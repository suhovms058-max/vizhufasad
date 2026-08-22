import { GenerationError } from "../contract.mjs";

function providerError(code, status, retryable, details = null) {
  return new GenerationError(code, status, { retryable, details });
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function retryableStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function imageResultUrl(payload) {
  const candidates = [
    ...(Array.isArray(payload?.result) ? payload.result : []),
    ...(Array.isArray(payload?.full_response)
      ? payload.full_response.map((item) => item?.url || item?.image || item?.output)
      : []),
  ];
  const value = candidates.find((item) => typeof item === "string" && item);
  if (!value) throw providerError("GENAPI_EMPTY_RESULT", 502, true);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw providerError("GENAPI_INVALID_RESULT_URL", 502, false);
  }
  if (url.protocol !== "https:") throw providerError("GENAPI_INSECURE_RESULT_URL", 502, false);
  return url.toString();
}

async function readLimitedBody(response, maxBytes) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw providerError("GENAPI_RESULT_TOO_LARGE", 502, false);
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > maxBytes) throw providerError("GENAPI_RESULT_TOO_LARGE", 502, false);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, total);
}

function wait(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(providerError("GENAPI_TIMEOUT", 504, true));
    }, { once: true });
  });
}

function closestAspectRatio(width, height) {
  const ratio = Number(width) / Number(height);
  const candidates = [
    ["1:1", 1],
    ["4:3", 4 / 3],
    ["3:4", 3 / 4],
    ["16:9", 16 / 9],
    ["9:16", 9 / 16],
  ];
  return candidates.reduce((best, item) => (
    Math.abs(Math.log(ratio / item[1])) < Math.abs(Math.log(ratio / best[1])) ? item : best
  ))[0];
}

function appendSource(body, field, sourceImage, sourceMimeType) {
  const extension = sourceMimeType === "image/png" ? "png"
    : sourceMimeType === "image/webp" ? "webp" : "jpg";
  body.append(field, new Blob([sourceImage], { type: sourceMimeType }), `source.${extension}`);
}

function createGenerationBody({ model, sourceImage, sourceMimeType, prompt, seed, width, height }) {
  const body = new FormData();
  if (model === "nano-banana-2") {
    body.append("is_sync", "false");
    body.append("prompt", prompt);
    appendSource(body, "image_urls[]", sourceImage, sourceMimeType);
    body.append("aspect_ratio", closestAspectRatio(width, height));
    body.append("resolution", "1K");
    body.append("num_images", "1");
    body.append("seed", String(seed));
    body.append("output_format", "png");
    body.append("enable_web_search", "false");
    return body;
  }
  if (model === "seedream-v5-pro" || model === "seedream-v5-lite") {
    body.append("translate_input", "false");
    body.append("is_sync", "false");
    body.append("prompt", prompt);
    appendSource(body, "image_urls[]", sourceImage, sourceMimeType);
    body.append("width", String(width));
    body.append("height", String(height));
    body.append("num_images", "1");
    body.append("output_format", "jpeg");
    body.append("enable_safety_checker", "true");
    return body;
  }
  if (model === "flux-kontext") {
    body.append("is_sync", "false");
    body.append("translate_input", "false");
    body.append("prompt", prompt);
    body.append("model", "max");
    body.append("guidance_scale", "3.5");
    body.append("num_images", "1");
    body.append("output_format", "jpeg");
    body.append("safety_tolerance", "2");
    body.append("aspect_ratio", closestAspectRatio(width, height));
    appendSource(body, "images[]", sourceImage, sourceMimeType);
    return body;
  }
  if (model === "restyle") {
    body.append("translate_input", "false");
    appendSource(body, "image", sourceImage, sourceMimeType);
    body.append("prompt", prompt);
    body.append(
      "negative_prompt",
      "unfinished, raw blockwork, primer only, flat painted shell, missing soffit, missing cornice, "
        + "unclad columns, exposed concrete, cartoon, painting, changed geometry, extra windows, text",
    );
    body.append("num_images", "1");
    body.append("image_size", "input");
    body.append("num_inference_steps", "30");
    body.append("guidance_scale", "7.5");
    body.append("scheduler", "DPM++ 2M");
    body.append("image_format", "png");
    body.append("enable_safety_checker", "true");
    return body;
  }
  body.append("translate_input", "false");
  body.append("prompt", prompt);
  appendSource(body, "image_urls[]", sourceImage, sourceMimeType);
  body.append("width", String(width));
  body.append("height", String(height));
  body.append("enable_safety_checker", "true");
  body.append("seed", String(seed));
  body.append("output_format", "png");
  return body;
}

export class GenApiGenerationProvider {
  constructor({
    apiKey,
    model = "nano-banana-2",
    endpoint = "https://api.gen-api.ru/api/v1",
    estimatedCostMinor = 2500,
    currency = "RUB",
    pollIntervalMs = 1500,
    resultMaxBytes = 25 * 1024 * 1024,
    generationKinds = ["standard"],
    fetchImplementation = fetch,
  }) {
    this.name = "genapi";
    this.model = model;
    this.apiKey = apiKey;
    this.endpoint = endpoint.replace(/\/+$/u, "");
    this.estimatedCostMinor = estimatedCostMinor;
    this.currency = currency;
    this.pollIntervalMs = pollIntervalMs;
    this.resultMaxBytes = resultMaxBytes;
    this.generationKinds = generationKinds;
    this.fetchImplementation = fetchImplementation;
  }

