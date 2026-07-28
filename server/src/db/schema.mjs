import { sql } from "drizzle-orm";
import {
  bigint, boolean, check, index, integer, jsonb, pgEnum, pgTable,
  text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const userStatus = pgEnum("user_status", ["pending", "active", "blocked", "deleted"]);
export const projectStatus = pgEnum("project_status", [
  "photo_validation_queued", "photo_retake_required", "configuration_required",
  "generation_queued", "generating", "qa_queued", "qa_failed_retrying",
  "ready", "revision_queued", "failed_terminal", "archived",
]);
export const imageStatus = pgEnum("image_status", ["uploaded", "validated", "rejected", "deleted"]);
export const generationStatus = pgEnum("generation_status", ["queued", "processing", "qa", "ready", "failed", "cancelled"]);
export const attemptStatus = pgEnum("attempt_status", ["started", "succeeded", "retryable_failed", "terminal_failed"]);
export const transactionType = pgEnum("wallet_transaction_type", ["credit", "debit", "hold", "release", "refund", "adjustment"]);
export const paymentStatus = pgEnum("payment_status", ["pending", "authorized", "succeeded", "failed", "cancelled", "refunded"]);
export const subscriptionStatus = pgEnum("subscription_status", ["pending", "active", "past_due", "cancelled", "expired"]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull(),
  status: userStatus("status").default("pending").notNull(),
  ...timestamps,
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("users_email_lower_uidx").on(table.email),
  index("users_status_idx").on(table.status),
]);

export const authSessions = pgTable("auth_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("auth_sessions_token_hash_uidx").on(table.tokenHash),
  index("auth_sessions_user_expires_idx").on(table.userId, table.expiresAt),
]);

export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  legacyOrderId: text("legacy_order_id"),
  title: text("title").notNull(),
  status: projectStatus("status").default("photo_validation_queued").notNull(),
  facadeConfig: jsonb("facade_config").default({}).notNull(),
  geometryPolicy: jsonb("geometry_policy").default({
    preserveGeometry: true, preserveFloors: true, preserveWindows: true,
    preserveDoors: true, preserveRoof: true,
  }).notNull(),
  ...timestamps,
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("projects_legacy_order_id_uidx").on(table.legacyOrderId),
  index("projects_user_created_idx").on(table.userId, table.createdAt),
  index("projects_status_idx").on(table.status),
]);

export const sourceImages = pgTable("source_images", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  storageBucket: text("storage_bucket").notNull(),
  storageKey: text("storage_key").notNull(),
  originalFilename: text("original_filename"),
  mimeType: text("mime_type").notNull(),
  byteSize: bigint("byte_size", { mode: "number" }).notNull(),
  width: integer("width"),
  height: integer("height"),
  sha256: text("sha256").notNull(),
  status: imageStatus("status").default("uploaded").notNull(),
  qualityAssessment: jsonb("quality_assessment"),
  ...timestamps,
}, (table) => [
  uniqueIndex("source_images_storage_object_uidx").on(table.storageBucket, table.storageKey),
  index("source_images_project_created_idx").on(table.projectId, table.createdAt),
  index("source_images_sha256_idx").on(table.sha256),
  check("source_images_byte_size_positive_chk", sql`${table.byteSize} > 0`),
  check("source_images_dimensions_positive_chk", sql`(${table.width} IS NULL OR ${table.width} > 0) AND (${table.height} IS NULL OR ${table.height} > 0)`),
]);

export const generations = pgTable("generations", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sourceImageId: uuid("source_image_id").notNull().references(() => sourceImages.id, { onDelete: "restrict" }),
  revision: integer("revision").default(1).notNull(),
  status: generationStatus("status").default("queued").notNull(),
  configSnapshot: jsonb("config_snapshot").notNull(),
  geometryPolicySnapshot: jsonb("geometry_policy_snapshot").notNull(),
  resultBucket: text("result_bucket"),
  resultKey: text("result_key"),
  failureCode: text("failure_code"),
  ...timestamps,
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("generations_project_revision_uidx").on(table.projectId, table.revision),
  index("generations_status_created_idx").on(table.status, table.createdAt),
  check("generations_revision_positive_chk", sql`${table.revision} > 0`),
]);

