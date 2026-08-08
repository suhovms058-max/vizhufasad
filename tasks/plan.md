# Implementation Plan: Stage 10 Standard User Flow

## Overview

Connect the existing authenticated project, image assessment, wallet, generation queue and mandatory quality gate into one self-service path. The Express product UI remains the source of truth for `/app/*`; the static Next.js site becomes an entry point and exposes the legacy lead form only behind an explicit cutover flag.

## Architecture Decisions

- Build one responsive server-rendered product shell with small progressive-enhancement scripts; keep all ownership and state decisions in the API.
- Persist the latest draft facade configuration on the project and snapshot it into every generation. Browser storage is only a reload fallback, not the source of truth.
- Expose only real queue states. Polling resumes from the generation id encoded in the result URL and never invents percentages or completion times.
- Store the original approved result privately. Free-tier results receive a deterministic watermarked derivative in private S3 and only owner-authorized temporary links are returned.
- Keep the legacy lead endpoint and form disabled by default and opt-in independently for controlled cutover.

## Task List

### Phase 1: Contracts and persistence

- [x] Task 1: Extend the generation settings contract and project configuration persistence.
- [x] Task 2: Add favorite and free-watermark metadata with migration and owner-scoped repository methods.

### Checkpoint: Foundation

- [x] Contract, repository and migration tests pass.
- [x] Existing Stage 4-9 API behavior remains green.

### Phase 2: Self-service wizard

- [x] Task 3: Turn `/app/new` into project/photo/assessment/settings/cost steps.
- [x] Task 4: Persist draft settings and launch Standard idempotently into the existing queue.
- [x] Task 5: Render truthful status, cancellation/refund explanations and reload recovery.

### Checkpoint: Critical path

- [x] A signed-in user can create/select a project, upload/select a photo, review assessment and enqueue Standard.
- [x] Reload restores project, settings and active generation state.

### Phase 3: Results and projects

- [x] Task 6: Add result history, favorite and owner-only result/source URLs.
- [x] Task 7: Add accessible before/after, download, repeat/create-another actions and free watermark.
- [x] Task 8: Expand project cards with source, preferred result, count, date, status, rename and delete.

### Checkpoint: Product UI

- [x] Only quality-approved results are visible.
- [x] Free results are watermarked; paid results remain unmodified.
- [x] Projects and result history remain owner-scoped.

### Phase 4: Cutover, accessibility and verification

- [x] Task 9: Remove manual-service claims from the published Next.js path and gate legacy leads explicitly.
- [x] Task 10: Add responsive/reduced-motion/accessibility styling and frontend/e2e coverage.
- [x] Task 11: Update runbooks and run install, lint/check, typecheck, tests, build, migrations, smoke and security scans.

### Checkpoint: Complete

- [x] Critical e2e path passes at 360, 390, 768 and desktop widths.
- [x] No payment, Pro, 4K or region editor is exposed.
- [x] No manual review/operator/specialist/material-estimate copy is reachable in current UI.
- [x] All mandatory checks pass before commit, push and draft PR.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Paid provider or VLM is unavailable locally | Real generation cannot finish during UI e2e | Test the browser contract deterministically and run integration smoke against the real queue/services without claiming an external paid generation |
| Watermark work exposes the original | Free user can obtain an unmarked result | Return only the derivative URL from owner-authorized result endpoints and keep raw object keys private |
| Wizard state diverges between browser and database | Reload loses or changes client choices | Validate and persist the normalized configuration server-side before enqueue; version local fallback data |
| Legacy GitHub Pages still submits leads | Obsolete manual path remains public | Build the lead form only when `NEXT_PUBLIC_LEGACY_LEADS_ENABLED=true`; default and CI value stay false |

## Open Questions

- A real provider generation is not repeated unless it is required to validate a code path and explicitly fits the user's previously approved spend. Existing Stage 7-9 provider evidence remains the baseline.
