# @gixcopilot/provider-openai

## Purpose

## Install

```bash
npm install @gixcopilot/provider-openai
```

Requires Node.js >=22.12.0. ESM only.

The first real (non-mock) `ModelProvider` — an OpenAI streaming chat completions adapter.
This is the only package in the workspace allowed to depend on the `openai` SDK.

## Responsibilities

- `createOpenAIProvider({ id?, apiKey?, baseURL?, fetch?, client? })` — `apiKey` falls back
  to the `OPENAI_API_KEY` environment variable; `fetch`/`client` are injectable for testing
  (no real network call is made in this package's own test suite).
- Streams `chat.completions.create({ ..., stream: true, stream_options: { include_usage:
true } })`, mapping each chunk's `delta.content` to `content.delta`, the final
  `finish_reason` to the shared `FinishReason` vocabulary, and `usage` (when present) to
  the shared `Usage` shape.
- Maps the OpenAI SDK's own error hierarchy (`AuthenticationError`, `RateLimitError`,
  `BadRequestError` with `context_length_exceeded`, `NotFoundError`,
  `APIConnectionTimeoutError`, `APIConnectionError`, generic `APIError`) onto the shared
  `CopilotErrorCode` taxonomy — see `src/error-mapping.ts`.
- Disables the SDK's own built-in retry (`maxRetries: 0`): retry is
  `@gixcopilot/provider`'s `ModelRuntime`'s job, not duplicated here.

## Public API

See `src/index.ts`.

## Dependencies

- `@gixcopilot/protocol`, `@gixcopilot/provider`, `openai`.

## Non-responsibilities

- **No tool/function calling, no Assistants API, no vector stores, no hosted retrieval.**
  All explicitly out of Phase 2's scope; a `tool`-role input message is rejected with a
  clear `VALIDATION_ERROR` rather than silently reinterpreted.
- **No credential storage or rotation.** The API key is read once at construction time from
  the option/environment variable given to it; this package has no notion of multiple
  tenants' keys.
- **No retry policy of its own** — see above; a caller wanting retries configures
  `@gixcopilot/provider`'s `ModelRuntime`.

## Configuration

Set `OPENAI_API_KEY` in the environment (never commit it, never send it to a browser — see
the security skill). Optionally set `baseURL` for an OpenAI-compatible endpoint.

## Basic Usage

```ts
import { createOpenAIProvider } from '@gixcopilot/provider-openai';

const provider = createOpenAIProvider({ apiKey: process.env.OPENAI_API_KEY });
```

## Documentation

- [models guide](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/models.md)
- [Getting started](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/getting-started.md)
- [Source](https://github.com/AfoudaSWE/gix_ai_copilot_nx/tree/main/packages/providers/openai)

## License

MIT
