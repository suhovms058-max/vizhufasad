import { WalletRepositoryError } from "./repository.mjs";

const actionCodes = new Set([
  "standard_generation", "pro_generation", "text_revision", "upscale_4k",
  "photo_assessment", "download",
]);

function requiredText(value, name, max = 160) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) {
    throw new WalletRepositoryError(`INVALID_${name.toUpperCase()}`, 400);
  }
  return normalized;
}

function latestActionVersions(actions) {
  const latest = new Map();
  for (const action of actions) {
    const current = latest.get(action.code);
    if (!current || new Date(action.valid_from).getTime() > new Date(current.valid_from).getTime()) {
      latest.set(action.code, action);
    }
  }
  return [...latest.values()].sort((left, right) => (
    Number(left.credits) - Number(right.credits)
    || String(left.code).localeCompare(String(right.code))
  ));
}

export class WalletService {
  constructor({ repository, config, clock = () => new Date() }) {
    this.repository = repository;
    this.config = config;
    this.clock = clock;
  }

  assertWalletEnabled() {
    if (!this.config.walletEnabled) throw new WalletRepositoryError("WALLET_DISABLED", 404);
  }

  async summary(userId) {
    this.assertWalletEnabled();
    if (this.config.freeBonusEnabled) {
      await this.repository.grantFreeBonus(userId, this.config.freeBonusCredits);
    }
    const wallet = await this.repository.summary(userId);
    if (!wallet) throw new WalletRepositoryError("WALLET_NOT_FOUND", 404);
    return {
      id: wallet.id,
      currency: wallet.currency,
      balance: Number(wallet.balance),
      updatedAt: wallet.updated_at,
    };
  }

  async history(userId, requestedLimit) {
    this.assertWalletEnabled();
    const limit = Math.min(100, Math.max(1, Number.parseInt(requestedLimit || "50", 10) || 50));
    await this.summary(userId);
    return this.repository.history(userId, limit);
  }

  async catalog() {
    if (!this.config.tariffCatalogEnabled) {
      throw new WalletRepositoryError("TARIFF_CATALOG_DISABLED", 404);
    }
    const at = this.clock();
    const [tariffs, actions] = await Promise.all([
      this.repository.listTariffs(at),
      this.repository.listActionCosts(at),
    ]);
    return {
      tariffs: tariffs.map((tariff) => ({
        id: tariff.id,
        code: tariff.code,
        name: tariff.name,
        description: tariff.description,
        priceMinor: Number(tariff.price_minor),
        currency: tariff.currency,
        credits: Number(tariff.credits),
        validFrom: tariff.valid_from,
      })),
      actions: latestActionVersions(actions).map((action) => ({
        code: action.code,
        name: action.name,
        credits: Number(action.credits),
        validFrom: action.valid_from,
      })),
      features: {
        wallet: this.config.walletEnabled,
        tariffCatalog: this.config.tariffCatalogEnabled,
        payments: this.config.paymentsEnabled,
      },
    };
  }

  reserve(userId, input) {
    this.assertWalletEnabled();
    const actionCode = requiredText(input.actionCode, "action_code", 64);
    if (!actionCodes.has(actionCode)) throw new WalletRepositoryError("UNKNOWN_ACTION", 400);
    return this.repository.reserve({
      userId,
      actionCode,
      idempotencyKey: requiredText(input.idempotencyKey, "idempotency_key"),
      referenceType: input.referenceType
        ? requiredText(input.referenceType, "reference_type", 64)
        : null,
      referenceId: input.referenceId || null,
    });
  }

  credit(userId, input) {
    this.assertWalletEnabled();
    const type = requiredText(input.type, "transaction_type", 64);
    if (!new Set(["purchase", "promo", "subscription", "admin_adjustment"]).has(type)) {
      throw new WalletRepositoryError("INVALID_CREDIT_TYPE", 400);
    }
    const amount = Number(input.amount);
    if (
      !Number.isSafeInteger(amount)
      || amount === 0
      || (type !== "admin_adjustment" && amount < 0)
    ) {
      throw new WalletRepositoryError("INVALID_CREDIT_AMOUNT", 400);
    }
    return this.repository.credit({
      userId,
      type,
      amount,
      idempotencyKey: requiredText(input.idempotencyKey, "idempotency_key"),
      referenceType: input.referenceType
        ? requiredText(input.referenceType, "reference_type", 64)
        : null,
      referenceId: input.referenceId || null,
      metadata: input.metadata || {},
    });
  }

  commit(userId, reservationId) {
    this.assertWalletEnabled();
    return this.repository.commit({
      userId,
      reservationId: requiredText(reservationId, "reservation_id", 64),
    });
  }

  refund(userId, reservationId, idempotencyKey, reason) {
    this.assertWalletEnabled();
    return this.repository.refund({
      userId,
      reservationId: requiredText(reservationId, "reservation_id", 64),
      idempotencyKey: requiredText(idempotencyKey, "idempotency_key"),
      reason: reason ? requiredText(reason, "reason", 120) : "technical_failure",
    });
  }

  scheduleTariffVersion(input) {
    const validFrom = new Date(input.validFrom);
    if (
      Number.isNaN(validFrom.getTime())
      || validFrom.getTime() <= this.clock().getTime()
    ) {
      throw new WalletRepositoryError("TARIFF_VALID_FROM_MUST_BE_FUTURE", 400);
    }
    const priceMinor = Number(input.priceMinor);
    const credits = Number(input.credits);
    if (!Number.isSafeInteger(priceMinor) || priceMinor < 0) {
      throw new WalletRepositoryError("INVALID_TARIFF_PRICE", 400);
    }
    if (!Number.isInteger(credits) || credits <= 0) {
      throw new WalletRepositoryError("INVALID_TARIFF_CREDITS", 400);
    }
    return this.repository.scheduleTariffVersion({
      code: requiredText(input.code, "tariff_code", 64).toUpperCase(),
      name: requiredText(input.name, "tariff_name", 120),
      description: input.description ? String(input.description).trim().slice(0, 500) : null,
      priceMinor,
      credits,
      validFrom,
    });
  }
}
