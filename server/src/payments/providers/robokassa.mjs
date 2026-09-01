import { createHash, createHmac, timingSafeEqual, verify as verifySignature } from "node:crypto";
import { PaymentError, formatRubles, parseRubles } from "../contract.mjs";

function digest(algorithm, value) {
  return createHash(algorithm).update(value, "utf8").digest("hex");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || "").toLowerCase(), "utf8");
  const b = Buffer.from(String(right || "").toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function xmlValue(xml, tag) {
  const match = String(xml || "").match(new RegExp(`<${tag}>([^<]*)</${tag}>`, "u"));
  return match?.[1]?.trim() || null;
}

export class RobokassaPaymentProvider {
  constructor(config, fetchImpl = globalThis.fetch) {
    this.config = config;
    this.fetch = fetchImpl;
    this.name = "robokassa";
  }

  createCheckout(payment, customer) {
    const outSum = formatRubles(payment.amount_minor);
    const invId = String(payment.provider_payment_id);
    const custom = `Shp_payment=${payment.id}`;
    const receipt = JSON.stringify({
      items: [{
        name: String(payment.description || "ВФ-коины ВИЖУФАСАД").slice(0, 128),
        quantity: 1,
        sum: Number(outSum),
        payment_method: "full_payment",
        payment_object: "service",
        tax: "none",
      }],
    });
    const successUrl = `${this.config.siteOrigin}/app/balance`;
    const failUrl = `${this.config.siteOrigin}/app/balance`;
    const encodedReceipt = encodeURIComponent(receipt);
    const signatureParts = [this.config.merchantLogin, outSum, invId, encodedReceipt];
    if (this.config.result2Url) signatureParts.push(this.config.result2Url);
    signatureParts.push(successUrl, "GET", failUrl, "GET");
    signatureParts.push(this.config.password1, custom);
    const parameters = new URLSearchParams({
      MerchantLogin: this.config.merchantLogin,
      OutSum: outSum,
      InvId: invId,
      Description: payment.description,
      Culture: "ru",
      Encoding: "utf-8",
      Email: customer.email,
      // Robokassa signs the URL-encoded receipt and expects that encoded value
      // to be encoded once more by the query string serializer.
      Receipt: encodedReceipt,
      Shp_payment: payment.id,
      SignatureValue: digest(this.config.signatureAlgorithm, signatureParts.join(":")),
      SuccessUrl2: successUrl,
      SuccessUrl2Method: "GET",
      FailUrl2: failUrl,
      FailUrl2Method: "GET",
    });
    if (this.config.result2Url) parameters.set("ResultUrl2", this.config.result2Url);
    if (this.config.testMode) parameters.set("IsTest", "1");
    return { url: `${this.config.checkoutUrl}?${parameters}`, expiresAt: payment.checkout_expires_at };
  }

  verifyResult(input) {
    const outSum = String(input.OutSum || "");
    const invId = String(input.InvId || input.InvID || "");
    const paymentId = String(input.Shp_payment || "");
    const signature = String(input.SignatureValue || "");
    if (!invId || !paymentId || !signature) throw new PaymentError("INVALID_WEBHOOK", 400);
    const expected = digest(
      this.config.signatureAlgorithm,
      `${outSum}:${invId}:${this.config.password2}:Shp_payment=${paymentId}`,
    );
    if (!safeEqual(expected, signature)) throw new PaymentError("INVALID_WEBHOOK_SIGNATURE", 401);
    const isTest = String(input.IsTest || "") === "1";
    if (isTest && !this.config.testMode) {
      throw new PaymentError("TEST_WEBHOOK_NOT_ALLOWED", 409);
    }
    return {
      eventKey: `paid:${invId}:${outSum}`,
      paymentId,
      providerPaymentId: invId,
      amountMinor: parseRubles(outSum),
      paymentMethod: String(input.PaymentMethod || "").slice(0, 80) || null,
      isTest,
      raw: { ...input, SignatureValue: "[redacted]" },
    };
  }

  verifyResult2(compactJws) {
    if (!this.config.result2PublicKey) throw new PaymentError("RESULT2_NOT_CONFIGURED", 503);
    const parts = String(compactJws || "").trim().split(".");
    if (parts.length !== 3) throw new PaymentError("INVALID_RESULT2", 400);
    const [headerPart, payloadPart, signaturePart] = parts;
    let header;
    let payload;
    try {
      header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8"));
      payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
    } catch {
      throw new PaymentError("INVALID_RESULT2", 400);
    }
    if (header.alg !== "RS256") throw new PaymentError("INVALID_RESULT2_ALGORITHM", 401);
    const valid = verifySignature(
      "RSA-SHA256",
      Buffer.from(`${headerPart}.${payloadPart}`),
      this.config.result2PublicKey,
      Buffer.from(signaturePart, "base64url"),
    );
    if (!valid) throw new PaymentError("INVALID_RESULT2_SIGNATURE", 401);
    if (payload?.data?.shop !== this.config.merchantLogin) throw new PaymentError("RESULT2_SHOP_MISMATCH", 401);
    return payload.data;
  }

  async createRefund({ operationKey, amountMinor, description }) {
    if (!this.config.password3) throw new PaymentError("REFUNDS_NOT_CONFIGURED", 503);
    if (!operationKey) throw new PaymentError("REFUND_OPERATION_KEY_UNAVAILABLE", 409);
    const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = base64url(JSON.stringify({
      OpKey: operationKey,
      RefundSum: Number(formatRubles(amountMinor)),
      InvoiceItems: [{
        Name: description,
        Quantity: 1,
        Cost: Number(formatRubles(amountMinor)),
        Tax: "none",
        PaymentMethod: "full_payment",
        PaymentObject: "service",
      }],
    }));
    const signature = createHmac("sha256", this.config.password3)
      .update(`${header}.${payload}`)
      .digest("base64url");
    const response = await this.fetch(this.config.refundUrl, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: `${header}.${payload}.${signature}`,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success || !result.requestId) {
      throw new PaymentError("PROVIDER_REFUND_FAILED", 502);
    }
    return { providerRefundId: result.requestId, status: "pending" };
  }

  async getOperationState(providerPaymentId) {
    const invoiceId = String(providerPaymentId || "").trim();
    if (!/^\d+$/u.test(invoiceId)) throw new PaymentError("INVALID_PROVIDER_PAYMENT_ID", 400);
    const url = new URL(this.config.operationStateUrl);
    url.searchParams.set("MerchantLogin", this.config.merchantLogin);
    url.searchParams.set("InvoiceID", invoiceId);
    url.searchParams.set(
      "Signature",
      digest(this.config.signatureAlgorithm, `${this.config.merchantLogin}:${invoiceId}:${this.config.password2}`),
    );
    const response = await this.fetch(url, { headers: { accept: "application/xml, text/xml" } });
    const xml = await response.text().catch(() => "");
    const resultCode = xml.match(/<Result>\s*<Code>(\d+)<\/Code>/u)?.[1] || null;
    const stateCode = xml.match(/<State>\s*<Code>(\d+)<\/Code>/u)?.[1] || null;
    const operationKey = xmlValue(xml, "OpKey");
    if (!response.ok || resultCode !== "0" || stateCode !== "100" || !operationKey) {
      throw new PaymentError("PROVIDER_OPERATION_STATE_FAILED", 502);
    }
    return { operationKey, stateCode, providerPaymentId: invoiceId };
  }

  async getRefundState(providerRefundId) {
    const url = new URL(this.config.refundStateUrl);
    url.searchParams.set("id", providerRefundId);
    const response = await this.fetch(url, { headers: { accept: "application/json" } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.label) throw new PaymentError("PROVIDER_REFUND_STATUS_FAILED", 502);
    const status = result.label === "finished" ? "succeeded"
      : result.label === "processing" ? "pending" : "failed";
    return { providerRefundId, status, amountMinor: result.amount === undefined ? null : parseRubles(String(result.amount)) };
  }
}
