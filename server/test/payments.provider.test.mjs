import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadPaymentConfig } from "../src/payments/config.mjs";
import { RobokassaPaymentProvider } from "../src/payments/providers/robokassa.mjs";

const environment = {
  FEATURE_PAYMENTS_ENABLED: "true",
  FEATURE_SUBSCRIPTIONS_ENABLED: "false",
  PAYMENT_TEST_MODE: "true",
  PAYMENT_ALLOW_TEST_MODE_IN_PRODUCTION: "true",
  PAYMENT_PROVIDER: "robokassa",
  ROBOKASSA_MERCHANT_LOGIN: "demo-shop",
  ROBOKASSA_PASSWORD1: "password-one",
  ROBOKASSA_PASSWORD2: "password-two",
  ROBOKASSA_SIGNATURE_ALGORITHM: "sha256",
  SITE_ORIGIN: "https://stage.example.test",
  LEGAL_MERCHANT_NAME: "Тестовый Самозанятый",
  LEGAL_MERCHANT_INN: "000000000000",
  LEGAL_MERCHANT_EMAIL: "merchant@example.test",
  LEGAL_MERCHANT_STATUS: "Самозанятый НПД",
};

test("payment config is disabled by default and blocks accidental production test mode", () => {
  assert.equal(loadPaymentConfig({}).enabled, false);
  assert.throws(
    () => loadPaymentConfig({ ...environment, NODE_ENV: "production", PAYMENT_ALLOW_TEST_MODE_IN_PRODUCTION: "false" }),
    /Production test payments require/,
  );
  assert.throws(
    () => loadPaymentConfig({ ...environment, FEATURE_SUBSCRIPTIONS_ENABLED: "true" }),
    /explicit Robokassa approval/,
  );
});

