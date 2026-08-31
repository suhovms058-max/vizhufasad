import { getPool } from "../db/client.mjs";
import { hashesEqual } from "./crypto.mjs";

export class AuthRepository {
  constructor(pool = getPool(), walletConfig = { freeBonusEnabled: true, freeBonusCredits: 1 }) {
    this.pool = pool;
    this.walletConfig = walletConfig;
  }

  async createLoginCode(input) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `update email_login_codes
         set consumed_at = now()
         where email = $1 and consumed_at is null and expires_at > now()`,
        [input.email],
      );
      await client.query(
        `insert into email_login_codes
          (id, email, code_hash, request_ip_hash, attempts_remaining, expires_at)
         values ($1, $2, $3, $4, $5, $6)`,
        [input.id, input.email, input.codeHash, input.requestIpHash, input.attemptsRemaining, input.expiresAt],
      );
      await client.query(
        `insert into legal_acceptances
          (document_key, document_version, document_hash, action, context, challenge_id,
           request_ip_hash, user_agent)
         values ($1, $2, $3, 'accepted', 'account_email_submission', $4, $5, $6)`,
        [input.consent.document.key, input.consent.document.revision, input.consent.document.hash,
          input.id, input.requestIpHash, input.userAgent],
      );
      await client.query(
        `insert into audit_logs (action, entity_type, entity_id, details)
         values ('auth.code_requested', 'email_login_code', $1, '{}'::jsonb)`,
        [input.id],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async invalidateLoginCode(id) {
    await this.pool.query(
      "update email_login_codes set consumed_at = now() where id = $1 and consumed_at is null",
      [id],
    );
  }

  async authenticateWithCode(input) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query(
        `select id, email, code_hash, attempts_remaining, expires_at, consumed_at
         from email_login_codes where id = $1 for update`,
        [input.challengeId],
      );
      const challenge = result.rows[0];
      if (!challenge || challenge.consumed_at || new Date(challenge.expires_at) <= input.now) {
        await client.query("commit");
        return { ok: false, reason: "INVALID_OR_EXPIRED" };
      }
      if (challenge.attempts_remaining <= 0) {
        await client.query("commit");
        return { ok: false, reason: "ATTEMPTS_EXHAUSTED" };
      }
      if (!hashesEqual(challenge.code_hash, input.codeHash)) {
        const remaining = challenge.attempts_remaining - 1;
        await client.query(
          `update email_login_codes
           set attempts_remaining = $2, consumed_at = case when $2 = 0 then now() else consumed_at end
           where id = $1`,
          [input.challengeId, remaining],
        );
        await client.query(
          `insert into audit_logs (action, entity_type, entity_id, details)
           values ('auth.code_rejected', 'email_login_code', $1, jsonb_build_object('attemptsRemaining', $2::int))`,
          [input.challengeId, remaining],
        );
        await client.query("commit");
        return { ok: false, reason: "INVALID_CODE", attemptsRemaining: remaining };
      }

      await client.query(
        "update email_login_codes set consumed_at = now() where id = $1",
        [input.challengeId],
      );
      let userResult = await client.query(
        `select id, email, status, account_deletion_requested_at
         from users where lower(email) = lower($1) for update`,
        [challenge.email],
      );
      let user = userResult.rows[0];
      if (!user) {
        userResult = await client.query(
          "insert into users (email, status) values ($1, 'active') returning id, email, status",
          [challenge.email],
        );
        user = userResult.rows[0];
        await client.query(
          "insert into wallets (user_id, currency) values ($1, 'CREDIT') returning id",
          [user.id],
        );
        if (this.walletConfig.freeBonusEnabled) {
          await client.query(
            `insert into free_trial_entitlements (user_id, device_hash, expires_at)
             values ($1, $2, now() + interval '180 days')
             on conflict (user_id) where user_id is not null do nothing`,
            [user.id, input.deviceHash || null],
          );
        }
      } else if (
        user.status === "blocked"
        || user.status === "deleted"
        || user.account_deletion_requested_at
      ) {
        await client.query(
          `insert into audit_logs (actor_user_id, action, entity_type, entity_id, details)
           values ($1, 'auth.login_rejected', 'user', $1, jsonb_build_object('reason', 'account_unavailable'))`,
          [user.id],
        );
        await client.query("commit");
        return { ok: false, reason: "ACCOUNT_UNAVAILABLE" };
      } else if (user.status === "pending") {
        const activated = await client.query(
          "update users set status = 'active', updated_at = now() where id = $1 returning id, email, status",
          [user.id],
        );
        user = activated.rows[0];
      }

      const sessionResult = await client.query(
        `insert into auth_sessions
          (user_id, token_hash, request_ip_hash, user_agent, expires_at, last_seen_at)
         values ($1, $2, $3, $4, $5, now())
         returning id, created_at, expires_at`,
        [user.id, input.tokenHash, input.requestIpHash, input.userAgent, input.expiresAt],
      );
      if (input.deviceHash) {
        await client.query(
          `update free_trial_entitlements set device_hash = coalesce(device_hash, $2), updated_at = now()
           where user_id = $1`,
          [user.id, input.deviceHash],
        );
      }
      await client.query(
        `update legal_acceptances set user_id = $1
         where challenge_id = $2 and user_id is null and document_key = 'personal-data-consent'`,
        [user.id, input.challengeId],
      );
      await client.query(
        `insert into audit_logs (actor_user_id, action, entity_type, entity_id, details)
         values ($1, 'auth.login_succeeded', 'auth_session', $2, '{}'::jsonb)`,
        [user.id, sessionResult.rows[0].id],
      );
      await client.query("commit");
      return { ok: true, user, session: sessionResult.rows[0] };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async findSession(tokenHash) {
    const result = await this.pool.query(
      `select s.id, s.user_id, s.created_at, s.expires_at, u.email, u.status
       from auth_sessions s join users u on u.id = s.user_id
       where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now()
         and u.status = 'active' and u.account_deletion_requested_at is null`,
      [tokenHash],
    );
    const session = result.rows[0];
    if (session) {
      await this.pool.query("update auth_sessions set last_seen_at = now() where id = $1", [session.id]);
    }
    return session ?? null;
  }

  async listSessions(userId) {
    const result = await this.pool.query(
      `select id, user_agent, created_at, last_seen_at, expires_at
       from auth_sessions
       where user_id = $1 and revoked_at is null and expires_at > now()
       order by created_at desc`,
      [userId],
    );
    return result.rows;
  }

  async revokeSession(userId, sessionId, action = "auth.session_revoked") {
    const result = await this.pool.query(
      `update auth_sessions set revoked_at = now()
       where id = $1 and user_id = $2 and revoked_at is null returning id`,
      [sessionId, userId],
    );
    if (!result.rowCount) return false;
    await this.pool.query(
      `insert into audit_logs (actor_user_id, action, entity_type, entity_id, details)
       values ($1, $2, 'auth_session', $3, '{}'::jsonb)`,
      [userId, action, sessionId],
    );
    return true;
  }

  async revokeAllSessions(userId, action = "auth.sessions_revoked") {
    const result = await this.pool.query(
      `update auth_sessions set revoked_at = now()
       where user_id = $1 and revoked_at is null returning id`,
      [userId],
    );
    await this.pool.query(
      `insert into audit_logs (actor_user_id, action, entity_type, entity_id, details)
       values ($1, $2, 'user', $1, jsonb_build_object('count', $3::int))`,
      [userId, action, result.rowCount],
    );
    return result.rowCount;
  }

  async requestAccountDeletion(userId) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `update users set account_deletion_requested_at = coalesce(account_deletion_requested_at, now()),
          updated_at = now() where id = $1`,
        [userId],
      );
      await client.query(
        "update auth_sessions set revoked_at = now() where user_id = $1 and revoked_at is null",
        [userId],
      );
      await client.query(
        `insert into audit_logs (actor_user_id, action, entity_type, entity_id, details)
         values ($1, 'account.deletion_requested', 'user', $1, '{}'::jsonb)`,
        [userId],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async pendingAccountDeletions(limit = 20) {
    const result = await this.pool.query(
      `select id, email, account_deletion_requested_at
       from users
       where account_deletion_requested_at is not null and deleted_at is null
       order by account_deletion_requested_at asc limit $1`,
      [limit],
    );
    return result.rows;
  }

  async finalizeAccountDeletion(userId) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const current = await client.query(
        `select id, email from users
         where id = $1 and account_deletion_requested_at is not null and deleted_at is null
         for update`,
        [userId],
      );
      if (!current.rowCount) {
        await client.query("commit");
        return { completed: false };
      }
      const email = current.rows[0].email;
      const codes = await client.query(
        "delete from email_login_codes where lower(email) = lower($1)",
        [email],
      );
      const sessions = await client.query("delete from auth_sessions where user_id = $1", [userId]);
      await client.query(
        `update users set status = 'deleted',
          email = concat('deleted+', id::text, '@invalid.vizhufasad.local'),
          deleted_at = now(), updated_at = now()
         where id = $1`,
        [userId],
      );
      await client.query(
        `insert into audit_logs (actor_user_id, action, entity_type, entity_id, details)
         values ($1, 'account.deletion_completed', 'user', $1,
           jsonb_build_object('loginCodesDeleted', $2::int, 'sessionsDeleted', $3::int))`,
        [userId, codes.rowCount, sessions.rowCount],
      );
      await client.query("commit");
      return { completed: true, loginCodesDeleted: codes.rowCount, sessionsDeleted: sessions.rowCount };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
