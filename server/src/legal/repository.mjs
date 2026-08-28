import { getPool } from "../db/client.mjs";

export class LegalAcceptanceRepository {
  constructor(pool = getPool()) { this.pool = pool; }

  async record(input) {
    const result = await this.pool.query(
      `insert into legal_acceptances
       (user_id, document_key, document_version, document_hash, action, context, project_id, payment_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning *`,
      [input.userId || null, input.documentKey, input.documentVersion, input.documentHash,
        input.action || "accepted", input.context, input.projectId || null, input.paymentId || null],
    );
    return result.rows[0];
  }

  async hasCurrent(userId, documents) {
    const result = await this.pool.query(
      `select distinct on (document_key) document_key, document_version, document_hash, action
       from legal_acceptances where user_id = $1 and document_key = any($2::text[])
       order by document_key, created_at desc`,
      [userId, documents.map((document) => document.key)],
    );
    const latest = new Map(result.rows.map((row) => [row.document_key, row]));
    return documents.every((document) => {
      const row = latest.get(document.key);
      return row?.action === "accepted" && row.document_version === document.revision && row.document_hash === document.hash;
    });
  }
}
