import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import multer from "multer";
import nodemailer from "nodemailer";
import sharp from "sharp";

const required = ["SITE_ORIGIN", "MAX_BOT_TOKEN", "MAX_CHAT_ID", "SMTP_USER", "SMTP_PASSWORD", "LEADS_EMAIL"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const app = express();
const port = Number(process.env.PORT || 8080);
const maxApi = "https://platform-api2.max.ru";
const allowedImages = new Set(["image/jpeg", "image/png", "image/webp"]);
const dataDir = path.resolve(process.env.DATA_DIR || "./data");
const ordersDir = path.join(dataDir, "orders");
const photosDir = path.join(dataDir, "photos");
const requestedAiProvider = cleanProvider(process.env.AI_PROVIDER || "auto");
const yandexConfigured = Boolean(process.env.YANDEX_API_KEY && process.env.YANDEX_FOLDER_ID);
const openAiConfigured = Boolean(process.env.OPENAI_API_KEY);
const aiProvider = requestedAiProvider === "auto"
  ? (yandexConfigured ? "yandex" : (openAiConfigured ? "openai" : "none"))
  : requestedAiProvider;
const aiEnabled = aiProvider === "yandex" ? yandexConfigured : aiProvider === "openai" ? openAiConfigured : false;
const aiModel = aiProvider === "yandex"
  ? (process.env.YANDEX_MODEL || "qwen3.6-35b-a3b")
  : (process.env.OPENAI_MODEL || "gpt-4.1-mini");
await Promise.all([mkdir(ordersDir, { recursive: true }), mkdir(photosDir, { recursive: true })]);

app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: process.env.SITE_ORIGIN, methods: ["GET", "POST"] }));
app.use(express.json({ limit: "32kb" }));
app.use("/api/leads", rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true }));
app.use("/api/orders", rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 8 },
  fileFilter: (_request, file, callback) => {
    if (!allowedImages.has(file.mimetype)) return callback(new Error("UNSUPPORTED_IMAGE"));
    return callback(null, true);
  },
});

const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.mail.ru",
  port: Number(process.env.SMTP_PORT || 465),
  secure: String(process.env.SMTP_SECURE || "true") === "true",
  family: 4,
  connectionTimeout: 15_000,
  greetingTimeout: 15_000,
  socketTimeout: 30_000,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
});

const clean = (value, max = 500) => String(value || "").replace(/[<>]/g, "").trim().slice(0, max);
function cleanProvider(value) {
  const provider = String(value || "auto").trim().toLowerCase();
  return new Set(["auto", "yandex", "openai", "none"]).has(provider) ? provider : "auto";
}
const makeOrderId = () => {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `VF-${date}-${randomBytes(4).toString("hex").toUpperCase()}`;
};
const imageExtension = (mime) => ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[mime] || "img");
const orderFile = (id) => path.join(ordersDir, `${id}.json`);
const saveOrder = (order) => writeFile(orderFile(order.id), JSON.stringify(order, null, 2), { mode: 0o600 });

async function assessPhoto(file) {
  const image = sharp(file.buffer, { failOn: "warning" });
  const [metadata, stats] = await Promise.all([image.metadata(), image.stats()]);
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  const reasons = [];
  const meetsMinimumResolution = shortSide >= 420 && longSide >= 640;
  const meetsRecommendedResolution = shortSide >= 800 && longSide >= 1200;
  if (!meetsMinimumResolution) reasons.push("Разрешение фото ниже минимально допустимого — 640×420");
  else if (!meetsRecommendedResolution) reasons.push("Разрешение ниже рекомендуемого, но допустимо для обработки");
  if (width && height && (width / height < 0.45 || width / height > 2.6)) reasons.push("Слишком узкий или панорамный кадр");
  if (stats.entropy < 2.4) reasons.push("На снимке мало различимых деталей");
  const accepted = meetsMinimumResolution;
  return {
    accepted,
    label: accepted ? "Фото подходит для автоматической обработки" : "Нужна проверка качества фото",
    reasons,
    width,
    height,
    format: metadata.format,
  };
}

const aiPhotoSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    decision: { type: "string", enum: ["accepted", "retake_required", "manual_review"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    houseVisible: { type: "boolean" },
    facadeVisible: { type: "boolean" },
    geometryReadable: { type: "boolean" },
    obstructionLevel: { type: "string", enum: ["none", "minor", "major"] },
    perspective: { type: "string", enum: ["good", "acceptable", "poor"] },
    issues: { type: "array", items: { type: "string" }, maxItems: 6 },
    customerMessage: { type: "string" },
    operatorSummary: { type: "string" },
  },
  required: [
    "decision", "confidence", "houseVisible", "facadeVisible", "geometryReadable",
    "obstructionLevel", "perspective", "issues", "customerMessage", "operatorSummary",
  ],
};

function readResponseText(payload) {
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && content.text) return content.text;
    }
  }
  throw new Error("OPENAI_EMPTY_OUTPUT");
}

const assessmentPrompt = [
  "Ты проверяешь фотографию дома для сервиса визуализации отделки фасада.",
  "Оцени только пригодность исходного фото, не предлагай дизайн.",
  "accepted: фасад и основные границы дома хорошо видны, геометрия читается, перспектива пригодна для визуализации.",
  "retake_required: это не дом или фасад, дом почти не виден, кадр сильно перекрыт, обрезан или геометрия нечитаема.",
  "manual_review: пограничный случай, где решение должен принять оператор.",
  "Небольшие деревья, забор или перспективные искажения допустимы.",
  "Верни только JSON без Markdown со всеми полями: decision, confidence, houseVisible, facadeVisible, geometryReadable, obstructionLevel, perspective, issues, customerMessage, operatorSummary.",
  "decision: accepted, retake_required или manual_review; confidence: число 0..1; obstructionLevel: none, minor или major; perspective: good, acceptable или poor.",
  "issues — массив не более 6 коротких строк. customerMessage и operatorSummary пиши по-русски, просто и доброжелательно.",
].join(" ");

function parseAssessment(text) {
  const normalized = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = normalized.indexOf("{");
  const end = normalized.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI_INVALID_JSON");
  const result = JSON.parse(normalized.slice(start, end + 1));
  const decisions = new Set(["accepted", "retake_required", "manual_review"]);
  const obstructions = new Set(["none", "minor", "major"]);
  const perspectives = new Set(["good", "acceptable", "poor"]);
  if (!decisions.has(result.decision) || !obstructions.has(result.obstructionLevel) || !perspectives.has(result.perspective)) {
    throw new Error("AI_INVALID_ASSESSMENT");
  }
  const confidence = Number(result.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("AI_INVALID_CONFIDENCE");
  return {
    decision: result.decision,
    confidence,
    houseVisible: Boolean(result.houseVisible),
    facadeVisible: Boolean(result.facadeVisible),
    geometryReadable: Boolean(result.geometryReadable),
    obstructionLevel: result.obstructionLevel,
    perspective: result.perspective,
    issues: Array.isArray(result.issues) ? result.issues.map((item) => clean(item, 180)).filter(Boolean).slice(0, 6) : [],
    customerMessage: clean(result.customerMessage, 600),
    operatorSummary: clean(result.operatorSummary, 600),
  };
}

async function assessPhotoWithYandex(file, signal) {
  const imageUrl = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
  const apiResponse = await fetch("https://ai.api.cloud.yandex.net/v1/chat/completions", {
    method: "POST",
    signal,
    headers: {
      Authorization: `Api-Key ${process.env.YANDEX_API_KEY}`,
      "OpenAI-Project": process.env.YANDEX_FOLDER_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: `gpt://${process.env.YANDEX_FOLDER_ID}/${aiModel}`,
      temperature: 0.1,
      max_tokens: 900,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: assessmentPrompt },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      }],
    }),
  });
  if (!apiResponse.ok) throw new Error(`YANDEX_${apiResponse.status}: ${(await apiResponse.text()).slice(0, 500)}`);
  const payload = await apiResponse.json();
  return parseAssessment(payload?.choices?.[0]?.message?.content);
}

async function assessPhotoWithOpenAi(file, signal) {
  const imageUrl = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
  const apiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: aiModel,
      store: false,
      max_output_tokens: 900,
      input: [{ role: "user", content: [
        { type: "input_text", text: assessmentPrompt },
        { type: "input_image", image_url: imageUrl, detail: "high" },
      ] }],
      text: { format: { type: "json_schema", name: "facade_photo_assessment", strict: true, schema: aiPhotoSchema } },
    }),
  });
  if (!apiResponse.ok) throw new Error(`OPENAI_${apiResponse.status}: ${(await apiResponse.text()).slice(0, 500)}`);
  return parseAssessment(readResponseText(await apiResponse.json()));
}

