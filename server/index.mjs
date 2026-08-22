import "dotenv/config";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import multer from "multer";
import nodemailer from "nodemailer";
import { loadAuthConfig } from "./src/auth/config.mjs";
import { createAuthRouter } from "./src/auth/http.mjs";
import { createAuthMailer } from "./src/auth/mailer.mjs";
import { createAuthPagesRouter } from "./src/auth/pages.mjs";
import { AuthRepository } from "./src/auth/repository.mjs";
import { AuthService } from "./src/auth/service.mjs";
import { closeDatabase } from "./src/db/client.mjs";
import { liveness, readiness } from "./src/health.mjs";
import { ensurePrivateBucket } from "./src/infra/storage.mjs";
import * as storage from "./src/infra/storage.mjs";
import { closeRedis } from "./src/infra/redis.mjs";
import { loadGenerationConfig } from "./src/generation/config.mjs";
import { loadGenerationQualityConfig } from "./src/generation-quality/config.mjs";
import { createGenerationQualityDiagnosticsRouter } from "./src/generation-quality/http.mjs";
import { GenerationQualityRepository } from "./src/generation-quality/repository.mjs";
import {
  createGenerationMetricsRouter, createGenerationRouter, createGenerationStagingRouter,
} from "./src/generation/http.mjs";
import { GenerationMetrics } from "./src/generation/metrics.mjs";
import { createGenerationQueue } from "./src/generation/queue.mjs";
import { GenerationRepository } from "./src/generation/repository.mjs";
import { GenerationService } from "./src/generation/service.mjs";
import { loadProjectConfig } from "./src/projects/config.mjs";
import { createProjectsRouter } from "./src/projects/http.mjs";
import { createProjectPagesRouter } from "./src/projects/pages.mjs";
import { ProjectRepository } from "./src/projects/repository.mjs";
import { ProjectService } from "./src/projects/service.mjs";
import { loadPhotoAssessmentConfig } from "./src/photo-assessment/config.mjs";
import { PhotoAssessmentOrchestrator } from "./src/photo-assessment/orchestrator.mjs";
import { createPhotoAssessmentProviders } from "./src/photo-assessment/providers.mjs";
import { PhotoAssessmentRepository } from "./src/photo-assessment/repository.mjs";
import { PhotoAssessmentService } from "./src/photo-assessment/service.mjs";
import { analyzeTechnicalPhoto } from "./src/photo-assessment/technical.mjs";
import { loadPaymentConfig } from "./src/payments/config.mjs";
import { createPaymentRouter, createPaymentWebhookRouter } from "./src/payments/http.mjs";
import { createPaymentPagesRouter } from "./src/payments/pages.mjs";
import { RobokassaPaymentProvider } from "./src/payments/providers/robokassa.mjs";
import { PaymentRepository } from "./src/payments/repository.mjs";
import { PaymentService } from "./src/payments/service.mjs";
import { loadWalletConfig } from "./src/wallet/config.mjs";
import { createCatalogRouter, createWalletRouter } from "./src/wallet/http.mjs";
import { createWalletPagesRouter } from "./src/wallet/pages.mjs";
import { WalletRepository } from "./src/wallet/repository.mjs";
import { WalletService } from "./src/wallet/service.mjs";
import { createComparisonRouter } from "./src/comparison/http.mjs";
import { ComparisonRepository } from "./src/comparison/repository.mjs";
import { ComparisonService } from "./src/comparison/service.mjs";
import { loadUpscaleConfig } from "./src/upscale/config.mjs";
import { createUpscaleRouter } from "./src/upscale/http.mjs";
import { createUpscaleQueue } from "./src/upscale/queue.mjs";
import { UpscaleRepository } from "./src/upscale/repository.mjs";
import { UpscaleService } from "./src/upscale/service.mjs";

