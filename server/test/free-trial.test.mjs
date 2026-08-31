import assert from "node:assert/strict";
import test from "node:test";
import { perceptualHashDistance } from "../src/free-trial/repository.mjs";
import { FreeTrialError, FreeTrialService } from "../src/free-trial/service.mjs";

test("perceptual hash distance supports near-photo decisions", () => {
  assert.equal(perceptualHashDistance("0000000000000000", "0000000000000000"), 0);
  assert.equal(perceptualHashDistance("0000000000000000", "000000000000000f"), 4);
  assert.equal(perceptualHashDistance("0000000000000000", "ffffffffffffffff"), 64);
  assert.equal(perceptualHashDistance("invalid", "ffffffffffffffff"), Number.POSITIVE_INFINITY);
});

test("paid credits bypass free-trial signals", async () => {
  let freeChecks = 0;
  let walletReservations = 0;
  const service = new FreeTrialService({
    repository: {
      async hasSpendablePaidCredits() { return true; },
      async authorizeAndReserve() { freeChecks += 1; },
    },
    walletService: {
      async reserve() { walletReservations += 1; return { transaction: { id: "paid" } }; },
    },
  });
  const result = await service.reserveStandard("user", {
    actionCode: "standard_generation", idempotencyKey: "generation:1:reserve", referenceId: "generation-1",
  });
  assert.equal(result.transaction.id, "paid");
  assert.equal(walletReservations, 1);
  assert.equal(freeChecks, 0);
});

test("free-trial denial never falls through to wallet reservation", async () => {
  let walletReservations = 0;
  const service = new FreeTrialService({
    repository: {
      async hasSpendablePaidCredits() { return false; },
      async authorizeAndReserve() { return { decision: "denied", reasonCode: "FREE_TRIAL_DEVICE_USED" }; },
    },
    walletService: { async reserve() { walletReservations += 1; } },
  });
  await assert.rejects(
    service.reserveStandard("user", {
      actionCode: "standard_generation", idempotencyKey: "generation:1:reserve",
      referenceId: "generation-1", sourceImageId: "image-1",
    }, { deviceHash: "device" }),
    (error) => error instanceof FreeTrialError && error.code === "FREE_TRIAL_ALREADY_USED",
  );
  assert.equal(walletReservations, 0);
});

test("missing antifraud evidence fails closed", async () => {
  const service = new FreeTrialService({
    repository: {
      async hasSpendablePaidCredits() { return false; },
      async authorizeAndReserve() { return { decision: "review_required", reasonCode: "DEVICE_SIGNAL_MISSING" }; },
    },
    walletService: { async reserve() { throw new Error("must not reserve"); } },
  });
  await assert.rejects(
    service.reserveStandard("user", {
      actionCode: "standard_generation", idempotencyKey: "generation:1:reserve",
      referenceId: "generation-1", sourceImageId: "image-1",
    }),
    (error) => error.code === "FREE_TRIAL_REVIEW_REQUIRED",
  );
});
