import { randomUUID } from "node:crypto";
import { PaymentError, normalizePromoCode } from "./contract.mjs";

function required(value, code, max = 160) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) throw new PaymentError(code);
  return normalized;
}

export class PaymentService {
  constructor({ repository, provider, config, clock = () => new Date() }) {
    this.repository = repository;
    this.provider = provider;
    this.config = config;
    this.clock = clock;
  }

  assertEnabled() {
    if (!this.config.enabled) throw new PaymentError("PAYMENTS_DISABLED", 404);
  }

  async createCheckout(user, input, idempotencyKey) {
    this.assertEnabled();
    const tariffPlanId = required(input?.tariffPlanId, "INVALID_TARIFF_PLAN_ID", 64);
    const key = required(idempotencyKey, "IDEMPOTENCY_KEY_REQUIRED", 160);
    const expiresAt = new Date(this.clock().getTime() + this.config.checkoutTtlMinutes * 60_000);
    const created = await this.repository.create({
      userId: user.user_id,
      tariffPlanId,
      promoCode: normalizePromoCode(input?.promoCode),
      idempotencyKey: key,
      expiresAt,
    });
    const payment = created.payment;
    if (["paid", "refunded"].includes(payment.status)) {
      return { payment: await this.repository.view(user.user_id, payment.id), checkout: null, idempotent: true };
    }
    try {
      const checkout = this.provider.createCheckout(payment, { email: user.email });
      await this.repository.markPending(payment.id);
      return {
        payment: await this.repository.view(user.user_id, payment.id),
        checkout,
        idempotent: created.idempotent,
      };
    } catch (error) {
      await this.repository.markFailed(payment.id, error.code || "CHECKOUT_CREATION_FAILED");
      throw error;
    }
  }

  async handleResult(input) {
    this.assertEnabled();
    let event;
    try {
      event = this.provider.verifyResult(input);
    } catch (error) {
      await this.repository.recordRejectedWebhook(input, error.code || "INVALID_WEBHOOK");
      throw error;
    }
    const result = await this.repository.processPaid(event);
    if (result.error) throw new PaymentError(result.error, 409);
    return { ...result, acknowledgment: `OK${event.providerPaymentId}` };
  }

  async handleResult2(compactJws) {
    this.assertEnabled();
    const data = this.provider.verifyResult2(compactJws);
    await this.repository.saveResult2(data);
    return data;
  }

  async history(userId, limit) {
    this.assertEnabled();
    await this.reconcilePendingRefunds(userId);
    return this.repository.history(userId, Math.min(100, Math.max(1, Number(limit) || 50)));
  }

  async reconcilePendingRefunds(userId) {
    if (typeof this.provider.getRefundState !== "function") return;
    const refunds = await this.repository.pendingRefunds(userId, 5);
    for (const refund of refunds) {
      try {
        const state = await this.provider.getRefundState(refund.provider_refund_id);
        if (state.status === "succeeded") {
          await this.repository.completeRefund(userId, refund.id, state);
        } else if (state.status === "failed") {
          await this.repository.failRefund(userId, refund.id, "PROVIDER_REFUND_CANCELLED");
        }
      } catch {
        // A transient provider status failure must not block payment history.
      }
    }
  }

  async view(userId, paymentId) {
    this.assertEnabled();
    const payment = await this.repository.view(userId, paymentId);
    if (!payment) throw new PaymentError("PAYMENT_NOT_FOUND", 404);
    return payment;
  }

  cancel(userId, paymentId) {
    this.assertEnabled();
    return this.repository.cancel(userId, paymentId);
  }

  async refund(userId, paymentId, input = {}, idempotencyKey = randomUUID()) {
    this.assertEnabled();
    const payment = await this.repository.findInternal(paymentId, userId);
    if (!payment) throw new PaymentError("PAYMENT_NOT_FOUND", 404);
    const operationKey = payment.metadata?.operationKey;
    if (!operationKey) throw new PaymentError("REFUND_OPERATION_KEY_UNAVAILABLE", 409);
    const reason = required(input.reason || "customer_request", "INVALID_REFUND_REASON", 200);
    const reserved = await this.repository.reserveRefund(userId, paymentId, reason, idempotencyKey);
    if (reserved.idempotent) return reserved.refund;
    try {
      const providerResult = await this.provider.createRefund({
        operationKey,
        amountMinor: Number(payment.amount_minor),
        description: payment.description,
      });
      return this.repository.completeRefund(userId, reserved.refund.id, providerResult);
    } catch (error) {
      await this.repository.failRefund(userId, reserved.refund.id, error.code || "PROVIDER_REFUND_FAILED");
      throw error;
    }
  }

  subscriptionStatus() {
    if (!this.config.subscriptionsEnabled) throw new PaymentError("SUBSCRIPTIONS_DISABLED", 404);
    throw new PaymentError("SUBSCRIPTIONS_NOT_IMPLEMENTED", 501);
  }
}
