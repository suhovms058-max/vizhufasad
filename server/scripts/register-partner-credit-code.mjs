import "dotenv/config";
import { hashAuthValue, normalizeEmail } from "../src/auth/crypto.mjs";
import { normalizePartnerCode } from "../src/partner-credits/contract.mjs";
import { closeDatabase, getPool } from "../src/db/client.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const code = normalizePartnerCode(argument("--code"));
const credits = Number(argument("--credits"));
const contract = String(argument("--contract") || "").trim();
const partner = String(argument("--partner") || "").trim() || null;
const recipientEmail = normalizeEmail(argument("--email"));
const expiresAt = argument("--expires-at") ? new Date(argument("--expires-at")) : null;
const secret = String(process.env.AUTH_HASH_SECRET || "");
if (secret.length < 32) throw new Error("AUTH_HASH_SECRET must contain at least 32 characters");
if (!Number.isSafeInteger(credits) || credits <= 0) throw new Error("INVALID_PARTNER_CREDITS");
if (!contract || contract.length > 160) throw new Error("INVALID_CONTRACT_REFERENCE");
if (partner && partner.length > 240) throw new Error("INVALID_PARTNER_NAME");
if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new Error("INVALID_EXPIRY");

const pool = getPool();
try {
  const codeHash = hashAuthValue(secret, "partner-credit-code", code);
  const [local, domain] = recipientEmail.split("@");
  const visible = local.slice(0, Math.min(2, local.length));
  const recipientEmailMasked = `${visible}${"*".repeat(Math.max(3, Math.min(8, local.length - visible.length)))}@${domain}`;
  await pool.query(
    `insert into partner_credit_codes
      (code_hash, code_suffix, credits, contract_reference, partner_name,
       recipient_email_hash, recipient_email_masked, expires_at, is_active)
     values ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
    [codeHash, code.slice(-4), credits, contract, partner,
      hashAuthValue(secret, "partner-recipient-email", recipientEmail), recipientEmailMasked, expiresAt],
  );
  process.stdout.write("Partner credit code registered; plaintext was not stored.\n");
} finally {
  await closeDatabase();
}
