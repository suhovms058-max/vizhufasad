import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { closeDatabase, getPool } from "../src/db/client.mjs";
import { AuthRepository } from "../src/auth/repository.mjs";
import { AuthService } from "../src/auth/service.mjs";

const enabled = Boolean(process.env.DATABASE_URL);

test("login code is one-time and creates user, wallet and revocable session", { skip: !enabled }, async () => {
  const pool = getPool();
  const repository = new AuthRepository(pool);
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
    config,
    mailer: { async sendLoginCode(message) { deliveredCode = message.code; } },
  });

  try {
    const exhausted = await service.requestCode(email, { ip: "127.0.0.1" });
    for (let attempt = 2; attempt >= 0; attempt -= 1) {
      const rejected = await service.verifyCode({
        challengeId: exhausted.challengeId,
        code: deliveredCode === "000000" ? "999999" : "000000",
      }, { ip: "127.0.0.1" });
      assert.equal(rejected.ok, false);
      assert.equal(rejected.reason, "INVALID_CODE");
      assert.equal(rejected.attemptsRemaining, attempt);
    }
    const afterExhaustion = await service.verifyCode({
      challengeId: exhausted.challengeId,
      code: deliveredCode,
    }, { ip: "127.0.0.1" });
    assert.equal(afterExhaustion.ok, false);
    assert.equal(afterExhaustion.reason, "INVALID_OR_EXPIRED");

    const requested = await service.requestCode(email, { ip: "127.0.0.1" });
    const first = await service.verifyCode({
      challengeId: requested.challengeId,
      code: deliveredCode,
    }, { ip: "127.0.0.1", userAgent: "node-test" });
    assert.equal(first.ok, true);

    const repeated = await service.verifyCode({
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

    assert.ok(await service.sessionFromRequest({ headers: { cookie: `session=${first.token}` } }));
    assert.equal(await repository.revokeSession(first.user.id, first.session.id, "auth.logout"), true);
    assert.equal(await service.sessionFromRequest({ headers: { cookie: `session=${first.token}` } }), null);

    const repeatRequest = await service.requestCode(email, { ip: "127.0.0.1" });
    const repeatLogin = await service.verifyCode({
      challengeId: repeatRequest.challengeId,
      code: deliveredCode,
    }, { ip: "127.0.0.1", userAgent: "node-test-repeat" });
    assert.equal(repeatLogin.ok, true);
    assert.equal(repeatLogin.user.id, first.user.id);
    const repeatWalletState = await pool.query(
      "select count(*)::int as wallet_count from wallets where user_id = $1",
      [first.user.id],
    );
    assert.equal(repeatWalletState.rows[0].wallet_count, 1);

    await repository.requestAccountDeletion(first.user.id);
    assert.equal(await service.sessionFromRequest({ headers: { cookie: `session=${repeatLogin.token}` } }), null);
    const deletionLogin = await service.requestCode(email, { ip: "127.0.0.1" });
    const rejectedDeletionLogin = await service.verifyCode({
      challengeId: deletionLogin.challengeId,
      code: deliveredCode,
    }, { ip: "127.0.0.1" });
    assert.equal(rejectedDeletionLogin.ok, false);
    assert.equal(rejectedDeletionLogin.reason, "ACCOUNT_UNAVAILABLE");
  } finally {
    const user = await pool.query("select id from users where email = $1", [email]);
    if (user.rows[0]) {
      await pool.query("delete from wallets where user_id = $1", [user.rows[0].id]);
      await pool.query("delete from users where id = $1", [user.rows[0].id]);
    }
    await pool.query("delete from email_login_codes where email = $1", [email]);
    await closeDatabase();
  }
});