  headers(contentType) {
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (contentType) headers["Content-Type"] = contentType;
    return headers;
  }

  async request(path, options, signal) {
    let response;
    try {
      response = await this.fetchImplementation(`${this.endpoint}${path}`, {
        ...options,
        signal,
      });
    } catch (error) {
      if (error instanceof GenerationError) throw error;
      const timeout = error?.name === "AbortError" || error?.name === "TimeoutError";
      throw providerError(timeout ? "GENAPI_TIMEOUT" : "GENAPI_NETWORK_ERROR", 503, true);
    }
    if (!response.ok) {
      const payload = await safeJson(response);
      throw providerError(
        `GENAPI_HTTP_${response.status}`,
        response.status === 401 || response.status === 403 ? 503 : 502,
        retryableStatus(response.status),
        payload?.errors_validation || payload?.error || payload?.message || null,
      );
    }
    return response;
  }

  async generate({ sourceImage, sourceMimeType = "image/jpeg", prompt, seed, width, height, signal }) {
    const submittedAt = Date.now();
    const body = createGenerationBody({
      model: this.model,
      sourceImage,
      sourceMimeType,
      prompt,
      seed,
      width,
      height,
    });
    const createResponse = await this.request(`/networks/${encodeURIComponent(this.model)}`, {
      method: "POST",
      headers: this.headers(),
      body,
    }, signal);
    const created = await safeJson(createResponse);
    const requestId = created?.request_id ?? created?.id;
    if (requestId == null) throw providerError("GENAPI_INVALID_CREATE_RESPONSE", 502, true);

    let payload;
    while (true) {
      await wait(this.pollIntervalMs, signal);
      const resultResponse = await this.request(`/request/get/${encodeURIComponent(requestId)}`, {
        method: "GET",
        headers: this.headers(),
      }, signal);
      payload = await safeJson(resultResponse);
      if (!payload) throw providerError("GENAPI_INVALID_POLL_RESPONSE", 502, true);
      if (payload.status === "success") break;
      if (payload.status === "error" || payload.status === "failed") {
        throw providerError("GENAPI_GENERATION_FAILED", 502, true, payload.error || null);
      }
      if (!["processing", "starting", "pending", "queued"].includes(payload.status)) {
        throw providerError("GENAPI_UNKNOWN_STATUS", 502, true, payload.status);
      }
    }

    const resultUrl = imageResultUrl(payload);
    const resultResponse = await this.requestResult(resultUrl, signal);
    const contentType = String(resultResponse.headers.get("content-type") || "").split(";")[0];
    if (!["image/png", "image/jpeg", "image/webp"].includes(contentType)) {
      throw providerError("GENAPI_INVALID_RESULT_TYPE", 502, false, contentType);
    }
    const result = await readLimitedBody(resultResponse, this.resultMaxBytes);
    if (!result.length) throw providerError("GENAPI_EMPTY_RESULT", 502, true);
    return {
      provider: this.name,
      jobId: String(requestId),
      model: this.model,
      seed,
      durationMs: Math.max(0, Math.round(Number(payload.runtime || 0) * 1000))
        || Date.now() - submittedAt,
      estimatedCostMinor: this.estimatedCostMinor,
      actualCostMinor: Number.isFinite(Number(payload.cost))
        ? Math.max(0, Math.round(Number(payload.cost) * 100))
        : null,
      currency: this.currency,
      contentType,
      result,
    };
  }

  async requestResult(url, signal) {
    let currentUrl = url;
    for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
      let response;
      try {
        response = await this.fetchImplementation(currentUrl, {
          method: "GET",
          redirect: "manual",
          signal,
          headers: { Accept: "image/png,image/jpeg,image/webp" },
        });
      } catch (error) {
        const timeout = error?.name === "AbortError" || error?.name === "TimeoutError";
        throw providerError(timeout ? "GENAPI_TIMEOUT" : "GENAPI_RESULT_DOWNLOAD_FAILED", 503, true);
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        let nextUrl;
        try {
          nextUrl = new URL(location, currentUrl);
        } catch {
          throw providerError("GENAPI_INVALID_RESULT_REDIRECT", 502, false);
        }
        if (nextUrl.protocol !== "https:") {
          throw providerError("GENAPI_INSECURE_RESULT_REDIRECT", 502, false);
        }
        currentUrl = nextUrl.toString();
        continue;
      }
      if (!response.ok) {
        throw providerError(`GENAPI_RESULT_HTTP_${response.status}`, 502, retryableStatus(response.status));
      }
      return response;
    }
    throw providerError("GENAPI_TOO_MANY_RESULT_REDIRECTS", 502, false);
  }
}
