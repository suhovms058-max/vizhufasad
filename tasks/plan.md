# Implementation Plan: Stage 9 Generation Quality Control

## Overview

Add mandatory, automatic quality control to every Standard facade generation. The gate combines a versioned VLM comparison with local structural evidence (contours, spatial layout and protected-zone edge similarity). A failed first candidate receives one stricter, credit-free generation retry; a failed second candidate is hidden and the original wallet reservation is refunded idempotently.

## Architecture Decisions

- Evaluate evidence separately: VLM semantics, structural contours, protected zones, composition/perspective and artifacts/style. Do not use a single whole-image pixel similarity score.
- Use Yandex AI Studio as the Russia-compatible primary VLM and keep OpenAI as an optional fallback through the same provider contract.
- Fail closed: a candidate cannot become `completed` without a persisted passing assessment.
- Persist rejected candidates only in the private bucket under diagnostic keys with a configurable expiry; remove expired objects and redact detailed diagnostics with a cleanup command.
- Treat user `preserve` settings as the policy boundary: disabled protections do not cause rejection, while non-negotiable same-house and artifact checks remain mandatory.
- Keep the quality retry inside the durable generation job and record both candidate generation attempts and both assessments. Wallet reserve/commit/refund remains single and idempotent.

## Task List

### Phase 1: Contract and persistence

- [x] Task 1: Define versioned quality input/output schemas, decisions and configurable thresholds.
- [x] Task 2: Add migration and repository for two assessments and expiring private diagnostics.

### Checkpoint: Foundation

- [x] Contract tests pass.
- [x] Migration applies on a clean database and schema check passes.

### Phase 2: Evidence and policy

- [x] Task 3: Implement deterministic contour, spatial and protected-zone evidence with golden fixtures.
- [x] Task 4: Implement strict structured VLM providers and orchestration with bounded fallback.
- [x] Task 5: Combine evidence into separate scores, reasons and a final automatic decision.

### Checkpoint: Assessment

- [x] Structural, provider and policy tests pass.
- [x] Regression report matches the committed golden expectations.

### Phase 3: Worker lifecycle

- [x] Task 6: Store each candidate privately, assess it, publish only a passing candidate and commit once.
- [x] Task 7: On first QC failure strengthen constraints and generate exactly one free retry.
- [x] Task 8: On second QC failure hide candidates and refund once, including restart/idempotency paths.

### Checkpoint: Lifecycle

- [x] Processor tests cover first pass, retry pass, second failure, technical errors and duplicate refund.
- [x] Queue/integration tests preserve Stage 8 behavior.

### Phase 4: Operations and release gate

- [x] Task 9: Add admin-only read diagnostics, retention cleanup and quality metrics.
- [x] Task 10: Update environment examples, runbooks and Stage 9 documentation.
- [x] Task 11: Run full server and frontend checks, clean-database migration, service smoke, secret scan and diff checks.

### Checkpoint: Complete

- [x] Every exposed result has a passing assessment.
- [x] One quality retry is free and the second failure is refunded idempotently.
- [x] No operator or manual approval path exists.
- [x] All mandatory checks pass before commit, push and draft PR.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| VLM outage or malformed output | A bad result could leak or work could stall | Validate strict JSON, use bounded fallback and fail closed without committing the wallet charge |
| Material changes lower raw visual similarity | False rejection | Compare contours and protected zones, not global color/pixel similarity; make thresholds evidence-specific |
| Worker restart between generation and QC | Duplicate provider cost or extra retry | Persist candidate objects and assessment numbers; resume from durable records where possible |
| Diagnostics retain customer images too long | Privacy risk | Private keys, signed admin access, expiry timestamps and cleanup command |
| Threshold drift | Quality regression | Version policy/prompt/schema and keep a deterministic golden regression report |

## Open Questions

- A live Yandex VLM smoke requires configured credentials. Local contract/integration tests use strict mocks; any paid or credentialed external smoke is reported separately rather than inferred.
