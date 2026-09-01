import "dotenv/config";
import { hashAuthValue, normalizeEmail } from "../src/auth/crypto.mjs";
import { normalizeOwnerCode } from "../src/owner-access/contract.mjs";
import { closeDatabase, getPool } from "../src/db/client.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const email = normalizeEmail(argument("--email"));
const code = normalizeOwnerCode(argument("--code"));
const secret = String(process.env.AUTH_HASH_SECRET || "");
if (secret.length < 32) throw new Error("AUTH_HASH_SECRET must contain at least 32 characters");

const pool = getPool();
try {
  const user = await pool.query(
    "select id from users where lower(email) = lower($1) and status = 'active'",
    [email],
  );
  if (!user.rowCount) throw new Error("OWNER_USER_NOT_FOUND");
  const codeHash = hashAuthValue(secret, "owner-access-code", code);
  await pool.query(
    `insert into owner_access_codes (user_id, code_hash, is_active)
     values ($1, $2, true)
     on conflict (user_id) do update
       set code_hash = excluded.code_hash, is_active = true, expires_at = null,
         activated_at = null, updated_at = now()`,
    [user.rows[0].id, codeHash],
  );
  process.stdout.write("Owner access code registered for the selected account; plaintext was not stored.\n");
} finally {
  await closeDatabase();
}
