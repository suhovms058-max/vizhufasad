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
export const generationStatus = pgEnum("generation_status", [
  "created", "queued", "preprocessing", "generating", "quality_check_pending",
  "completed", "retrying", "failed_refunded", "cancelled",
]);
export const generationKind = pgEnum("generation_kind", ["standard", "pro", "edit"]);
export const generationEditScope = pgEnum("generation_edit_scope", [
  "full_facade", "walls", "plinth", "roof", "entrance", "custom_mask",
]);
export const upscaleStatus = pgEnum("upscale_status", [
  "created", "queued", "processing", "completed", "failed_refunded", "cancelled",
]);
export const attemptStatus = pgEnum("attempt_status", ["started", "succeeded", "retryable_failed", "terminal_failed"]);
export const generationQualityStatus = pgEnum("generation_quality_status", [
  "processing", "completed", "provider_unavailable",
]);
export const generationQualityDecision = pgEnum("generation_quality_decision", [
  "passed", "retry_required", "rejected_refund",
]);
export const transactionType = pgEnum("wallet_transaction_type", [
  "free_bonus", "purchase", "generation_charge", "generation_refund",
  "promo", "subscription", "admin_adjustment",
]);
export const walletTransactionStatus = pgEnum("wallet_transaction_status", [
  "reserved", "committed", "refunded",
]);
export const paymentStatus = pgEnum("payment_status", ["created", "pending", "paid", "cancelled", "failed", "refunded"]);
export const subscriptionStatus = pgEnum("subscription_status", ["pending", "active", "past_due", "cancelled", "expired"]);
export const paymentWebhookStatus = pgEnum("payment_webhook_status", ["received", "processed", "rejected", "failed"]);
export const paymentReceiptType = pgEnum("payment_receipt_type", ["payment", "refund"]);
export const paymentReceiptStatus = pgEnum("payment_receipt_status", ["pending", "succeeded", "failed"]);
export const paymentRefundStatus = pgEnum("payment_refund_status", ["created", "pending", "succeeded", "failed"]);
export const promoKind = pgEnum("promo_kind", ["discount", "credits"]);

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
  kind: generationKind("kind").default("standard").notNull(),
  parentGenerationId: uuid("parent_generation_id")
    .references(() => generations.id, { onDelete: "set null" }),
  editScope: generationEditScope("edit_scope"),
  editPrompt: text("edit_prompt"),
  editMaskBucket: text("edit_mask_bucket"),
  editMaskKey: text("edit_mask_key"),
  editMaskMimeType: text("edit_mask_mime_type"),
  status: generationStatus("status").default("created").notNull(),
  idempotencyKey: text("idempotency_key"),
  queueJobId: text("queue_job_id"),
  priority: integer("priority").default(10).notNull(),
  walletReservationId: uuid("wallet_reservation_id")
    .references(() => walletTransactions.id, { onDelete: "set null" }),
  configSnapshot: jsonb("config_snapshot").notNull(),
  geometryPolicySnapshot: jsonb("geometry_policy_snapshot").notNull(),
  resultBucket: text("result_bucket"),
  resultKey: text("result_key"),
  resultMimeType: text("result_mime_type"),
  requiresWatermark: boolean("requires_watermark").default(true).notNull(),
  watermarkKey: text("watermark_key"),
  isFavorite: boolean("is_favorite").default(false).notNull(),
  failureCode: text("failure_code"),
  ...timestamps,
  queuedAt: timestamp("queued_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  favoritedAt: timestamp("favorited_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("generations_project_revision_uidx").on(table.projectId, table.revision),
  uniqueIndex("generations_idempotency_uidx").on(table.idempotencyKey),
  uniqueIndex("generations_queue_job_uidx").on(table.queueJobId),
  index("generations_status_created_idx").on(table.status, table.createdAt),
  index("generations_watchdog_idx").on(table.status, table.heartbeatAt),
  index("generations_project_favorite_idx").on(table.projectId, table.isFavorite, table.completedAt),
  index("generations_parent_idx").on(table.parentGenerationId, table.createdAt),
  index("generations_project_kind_idx").on(table.projectId, table.kind, table.createdAt),
  check("generations_revision_positive_chk", sql`${table.revision} > 0`),
  check("generations_priority_positive_chk", sql`${table.priority} > 0`),
  check("generations_parent_not_self_chk", sql`${table.parentGenerationId} IS NULL OR ${table.parentGenerationId} <> ${table.id}`),
  check("generations_edit_shape_chk", sql`
    (${table.kind} <> 'edit' AND ${table.parentGenerationId} IS NULL AND ${table.editScope} IS NULL AND ${table.editPrompt} IS NULL)
    OR (${table.kind} = 'edit' AND ${table.parentGenerationId} IS NOT NULL AND ${table.editScope} IS NOT NULL
      AND length(btrim(${table.editPrompt})) BETWEEN 1 AND 700)
  `),
  check("generations_custom_mask_chk", sql`
    ${table.editScope} <> 'custom_mask' OR (${table.editMaskBucket} IS NOT NULL AND ${table.editMaskKey} IS NOT NULL
      AND ${table.editMaskMimeType} = 'image/png')
  `),
]);

