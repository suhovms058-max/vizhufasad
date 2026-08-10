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
- [ ] Replace the invalid staging `GENAPI_API_KEY`; two live Standard attempts currently end in `GENAPI_HTTP_401`.
- [ ] Re-run the authenticated photo → settings → Standard → QC → result path on VPS after the key is restored.
- [x] Confirm the signed Robokassa demo payment becomes `paid` and grants 25 credits exactly once.
- [ ] Wait for Robokassa merchant activation and keep production payments disabled until it is approved.
- [ ] Re-run the full mandatory suite after the remaining external blockers are resolved.
