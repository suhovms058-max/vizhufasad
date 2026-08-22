# Stage 10 Checklist

- [x] Persist validated facade settings and all preservation switches.
- [x] Add history, favorite and free-watermark metadata/API.
- [x] Complete `/app/new` self-service wizard.
- [x] Resume truthful generation status after reload.
- [x] Add quality-approved result page with before/after and download.
- [x] Expand project cards and owner-only history.
- [x] Gate the legacy lead form off by default.
- [x] Remove manual-service copy from current published UI.
- [x] Verify accessibility, reduced motion and 360/390/768/desktop layouts.
- [x] Add API/frontend/e2e tests.
- [x] Run full frontend, server, migration, infrastructure, queue and UI checks.
- [x] Commit focused increments, push and create a draft PR without merging to `main`.

## Stage 1–11 live audit before Stage 11 completion

- [x] Confirm the VPS serves the Next.js landing page and proxies `/auth`, `/app`, `/api`, `/assets` and `/legal` to Express.
- [x] Unify login, verification, settings, balance and legal pages with the responsive cabinet stylesheet.
- [x] Confirm PostgreSQL, Redis and private object storage are healthy through `/health/ready`.
- [x] Confirm the uploaded facade is stored and Yandex assessment completes automatically with no credit charge.
- [x] Confirm the asynchronous worker refunds a failed provider request idempotently.
- [x] Replace the invalid staging `GENAPI_API_KEY` and verify the rotated key server-side without printing it.
- [x] Fix the Yandex generation-QC adapter to use the working multimodal Chat Completions contract and deploy it with a rollback backup.
- [x] Confirm a real GenAPI candidate (20 RUB), one strengthened retry (20 RUB) and passing Yandex QC (9532/10000) within the approved 50 RUB cap.
- [ ] Re-run the authenticated photo → settings → Standard → QC → persisted result path on VPS with a new explicit live-spend approval.
- [x] Confirm the signed Robokassa demo payment becomes `paid` and grants 25 credits exactly once.
- [ ] Wait for Robokassa merchant activation and keep production payments disabled until it is approved.
- [x] Re-run the full mandatory suite after the QC fix: 120 server tests, frontend typecheck/build, Drizzle check, quality regression 5/5 and Stage 10 E2E 4/4.
- [x] Audit the published landing, login and legal pages at 390/768/1440 widths; fix the 768px footer overflow and align the cabinet/legal UI with the graphite, warm-paper and copper landing-page style.
- [ ] Wait for public DNS delegation of `vizhufasad.ru`; Google DNS, Cloudflare DNS and the system resolver still return no A/NS records, so HTTPS and the Robokassa production URL cannot be finalized yet.
