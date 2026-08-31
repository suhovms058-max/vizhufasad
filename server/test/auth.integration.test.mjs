import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { closeDatabase, getPool } from "../src/db/client.mjs";
import { AuthRepository } from "../src/auth/repository.mjs";
import { AuthService } from "../src/auth/service.mjs";
import { LegalAcceptanceRepository } from "../src/legal/repository.mjs";
import { AGE_CONFIRMATION, legalDocument } from "../src/legal/documents.mjs";

const enabled = Boolean(process.env.DATABASE_URL);
const agreement = legalDocument("user-agreement");
const personalData = legalDocument("personal-data-consent");
const requestConsent = {
  personalDataAccepted: true, personalDataVersion: personalData.revision, personalDataHash: personalData.hash,
};
const accountConsents = {
  agreementAccepted: true, agreementVersion: agreement.revision, agreementHash: agreement.hash,
  ageConfirmed: true, ageVersion: AGE_CONFIRMATION.revision, ageHash: AGE_CONFIRMATION.hash,
};

test("login code is one-time and creates user, wallet and revocable session", { skip: !enabled }, async () => {
  const pool = getPool();
  const repository = new AuthRepository(pool, { freeBonusEnabled: true, freeBonusCredits: 2 });
  const email = `auth-${randomUUID()}@example.test`;
  let deliveredCode;
  const config = {
    hashSecret: "integration-secret-with-at-least-thirty-two-characters",
    codeTtlSeconds: 600,
    codeMaxAttempts: 3,
    sessionTtlSeconds: 3600,
    cookieName: "session",
    cookieSecure: false,
  };
  const service = new AuthService({
    repository,
    legalAcceptanceRepository: new LegalAcceptanceRepository(pool),
    config,
    mailer: { async sendLoginCode(message) { deliveredCode = message.code; } },
  });

  try {
    const exhausted = await service.requestCode({ email, ...requestConsent }, { ip: "127.0.0.1" });
    for (let attempt = 2; attempt >= 0; attempt -= 1) {
      const rejected = await service.verifyCode({
        ...accountConsents,
        challengeId: exhausted.challengeId,
        code: deliveredCode === "000000" ? "999999" : "000000",
      }, { ip: "127.0.0.1" });
      assert.equal(rejected.ok, false);
      assert.equal(rejected.reason, "INVALID_CODE");
      assert.equal(rejected.attemptsRemaining, attempt);
    }
    const afterExhaustion = await service.verifyCode({
      ...accountConsents,
      challengeId: exhausted.challengeId,
      code: deliveredCode,
    }, { ip: "127.0.0.1" });
    assert.equal(afterExhaustion.ok, false);
    assert.equal(afterExhaustion.reason, "INVALID_OR_EXPIRED");

    const requested = await service.requestCode({ email, ...requestConsent }, { ip: "127.0.0.1" });
    const preAuthConsent = await pool.query(
      `select user_id, challenge_id, document_version, document_hash
       from legal_acceptances where challenge_id = $1 and document_key = 'personal-data-consent'`,
      [requested.challengeId],
    );
    assert.equal(preAuthConsent.rowCount, 1);
    assert.equal(preAuthConsent.rows[0].user_id, null);
    assert.equal(preAuthConsent.rows[0].document_version, personalData.revision);
    assert.equal(preAuthConsent.rows[0].document_hash, personalData.hash);
    const first = await service.verifyCode({
      ...accountConsents,
      challengeId: requested.challengeId,
      code: deliveredCode,
    }, { ip: "127.0.0.1", userAgent: "node-test" });
    assert.equal(first.ok, true);
    const linkedConsent = await pool.query(
      "select user_id from legal_acceptances where challenge_id = $1 and document_key = 'personal-data-consent'",
      [requested.challengeId],
    );
    assert.equal(linkedConsent.rows[0].user_id, first.user.id);

    const repeated = await service.verifyCode({
      ...accountConsents,
      challengeId: requested.challengeId,
      code: deliveredCode,
    }, { ip: "127.0.0.1" });
    assert.equal(repeated.ok, false);
    assert.equal(repeated.reason, "INVALID_OR_EXPIRED");

    const databaseState = await pool.query(
      `select u.id, u.status, count(w.id)::int as wallet_count
       from users u left join wallets w on w.user_id = u.id
       where u.email = $1 group by u.id`,
      [email],
    );
    assert.equal(databaseState.rows[0].status, "active");
    assert.equal(databaseState.rows[0].wallet_count, 1);
    const bonusState = await pool.query(
      `select w.balance, count(t.id)::int as bonus_count
       from wallets w left join wallet_transactions t
         on t.wallet_id = w.id and t.type = 'free_bonus'
       where w.user_id = $1 group by w.id`,
      [first.user.id],
    );
    assert.equal(bonusState.rows[0].balance, "0");
    assert.equal(bonusState.rows[0].bonus_count, 0);
    const entitlement = await pool.query(
      "select status from free_trial_entitlements where user_id = $1",
      [first.user.id],
    );
    assert.equal(entitlement.rows[0]?.status, "pending");

    assert.ok(await service.sessionFromRequest({ headers: { cookie: `session=${first.token}` } }));
    assert.equal(await repository.revokeSession(first.user.id, first.session.id, "auth.logout"), true);
    assert.equal(await service.sessionFromRequest({ headers: { cookie: `session=${first.token}` } }), null);

    const repeatRequest = await service.requestCode({ email, ...requestConsent }, { ip: "127.0.0.1" });
    const repeatLogin = await service.verifyCode({
      ...accountConsents,
      challengeId: repeatRequest.challengeId,
      code: deliveredCode,
    }, { ip: "127.0.0.1", userAgent: "node-test-repeat" });
    assert.equal(repeatLogin.ok, true);
    assert.equal(repeatLogin.user.id, first.user.id);
    const repeatWalletState = await pool.query(
      `select count(distinct w.id)::int as wallet_count,
        count(t.id)::int as bonus_count
       from wallets w left join wallet_transactions t
         on t.wallet_id = w.id and t.type = 'free_bonus'
       where w.user_id = $1`,
      [first.user.id],
    );
    assert.equal(repeatWalletState.rows[0].wallet_count, 1);
    assert.equal(repeatWalletState.rows[0].bonus_count, 0);

    await repository.requestAccountDeletion(first.user.id);
    assert.equal(await service.sessionFromRequest({ headers: { cookie: `session=${repeatLogin.token}` } }), null);
    const deletionLogin = await service.requestCode({ email, ...requestConsent }, { ip: "127.0.0.1" });
    const rejectedDeletionLogin = await service.verifyCode({
      ...accountConsents,
      challengeId: deletionLogin.challengeId,
      code: deliveredCode,
    }, { ip: "127.0.0.1" });
    assert.equal(rejectedDeletionLogin.ok, false);
    assert.equal(rejectedDeletionLogin.reason, "ACCOUNT_UNAVAILABLE");
  } finally {
    const user = await pool.query("select id from users where email = $1", [email]);
    if (user.rows[0]) {
      await pool.query("delete from legal_acceptances where user_id = $1", [user.rows[0].id]);
      await pool.query(
        "delete from wallet_transactions where wallet_id in (select id from wallets where user_id = $1)",
        [user.rows[0].id],
      );
      await pool.query("delete from wallets where user_id = $1", [user.rows[0].id]);
      await pool.query("delete from users where id = $1", [user.rows[0].id]);
    }
    await pool.query("delete from email_login_codes where email = $1", [email]);
    await closeDatabase();
  }
});