const required = [
  "SITE_ORIGIN", "DATABASE_URL", "REDIS_URL", "S3_ENDPOINT",
  "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET",
];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(", ")}`);
  process.exit(1);
}
const notificationVariables = ["MAX_BOT_TOKEN", "MAX_CHAT_ID", "SMTP_USER", "SMTP_PASSWORD", "LEADS_EMAIL"];
const notificationsConfigured = notificationVariables.every((key) => process.env[key]);

const app = express();
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "0.0.0.0";
const storageOrigin = new URL(process.env.S3_ENDPOINT).origin;
const authConfig = loadAuthConfig();
const walletConfig = loadWalletConfig();
const paymentConfig = loadPaymentConfig();
const paymentCheckoutOrigin = new URL(paymentConfig.checkoutUrl).origin;
const walletRepository = new WalletRepository();
const walletService = new WalletService({
  repository: walletRepository,
  config: walletConfig,
});
const paymentRepository = new PaymentRepository();
const paymentProvider = new RobokassaPaymentProvider(paymentConfig);
const paymentService = new PaymentService({
  repository: paymentRepository,
  provider: paymentProvider,
  config: paymentConfig,
});
const generationConfig = loadGenerationConfig();
const upscaleConfig = loadUpscaleConfig();
const generationQualityConfig = loadGenerationQualityConfig();
const generationRepository = new GenerationRepository();
const generationQualityRepository = new GenerationQualityRepository();
const generationQueue = createGenerationQueue(generationConfig);
const generationService = new GenerationService({
  repository: generationRepository,
  storage,
  walletService,
  queue: generationQueue,
  config: generationConfig,
});
const upscaleRepository = new UpscaleRepository();
const upscaleQueue = createUpscaleQueue(upscaleConfig);
const upscaleService = new UpscaleService({
  repository: upscaleRepository,
  queue: upscaleQueue,
  walletService,
  storage,
  config: upscaleConfig,
});
const comparisonService = new ComparisonService({
  repository: new ComparisonRepository(),
  storage,
  signedUrlTtlSeconds: generationConfig.resultSignedUrlTtlSeconds,
});
const generationMetrics = new GenerationMetrics({
  repository: generationRepository,
  queue: generationQueue,
  qualityRepository: generationQualityRepository,
});
const authRepository = new AuthRepository(undefined, walletConfig);
const authService = new AuthService({
  repository: authRepository,
  mailer: createAuthMailer(authConfig),
  config: authConfig,
});
const projectConfig = loadProjectConfig();
const projectRepository = new ProjectRepository();
const photoAssessmentConfig = loadPhotoAssessmentConfig();
const photoAssessmentRepository = new PhotoAssessmentRepository();
const photoAssessmentOrchestrator = new PhotoAssessmentOrchestrator({
  providers: createPhotoAssessmentProviders(photoAssessmentConfig),
  config: photoAssessmentConfig,
});
const photoAssessmentService = new PhotoAssessmentService({
  repository: photoAssessmentRepository,
  orchestrator: photoAssessmentOrchestrator,
  storage,
});
const projectService = new ProjectService({
  repository: projectRepository,
  storage,
  config: projectConfig,
  assessmentService: photoAssessmentService,
});
const maxApi = "https://platform-api2.max.ru";
const allowedImages = new Set(["image/jpeg", "image/png", "image/webp"]);
const dataDir = path.resolve(process.env.DATA_DIR || "./data");
const ordersDir = path.join(dataDir, "orders");
const photosDir = path.join(dataDir, "photos");
const aiEnabled = photoAssessmentConfig.primary !== "none";
await Promise.all([
  mkdir(ordersDir, { recursive: true }),
  mkdir(photosDir, { recursive: true }),
  ensurePrivateBucket(),
]);

app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      imgSrc: ["'self'", "data:", "blob:", storageOrigin],
      connectSrc: ["'self'", storageOrigin],
      formAction: ["'self'", paymentCheckoutOrigin],
    },
  },
}));
app.use(cors({
  origin: process.env.SITE_ORIGIN,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  credentials: true,
}));
app.use("/api/payments/webhooks", createPaymentWebhookRouter({ paymentService }));
app.use(express.json({ limit: "32kb" }));
app.use("/assets", express.static(path.resolve("./public"), {
  dotfiles: "deny",
  fallthrough: false,
  maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
}));
app.use("/api/auth", createAuthRouter({ service: authService, config: authConfig }));
app.use("/api/projects", createProjectsRouter({ authService, projectService }));
app.use("/api/projects", createGenerationRouter({ authService, generationService }));
app.use("/api/projects", createUpscaleRouter({ authService, upscaleService }));
app.use("/api/projects", createComparisonRouter({ authService, comparisonService }));
app.use(
  "/api/staging/generation",
  createGenerationStagingRouter({ generationService, config: generationConfig }),
);
app.use(
  "/internal/generation/metrics",
  createGenerationMetricsRouter({ metrics: generationMetrics, config: generationConfig }),
);
app.use(
  "/internal/generation/quality",
  createGenerationQualityDiagnosticsRouter({
    repository: generationQualityRepository,
    storage,
    config: generationQualityConfig,
  }),
);
app.use("/api/wallet", createWalletRouter({ authService, walletService }));
app.use("/api/catalog", createCatalogRouter({ authService, walletService }));
app.use("/api/payments", createPaymentRouter({ authService, paymentService }));
app.use(createProjectPagesRouter({ authService, projectService, generationService, walletService }));
app.use(createWalletPagesRouter({
  authService, walletService, paymentService, paymentConfig,
}));
app.use(createPaymentPagesRouter({ authService, paymentService, config: paymentConfig }));
app.use(createAuthPagesRouter({ service: authService, config: authConfig }));
const legacyLeadsMode = String(process.env.LEGACY_LEADS_MODE || "deprecated").toLowerCase();
if (!["deprecated", "disabled"].includes(legacyLeadsMode)) {
  throw new Error("LEGACY_LEADS_MODE must be deprecated or disabled");
}
app.use("/api/leads", (_request, response, next) => {
  response.set("Deprecation", "true");
  response.set("Link", '</app/new>; rel="successor-version"');
  response.set("Warning", '299 - "Legacy leads API is deprecated; migrate to /app/new"');
  if (process.env.LEGACY_LEADS_SUNSET) response.set("Sunset", process.env.LEGACY_LEADS_SUNSET);
  if (legacyLeadsMode === "disabled") {
    return response.status(410).json({ ok: false, error: "LEGACY_LEADS_DISABLED" });
  }
  return next();
});
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
const makeOrderId = () => {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `VF-${date}-${randomBytes(4).toString("hex").toUpperCase()}`;
};
const imageExtension = (mime) => ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[mime] || "img");
const orderFile = (id) => path.join(ordersDir, `${id}.json`);
const saveOrder = (order) => writeFile(orderFile(order.id), JSON.stringify(order, null, 2), { mode: 0o600 });

async function assessPhoto(file) {
  const technical = await analyzeTechnicalPhoto(file.buffer);
  const accepted = !technical.blocking.includes("resolution_below_minimum");
  const reasons = [...technical.blocking, ...technical.warnings];
  return {
    accepted,
    label: accepted ? "Фото прошло техническую проверку" : "Нужно переснять фотографию",
    reasons,
    width: technical.width,
    height: technical.height,
    format: technical.format,
    technical,
  };
}

async function assessPhotoWithAi(file) {
  if (!aiEnabled) return { enabled: false, status: "not_configured" };
  try {
    const technical = await analyzeTechnicalPhoto(file.buffer);
    const result = await photoAssessmentOrchestrator.assess({
      image: file.buffer,
      technical,
    });
    return {
      enabled: true,
      status: "completed",
      provider: result.provider,
      model: result.model,
      checkedAt: new Date().toISOString(),
      decision: result.decision,
      confidence: result.technicalResult.observation.confidence,
      customerMessage: result.userResult.summary,
      issues: result.userResult.recommendations,
      technicalResult: result.technicalResult,
      userResult: result.userResult,
    };
  } catch (error) {
    return {
      enabled: true,
      status: "failed",
      checkedAt: new Date().toISOString(),
      error: error?.code || "PHOTO_ASSESSMENT_UNAVAILABLE",
    };
  }
}

function decideOrderStatus(quality, aiAssessment) {
  if (!quality.accepted) return "photo_retake_required";
  if (aiAssessment?.status !== "completed") return "queued_for_ai";
  if (["accepted", "accepted_with_warning"].includes(aiAssessment.decision)) {
    return "queued_for_generation";
  }
  return "photo_retake_required";
}

const formatLead = ({ id, name, contact, wishes, packageName, quality, aiAssessment, status }) => [
  "Новая заявка — ВИЖУФАСАД",
  `Номер: ${id}`,
  `Статус: ${status}`,
  `Проверка фото: ${quality.label}`,
  quality.reasons.length ? `Замечания: ${quality.reasons.join("; ")}` : null,
  `Размер фото: ${quality.width}×${quality.height}`,
  aiAssessment?.status === "completed" ? `ИИ-проверка: ${aiAssessment.decision} (${Math.round(aiAssessment.confidence * 100)}%)` : null,
  aiAssessment?.status === "completed" ? `Автоматический вывод: ${aiAssessment.customerMessage}` : null,
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

app.get("/health/live", liveness);
app.get("/health", readiness);
app.get("/health/ready", readiness);

app.get("/api/orders/:id/status", async (request, response) => {
  try {
    const id = clean(request.params.id, 40);
    if (!/^VF-\d{8}-[A-F0-9]{8}$/.test(id)) {
      return response.status(404).json({ ok: false, error: "Заказ не найден" });
    }
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
  if (!notificationsConfigured) {
    return response.status(503).json({ ok: false, error: "Сервис уведомлений временно не настроен" });
  }
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

const httpServer = app.listen(
  port,
  host,
  () => console.log(`VIZHUFASAD API listening on ${host}:${port}`),
);

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log("VIZHUFASAD API graceful shutdown", { signal });
  httpServer.close(async () => {
    await Promise.allSettled([
      generationQueue.close(),
      upscaleQueue.close(),
      closeRedis(),
      closeDatabase(),
    ]);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 15_000).unref();
}
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
