import { setTimeout as wait } from "node:timers/promises";
import { UpscaleError } from "../contract.mjs";

function retryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

async function json(response) {
  try { return await response.json(); } catch { return null; }
}

function resultUrl(payload) {
  const value = payload?.result?.[0] || payload?.output?.[0] || payload?.output || payload?.url;
  if (!value) throw new UpscaleError("UPSCALE_EMPTY_RESULT", 502, { retryable: true });
  const url = new URL(String(value));
  if (url.protocol !== "https:") throw new UpscaleError("UPSCALE_INSECURE_RESULT_URL", 502);
  return url;
}

async function responseBuffer(response, maxBytes) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new UpscaleError("UPSCALE_RESULT_TOO_LARGE", 502);
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > maxBytes) throw new UpscaleError("UPSCALE_RESULT_TOO_LARGE", 502);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, total);
}

export class GenApiUpscaleProvider {
  constructor({
    apiKey,
    model = "drct-super-resolution",
    endpoint = "https://api.gen-api.ru/api/v1",
    factor = 4,
    estimatedCostMinor = 1000,
    currency = "RUB",
    pollIntervalMs = 1500,
    resultMaxBytes = 50 * 1024 * 1024,
    fetchImplementation = fetch,
  }) {
    this.name = "genapi";
    this.model = model;
    this.apiKey = apiKey;
    this.endpoint = endpoint.replace(/\/+$/u, "");
    this.factor = factor;
    this.estimatedCostMinor = estimatedCostMinor;
    this.currency = currency;
    this.pollIntervalMs = pollIntervalMs;
    this.resultMaxBytes = resultMaxBytes;
    this.fetchImplementation = fetchImplementation;
  }

  headers() {
    return { Accept: "application/json", Authorization: `Bearer ${this.apiKey}` };
  }

  async request(path, options, signal) {
    let response;
    try {
      response = await this.fetchImplementation(`${this.endpoint}${path}`, {
        ...options, headers: { ...this.headers(), ...(options.headers || {}) }, signal,
      });
    } catch (error) {
      throw new UpscaleError("UPSCALE_NETWORK_ERROR", 503, { retryable: true, details: error?.message });
    }
    if (!response.ok) {
      const payload = await json(response);
      throw new UpscaleError(`UPSCALE_HTTP_${response.status}`, 502, {
        retryable: retryableStatus(response.status),
        details: payload?.error || payload?.message || null,
      });
    }
    return response;
  }

  async upscale({
    sourceImage, sourceMimeType = "image/jpeg", signal,
    resumeRequestId = null, onSubmitted = null,
  }) {
    const startedAt = Date.now();
    let requestId = resumeRequestId;
    if (requestId == null) {
      const body = new FormData();
      const extension = sourceMimeType === "image/png" ? "png" : "jpg";
      body.append("image_url", new Blob([sourceImage], { type: sourceMimeType }), `source.${extension}`);
      body.append("upscaling_factor", String(this.factor));
      body.append("is_sync", "false");
      const created = await json(await this.request(`/networks/${encodeURIComponent(this.model)}`, {
        method: "POST", body,
      }, signal));
      requestId = created?.request_id ?? created?.id;
      if (requestId == null) throw new UpscaleError("UPSCALE_INVALID_CREATE_RESPONSE", 502, { retryable: true });
      if (onSubmitted) await onSubmitted(String(requestId));
    }
    let payload;
    while (true) {
      await wait(this.pollIntervalMs, undefined, { signal });
      payload = await json(await this.request(`/request/get/${encodeURIComponent(requestId)}`, {
        method: "GET",
      }, signal));
      if (["success", "completed", "done"].includes(payload?.status)) break;
      if (["failed", "error", "cancelled"].includes(payload?.status)) {
        throw new UpscaleError("UPSCALE_PROVIDER_FAILED", 502, { retryable: true });
      }
    }
    let downloaded;
    try {
      downloaded = await this.fetchImplementation(resultUrl(payload), { signal, redirect: "error" });
    } catch (error) {
      throw new UpscaleError("UPSCALE_RESULT_DOWNLOAD_FAILED", 503, {
        retryable: true, details: error?.message,
      });
    }
    if (!downloaded.ok) {
      throw new UpscaleError("UPSCALE_RESULT_DOWNLOAD_FAILED", 502, {
        retryable: retryableStatus(downloaded.status),
      });
    }
    if (!String(downloaded.headers.get("content-type") || "").toLowerCase().startsWith("image/")) {
      throw new UpscaleError("UPSCALE_INVALID_RESULT_TYPE", 502);
    }
    return {
      provider: this.name,
      model: this.model,
      requestId: String(requestId),
      result: await responseBuffer(downloaded, this.resultMaxBytes),
      durationMs: Date.now() - startedAt,
      estimatedCostMinor: this.estimatedCostMinor,
      actualCostMinor: Number.isFinite(Number(payload?.cost)) ? Math.round(Number(payload.cost) * 100) : null,
      currency: this.currency,
    };
  }
}
