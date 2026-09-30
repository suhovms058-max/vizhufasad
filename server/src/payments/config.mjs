import { readFileSync } from "node:fs";

function flag(value, fallback, name) {
  const normalized = String(value ?? fallback).trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function required(environment, name) {
  const value = String(environment[name] || "").trim();
  if (!value) throw new Error(`${name} is required when payments are enabled`);
  return value;
}

function canonicalOrigin(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error("SITE_ORIGIN must be an absolute http(s) origin");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("SITE_ORIGIN must be an absolute http(s) origin without path, query or credentials");
  }
  return url.origin;
}

export function loadPaymentConfig(environment = process.env) {
  const enabled = flag(environment.FEATURE_PAYMENTS_ENABLED, false, "FEATURE_PAYMENTS_ENABLED");
  const subscriptionsEnabled = flag(
    environment.FEATURE_SUBSCRIPTIONS_ENABLED,
    false,
    "FEATURE_SUBSCRIPTIONS_ENABLED",
  );
  const testMode = flag(environment.PAYMENT_TEST_MODE, true, "PAYMENT_TEST_MODE");
  const allowProductionTestMode = flag(
    environment.PAYMENT_ALLOW_TEST_MODE_IN_PRODUCTION,
    false,
    "PAYMENT_ALLOW_TEST_MODE_IN_PRODUCTION",
  );
  const recurringApproved = flag(
    environment.ROBOKASSA_RECURRING_APPROVED,
    false,
    "ROBOKASSA_RECURRING_APPROVED",
  );
  if (subscriptionsEnabled && (!enabled || !recurringApproved)) {
    throw new Error("Subscriptions require enabled payments and explicit Robokassa approval");
  }
  if (enabled && environment.NODE_ENV === "production" && testMode && !allowProductionTestMode) {
    throw new Error("Production test payments require PAYMENT_ALLOW_TEST_MODE_IN_PRODUCTION=true");
  }

  const result2PublicKeyFile = String(environment.ROBOKASSA_RESULT2_PUBLIC_KEY_FILE || "").trim() || null;
  const inlineResult2PublicKey = String(environment.ROBOKASSA_RESULT2_PUBLIC_KEY || "")
    .replaceAll("\\n", "\n")
    .trim() || null;
  const result2PublicKey = result2PublicKeyFile
    ? readFileSync(result2PublicKeyFile, "utf8").trim()
    : inlineResult2PublicKey;

  const siteOrigin = canonicalOrigin(environment.SITE_ORIGIN || "http://localhost:8080");
  const config = {
    enabled,
    subscriptionsEnabled,
    testMode,
    provider: String(environment.PAYMENT_PROVIDER || "robokassa").trim().toLowerCase(),
    checkoutTtlMinutes: Math.max(5, Number(environment.PAYMENT_CHECKOUT_TTL_MINUTES || 30)),
    merchantLogin: null,
    password1: null,
    password2: null,
    password3: String(environment.ROBOKASSA_PASSWORD3 || "").trim() || null,
    signatureAlgorithm: String(environment.ROBOKASSA_SIGNATURE_ALGORITHM || "sha256").trim().toLowerCase(),
    checkoutUrl: String(environment.ROBOKASSA_CHECKOUT_URL || "https://auth.robokassa.ru/Merchant/Index.aspx").trim(),
    refundUrl: String(environment.ROBOKASSA_REFUND_URL || "https://services.robokassa.ru/RefundService/Refund/Create").trim(),
    refundStateUrl: String(environment.ROBOKASSA_REFUND_STATE_URL || "https://services.robokassa.ru/RefundService/Refund/GetState").trim(),
    operationStateUrl: String(environment.ROBOKASSA_OPERATION_STATE_URL || "https://auth.robokassa.ru/Merchant/WebService/Service.asmx/OpStateExt").trim(),
    result2Url: String(environment.ROBOKASSA_RESULT2_URL || "").trim() || null,
    result2PublicKey,
    result2PublicKeyFile,
    siteOrigin,
    resultUrl: `${siteOrigin}/api/payments/webhooks/robokassa/result`,
    successUrl: `${siteOrigin}/app/balance`,
    failUrl: `${siteOrigin}/app/balance`,
    merchantName: String(environment.LEGAL_MERCHANT_NAME || "").trim() || null,
    merchantInn: String(environment.LEGAL_MERCHANT_INN || "").trim() || null,
    merchantOgrnip: String(environment.LEGAL_MERCHANT_OGRNIP || "").trim() || null,
    merchantEmail: String(environment.LEGAL_MERCHANT_EMAIL || environment.LEADS_EMAIL || "").trim() || null,
    merchantStatus: String(environment.LEGAL_MERCHANT_STATUS || "").trim() || null,
    merchantRegistrationDate: String(environment.LEGAL_MERCHANT_REGISTRATION_DATE || "").trim() || null,
    merchantRegistrationAuthority: String(environment.LEGAL_MERCHANT_REGISTRATION_AUTHORITY || "").trim() || null,
    merchantAddress: String(environment.LEGAL_MERCHANT_ADDRESS || "").trim() || null,
  };
  if (enabled) {
    if (config.provider !== "robokassa") throw new Error("PAYMENT_PROVIDER must be robokassa");
    if (!["md5", "sha256", "sha512"].includes(config.signatureAlgorithm)) {
      throw new Error("ROBOKASSA_SIGNATURE_ALGORITHM must be md5, sha256 or sha512");
    }
    config.merchantLogin = required(environment, "ROBOKASSA_MERCHANT_LOGIN");
    config.password1 = required(environment, "ROBOKASSA_PASSWORD1");
    config.password2 = required(environment, "ROBOKASSA_PASSWORD2");
    config.merchantName = required(environment, "LEGAL_MERCHANT_NAME");
    config.merchantInn = required(environment, "LEGAL_MERCHANT_INN");
    config.merchantOgrnip = required(environment, "LEGAL_MERCHANT_OGRNIP");
    config.merchantEmail = required(environment, "LEGAL_MERCHANT_EMAIL");
    config.merchantStatus = required(environment, "LEGAL_MERCHANT_STATUS");
    config.merchantRegistrationDate = required(environment, "LEGAL_MERCHANT_REGISTRATION_DATE");
    config.merchantRegistrationAuthority = required(environment, "LEGAL_MERCHANT_REGISTRATION_AUTHORITY");
    config.merchantAddress = required(environment, "LEGAL_MERCHANT_ADDRESS");
    if (!/^\d{12}$/u.test(config.merchantInn)) throw new Error("LEGAL_MERCHANT_INN must contain 12 digits for an individual entrepreneur");
    if (!/^\d{15}$/u.test(config.merchantOgrnip)) throw new Error("LEGAL_MERCHANT_OGRNIP must contain 15 digits");
    if (Boolean(config.result2Url) !== Boolean(config.result2PublicKey)) {
      throw new Error("ROBOKASSA_RESULT2_URL and ResultUrl2 public key must be configured together");
    }
    if (environment.NODE_ENV === "production") {
      if (config.siteOrigin !== "https://vizhufasad.ru") {
        throw new Error("Production payments require SITE_ORIGIN=https://vizhufasad.ru");
      }
      const expectedResult2Url = `${config.siteOrigin}/api/payments/webhooks/robokassa/result2`;
      if (!config.result2Url || !config.result2PublicKey) {
        throw new Error("Production payments require signed Robokassa ResultUrl2");
      }
      if (config.result2Url !== expectedResult2Url) {
        throw new Error(`ROBOKASSA_RESULT2_URL must be ${expectedResult2Url}`);
      }
    }
  }
  return Object.freeze(config);
}
