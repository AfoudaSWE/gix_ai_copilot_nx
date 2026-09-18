# Phase 1 Issues Found and Fixed

Real bugs found during Phase 1's own validation, each fixed before completion — recorded
per the code-review skill's "disclose, don't hide" rule.

## 1. The server was cancelling every run almost immediately

**Symptom:** every integration test that expected a full `run.completed` sequence instead
received `run.cancelled` after only `run.started`/`message.started` — even though nothing
had actually cancelled anything.

**Cause:** the client-disconnect detection was listening for `'close'` on `request.raw`
(the incoming HTTP request stream) rather than `reply.raw` (the outgoing response stream).
`request.raw`'s `'close'` event fires as soon as the — tiny — request body has been fully
read, which happens well before the response even starts streaming, not only on a genuine
client disconnect. This meant the server was treating the normal completion of reading the
request body as if the client had disconnected, and cancelling the run it had just created.

**Fix:** listen on `reply.raw`'s `'close'` event instead, guarded by
`!reply.raw.writableEnded` to distinguish "the connection died before we finished" from
"we already finished and this is just the connection's own normal teardown." Full detail
and the corrected code: `docs/adr/0004-sse-as-initial-streaming-transport.md`.

This is the only product bug found during Phase 1's own validation. It was caught by the
integration test suite itself (not a manual observation), which is exactly what that suite
exists to catch, and is a large part of why `docs/adr/0004` calls this out explicitly as a
mistake worth documenting for future transport work (e.g. a future WebSocket transport
must not repeat the same "which stream am I actually listening to" error).