export const generationAttempts = pgTable("generation_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  generationId: uuid("generation_id").notNull().references(() => generations.id, { onDelete: "cascade" }),
  attemptNumber: integer("attempt_number").notNull(),
  status: attemptStatus("status").default("started").notNull(),
  provider: text("provider"),
  providerRequestId: text("provider_request_id"),
  errorCode: text("error_code"),
  errorDetails: jsonb("error_details"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("generation_attempts_number_uidx").on(table.generationId, table.attemptNumber),
  index("generation_attempts_status_idx").on(table.status),
  check("generation_attempts_number_positive_chk", sql`${table.attemptNumber} > 0`),
]);

export const wallets = pgTable("wallets", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  currency: text("currency").default("CREDIT").notNull(),
  balance: bigint("balance", { mode: "number" }).default(0).notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("wallets_user_currency_uidx").on(table.userId, table.currency),
  check("wallets_balance_nonnegative_chk", sql`${table.balance} >= 0`),
]);

export const walletTransactions = pgTable("wallet_transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  walletId: uuid("wallet_id").notNull().references(() => wallets.id, { onDelete: "restrict" }),
  type: transactionType("type").notNull(),
  amount: bigint("amount", { mode: "number" }).notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  referenceType: text("reference_type"),
  referenceId: uuid("reference_id"),
  metadata: jsonb("metadata").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("wallet_transactions_idempotency_uidx").on(table.idempotencyKey),
  index("wallet_transactions_wallet_created_idx").on(table.walletId, table.createdAt),
  check("wallet_transactions_amount_nonzero_chk", sql`${table.amount} <> 0`),
]);

export const tariffPlans = pgTable("tariff_plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  priceMinor: bigint("price_minor", { mode: "number" }).notNull(),
  currency: text("currency").default("RUB").notNull(),
  credits: integer("credits").notNull(),
  isActive: boolean("is_active").default(false).notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("tariff_plans_code_uidx").on(table.code),
  index("tariff_plans_active_idx").on(table.isActive),
  check("tariff_plans_price_nonnegative_chk", sql`${table.priceMinor} >= 0`),
  check("tariff_plans_credits_positive_chk", sql`${table.credits} > 0`),
]);

export const payments = pgTable("payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  tariffPlanId: uuid("tariff_plan_id").references(() => tariffPlans.id, { onDelete: "restrict" }),
  provider: text("provider").notNull(),
  providerPaymentId: text("provider_payment_id"),
  idempotencyKey: text("idempotency_key").notNull(),
  status: paymentStatus("status").default("pending").notNull(),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  currency: text("currency").notNull(),
  metadata: jsonb("metadata").default({}).notNull(),
  ...timestamps,
  paidAt: timestamp("paid_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("payments_idempotency_uidx").on(table.idempotencyKey),
  uniqueIndex("payments_provider_id_uidx").on(table.provider, table.providerPaymentId),
  index("payments_user_created_idx").on(table.userId, table.createdAt),
  index("payments_status_idx").on(table.status),
  check("payments_amount_positive_chk", sql`${table.amountMinor} > 0`),
]);

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  tariffPlanId: uuid("tariff_plan_id").notNull().references(() => tariffPlans.id, { onDelete: "restrict" }),
  provider: text("provider").notNull(),
  providerSubscriptionId: text("provider_subscription_id"),
  status: subscriptionStatus("status").default("pending").notNull(),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
  ...timestamps,
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("subscriptions_provider_id_uidx").on(table.provider, table.providerSubscriptionId),
  index("subscriptions_user_status_idx").on(table.userId, table.status),
]);

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  requestId: text("request_id"),
  ipHash: text("ip_hash"),
  details: jsonb("details").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("audit_logs_entity_created_idx").on(table.entityType, table.entityId, table.createdAt),
  index("audit_logs_actor_created_idx").on(table.actorUserId, table.createdAt),
  index("audit_logs_request_idx").on(table.requestId),
]);
