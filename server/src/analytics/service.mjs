import { createHash, timingSafeEqual } from "node:crypto";

const EVENT_NAMES = new Set([
  "page_view", "hero_cta", "pricing_cta", "photo_check_selected", "photo_upload_started",
  "photo_upload_completed", "settings_opened", "generation_started", "payment_checkout_started",
]);
const PROPERTY_KEYS = new Set(["placement", "plan", "generationKind", "outcome"]);

function cleanProperties(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => PROPERTY_KEYS.has(key) && ["string", "number", "boolean"].includes(typeof item))
    .map(([key, item]) => [key, typeof item === "string" ? item.slice(0, 80) : item]));
}

export function tokenMatches(actual, expected) {
  const left = Buffer.from(String(actual || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length === right.length && timingSafeEqual(left, right);
}

export class ProductAnalyticsService {
  constructor({ repository, sessionSalt }) {
    this.repository = repository;
    this.sessionSalt = sessionSalt;
  }

  async record(input) {
    const eventName = String(input?.eventName || "");
    if (!EVENT_NAMES.has(eventName)) return { accepted: false };
    const sessionId = String(input?.sessionId || "");
    if (!/^[a-f0-9-]{20,80}$/iu.test(sessionId)) return { accepted: false };
    const path = String(input?.path || "").split(/[?#]/u)[0].slice(0, 240);
    if (!path.startsWith("/")) return { accepted: false };
    const sessionHash = createHash("sha256").update(`${this.sessionSalt}:${sessionId}`).digest("hex");
    await this.repository.record({
      eventName,
      sessionHash,
      path,
      properties: cleanProperties(input.properties),
    });
    return { accepted: true };
  }
}
