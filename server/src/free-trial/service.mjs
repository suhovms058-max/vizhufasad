export class FreeTrialError extends Error {
  constructor(code = "FREE_TRIAL_REVIEW_REQUIRED", status = 403) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export class FreeTrialService {
  constructor({ repository, walletService, freeBonusCredits = 1 }) {
    this.repository = repository;
    this.walletService = walletService;
    this.freeBonusCredits = freeBonusCredits;
  }

  async reserveStandard(userId, input, riskContext = {}) {
    if (await this.repository.hasSpendablePaidCredits(userId, input.actionCode)) {
      return this.walletService.reserve(userId, input);
    }
    const result = await this.repository.authorizeAndReserve({
      userId,
      sourceImageId: input.sourceImageId,
      generationId: input.referenceId,
      deviceHash: riskContext.deviceHash || null,
      ipHash: riskContext.ipHash || null,
      networkHash: riskContext.networkHash || null,
      actionCode: input.actionCode,
      idempotencyKey: input.idempotencyKey,
      freeBonusCredits: this.freeBonusCredits,
    });
    if (result.decision !== "allowed") {
      throw new FreeTrialError(result.decision === "denied"
        ? "FREE_TRIAL_ALREADY_USED"
        : "FREE_TRIAL_REVIEW_REQUIRED");
    }
    return { transaction: result.transaction, idempotent: result.idempotent };
  }

  consume(generationId) {
    return this.repository.consume(generationId);
  }

  release(generationId) {
    return this.repository.release(generationId);
  }
}
