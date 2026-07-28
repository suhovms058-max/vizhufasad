import {
  PHOTO_ASSESSMENT_SCHEMA_VERSION, providerObservationSchema,
} from "./schema.mjs";
import {
  PHOTO_ASSESSMENT_PROMPT_VERSION, photoAssessmentPrompt,
} from "./prompt.mjs";

export class PhotoAssessmentProviderError extends Error {
  constructor(code, { retryable = false, status } = {}) {
    super(code);
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

function responseText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text) return payload.output_text;
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && content.text) return content.text;
    }
  }
  throw new PhotoAssessmentProviderError("PROVIDER_EMPTY_OUTPUT", { retryable: true });
}

function requestBody({ model, image }) {
  return {
    model,
    store: false,
    max_output_tokens: 900,
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: photoAssessmentPrompt },
        {
          type: "input_image",
          image_url: `data:image/jpeg;base64,${image.toString("base64")}`,
          detail: "low",
        },
      ],
    }],
    text: {
      format: {
        type: "json_schema",
        name: PHOTO_ASSESSMENT_SCHEMA_VERSION,
        description: `Facade photo observations for prompt ${PHOTO_ASSESSMENT_PROMPT_VERSION}`,
        strict: true,
        schema: providerObservationSchema,
      },
    },
  };
}

async function callResponsesApi({ fetchImplementation, endpoint, headers, model, image, signal, name }) {
  let response;
  try {
    response = await fetchImplementation(endpoint, {
      method: "POST",
      signal,
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(requestBody({ model, image })),
    });
  } catch (error) {
    const timeout = error?.name === "AbortError" || error?.name === "TimeoutError";
    throw new PhotoAssessmentProviderError(
      timeout ? "PROVIDER_TIMEOUT" : "PROVIDER_NETWORK_ERROR",
      { retryable: true },
    );
  }
  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 409
      || response.status === 429 || response.status >= 500;
    throw new PhotoAssessmentProviderError(`${name.toUpperCase()}_HTTP_${response.status}`, {
      retryable,
      status: response.status,
    });
  }
  let payload;
  try {
    payload = await response.json();
    return {
      observation: JSON.parse(responseText(payload)),
      requestId: payload.id || response.headers.get("x-request-id") || null,
    };
  } catch (error) {
    if (error instanceof PhotoAssessmentProviderError) throw error;
    throw new PhotoAssessmentProviderError("PROVIDER_INVALID_JSON", { retryable: true });
  }
}

export class OpenAiPhotoAssessmentProvider {
  constructor({
    apiKey,
    model,
    fetchImplementation = fetch,
    endpoint = "https://api.openai.com/v1/responses",
  }) {
    this.name = "openai";
    this.model = model;
    this.apiKey = apiKey;
    this.fetchImplementation = fetchImplementation;
    this.endpoint = endpoint;
  }

  assess({ image, signal }) {
    return callResponsesApi({
      fetchImplementation: this.fetchImplementation,
      endpoint: this.endpoint,
      headers: { Authorization: `Bearer ${this.apiKey}` },
      model: this.model,
      image,
      signal,
      name: this.name,
    });
  }
}

export class YandexPhotoAssessmentProvider {
  constructor({
    apiKey,
    folderId,
    model,
    fetchImplementation = fetch,
    endpoint = "https://ai.api.cloud.yandex.net/v1/responses",
  }) {
    this.name = "yandex";
    this.model = model;
    this.apiKey = apiKey;
    this.folderId = folderId;
    this.fetchImplementation = fetchImplementation;
    this.endpoint = endpoint;
  }

  assess({ image, signal }) {
    return callResponsesApi({
      fetchImplementation: this.fetchImplementation,
      endpoint: this.endpoint,
      headers: {
        Authorization: `Api-Key ${this.apiKey}`,
        "OpenAI-Project": this.folderId,
      },
      model: `gpt://${this.folderId}/${this.model}`,
      image,
      signal,
      name: this.name,
    });
  }
}

export function createPhotoAssessmentProviders(config, environment = process.env) {
  const providers = {};
  if (config.primary === "yandex" || config.fallback === "yandex") {
    providers.yandex = new YandexPhotoAssessmentProvider({
      apiKey: environment.YANDEX_API_KEY,
      folderId: environment.YANDEX_FOLDER_ID,
      model: config.models.yandex,
    });
  }
  if (config.primary === "openai" || config.fallback === "openai") {
    providers.openai = new OpenAiPhotoAssessmentProvider({
      apiKey: environment.OPENAI_API_KEY,
      model: config.models.openai,
    });
  }
  return providers;
}
