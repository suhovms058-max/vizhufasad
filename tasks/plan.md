# Implementation Plan: Stage 11 Russian Payments

## Outcome

Add signed, idempotent one-off credit purchases for a Russian self-employed merchant through Robokassa. Keep subscriptions disabled until the provider approves recurring payments and the owner's legal status is confirmed. Prices and credit amounts remain server-owned tariff data.

## Architecture Decisions

- Use a small `PaymentProvider` contract and a Robokassa adapter built on Node crypto/fetch; do not expose provider passwords to the browser.
- Treat signed `ResultURL` plus matching server-side payment data as the payment signal. Return redirects never grant credits.
- Persist every provider notification before processing it and credit the wallet in the same database transaction as the payment transition.
- Keep card data outside VIZHUFASAD. Store only provider identifiers, payment method labels, receipt references and audit-safe metadata.
- Keep Plus and recurring charging behind a separate disabled feature flag until Robokassa explicitly enables the service for the merchant.

## Task List

### Phase 1: Provider and persistence

- [x] Document the official provider comparison and legal constraints.
- [x] Add payment states, webhook events, receipts, refunds, promo campaigns and redemptions.
- [x] Implement configuration and the provider-neutral contract with a Robokassa adapter.

### Phase 2: Atomic payment lifecycle

- [x] Create checkout from an active tariff selected by server-side id.
- [x] Verify ResultURL signatures and persist duplicate notifications idempotently.
- [x] Mark payment paid and grant purchase credits exactly once.
- [x] Add cancellation reconciliation and provider refund support.
- [x] Apply expiry/limit/user-once promo rules atomically.

### Phase 3: Product and legal UI

- [x] Add checkout, payment/receipt history and truthful return-state UI.
- [x] Add offer, privacy/payment-data and refund pages with owner fields gated on confirmed merchant data.
- [x] Keep subscriptions and Plus hidden unless their dedicated feature is valid and enabled.

### Phase 4: Verification and delivery

- [x] Cover success, duplicate webhook, invalid signature, cancel, refund, promo, disabled subscription and amount mismatch.
- [x] Run install, syntax check, typecheck, unit/integration tests, build and smoke checks.
- [x] Run one real provider test payment on staging without committing credentials.
- [x] Commit, push and open draft PR #11 without merging.

## Completion Gates

- [x] Owner legal status is confirmed as self-employed NPD; Robokassa shop `vizhufasad` and separate test credentials are created. Robocheki SMZ activation remains part of the real staging test gate.
- [x] A real Robokassa test payment reaches the signed staging ResultURL.
- [x] Credits are granted once and only after confirmation.
- [x] Wrong signatures and client-side price changes are rejected.
- [x] Payment and receipt history are owner-scoped.
- [x] Mandatory local checks pass after the Yandex QC adapter fix: frontend check/build, 120 server tests, 4 viewport E2E tests, Drizzle schema check and 5-case quality regression.
- [ ] Robokassa activates the merchant after reviewing the public legal pages on `https://vizhufasad.ru`; keep production payments disabled until DNS delegation and approval are confirmed.
- [x] Restore the staging GenAPI credential and verify authorization without exposing the secret (`GET /api/v1/user` returned HTTP 200).
- [x] Confirm real `nano-banana-2` image editing and automatic Yandex QC on staging: the first candidate cost 20 RUB and required the single retry; the strengthened retry cost 20 RUB, passed at 9532/10000 and stayed within the approved 50 RUB cap.
- [ ] Re-run the complete authenticated UI path into a persisted `completed` generation after a separate live-spend approval; the diagnostic retry deliberately did not alter the already-refunded failed record.

## Known External Dependencies

- Active self-employed NPD status or another confirmed merchant status.
- Robokassa merchant/test-shop login plus test Password #1/#2; Password #3 is needed for live refund smoke.
- Provider approval is required before recurring payments may be enabled.
