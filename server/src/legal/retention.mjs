import { getPool } from "../db/client.mjs";

const DAY = 24 * 60 * 60 * 1000;

export const DEFAULT_RETENTION = Object.freeze({
  loginCodesMs: DAY,
  sessionsMs: 30 * DAY,
  productEventsMs: 180 * DAY,
  auditLogsMs: 3 * 365 * DAY,
});

export class PersonalDataRetentionRepository {
  constructor(pool = getPool()) {
    this.pool = pool;
  }

  async cleanup({ now = new Date(), retention = DEFAULT_RETENTION } = {}) {
    const cutoffs = {
      loginCodes: new Date(now.getTime() - retention.loginCodesMs),
      sessions: new Date(now.getTime() - retention.sessionsMs),
      productEvents: new Date(now.getTime() - retention.productEventsMs),
      auditLogs: new Date(now.getTime() - retention.auditLogsMs),
    };
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const loginCodes = await client.query(
        "delete from email_login_codes where created_at < $1",
        [cutoffs.loginCodes],
      );
      const sessions = await client.query(
        `delete from auth_sessions
         where expires_at < $1 or (revoked_at is not null and revoked_at < $1)`,
        [cutoffs.sessions],
      );
      const productEvents = await client.query(
        "delete from product_events where created_at < $1",
        [cutoffs.productEvents],
      );
      const freeTrialRiskEvents = await client.query(
        "delete from free_trial_risk_events where expires_at <= $1",
        [now],
      );
      const freeTrialEntitlements = await client.query(
        `delete from free_trial_entitlements where expires_at <= $1
         and status in ('consumed', 'denied', 'review_required')`,
        [now],
      );
      const auditLogs = await client.query(
        `delete from audit_logs where created_at < $1
         and action not like 'account.%'
         and action not like 'payment.%'
         and action not like 'legal.%'`,
        [cutoffs.auditLogs],
      );
      const counts = {
        loginCodes: loginCodes.rowCount,
        sessions: sessions.rowCount,
        productEvents: productEvents.rowCount,
        freeTrialRiskEvents: freeTrialRiskEvents.rowCount,
        freeTrialEntitlements: freeTrialEntitlements.rowCount,
        auditLogs: auditLogs.rowCount,
      };
      await client.query(
        `insert into data_cleanup_runs (status, deleted_counts, completed_at)
         values ('succeeded', $1, now())`,
        [counts],
      );
      await client.query("commit");
      return counts;
    } catch (error) {
      await client.query("rollback");
      await this.pool.query(
        `insert into data_cleanup_runs (status, error_code, completed_at)
         values ('failed', $1, now())`,
        [String(error?.code || error?.name || "CLEANUP_FAILED").slice(0, 100)],
      ).catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}

export class AccountDeletionProcessor {
  constructor({ authRepository, projectRepository, storage }) {
    this.authRepository = authRepository;
    this.projectRepository = projectRepository;
    this.storage = storage;
  }

  async run(limit = 20) {
    const users = await this.authRepository.pendingAccountDeletions(limit);
    const result = { requested: users.length, completed: 0, failed: 0 };
    for (const user of users) {
      try {
        const projects = await this.projectRepository.projectsForAccountDeletion(user.id);
        for (const project of projects) {
          await this.projectRepository.markProjectForAccountDeletion(user.id, project.id);
          await this.storage.deletePrivateObjects(project.keys || []);
          await this.projectRepository.hardDeleteProject(project.id);
        }
        const completed = await this.authRepository.finalizeAccountDeletion(user.id);
        if (completed.completed) result.completed += 1;
      } catch (error) {
        result.failed += 1;
        console.error("Account deletion will be retried", {
          userId: user.id,
          error: error?.code || error?.name || "ACCOUNT_DELETION_FAILED",
        });
      }
    }
    return result;
  }
}
