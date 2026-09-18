# Phase 2 Issues Found and Fixed

Real bugs found during this phase's own validation, each fixed before completion — recorded
per the code-review skill's "disclose, don't hide" rule.

## 1. The OpenAI SDK's own retry logic was fighting with `ModelRuntime`'s retry policy

**Symptom:** two tests (429 and 500 response mapping) took 1.3–1.5 real seconds each
instead of being near-instant.

**Cause:** the `openai` SDK retries retryable-looking responses (429, 5xx) internally by
default, independent of `@aicopilot/provider`'s own retry policy — so a single "provider
call" from `ModelRuntime`'s point of view was silently retrying multiple times inside the
SDK before ever surfacing an error to be classified/retried again at our layer.

**Fix:** `createOpenAIProvider` now constructs its client with `maxRetries: 0` — retry is
`ModelRuntime`'s job alone (see `docs/adr/0006-model-provider-abstraction.md`, decision 5).

## 2. `toNormalizedError` didn't recognize an already-normalized `CopilotError`

**Symptom:** a test asserting that a tool-role message is rejected with `VALIDATION_ERROR`
(thrown as a `CopilotError` from message-mapping, before any API call) instead received
`PROVIDER_ERROR`.

**Cause:** the OpenAI adapter's `catch` block always ran every thrown error — including
ones we had already normalized ourselves — through the generic OpenAI-SDK-error mapping,
which doesn't recognize `CopilotError` and falls through to a generic provider-error
classification.

**Fix:** `toNormalizedError` now checks `CopilotError.isCopilotError(error)` first and
returns it unchanged if so.

## 3. TypeScript falsely narrowed `AbortSignal.aborted` across repeated checks

**Symptom:** `tsc` reported `error TS2367: This comparison appears to be unintentional
because the types 'false | undefined' and 'true' have no overlap` on the _second_ and
_third_ `if (signal?.aborted === true)` check in the mock provider's `stream()` method.

**Cause:** `.aborted` is a live getter whose value can change between reads, but
TypeScript's control-flow narrowing doesn't know that — after the first `if` returned
early, it assumed later reads of the same expression must be `false`.

**Fix:** introduced a tiny `isAborted(signal)` helper function; routing the check through a
function call (rather than reading the property inline repeatedly) prevents the false
narrowing. Documented inline in `mock-provider.ts` so the same mistake isn't repeated.

## 4. Early test-writing mistake: default retry policy made unrelated tests slow

**Symptom:** a test only meant to check "the executor throws on `model.failed`" took
536ms, because the default `DEFAULT_RETRY_POLICY` (3 attempts, real 200ms+ backoff)
retried a retryable-by-default `rateLimited()` error before finally failing.

**Fix:** tests that don't care about retry behavior now explicitly pass
`{ retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 } }`. Not a product bug, but
recorded here because it's exactly the kind of test-authoring trap the testing skill's
"keep tests deterministic and fast" rule warns about, and future contributors adding new
`ModelRuntime`-based tests should default to overriding retry timing unless the test is
specifically about retries.

No other product bugs were found during Phase 2's own validation. (Phase 1's
disconnect-detection bug — listening on the wrong stream for client disconnect — remains
documented in `docs/adr/0004-sse-as-initial-streaming-transport.md`; it was not
re-encountered here, only re-verified as still fixed via the unmodified `protocol-demo`
regression suite.)
