import assert from "node:assert/strict";
import test from "node:test";
import { ProductAnalyticsRepository } from "../src/analytics/repository.mjs";
import { ProductAnalyticsService } from "../src/analytics/service.mjs";

test("product analytics stores only allowlisted non-sensitive fields", async () => {
  const records = [];
  const service = new ProductAnalyticsService({
    repository: { async record(value) { records.push(value); } },
    sessionSalt: "analytics-test-salt-that-is-not-a-production-secret",
  });
  const result = await service.record({
    eventName: "pricing_cta",
    sessionId: "a3f8b099-8e3d-4d8e-9612-127f629e4b19",
    path: "/?email=private@example.test",
    properties: { plan: "START", email: "private@example.test", paymentId: "secret" },
  });
  assert.equal(result.accepted, true);
  assert.equal(records.length, 1);
  assert.equal(records[0].path, "/");
  assert.deepEqual(records[0].properties, { plan: "START" });
  assert.match(records[0].sessionHash, /^[a-f0-9]{64}$/u);
  assert.doesNotMatch(JSON.stringify(records[0]), /private@example|paymentId|secret/u);
});

test("product analytics rejects unknown events and malformed sessions", async () => {
  let calls = 0;
  const service = new ProductAnalyticsService({
    repository: { async record() { calls += 1; } },
    sessionSalt: "analytics-test-salt-that-is-not-a-production-secret",
  });
  assert.deepEqual(await service.record({
    eventName: "arbitrary_event", sessionId: "a3f8b099-8e3d-4d8e-9612-127f629e4b19", path: "/",
  }), { accepted: false });
  assert.deepEqual(await service.record({ eventName: "page_view", sessionId: "short", path: "/" }), { accepted: false });
  assert.equal(calls, 0);
});

test("economics snapshot reports only RUB provider cost and exposes unconverted attempts", async () => {
  const pool = {
    async query(sql, parameters) {
      assert.match(sql, /cost_currency = 'RUB'/u);
      assert.match(sql, /unconverted_cost_attempts/u);
      assert.deepEqual(parameters, [30]);
      return { rows: [{
        paid_revenue_minor: "100000",
        refunded_revenue_minor: "10000",
        provider_cost_minor: "25000",
        paid_payments: 2,
        completed_generations: 5,
        failed_refunded_generations: 1,
        measured_attempts: 6,
        unconverted_cost_attempts: 1,
        unresolved_provider_requests: 2,
        events: { page_view: 12 },
      }] };
    },
  };
  const snapshot = await new ProductAnalyticsRepository(pool).economicsSnapshot(30);
  assert.equal(snapshot.providerCostMinor, 25000);
  assert.equal(snapshot.grossContributionMinor, 65000);
  assert.equal(snapshot.averageProviderCostPerCompletedMinor, 5000);
  assert.equal(snapshot.unconvertedCostAttempts, 1);
  assert.equal(snapshot.unresolvedProviderRequests, 2);
  assert.match(snapshot.caveat, /measured RUB attempts/u);
});
