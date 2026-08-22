import "dotenv/config";
import { closeDatabase, getPool } from "../src/db/client.mjs";
import { loadPaymentConfig } from "../src/payments/config.mjs";
import { RobokassaPaymentProvider } from "../src/payments/providers/robokassa.mjs";
import { PaymentRepository } from "../src/payments/repository.mjs";

const invoiceId = String(process.argv[2] || "").trim();
if (!/^\d+$/u.test(invoiceId)) {
  console.error("Usage: node scripts/sync-robokassa-operation-state.mjs <invoice-id>");
  process.exitCode = 2;
} else {
  try {
    const payment = await getPool().query(
      `select id from payments
       where provider = 'robokassa' and provider_payment_id = $1 and status = 'paid'`,
      [invoiceId],
    );
    if (!payment.rowCount) throw new Error("PAID_PAYMENT_NOT_FOUND");

    const provider = new RobokassaPaymentProvider(loadPaymentConfig());
    const state = await provider.getOperationState(invoiceId);
    await new PaymentRepository().saveOperationState(payment.rows[0].id, state);
    console.log(JSON.stringify({
      invoiceId,
      stateCode: state.stateCode,
      operationKeyStored: Boolean(state.operationKey),
    }));
  } catch (error) {
    console.error(JSON.stringify({ invoiceId, error: error.code || error.message || "UNKNOWN_ERROR" }));
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}