test("ResultUrl2 requires a verification key and can load it from a file", () => {
  const result2Url = "https://stage.example.test/api/payments/webhooks/robokassa/result2";
  assert.throws(
    () => loadPaymentConfig({ ...environment, ROBOKASSA_RESULT2_URL: result2Url }),
    /must be configured together/,
  );

  const directory = mkdtempSync(join(tmpdir(), "vizhufasad-robokassa-"));
  const certificatePath = join(directory, "jwtsign.cer");
  try {
    writeFileSync(certificatePath, "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n");
    const config = loadPaymentConfig({
      ...environment,
      ROBOKASSA_RESULT2_URL: result2Url,
      ROBOKASSA_RESULT2_PUBLIC_KEY_FILE: certificatePath,
    });
    assert.equal(config.result2Url, result2Url);
    assert.match(config.result2PublicKey, /BEGIN CERTIFICATE/);
    assert.equal(config.result2PublicKeyFile, certificatePath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("checkout is server-priced, signed and never exposes provider passwords", () => {
  const config = loadPaymentConfig(environment);
  const provider = new RobokassaPaymentProvider(config);
  const checkout = provider.createCheckout({
    id: "4e0906df-e5e1-4b2f-8cf9-a7fd4b46b331",
    provider_payment_id: "100042",
    amount_minor: 79_000,
    description: "Пакет Старт",
    checkout_expires_at: new Date("2026-08-08T12:00:00Z"),
  }, { email: "buyer@example.test" });
  const url = new URL(checkout.url);
  assert.equal(url.searchParams.get("OutSum"), "790.00");
  assert.equal(url.searchParams.get("IsTest"), "1");
  assert.equal(url.searchParams.get("Shp_payment"), "4e0906df-e5e1-4b2f-8cf9-a7fd4b46b331");
  const receipt = url.searchParams.get("Receipt");
  assert.deepEqual(JSON.parse(receipt), {
    items: [{
      name: "Пакет Старт",
      quantity: 1,
      sum: 790,
      payment_method: "full_payment",
      payment_object: "service",
      tax: "none",
    }],
  });
  const successUrl = "https://stage.example.test/app/balance?payment_return=success&payment=4e0906df-e5e1-4b2f-8cf9-a7fd4b46b331";
  const failUrl = "https://stage.example.test/app/balance?payment_return=fail&payment=4e0906df-e5e1-4b2f-8cf9-a7fd4b46b331";
  const expectedSignature = createHash("sha256").update([
    "demo-shop", "790.00", "100042", encodeURIComponent(receipt),
    encodeURIComponent(successUrl), "GET", encodeURIComponent(failUrl), "GET",
    "password-one", "Shp_payment=4e0906df-e5e1-4b2f-8cf9-a7fd4b46b331",
  ].join(":")).digest("hex");
  assert.equal(url.searchParams.get("SignatureValue"), expectedSignature);
  assert.ok(!checkout.url.includes("password-one"));
  assert.ok(!checkout.url.includes("password-two"));
});

test("ResultURL signature is mandatory and amount remains exact", () => {
  const config = loadPaymentConfig(environment);
  const provider = new RobokassaPaymentProvider(config);
  const paymentId = "4e0906df-e5e1-4b2f-8cf9-a7fd4b46b331";
  const signature = createHash("sha256")
    .update(`790.000000:100042:${config.password2}:Shp_payment=${paymentId}`)
    .digest("hex");
  const event = provider.verifyResult({
    OutSum: "790.000000", InvId: "100042", Shp_payment: paymentId,
    SignatureValue: signature, PaymentMethod: "BankCard",
  });
  assert.equal(event.amountMinor, 79_000);
  assert.equal(event.paymentId, paymentId);
  assert.equal(event.raw.SignatureValue, "[redacted]");
  assert.throws(
    () => provider.verifyResult({ OutSum: "1.00", InvId: "100042", Shp_payment: paymentId, SignatureValue: "bad" }),
    (error) => error.code === "INVALID_WEBHOOK_SIGNATURE" && error.status === 401,
  );
});

test("ResultUrl2 accepts only a valid RS256 notification for the configured shop", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const config = loadPaymentConfig({
    ...environment,
    ROBOKASSA_RESULT2_URL: "https://stage.example.test/api/payments/webhooks/robokassa/result2",
    ROBOKASSA_RESULT2_PUBLIC_KEY: publicKey.export({ type: "spki", format: "pem" }),
  });
  const provider = new RobokassaPaymentProvider(config);
  const headerPart = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const data = {
    shop: "demo-shop",
    opKey: "operation-key",
    invId: "100042",
    paymentMethod: "BankCard",
    incSum: "790.00",
    state: "OK",
  };
  const payloadPart = Buffer.from(JSON.stringify({ data })).toString("base64url");
  const signaturePart = sign(
    "RSA-SHA256",
    Buffer.from(`${headerPart}.${payloadPart}`),
    privateKey,
  ).toString("base64url");
  const compactJws = `${headerPart}.${payloadPart}.${signaturePart}`;

  assert.deepEqual(provider.verifyResult2(compactJws), data);
  const tamperedPayload = Buffer.from(JSON.stringify({ data: { ...data, incSum: "1.00" } })).toString("base64url");
  assert.throws(
    () => provider.verifyResult2(`${headerPart}.${tamperedPayload}.${signaturePart}`),
    (error) => error.code === "INVALID_RESULT2_SIGNATURE" && error.status === 401,
  );
});

test("refund adapter signs JWT and returns provider request id", async () => {
  const config = loadPaymentConfig({ ...environment, ROBOKASSA_PASSWORD3: "password-three" });
  let request;
  const provider = new RobokassaPaymentProvider(config, async (url, options) => {
    request = { url, options };
    return { ok: true, async json() { return { success: true, requestId: "refund-request" }; } };
  });
  const result = await provider.createRefund({
    operationKey: "operation-key", amountMinor: 79_000, description: "Пакет Старт",
  });
  assert.equal(result.providerRefundId, "refund-request");
  assert.equal(result.status, "pending");
  assert.equal(request.options.body.split(".").length, 3);
  const payload = JSON.parse(Buffer.from(request.options.body.split(".")[1], "base64url"));
  assert.equal(payload.OpKey, "operation-key");
  assert.equal(payload.RefundSum, 790);
});

test("refund status maps provider reconciliation states", async () => {
  const states = [
    [{ label: "processing", amount: 790 }, "pending"],
    [{ label: "finished", amount: 790 }, "succeeded"],
    [{ label: "cancelled", amount: 790 }, "failed"],
  ];
  for (const [body, expected] of states) {
    const provider = new RobokassaPaymentProvider(loadPaymentConfig(environment), async (url) => {
      assert.equal(new URL(url).searchParams.get("id"), "refund-request");
      return { ok: true, async json() { return body; } };
    });
    const result = await provider.getRefundState("refund-request");
    assert.equal(result.status, expected);
    assert.equal(result.amountMinor, 79_000);
  }
});
