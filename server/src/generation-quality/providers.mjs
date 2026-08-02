import {
  GENERATION_QUALITY_SCHEMA_VERSION, GenerationQualityError,
  VLM_QUALITY_RESULT_SCHEMA,
} from "./contract.mjs";

function responseText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text) return payload.output_text;
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && content.text) return content.text;
    }
  }
  throw new GenerationQualityError("QUALITY_PROVIDER_EMPTY_OUTPUT", { retryable: true });
}

function requestBody({ model, sourceImage, candidateImage, prompt }) {
  return {
    model,
    store: false,
    max_output_tokens: 1_200,
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: prompt },
        { type: "input_text", text: "IMAGE 1 — source photograph:" },
        { type: "input_image", image_url: `data:image/jpeg;base64,${sourceImage.toString("base64")}`, detail: "low" },
        { type: "input_text", text: "IMAGE 2 — generated candidate:" },
        { type: "input_image", image_url: `data:image/jpeg;base64,${candidateImage.toString("base64")}`, detail: "low" },
      ],
    }],
    text: {
      format: {
        type: "json_schema",
        name: GENERATION_QUALITY_SCHEMA_VERSION,
        description: "Automatic facade generation quality scores",
        strict: true,
        schema: VLM_QUALITY_RESULT_SCHEMA,
      },
    },
  };
}

class ResponsesGenerationQualityProvider {
  constructor({ name, apiKey, model, endpoint, headers = {}, fetchImplementation = fetch }) {
    this.name = name;
    this.apiKey = apiKey;
    this.model = model;
    this.endpoint = endpoint;
    this.headers = headers;
    this.fetchImplementation = fetchImplementation;
  }

  async compare({ sourceImage, candidateImage, prompt, signal }) {
    let response;
    try {
      response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...this.headers,
        },
        body: JSON.stringify(requestBody({
          model: this.model, sourceImage, candidateImage, prompt,
        })),
      });
    } catch (error) {
      const timeout = error?.name === "AbortError" || error?.name === "TimeoutError";
      throw new GenerationQualityError(
        timeout ? "QUALITY_PROVIDER_TIMEOUT" : "QUALITY_PROVIDER_NETWORK_ERROR",
        { retryable: true },
      );
    }
    if (!response.ok) {
      const retryable = [408, 409, 429].includes(response.status) || response.status >= 500;
      throw new GenerationQualityError(`QUALITY_${this.name.toUpperCase()}_HTTP_${response.status}`, {
        retryable,
      });
    }
    try {
      const payload = await response.json();
      return {
        observation: JSON.parse(responseText(payload)),
        requestId: payload.id || response.headers.get("x-request-id") || null,
      };
    } catch (error) {
      if (error instanceof GenerationQualityError) throw error;
      throw new GenerationQualityError("QUALITY_PROVIDER_INVALID_JSON", { retryable: true });
    }
  }
}

export class YandexGenerationQualityProvider extends ResponsesGenerationQualityProvider {
  constructor({ apiKey, folderId, model, fetchImplementation = fetch }) {
    const modelUri = String(model).startsWith("gpt://")
      ? String(model)
      : `gpt://${folderId}/${model}/latest`;
    super({
      name: "yandex",
      apiKey,
      model: modelUri,
      endpoint: "https://ai.api.cloud.yandex.net/v1/responses",
      headers: { Authorization: `Api-Key ${apiKey}`, "OpenAI-Project": folderId },
      fetchImplementation,
    });
  }
}

export class OpenAiGenerationQualityProvider extends ResponsesGenerationQualityProvider {
  constructor({ apiKey, model, fetchImplementation = fetch }) {
    super({
      name: "openai", apiKey, model,
      endpoint: "https://api.openai.com/v1/responses",
      fetchImplementation,
    });
  }
}

export function createGenerationQualityProviders(config, environment = process.env) {
  const result = {};
  if (config.primary === "yandex" || config.fallback === "yandex") {
    result.yandex = new YandexGenerationQualityProvider({
      apiKey: environment.YANDEX_API_KEY,
      folderId: environment.YANDEX_FOLDER_ID,
      model: config.models.yandex,
    });
  }
  if (config.primary === "openai" || config.fallback === "openai") {
    result.openai = new OpenAiGenerationQualityProvider({
      apiKey: environment.OPENAI_API_KEY,
      model: config.models.openai,
    });
  }
  return result;
}
