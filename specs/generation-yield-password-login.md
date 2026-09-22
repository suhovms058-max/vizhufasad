# Generation yield and password login

Status: draft for owner review  
Date: 2026-09-22  
Base: `e2a972b` (`codex/seo-editorial-release`)

## 1. Production facts

Read-only production audit found 55 generation records:

- 25 `completed`;
- 30 `failed_refunded`;
- standard: 13 completed, 22 refunded;
- Pro: 12 completed, 8 refunded.

The 30 unsuccessful records are not one defect:

- 17 `GENERATION_QUALITY_REJECTED`;
- 4 `GENERATION_QUALITY_UNAVAILABLE`;
- 3 GenAPI HTTP 401;
- 2 GenAPI HTTP 402;
- 2 GenAPI HTTP 422;
- 1 `QUALITY_GATE_FALSE_PASS`;
- 1 `FREE_TRIAL_ALREADY_USED` (no paid generation should run).

Thus the raw delivery rate is 25/55 (45.5%). Seven records are provider HTTP failures, four are quality-service outages, one is an anti-abuse rejection, and the largest recoverable group is the 17 double quality rejections.

## 2. Goals and non-goals

### Goals

1. Increase the share of paid launches that end with a safe, usable delivered result without adding a third paid generation.
2. Never discard a safer first candidate only because the automatic retry is worse.
3. Do not charge a VF coin when no result is delivered.
4. Prevent repeated provider calls while GenAPI credentials, balance, or request contract are invalid.
5. Let a verified user create a password and subsequently log in with email and password.
6. Keep email-code login as first-login and recovery fallback.
7. Put a visible `Личный кабинет` link in public headers and footers, including mobile layouts.

### Non-goals

- weakening hard architecture checks merely to improve the metric;
- guaranteeing a particular percentage before replaying historical evidence;
- adding social login or phone login;
- deploying production in this stage.

## 3. Generation pipeline

### 3.1 Failure classes

Quality failures are split into two classes.

**Hard failures** make a candidate ineligible for delivery: different house, changed storeys, materially changed roof geometry, missing or added protected openings, severe artefacts, unfinished facade, or unreadable/corrupt output.

**Recoverable/soft failures** do not by themselves make a candidate unsafe: small position or framing drift, a marginal style score, a marginal material-expression score, or minor landscaping changes when protected architecture still passes.

The exact mapping is versioned and covered by regression fixtures. It must not be changed from production evidence without a test showing the intended result.

### 3.2 Candidate retention and selection

1. Generate candidate 1 and store it privately as now.
2. Run quality assessment.
3. If it passes, publish it immediately.
4. If it has any hard failure, keep it only for diagnostics and generate candidate 2 once.
5. If it has soft failures only, mark it as an `eligible fallback`, retain it, and generate candidate 2 once.
6. Assess candidate 2.
7. If candidate 2 passes, publish it.
8. Otherwise, publish candidate 1 only when it was marked `eligible fallback`; choose the higher safe score if both are eligible.
9. If neither candidate is eligible, refund and fail as today.

This uses at most the current two image generations. Selection uses stored quality data and does not trigger another paid AI call.

### 3.3 Quality-service outage

If quality checking is temporarily unavailable, retry only the quality assessment of the already stored candidate. Do not generate another image merely because the checker failed. Use bounded retries with backoff. If both configured quality providers remain unavailable, fail closed and refund.

### 3.4 Provider circuit breaker

- HTTP 401: stop new image jobs for that provider, alert the owner, retain/refund reservations.
- HTTP 402: stop new image jobs until provider balance is restored, alert the owner.
- HTTP 422: do not retry unchanged input; record a sanitized validation category and refund.
- transient 429/5xx/network errors: bounded provider retry, then fallback/refund according to existing policy.

The user sees a plain-language state; provider responses and secrets are not exposed.

### 3.5 Metrics

Add aggregate metrics/admin output for:

- delivered / requested;
- first-pass delivery;
- delivered after second candidate;
- first candidate rescued after worse retry;
- hard-rejected and soft-rejected candidates;
- quality-checker outage without a second image call;
- provider failure by sanitized code;
- provider calls and measured cost per delivered result.

