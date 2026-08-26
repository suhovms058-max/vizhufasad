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

function appendSource(body, field, sourceImage, sourceMimeType, basename = "source") {
  const extension = sourceMimeType === "image/png" ? "png"
    : sourceMimeType === "image/webp" ? "webp" : "jpg";
  body.append(field, new Blob([sourceImage], { type: sourceMimeType }), `${basename}.${extension}`);
}

function truncateUtf8(value, maxBytes) {
  let result = "";
  let bytes = 0;
  for (const character of value) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > maxBytes) break;
    result += character;
    bytes += size;
  }
  return result.trimEnd();
}

function compactEditPrompt(prompt, maxBytes = 1900) {
  const value = String(prompt || "").trim();
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  const lines = value.split("\n").map((line) => line.trim()).filter(Boolean);
  const priorities = [
    /^TASK:/u,
    /^EDIT BOUNDARY:/u,
    /^STRUCTURAL LOCK:/u,
    /^OPENING LOCK:/u,
    /^AUTOMATIC QUALITY RETRY:/u,
    /^RETRY OPENING LOCK:/u,
    /^SAFETY COMPLETION:/u,
    /^STRICTLY PRESERVE:/u,
    /^Never add a new storey/u,
    /^Do not change any protected/u,
    /^Required client wishes:/u,
    /^Required facade style:/u,
    /^Required finish materials:/u,
    /^Required color palette:/u,
    /^Additional forbidden changes:/u,
    /^COMPLETION STANDARD:/u,
  ];
  const selected = [];
  for (const pattern of priorities) {
    for (const line of lines) {
      if (pattern.test(line) && !selected.includes(line)) selected.push(line);
    }
  }
  for (const line of lines) {
    if (!selected.includes(line)) selected.push(line);
  }
  return truncateUtf8(selected.join("\n"), maxBytes);
}

function compactSeedreamPrompt(prompt) {
  // GenAPI rejects Seedream prompts longer than 5,000 characters. Keep a
  // small safety margin and prioritize the structural/retry locks when the
  // complete brief exceeds that upstream limit.
  return compactEditPrompt(prompt, 4800);
}

function compactMaskPrompt(prompt) {
  const value = String(prompt || "");
  const command = value.match(/Client command:\s*(.+?)(?:\.\s*Everything outside|$)/su)?.[1]?.trim();
  if (command) {
    return truncateUtf8(
      `${command}. Фотореалистичная фасадная отделка внутри маски, с естественной текстурой, масштабом и освещением.`,
      800,
    );
  }
  return compactEditPrompt(value, 800);
}

function createGenerationBody({
  model, sourceImage, sourceMimeType, maskImage, maskMimeType, prompt, seed, width, height,
}) {
  const body = new FormData();
  if (maskImage && model !== "bria-genfill") {
    throw providerError("GENAPI_MODEL_MASK_UNSUPPORTED", 422, false);
  }
  if (model === "bria-genfill") {
    if (!maskImage) throw providerError("GENAPI_MASK_REQUIRED", 422, false);
    body.append("translate_input", "true");
    body.append("prompt", compactMaskPrompt(prompt));
    body.append("negative_prompt", "changes outside mask, changed building geometry, changed windows, changed doors, changed roof");
    appendSource(body, "image", sourceImage, sourceMimeType);
    appendSource(body, "mask", maskImage, maskMimeType, "mask");
    body.append("seed", String(seed));
    body.append("num_images", "1");
    return body;
  }
  if (model === "nano-banana-pro") {
    body.append("is_sync", "false");
    body.append("translate_input", "false");
    body.append("prompt", prompt);
    appendSource(body, "image_urls[]", sourceImage, sourceMimeType);
    body.append("aspect_ratio", closestAspectRatio(width, height));
    body.append("resolution", "2K");
    body.append("num_images", "1");
    body.append("output_format", "png");
    return body;
  }
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
  if (model === "qwen-image-edit-plus" || model === "qwen-image-edit") {
    body.append("translate_input", "false");
    body.append("prompt", compactEditPrompt(prompt));
    appendSource(body, model === "qwen-image-edit" ? "image_url" : "image_urls[]", sourceImage, sourceMimeType);
    body.append("negative_prompt", "changed house geometry, changed windows, changed doors, changed roof, artifacts");
    body.append("width", String(width));
    body.append("height", String(height));
    body.append("num_images", "1");
    body.append("seed", String(seed));
    body.append("output_format", "png");
    body.append("guidance_scale", "4");
    body.append("num_inference_steps", model === "qwen-image-edit-plus" ? "50" : "30");
    body.append("enable_safety_checker", "true");
    return body;
  }
  if (model === "qwen-image-edit-2511") {
    body.append("translate_input", "false");
    body.append("prompt", compactEditPrompt(prompt));
    appendSource(body, "image_urls[]", sourceImage, sourceMimeType);
    body.append(
      "negative_prompt",
      "changed building geometry, changed floor count, changed roof, extra windows, missing windows, "
        + "extra doors, missing doors, shifted openings, new balcony, missing balcony, new terrace, "
        + "missing terrace, changed posts, changed canopy, changed camera perspective, duplicate objects, artifacts",
    );
    body.append("width", String(width));
    body.append("height", String(height));
    body.append("num_images", "1");
    body.append("seed", String(seed));
    body.append("output_format", "png");
    body.append("guidance_scale", "4.5");
    body.append("num_inference_steps", "28");
    body.append("enable_safety_checker", "true");
    body.append("acceleration", "regular");
    return body;
  }
  if (model === "seedream-v5-pro" || model === "seedream-v5-lite") {
    body.append("translate_input", "false");
    body.append("is_sync", "false");
    body.append("prompt", compactSeedreamPrompt(prompt));
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
    editScopes = null,
    candidateNumbers = null,
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
    this.editScopes = editScopes;
    this.candidateNumbers = candidateNumbers;
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

  async generate({
    sourceImage, sourceMimeType = "image/jpeg", maskImage = null,
    maskMimeType = "image/png", prompt, seed, width, height, signal,
    resumeRequestId = null, onSubmitted = null,
  }) {
    const submittedAt = Date.now();
    let requestId = resumeRequestId;
    if (requestId == null) {
      const body = createGenerationBody({
        model: this.model,
        sourceImage,
        sourceMimeType,
        maskImage,
        maskMimeType,
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
      requestId = created?.request_id ?? created?.id;
      if (requestId == null) throw providerError("GENAPI_INVALID_CREATE_RESPONSE", 502, true);
      if (onSubmitted) await onSubmitted(String(requestId));
    }

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
        const error = providerError("GENAPI_GENERATION_FAILED", 502, true, payload.error || null);
        if (Number.isFinite(Number(payload.cost))) {
          error.actualCostMinor = Math.max(0, Math.round(Number(payload.cost) * 100));
          error.costCurrency = this.currency;
        }
        throw error;
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
