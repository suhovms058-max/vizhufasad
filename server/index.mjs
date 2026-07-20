import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import multer from "multer";
import nodemailer from "nodemailer";

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

app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: process.env.SITE_ORIGIN, methods: ["GET", "POST"] }));
app.use(express.json({ limit: "32kb" }));
app.use("/api/leads", rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true }));

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
const formatLead = ({ name, contact, wishes, packageName }) => [
  "Новая заявка — ВИЖУФАСАД",
  `Тариф: ${packageName}`,
  `Имя: ${name}`,
  `Контакт: ${contact}`,
  `Пожелания: ${wishes || "не указаны"}`,
].join("\n");

async function uploadToMax(file) {
  const prepare = await fetch(`${maxApi}/uploads?type=image`, {
    method: "POST",
    headers: { Authorization: process.env.MAX_BOT_TOKEN },
  });
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
  const retryDelays = [300, 1_000, 2_500];

  for (const delay of retryDelays) {
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

app.get("/health", (_request, response) => response.json({ ok: true, service: "vizhufasad-leads" }));

app.post("/api/leads", upload.single("photo"), async (request, response) => {
  const name = clean(request.body.name, 80);
  const contact = clean(request.body.contact, 120);
  const wishes = clean(request.body.wishes, 1200);
  const packageName = clean(request.body.package, 80);
  if (!name || !contact || !packageName || !request.file) {
    return response.status(400).json({ ok: false, error: "Заполните обязательные поля" });
  }

  const text = formatLead({ name, contact, wishes, packageName });
  const deliveries = await Promise.allSettled([sendToMax(text, request.file), sendToMail(text, request.file, contact)]);
  const delivered = deliveries.filter((result) => result.status === "fulfilled").length;
  deliveries.forEach((result, index) => {
    if (result.status === "rejected") console.error(index === 0 ? "MAX delivery failed" : "Email delivery failed", result.reason);
  });
  if (!delivered) return response.status(502).json({ ok: false, error: "Не удалось отправить заявку" });
  return response.status(201).json({ ok: true, delivered });
});

app.use((error, _request, response, _next) => {
  if (error?.code === "LIMIT_FILE_SIZE") return response.status(413).json({ ok: false, error: "Фото должно быть не больше 15 МБ" });
  if (error?.message === "UNSUPPORTED_IMAGE") return response.status(415).json({ ok: false, error: "Поддерживаются JPG, PNG и WEBP" });
  console.error(error);
  return response.status(500).json({ ok: false, error: "Ошибка обработки заявки" });
});

app.listen(port, "0.0.0.0", () => console.log(`VIZHUFASAD leads API listening on ${port}`));