async function assessPhotoWithAi(file) {
  if (!aiEnabled) return { enabled: false, status: "not_configured" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.AI_TIMEOUT_MS || process.env.OPENAI_TIMEOUT_MS || 45_000));
  try {
    const result = aiProvider === "yandex"
      ? await assessPhotoWithYandex(file, controller.signal)
      : await assessPhotoWithOpenAi(file, controller.signal);
    return { enabled: true, status: "completed", provider: aiProvider, model: aiModel, checkedAt: new Date().toISOString(), ...result };
  } finally {
    clearTimeout(timeout);
  }
}

function decideOrderStatus(quality, aiAssessment) {
  if (!quality.accepted) return "photo_review_required";
  if (aiAssessment?.status !== "completed") return "queued_for_ai";
  if (aiAssessment.decision === "accepted" && aiAssessment.confidence >= 0.72) return "queued_for_generation";
  if (aiAssessment.decision === "retake_required" && aiAssessment.confidence >= 0.72) return "photo_retake_required";
  return "photo_review_required";
}

const formatLead = ({ id, name, contact, wishes, packageName, quality, aiAssessment, status }) => [
  "Новая заявка — ВИЖУФАСАД",
  `Номер: ${id}`,
  `Статус: ${status}`,
  `Проверка фото: ${quality.label}`,
  quality.reasons.length ? `Замечания: ${quality.reasons.join("; ")}` : null,
  `Размер фото: ${quality.width}×${quality.height}`,
  aiAssessment?.status === "completed" ? `ИИ-проверка: ${aiAssessment.decision} (${Math.round(aiAssessment.confidence * 100)}%)` : null,
  aiAssessment?.status === "completed" ? `Вывод ИИ: ${aiAssessment.operatorSummary}` : null,
  aiAssessment?.status === "failed" ? "ИИ-проверка временно недоступна — заявка сохранена для повторной обработки" : null,
  `Тариф: ${packageName}`,
  `Имя: ${name}`,
  `Контакт: ${contact}`,
  `Пожелания: ${wishes || "не указаны"}`,
].filter(Boolean).join("\n");

async function uploadToMax(file) {
  const prepare = await fetch(`${maxApi}/uploads?type=image`, { method: "POST", headers: { Authorization: process.env.MAX_BOT_TOKEN } });
  if (!prepare.ok) throw new Error(`MAX_UPLOAD_URL_${prepare.status}`);
  const { url } = await prepare.json();
  const form = new FormData();
  form.append("data", new Blob([file.buffer], { type: file.mimetype }), file.originalname);
  const uploaded = await fetch(url, { method: "POST", body: form });
  if (!uploaded.ok) throw new Error(`MAX_UPLOAD_${uploaded.status}`);
  return uploaded.json();
}

async function sendToMax(text, file) {
  const payload = await uploadToMax(file);
  for (const delay of [300, 1_000, 2_500]) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    const response = await fetch(`${maxApi}/messages?chat_id=${encodeURIComponent(process.env.MAX_CHAT_ID)}`, {
      method: "POST",
      headers: { Authorization: process.env.MAX_BOT_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ text, attachments: [{ type: "image", payload }], notify: true }),
    });
    if (response.ok) return;
    const details = (await response.text()).slice(0, 500);
    if (response.status === 400 && details.includes("attachment.not.ready")) continue;
    throw new Error(`MAX_MESSAGE_${response.status}: ${details}`);
  }
  throw new Error("MAX_MESSAGE_ATTACHMENT_NOT_READY");
}

async function sendToMail(text, file, contact) {
  await mailer.sendMail({
    from: `ВИЖУФАСАД <${process.env.SMTP_USER}>`,
    to: process.env.LEADS_EMAIL,
    replyTo: contact.includes("@") ? contact : undefined,
    subject: "Новая заявка с сайта ВИЖУФАСАД",
    text,
    attachments: [{ filename: file.originalname, content: file.buffer, contentType: file.mimetype }],
  });
}

app.get("/health", (_request, response) => response.json({
  ok: true,
  service: "vizhufasad-leads",
  automation: "photo-ai-v3",
  ai: aiEnabled ? "configured" : "not_configured",
  aiProvider,
}));

