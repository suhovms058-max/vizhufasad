import { createHmac, randomBytes, randomInt, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
export const PASSWORD_ALGORITHM = "scrypt-v1";
export const PASSWORD_PARAMS = Object.freeze({ N: 16_384, r: 8, p: 1, keyLength: 64, maxmem: 64 * 1024 * 1024 });

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

export function validatePassword(value, { minimum = 10, maximum = 128 } = {}) {
  const password = String(value ?? "");
  if (password.length < minimum || password.length > maximum) throw new Error("INVALID_PASSWORD");
  return password;
}

export async function hashPassword(value, options = {}) {
  const password = validatePassword(value, options);
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, PASSWORD_PARAMS.keyLength, PASSWORD_PARAMS);
  return {
    algorithm: PASSWORD_ALGORITHM,
    salt: salt.toString("base64url"),
    passwordHash: Buffer.from(derived).toString("base64url"),
    parameters: { N: PASSWORD_PARAMS.N, r: PASSWORD_PARAMS.r, p: PASSWORD_PARAMS.p, keyLength: PASSWORD_PARAMS.keyLength },
  };
}

export async function verifyPassword(value, credential) {
  const password = String(value ?? "");
  const salt = Buffer.from(String(credential?.salt || ""), "base64url");
  const expected = Buffer.from(String(credential?.password_hash || credential?.passwordHash || ""), "base64url");
  const parameters = credential?.parameters || PASSWORD_PARAMS;
  if (credential?.algorithm !== PASSWORD_ALGORITHM || salt.length !== 16 || expected.length !== PASSWORD_PARAMS.keyLength) {
    return false;
  }
  const derived = await scrypt(password, salt, PASSWORD_PARAMS.keyLength, {
    N: Number(parameters.N || PASSWORD_PARAMS.N), r: Number(parameters.r || PASSWORD_PARAMS.r),
    p: Number(parameters.p || PASSWORD_PARAMS.p), maxmem: PASSWORD_PARAMS.maxmem,
  });
  return timingSafeEqual(Buffer.from(derived), expected);
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
