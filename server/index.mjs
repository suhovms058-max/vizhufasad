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
  if (shortSide < 700 || longSide < 1200) reasons.push("Разрешение фото ниже рекомендуемого");
  if (width && height && (width / height < 0.45 || width / height > 2.6)) reasons.push("Слишком узкий или панорамный кадр");
  if (stats.entropy < 2.4) reasons.push("На снимке мало различимых деталей");
  const accepted = shortSide >= 700 && longSide >= 1200;
  return {
    accepted,
    label: accepted ? "Фото подходит для автоматической обработки" : "Нужна проверка качества фото",
    reasons,
    width,
    height,
    format: metadata.format,
  };
}

const formatLead = ({ id, name, contact, wishes, packageName, quality, status }) => [
  "Новая заявка — ВИЖУФАСАД",
  `Номер: ${id}`,
  `Статус: ${status}`,
  `Проверка фото: ${quality.label}`,
  quality.reasons.length ? `Замечания: ${quality.reasons.join("; ")}` : null,
  `Размер фото: ${quality.width}×${quality.height}`,
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

app.get("/health", (_request, response) => response.json({ ok: true, service: "vizhufasad-leads", automation: "orders-v1" }));

app.get("/api/orders/:id/status", async (request, response) => {
  try {
    const id = clean(request.params.id, 40);
    const order = JSON.parse(await readFile(orderFile(id), "utf8"));
    const token = clean(request.query.token, 80);
    if (!token || token !== order.statusToken) return response.status(404).json({ ok: false, error: "Заказ не найден" });
    return response.json({ ok: true, orderId: order.id, status: order.status, quality: order.quality, updatedAt: order.updatedAt });
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
  const status = quality.accepted ? "queued_for_ai" : "photo_review_required";
  const storedPhoto = `${id}.${imageExtension(request.file.mimetype)}`;
  await writeFile(path.join(photosDir, storedPhoto), request.file.buffer, { mode: 0o600 });

  const order = {
    id, statusToken, createdAt: now, updatedAt: now, status, packageName,
    customer: { name, contact, wishes },
    photo: { storedAs: storedPhoto, originalName: clean(request.file.originalname, 160), mimeType: request.file.mimetype, size: request.file.size },
    quality,
    deliveries: { max: "pending", email: "pending" },
    history: [{ at: now, status, note: quality.label }],
  };
  await saveOrder(order);

  const text = formatLead({ id, name, contact, wishes, packageName, quality, status });
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
  return response.status(201).json({ ok: true, delivered, orderId: id, statusToken, status, quality });
});

app.use((error, _request, response, _next) => {
  if (error?.code === "LIMIT_FILE_SIZE") return response.status(413).json({ ok: false, error: "Фото должно быть не больше 15 МБ" });
  if (error?.message === "UNSUPPORTED_IMAGE") return response.status(415).json({ ok: false, error: "Поддерживаются JPG, PNG и WEBP" });
  console.error(error);
  return response.status(500).json({ ok: false, error: "Ошибка обработки заявки" });
});

app.listen(port, "0.0.0.0", () => console.log(`VIZHUFASAD leads API listening on ${port}`));
