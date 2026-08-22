# GenAPI cost and cancellation control

## Confirmed API limitation

The public GenAPI documentation describes task creation and result polling but does not document an endpoint that cancels an already accepted `request_id`. Therefore VIZHUFASAD must treat a submitted remote request as a cost already in progress, even when the browser disconnects.

Official references:

- https://gen-api.ru/docs/v1/generations/ai-request
- https://gen-api.ru/docs/v1/generations/getting-the-result
- https://gen-api.ru/docs/queue

## Implemented policy

1. User cancellation is allowed only while a local task is `created`, `queued` or `retrying` and no provider `request_id` has ever been accepted. This condition is enforced atomically in SQL, not only by the button state.
2. Once GenAPI accepts a request, its `request_id` is persisted immediately.
3. A local timeout, worker restart or temporary polling failure resumes that same `request_id`; it does not submit another paid request.
4. A submitted request never falls through to a second provider during the same attempt.
5. The UI receives a `cancellable` flag and hides cancellation after provider acceptance, including a later local `retrying` state caused by a polling/network failure.
6. User credits may be refunded on a terminal technical failure, while the real provider cost is recorded separately for unit-economics monitoring.

## Product behaviour for frequent cancellation

- The cancel button is shown only before GenAPI accepts the task. After `request_id` appears, the UI says that generation is already running and the page may be closed safely.
- Leaving the page, reloading it or losing the browser connection never cancels the provider task. The worker continues polling and the user can return to the project later.
- A transient API/worker failure resumes polling the same `request_id`; it never submits a replacement request merely because the browser disconnected.
- A user credit is refunded only for a terminal technical failure according to the wallet policy. Provider spend remains in internal cost metrics and is never hidden.
- Operationally track accepted requests without a terminal result, provider error cost and repeated cancel clicks. These metrics distinguish user impatience from real provider failure.

## Remaining unavoidable edge case

If GenAPI accepts a request during the exact interval in which PostgreSQL becomes unavailable before `request_id` can be persisted, the remote task cannot be recovered reliably because the documented create endpoint has no client idempotency key. Keep database health fail-closed before dequeueing jobs and alert on request-id persistence failures.