export const generationAttempts = pgTable("generation_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  generationId: uuid("generation_id").notNull().references(() => generations.id, { onDelete: "cascade" }),
  attemptNumber: integer("attempt_number").notNull(),
  status: attemptStatus("status").default("started").notNull(),
  provider: text("provider"),
  model: text("model"),
  promptVersion: text("prompt_version"),
  providerRequestId: text("provider_request_id"),
  seed: bigint("seed", { mode: "number" }),
  durationMs: integer("duration_ms"),
  estimatedCostMinor: integer("estimated_cost_minor"),
  actualCostMinor: integer("actual_cost_minor"),
  costCurrency: text("cost_currency"),
  errorCode: text("error_code"),
  errorDetails: jsonb("error_details"),
  candidateNumber: integer("candidate_number").default(1).notNull(),
  resultBucket: text("result_bucket"),
  resultKey: text("result_key"),
  resultMimeType: text("result_mime_type"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("generation_attempts_number_uidx").on(table.generationId, table.attemptNumber),
  index("generation_attempts_status_idx").on(table.status),
  check("generation_attempts_number_positive_chk", sql`${table.attemptNumber} > 0`),
  check("generation_attempts_candidate_number_chk", sql`${table.candidateNumber} BETWEEN 1 AND 2`),
  check("generation_attempts_duration_nonnegative_chk", sql`${table.durationMs} IS NULL OR ${table.durationMs} >= 0`),
  check("generation_attempts_cost_nonnegative_chk", sql`
    (${table.estimatedCostMinor} IS NULL OR ${table.estimatedCostMinor} >= 0)
    AND (${table.actualCostMinor} IS NULL OR ${table.actualCostMinor} >= 0)
  `),
]);

