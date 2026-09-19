# Phase Changelog

| Phase                          | Delivered                                                                                                                                | Record                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 01 — Foundation & Architecture | Protocol, generic core, HTTP/SSE server/client, deterministic echo integration                                                           | [Phase 1](phases/phase-01/Phase_1_Docs.md) |
| 02 — LLM Runtime & Streaming   | Provider-neutral model runtime, registry, mock/OpenAI adapters, retry/timeout/cancellation                                               | [Phase 2](phases/phase-02/Phase_2_Docs.md) |
| 03 — React Copilot UI          | Headless React provider/hooks and optional chat/popup/sidebar UI, safe Markdown, themes/RTL/accessibility, examples and browser coverage | [Phase 3](phases/phase-03/Phase_3_Docs.md) |
| 04 — Application Context & State | Framework-independent `@gixcopilot/context` engine (scopes, priority, sensitivity, serialization, dedup, token budgeting/truncation), shared typed state store, `useCopilotContext`/`useCopilotState` React hooks, resolved context injected into model requests, application-aware chat example | [Phase 4](phases/phase-04/Phase_4_Docs.md) |

The authoritative completion state is [PROJECT_STATUS.md](PROJECT_STATUS.md).
Phase 05 and later remain locked/not started. This file records phases, not npm releases;
the workspace packages remain private.
