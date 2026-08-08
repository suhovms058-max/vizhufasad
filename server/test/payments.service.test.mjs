import assert from "node:assert/strict";
import test from "node:test";
import { PaymentService } from "../src/payments/service.mjs";

const payment = {
  id: "payment-id", user_id: "user-id", status: "created", amount_minor: 79_000,
  provider_payment_id: "100001", checkout_expires_at: new Date(), metadata: {},
};

test("checkout uses repository tariff data and provider output", async () => {
  const calls = [];
  const repository = {
    async create(input) { calls.push(input); return { payment, idempotent: false }; },
    async markPending() {},
    async markFailed() { assert.fail("must not fail"); },
    async view() { return { id: payment.id, amountMinor: 79_000, status: "pending" }; },
  };
  const provider = { createCheckout(row, customer) { return { url: `https://pay.test/${row.id}?email=${customer.email}` }; } };
  const service = new PaymentService({
    repository, provider, config: { enabled: true, checkoutTtlMinutes: 30 },
    clock: () => new Date("2026-08-08T10:00:00Z"),
  });
  const result = await service.createCheckout(
    { user_id: "user-id", email: "buyer@example.test" },
    { tariffPlanId: "tariff-id", promoCode: " bonus " },
    "checkout-key",
  );
  assert.equal(calls[0].tariffPlanId, "tariff-id");
  assert.equal(calls[0].promoCode, "BONUS");
  assert.match(result.checkout.url, /payment-id/);
});

test("invalid signature is audited and duplicate paid events stay idempotent", async () => {
  let rejected;
  const repository = {
    async recordRejectedWebhook(_payload, code) { rejected = code; },
    async processPaid() { return { payment: { id: payment.id, status: "paid" }, idempotent: true }; },
  };
  const provider = {
    verifyResult(input) {
      if (input.invalid) throw Object.assign(new Error("bad"), { code: "INVALID_WEBHOOK_SIGNATURE", status: 401 });
      return { eventKey: "paid:1", providerPaymentId: "1" };
    },
  };
  const service = new PaymentService({ repository, provider, config: { enabled: true } });
  await assert.rejects(service.handleResult({ invalid: true }), /bad/);
  assert.equal(rejected, "INVALID_WEBHOOK_SIGNATURE");
  const result = await service.handleResult({});
  assert.equal(result.idempotent, true);
  assert.equal(result.acknowledgment, "OK1");
});

test("subscriptions remain unavailable without explicit approval", () => {
  const service = new PaymentService({ repository: {}, provider: {}, config: { enabled: true, subscriptionsEnabled: false } });
  assert.throws(() => service.subscriptionStatus(), (error) => error.code === "SUBSCRIPTIONS_DISABLED");
});

test("payment history reconciles a finished provider refund without blocking on transient failures", async () => {
  const calls = [];
  const repository = {
    async pendingRefunds() {
      return [
        { id: "refund-finished", provider_refund_id: "provider-finished" },
        { id: "refund-transient", provider_refund_id: "provider-transient" },
      ];
    },
    async completeRefund(userId, refundId, state) { calls.push({ userId, refundId, state }); },
    async failRefund() { assert.fail("transient provider errors must not fail a refund"); },
    async history() { return [{ id: payment.id }]; },
  };
  const provider = {
    async getRefundState(id) {
      if (id === "provider-transient") throw new Error("temporary outage");
      return { providerRefundId: id, status: "succeeded", amountMinor: 79_000 };
    },
  };
  const service = new PaymentService({ repository, provider, config: { enabled: true } });
  assert.deepEqual(await service.history("user-id", 50), [{ id: payment.id }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].refundId, "refund-finished");
});
