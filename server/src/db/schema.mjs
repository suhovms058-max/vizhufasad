import { sql } from "drizzle-orm";
import {
  bigint, boolean, check, foreignKey, index, integer, jsonb, pgEnum, pgTable,
  text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const userStatus = pgEnum("user_status", ["pending", "active", "blocked", "deleted"]);
export const projectStatus = pgEnum("project_status", [
  "draft", "photo_uploading", "photo_processing", "photo_ready",
  "photo_validation_queued", "photo_retake_required", "configuration_required",
  "generation_queued", "generating", "qa_queued", "qa_failed_retrying",
  "ready", "revision_queued", "failed_terminal", "archived", "deleted",
]);
export const imageStatus = pgEnum("image_status", [
  "uploading", "uploaded", "processing", "ready", "invalid", "deleted",
]);
export const photoAssessmentStatus = pgEnum("photo_assessment_status", [
  "queued", "processing", "completed", "provider_unavailable",
]);
export const photoAssessmentDecision = pgEnum("photo_assessment_decision", [
  "accepted", "accepted_with_warning", "retake_required",
]);
export const generationStatus = pgEnum("generation_status", ["queued", "processing", "qa", "ready", "failed", "cancelled"]);
export const attemptStatus = pgEnum("attempt_status", ["started", "succeeded", "retryable_failed", "terminal_failed"]);
export const transactionType = pgEnum("wallet_transaction_type", [
  "free_bonus", "purchase", "generation_charge", "generation_refund",
  "promo", "subscription", "admin_adjustment",
]);
export const walletTransactionStatus = pgEnum("wallet_transaction_status", [
  "reserved", "committed", "refunded",
]);
export const paymentStatus = pgEnum("payment_status", ["pending", "authorized", "succeeded", "failed", "cancelled", "refunded"]);
export const subscriptionStatus = pgEnum("subscription_status", ["pending", "active", "past_due", "cancelled", "expired"]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull(),
  status: userStatus("status").default("pending").notNull(),
  ...timestamps,
  accountDeletionRequestedAt: timestamp("account_deletion_requested_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("users_email_lower_uidx").on(sql`lower(${table.email})`),
  index("users_status_idx").on(table.status),
]);

export const emailLoginCodes = pgTable("email_login_codes", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull(),
  codeHash: text("code_hash").notNull(),
  requestIpHash: text("request_ip_hash"),
  attemptsRemaining: integer("attempts_remaining").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("email_login_codes_email_created_idx").on(table.email, table.createdAt),
  index("email_login_codes_expires_idx").on(table.expiresAt),
  check("email_login_codes_attempts_chk", sql`${table.attemptsRemaining} >= 0`),
]);

export const authSessions = pgTable("auth_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  requestIpHash: text("request_ip_hash"),
  userAgent: text("user_agent"),
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
  status: projectStatus("status").default("draft").notNull(),
  facadeConfig: jsonb("facade_config").default({}).notNull(),
  geometryPolicy: jsonb("geometry_policy").default({
    preserveGeometry: true, preserveFloors: true, preserveWindows: true,
    preserveDoors: true, preserveRoof: true,
  }).notNull(),
  ...timestamps,
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
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
  workingStorageKey: text("working_storage_key"),
  thumbnailStorageKey: text("thumbnail_storage_key"),
  originalFilename: text("original_filename"),
  declaredMimeType: text("declared_mime_type").notNull(),
  mimeType: text("mime_type").notNull(),
  byteSize: bigint("byte_size", { mode: "number" }).notNull(),
  width: integer("width"),
  height: integer("height"),
  sha256: text("sha256"),
  status: imageStatus("status").default("uploading").notNull(),
  invalidReason: text("invalid_reason"),
  recommendedSize: boolean("recommended_size").default(false).notNull(),
  qualityAssessment: jsonb("quality_assessment"),
  ...timestamps,
  uploadExpiresAt: timestamp("upload_expires_at", { withTimezone: true }),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("source_images_storage_object_uidx").on(table.storageBucket, table.storageKey),
  index("source_images_project_created_idx").on(table.projectId, table.createdAt),
  index("source_images_sha256_idx").on(table.sha256),
  check("source_images_byte_size_positive_chk", sql`${table.byteSize} > 0`),
  check("source_images_dimensions_positive_chk", sql`(${table.width} IS NULL OR ${table.width} > 0) AND (${table.height} IS NULL OR ${table.height} > 0)`),
]);

