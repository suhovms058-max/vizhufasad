import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!emailPattern.test(email) || email.length > 254) throw new Error("INVALID_EMAIL");
  return email;
}
export function createLoginCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function createChallengeId() {
  return randomUUID();
}

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashAuthValue(secret, namespace, value) {
  return createHmac("sha256", secret).update(`${namespace}:${value}`).digest("hex");
}

export function hashesEqual(left, right) {
  const a = Buffer.from(String(left), "hex");
  const b = Buffer.from(String(right), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseCookies(header) {
  const result = {};
  for (const part of String(header || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try {
      result[key] = decodeURIComponent(value);
    } catch {
      result[key] = value;
    }
  }
  return result;
}