## 4. Password login

### 4.1 Existing behavior preserved

- Consent to personal-data processing remains before the first email POST.
- User agreement and 18+ confirmation remain on the code-verification step.
- Existing sessions stay valid.
- Current secure session cookie remains HttpOnly, Secure in production, SameSite=Lax, with a 30-day lifetime.

### 4.2 Credential storage

Create a separate `password_credentials` table:

- `user_id` primary key / foreign key;
- password hash and unique salt;
- algorithm and parameter version;
- created/updated timestamps;
- failed-attempt counter and temporary lock timestamp.

Use Node `crypto.scrypt` with versioned parameters and constant-time comparison. Never store or log plaintext passwords. Accept 10-128 characters, allow passphrases and password managers, and do not impose fragile symbol rules.

### 4.3 User flows

**First login**

1. Email + current personal-data consent.
2. One-time code + current agreement and 18+ confirmation.
3. Authenticated session is created for 30 days.
4. Settings show `Создать пароль`.

**Create password**

- Available only inside the authenticated account.
- If the code verification happened recently, no second code is required.
- For an old session, require a fresh email code before creating or changing the password.

**Normal login**

- `/auth/login` offers two clear choices: `Email и пароль` and `Одноразовый код`.
- Password login creates the same 30-day server session.
- Error text is generic and does not reveal whether an email is registered.
- Rate-limit by IP plus a hash of the normalized email; temporarily lock repeated failures.

**Recovery**

- `Забыли пароль?` starts the existing email-code flow.
- After successful verification the user sets a new password.
- Password reset revokes other active sessions.

### 4.4 API and form contracts

Additive routes:

- `POST /auth/password/login` — email, password, next;
- `POST /app/settings/password` — authenticated initial set/change;
- `POST /auth/password/recovery/request` — starts code recovery;
- `POST /auth/password/recovery/confirm` — verifies code and creates reset grant;
- `POST /auth/password/reset` — consumes one-time reset grant.

All state-changing forms use the existing same-origin form model plus explicit CSRF protection. Validation errors are structured internally and rendered as user-safe Russian text.

### 4.5 Public navigation

- Main header: visible `Личный кабинет` link that remains available on mobile.
- Main footer: `Личный кабинет` under the service group.
- SEO/article/partner/gallery/style public headers and footers receive the same link.
- Link target is `/app`: an active session opens the account; otherwise existing middleware redirects to `/auth/login?next=/app`.

## 5. Security and legal consistency

- Password change/reset is audit logged without password material.
- Account deletion removes password credentials through cascade.
- Login and password forms must not include analytics payloads containing email or password.
- After the feature passes tests, update only the affected legal wording to state that account access can use a password or one-time code and that authentication data are processed for account security.

## 6. Verification and acceptance criteria

### Automated

- migration up/down or clean-database migration test;
- password hashing/verification and wrong-password tests;
- rate-limit/temporary-lock tests;
- first-login, set-password, password-login, recovery, session-revocation integration tests;
- consent-before-email regression tests;
- candidate-1 pass, hard failure, soft fallback rescue, candidate-2 pass, both-hard-refund tests;
- quality provider outage retries assessment without a new image-provider call;
- 401/402 circuit-breaker tests;
- no VF-coin charge when no result is delivered;
- build and existing unit/integration/e2e suite.

### Visual

- desktop and mobile checks of the main page, representative SEO page, login choices, verification page, settings/password form, and header/footer links;
- no text overlap, horizontal overflow, or inaccessible focus order.

### Release gate

No production deployment or paid control generation is performed until the owner reviews the local result and explicitly authorizes publication.

## 7. Assumptions requiring owner approval

1. Password length: minimum 10 characters, maximum 128.
2. Session lifetime: 30 days, matching the current implementation.
3. A fresh email code is required only for password creation/change from an old session or for recovery.
4. The delivery policy may rescue candidate 1 only after all hard architecture gates pass; it will not publish a structurally unsafe image to improve the success statistic.