export const photoAssessments = pgTable("photo_assessments", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceImageId: uuid("source_image_id").notNull().references(() => sourceImages.id, { onDelete: "cascade" }),
  status: photoAssessmentStatus("status").default("queued").notNull(),
  decision: photoAssessmentDecision("decision"),
  technicalResult: jsonb("technical_result"),
  userResult: jsonb("user_result"),
  provider: text("provider"),
  model: text("model"),
  promptVersion: text("prompt_version").notNull(),
  schemaVersion: text("schema_version").notNull(),
  attemptCount: integer("attempt_count").default(0).notNull(),
  failureCode: text("failure_code"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  retryAfter: timestamp("retry_after", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  uniqueIndex("photo_assessments_source_image_uidx").on(table.sourceImageId),
  index("photo_assessments_status_retry_idx").on(table.status, table.retryAfter),
  check("photo_assessments_attempt_count_chk", sql`${table.attemptCount} >= 0`),
]);

export const photoAssessmentAttempts = pgTable("photo_assessment_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  assessmentId: uuid("assessment_id").notNull().references(() => photoAssessments.id, { onDelete: "cascade" }),
  attemptNumber: integer("attempt_number").notNull(),
  status: attemptStatus("status").default("started").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  providerRequestId: text("provider_request_id"),
  errorCode: text("error_code"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("photo_assessment_attempts_number_uidx").on(table.assessmentId, table.attemptNumber),
  index("photo_assessment_attempts_provider_status_idx").on(table.provider, table.status),
  check("photo_assessment_attempts_number_chk", sql`${table.attemptNumber} > 0`),
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
  status: walletTransactionStatus("status").default("committed").notNull(),
  amount: bigint("amount", { mode: "number" }).notNull(),
  balanceAfter: bigint("balance_after", { mode: "number" }).notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  actionCode: text("action_code"),
  relatedTransactionId: uuid("related_transaction_id"),
  referenceType: text("reference_type"),
  referenceId: uuid("reference_id"),
  metadata: jsonb("metadata").default({}).notNull(),
  committedAt: timestamp("committed_at", { withTimezone: true }),
  refundedAt: timestamp("refunded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("wallet_transactions_idempotency_uidx").on(table.idempotencyKey),
  index("wallet_transactions_wallet_created_idx").on(table.walletId, table.createdAt),
  uniqueIndex("wallet_transactions_refund_once_uidx")
    .on(table.relatedTransactionId)
    .where(sql`${table.type} = 'generation_refund'`),
  foreignKey({
    columns: [table.relatedTransactionId],
    foreignColumns: [table.id],
    name: "wallet_transactions_related_transaction_fk",
  }).onDelete("restrict"),
  check("wallet_transactions_amount_nonzero_chk", sql`${table.amount} <> 0`),
  check("wallet_transactions_balance_after_chk", sql`${table.balanceAfter} >= 0`),
  check(
    "wallet_transactions_amount_direction_chk",
    sql`(
      ${table.type} = 'generation_charge' AND ${table.amount} < 0
    ) OR (
      ${table.type} IN ('free_bonus', 'purchase', 'generation_refund', 'promo', 'subscription')
      AND ${table.amount} > 0
    ) OR ${table.type} = 'admin_adjustment'`,
  ),
  check(
    "wallet_transactions_status_type_chk",
    sql`(${table.type} = 'generation_charge') OR ${table.status} = 'committed'`,
  ),
]);

export const tariffPlans = pgTable("tariff_plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  priceMinor: bigint("price_minor", { mode: "number" }),
  currency: text("currency").default("RUB").notNull(),
  credits: integer("credits"),
  isActive: boolean("is_active").default(false).notNull(),
  isPublic: boolean("is_public").default(false).notNull(),
  validFrom: timestamp("valid_from", { withTimezone: true }).defaultNow().notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  uniqueIndex("tariff_plans_code_valid_from_uidx").on(table.code, table.validFrom),
  index("tariff_plans_active_idx").on(table.isActive, table.validFrom, table.validUntil),
  check("tariff_plans_price_nonnegative_chk", sql`${table.priceMinor} >= 0`),
  check("tariff_plans_credits_positive_chk", sql`${table.credits} > 0`),
  check(
    "tariff_plans_active_values_chk",
    sql`NOT ${table.isActive} OR (${table.priceMinor} IS NOT NULL AND ${table.credits} IS NOT NULL)`,
  ),
  check(
    "tariff_plans_validity_chk",
    sql`${table.validUntil} IS NULL OR ${table.validUntil} > ${table.validFrom}`,
  ),
]);

export const actionCosts = pgTable("action_costs", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  credits: integer("credits").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  validFrom: timestamp("valid_from", { withTimezone: true }).defaultNow().notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  uniqueIndex("action_costs_code_valid_from_uidx").on(table.code, table.validFrom),
  index("action_costs_active_idx").on(table.isActive, table.validFrom, table.validUntil),
  check("action_costs_credits_nonnegative_chk", sql`${table.credits} >= 0`),
  check(
    "action_costs_validity_chk",
    sql`${table.validUntil} IS NULL OR ${table.validUntil} > ${table.validFrom}`,
  ),
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
