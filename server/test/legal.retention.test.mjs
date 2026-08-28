import assert from "node:assert/strict";
import test from "node:test";
import {
  AccountDeletionProcessor, DEFAULT_RETENTION, PersonalDataRetentionRepository,
} from "../src/legal/retention.mjs";

test("personal data retention uses fixed cutoffs and records deleted counts", async () => {
  const calls = [];
  const counts = [2, 3, 4, 5];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (/^delete from /u.test(String(sql).trim())) return { rowCount: counts.shift() };
      return { rowCount: 1 };
    },
    release() {},
  };
  const pool = { async connect() { return client; }, async query() { return { rowCount: 1 }; } };
  const now = new Date("2026-08-28T12:00:00.000Z");
  const result = await new PersonalDataRetentionRepository(pool).cleanup({ now });

  assert.deepEqual(result, { loginCodes: 2, sessions: 3, productEvents: 4, auditLogs: 5 });
  assert.equal(calls[1].params[0].getTime(), now.getTime() - DEFAULT_RETENTION.loginCodesMs);
  assert.equal(calls[2].params[0].getTime(), now.getTime() - DEFAULT_RETENTION.sessionsMs);
  assert.match(calls.at(-2).sql, /insert into data_cleanup_runs/u);
  assert.equal(calls.at(-1).sql, "commit");
});

test("account deletion removes project objects before anonymizing the account", async () => {
  const events = [];
  const processor = new AccountDeletionProcessor({
    authRepository: {
      async pendingAccountDeletions() { return [{ id: "user-1" }]; },
      async finalizeAccountDeletion(id) { events.push(["finalize", id]); return { completed: true }; },
    },
    projectRepository: {
      async projectsForAccountDeletion() {
        return [{ id: "project-1", keys: ["source", "result"] }];
      },
      async markProjectForAccountDeletion(userId, projectId) {
        events.push(["mark", userId, projectId]);
      },
      async hardDeleteProject(projectId) { events.push(["hard-delete", projectId]); },
    },
    storage: {
      async deletePrivateObjects(keys) { events.push(["objects", ...keys]); },
    },
  });

  assert.deepEqual(await processor.run(), { requested: 1, completed: 1, failed: 0 });
  assert.deepEqual(events, [
    ["mark", "user-1", "project-1"],
    ["objects", "source", "result"],
    ["hard-delete", "project-1"],
    ["finalize", "user-1"],
  ]);
});

test("account deletion remains pending when private object deletion fails", async () => {
  let finalized = false;
  const processor = new AccountDeletionProcessor({
    authRepository: {
      async pendingAccountDeletions() { return [{ id: "user-1" }]; },
      async finalizeAccountDeletion() { finalized = true; return { completed: true }; },
    },
    projectRepository: {
      async projectsForAccountDeletion() { return [{ id: "project-1", keys: ["source"] }]; },
      async markProjectForAccountDeletion() {},
      async hardDeleteProject() {},
    },
    storage: { async deletePrivateObjects() { throw new Error("S3_UNAVAILABLE"); } },
  });

  assert.deepEqual(await processor.run(), { requested: 1, completed: 0, failed: 1 });
  assert.equal(finalized, false);
});