app.get("/api/orders/:id/status", async (request, response) => {
  try {
    const id = clean(request.params.id, 40);
    const order = JSON.parse(await readFile(orderFile(id), "utf8"));
    const token = clean(request.query.token, 80);
    if (!token || token !== order.statusToken) return response.status(404).json({ ok: false, error: "Заказ не найден" });
    const ai = order.aiAssessment?.status === "completed" ? {
      status: "completed",
      decision: order.aiAssessment.decision,
      confidence: order.aiAssessment.confidence,
      customerMessage: order.aiAssessment.customerMessage,
      issues: order.aiAssessment.issues,
    } : { status: order.aiAssessment?.status || "not_configured" };
    return response.json({ ok: true, orderId: order.id, status: order.status, quality: order.quality, ai, updatedAt: order.updatedAt });
  } catch {
    return response.status(404).json({ ok: false, error: "Заказ не найден" });
  }
});

app.post("/api/leads", upload.single("photo"), async (request, response) => {
  const name = clean(request.body.name, 80);
  const contact = clean(request.body.contact, 120);
  const wishes = clean(request.body.wishes, 1200);
  const packageName = clean(request.body.package, 80);
  if (!name || !contact || !packageName || !request.file) return response.status(400).json({ ok: false, error: "Заполните обязательные поля" });

  const id = makeOrderId();
  const now = new Date().toISOString();
  const statusToken = randomBytes(18).toString("hex");
  const quality = await assessPhoto(request.file);
  let aiAssessment = { enabled: aiEnabled, status: quality.accepted ? "pending" : "skipped_technical_check" };
  if (quality.accepted && aiEnabled) {
    try {
      aiAssessment = await assessPhotoWithAi(request.file);
    } catch (error) {
      console.error("AI photo assessment failed", error);
      aiAssessment = { enabled: true, status: "failed", checkedAt: new Date().toISOString(), error: String(error?.message || error).slice(0, 180) };
    }
  } else if (quality.accepted) {
    aiAssessment = { enabled: false, status: "not_configured" };
  }
  const status = decideOrderStatus(quality, aiAssessment);
  const storedPhoto = `${id}.${imageExtension(request.file.mimetype)}`;
  await writeFile(path.join(photosDir, storedPhoto), request.file.buffer, { mode: 0o600 });

  const order = {
    id, statusToken, createdAt: now, updatedAt: now, status, packageName,
    customer: { name, contact, wishes },
    photo: { storedAs: storedPhoto, originalName: clean(request.file.originalname, 160), mimeType: request.file.mimetype, size: request.file.size },
    quality,
    aiAssessment,
    deliveries: { max: "pending", email: "pending" },
    history: [{ at: now, status, note: aiAssessment.customerMessage || quality.label }],
  };
  await saveOrder(order);

  const text = formatLead({ id, name, contact, wishes, packageName, quality, aiAssessment, status });
  const deliveries = await Promise.allSettled([sendToMax(text, request.file), sendToMail(text, request.file, contact)]);
  const delivered = deliveries.filter((result) => result.status === "fulfilled").length;
  order.deliveries.max = deliveries[0].status === "fulfilled" ? "delivered" : "failed";
  order.deliveries.email = deliveries[1].status === "fulfilled" ? "delivered" : "failed";
  order.updatedAt = new Date().toISOString();
  await saveOrder(order);
  deliveries.forEach((result, index) => {
    if (result.status === "rejected") console.error(index === 0 ? "MAX delivery failed" : "Email delivery failed", result.reason);
  });
  if (!delivered) return response.status(502).json({ ok: false, error: "Заявка сохранена, но уведомления не отправлены", orderId: id });
  const ai = aiAssessment.status === "completed" ? {
    status: "completed",
    decision: aiAssessment.decision,
    confidence: aiAssessment.confidence,
    customerMessage: aiAssessment.customerMessage,
    issues: aiAssessment.issues,
  } : { status: aiAssessment.status };
  return response.status(201).json({ ok: true, delivered, orderId: id, statusToken, status, quality, ai });
});

app.use((error, _request, response, _next) => {
  if (error?.code === "LIMIT_FILE_SIZE") return response.status(413).json({ ok: false, error: "Фото должно быть не больше 15 МБ" });
  if (error?.message === "UNSUPPORTED_IMAGE") return response.status(415).json({ ok: false, error: "Поддерживаются JPG, PNG и WEBP" });
  console.error(error);
  return response.status(500).json({ ok: false, error: "Ошибка обработки заявки" });
});

app.listen(port, "0.0.0.0", () => console.log(`VIZHUFASAD leads API listening on ${port}`));