export const generationQualityAssessments = pgTable("generation_quality_assessments", {
  id: uuid("id").defaultRandom().primaryKey(),
  generationId: uuid("generation_id").notNull().references(() => generations.id, { onDelete: "cascade" }),
  generationAttemptId: uuid("generation_attempt_id").notNull().references(() => generationAttempts.id, { onDelete: "cascade" }),
  assessmentNumber: integer("assessment_number").notNull(),
  status: generationQualityStatus("status").default("processing").notNull(),
  decision: generationQualityDecision("decision"),
  schemaVersion: text("schema_version").notNull(),
  promptVersion: text("prompt_version").notNull(),
  policyVersion: text("policy_version").notNull(),
  provider: text("provider"),
  model: text("model"),
  providerRequestId: text("provider_request_id"),
  vlmResult: jsonb("vlm_result"),
  structuralResult: jsonb("structural_result"),
  scoreBreakdown: jsonb("score_breakdown"),
  overallScore: integer("overall_score"),
  failureReasons: jsonb("failure_reasons").default([]).notNull(),
  allowedChanges: jsonb("allowed_changes").default({}).notNull(),
  diagnosticBucket: text("diagnostic_bucket"),
  diagnosticKey: text("diagnostic_key"),
  diagnosticMimeType: text("diagnostic_mime_type"),
  diagnosticExpiresAt: timestamp("diagnostic_expires_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  uniqueIndex("generation_quality_assessments_number_uidx")
    .on(table.generationId, table.assessmentNumber),
  uniqueIndex("generation_quality_assessments_attempt_uidx").on(table.generationAttemptId),
  index("generation_quality_assessments_decision_idx").on(table.decision, table.createdAt),
  index("generation_quality_assessments_expiry_idx").on(table.diagnosticExpiresAt),
  check("generation_quality_assessments_number_chk", sql`${table.assessmentNumber} BETWEEN 1 AND 2`),
  check("generation_quality_assessments_score_chk", sql`${table.overallScore} IS NULL OR ${table.overallScore} BETWEEN 0 AND 10000`),
  check("generation_quality_assessments_completion_chk", sql`
    (${table.status} = 'completed' AND ${table.decision} IS NOT NULL AND ${table.finishedAt} IS NOT NULL)
    OR (${table.status} <> 'completed' AND ${table.decision} IS NULL)
  `),
]);

export const generationUpscales = pgTable("generation_upscales", {
  id: uuid("id").defaultRandom().primaryKey(),
  generationId: uuid("generation_id").notNull().references(() => generations.id, { onDelete: "cascade" }),
  status: upscaleStatus("status").default("created").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  queueJobId: text("queue_job_id"),
  walletReservationId: uuid("wallet_reservation_id")
    .references(() => walletTransactions.id, { onDelete: "set null" }),
  provider: text("provider"),
  model: text("model"),
  providerRequestId: text("provider_request_id"),
  sourceBucket: text("source_bucket").notNull(),
  sourceKey: text("source_key").notNull(),
  resultBucket: text("result_bucket"),
  resultKey: text("result_key"),
  resultMimeType: text("result_mime_type"),
  outputWidth: integer("output_width"),
  outputHeight: integer("output_height"),
  estimatedCostMinor: integer("estimated_cost_minor"),
  actualCostMinor: integer("actual_cost_minor"),
  costCurrency: text("cost_currency"),
  failureCode: text("failure_code"),
  ...timestamps,
  queuedAt: timestamp("queued_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("generation_upscales_idempotency_uidx").on(table.idempotencyKey),
  uniqueIndex("generation_upscales_queue_job_uidx").on(table.queueJobId),
  index("generation_upscales_generation_idx").on(table.generationId, table.createdAt),
  index("generation_upscales_status_idx").on(table.status, table.createdAt),
  check("generation_upscales_dimensions_chk", sql`
    (${table.status} <> 'completed') OR (
      ${table.outputWidth} IS NOT NULL AND ${table.outputHeight} IS NOT NULL
      AND ((${table.outputWidth} >= 3840 AND ${table.outputHeight} >= 2160)
        OR (${table.outputWidth} >= 2160 AND ${table.outputHeight} >= 3840))
    )
  `),
  check("generation_upscales_cost_chk", sql`
    (${table.estimatedCostMinor} IS NULL OR ${table.estimatedCostMinor} >= 0)
    AND (${table.actualCostMinor} IS NULL OR ${table.actualCostMinor} >= 0)
  `),
]);

export const generationComparisons = pgTable("generation_comparisons", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  winnerGenerationId: uuid("winner_generation_id").references(() => generations.id, { onDelete: "set null" }),
  collageBucket: text("collage_bucket"),
  collageKey: text("collage_key"),
  collageMimeType: text("collage_mime_type"),
  ...timestamps,
}, (table) => [
  index("generation_comparisons_project_idx").on(table.projectId, table.updatedAt),
]);

export const generationComparisonItems = pgTable("generation_comparison_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  comparisonId: uuid("comparison_id").notNull()
    .references(() => generationComparisons.id, { onDelete: "cascade" }),
  generationId: uuid("generation_id").notNull().references(() => generations.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("generation_comparison_items_generation_uidx").on(table.comparisonId, table.generationId),
  uniqueIndex("generation_comparison_items_position_uidx").on(table.comparisonId, table.position),
  check("generation_comparison_items_position_chk", sql`${table.position} BETWEEN 1 AND 4`),
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
  status: paymentStatus("status").default("created").notNull(),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  originalAmountMinor: bigint("original_amount_minor", { mode: "number" }).notNull(),
  currency: text("currency").notNull(),
  credits: integer("credits").notNull(),
  promoCredits: integer("promo_credits").default(0).notNull(),
  promoCodeId: uuid("promo_code_id").references(() => promoCodes.id, { onDelete: "restrict" }),
  description: text("description").notNull(),
  checkoutExpiresAt: timestamp("checkout_expires_at", { withTimezone: true }).notNull(),
  metadata: jsonb("metadata").default({}).notNull(),
  ...timestamps,
  paidAt: timestamp("paid_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  refundedAt: timestamp("refunded_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("payments_idempotency_uidx").on(table.idempotencyKey),
  uniqueIndex("payments_provider_id_uidx").on(table.provider, table.providerPaymentId),
  index("payments_user_created_idx").on(table.userId, table.createdAt),
  index("payments_status_idx").on(table.status),
  check("payments_amount_positive_chk", sql`${table.amountMinor} > 0`),
  check("payments_original_amount_positive_chk", sql`${table.originalAmountMinor} > 0`),
  check("payments_credits_positive_chk", sql`${table.credits} > 0`),
  check("payments_promo_credits_nonnegative_chk", sql`${table.promoCredits} >= 0`),
]);

export const paymentWebhookEvents = pgTable("payment_webhook_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  paymentId: uuid("payment_id").references(() => payments.id, { onDelete: "set null" }),
  provider: text("provider").notNull(),
  eventKey: text("event_key").notNull(),
  status: paymentWebhookStatus("status").default("received").notNull(),
  signatureValid: boolean("signature_valid").default(false).notNull(),
  payload: jsonb("payload").default({}).notNull(),
  errorCode: text("error_code"),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("payment_webhook_events_provider_key_uidx").on(table.provider, table.eventKey),
  index("payment_webhook_events_payment_created_idx").on(table.paymentId, table.createdAt),
]);

export const paymentReceipts = pgTable("payment_receipts", {
  id: uuid("id").defaultRandom().primaryKey(),
  paymentId: uuid("payment_id").notNull().references(() => payments.id, { onDelete: "restrict" }),
  type: paymentReceiptType("type").notNull(),
  status: paymentReceiptStatus("status").default("pending").notNull(),
  providerReceiptId: text("provider_receipt_id"),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  receiptUrl: text("receipt_url"),
  fiscalDocumentNumber: text("fiscal_document_number"),
  fiscalSign: text("fiscal_sign"),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  metadata: jsonb("metadata").default({}).notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("payment_receipts_provider_id_uidx").on(table.providerReceiptId),
  index("payment_receipts_payment_created_idx").on(table.paymentId, table.createdAt),
  check("payment_receipts_amount_positive_chk", sql`${table.amountMinor} > 0`),
]);

export const paymentRefunds = pgTable("payment_refunds", {
  id: uuid("id").defaultRandom().primaryKey(),
  paymentId: uuid("payment_id").notNull().references(() => payments.id, { onDelete: "restrict" }),
  providerRefundId: text("provider_refund_id"),
  idempotencyKey: text("idempotency_key").notNull(),
  status: paymentRefundStatus("status").default("created").notNull(),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  reason: text("reason").notNull(),
  metadata: jsonb("metadata").default({}).notNull(),
  ...timestamps,
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("payment_refunds_idempotency_uidx").on(table.idempotencyKey),
  uniqueIndex("payment_refunds_provider_id_uidx").on(table.providerRefundId),
  index("payment_refunds_payment_created_idx").on(table.paymentId, table.createdAt),
  check("payment_refunds_amount_positive_chk", sql`${table.amountMinor} > 0`),
]);

export const promoCodes = pgTable("promo_codes", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull(),
  kind: promoKind("kind").notNull(),
  discountPercent: integer("discount_percent"),
  bonusCredits: integer("bonus_credits"),
  maxRedemptions: integer("max_redemptions"),
  maxPerUser: integer("max_per_user").default(1).notNull(),
  redemptionCount: integer("redemption_count").default(0).notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  isActive: boolean("is_active").default(true).notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("promo_codes_code_upper_uidx").on(sql`upper(${table.code})`),
  index("promo_codes_active_window_idx").on(table.isActive, table.startsAt, table.expiresAt),
  check("promo_codes_discount_chk", sql`(${table.kind} = 'discount' AND ${table.discountPercent} BETWEEN 1 AND 99 AND ${table.bonusCredits} IS NULL) OR (${table.kind} = 'credits' AND ${table.bonusCredits} > 0 AND ${table.discountPercent} IS NULL)`),
  check("promo_codes_limits_chk", sql`${table.maxPerUser} = 1 AND (${table.maxRedemptions} IS NULL OR ${table.maxRedemptions} > 0) AND ${table.redemptionCount} >= 0`),
]);

export const promoRedemptions = pgTable("promo_redemptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  promoCodeId: uuid("promo_code_id").notNull().references(() => promoCodes.id, { onDelete: "restrict" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  paymentId: uuid("payment_id").notNull().references(() => payments.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("promo_redemptions_payment_uidx").on(table.paymentId),
  uniqueIndex("promo_redemptions_code_user_uidx").on(table.promoCodeId, table.userId),
  index("promo_redemptions_user_created_idx").on(table.userId, table.createdAt),
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
