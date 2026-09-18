---
name: ai-runtime
description: AI runtime architecture - model abstraction, provider adapters, streaming, retries, timeouts, cancellation, token/usage accounting, and provider-independent error normalization. Load when working on model execution or provider integration.
---

# Purpose

Define the runtime layer that executes model calls in a provider-independent way, so
switching or combining providers (OpenAI, Anthropic, Gemini, Ollama) never requires
changing calling code.

# When to Apply

Implementing or modifying model execution, a provider adapter, streaming response handling,
retry/timeout logic, or usage accounting.

# Required Rules

- All model calls go through a single core model interface; provider SDKs are implemented
  as adapters behind that interface (per [[project-architecture]]) and are never called
  directly from application/business code.
- Streaming is a first-class execution mode, not an afterthought bolted onto a non-
  streaming call — the interface supports incremental token/event delivery uniformly
  across providers, normalized into the protocol's `Event` shape (see [[protocol-design]]).
- Every model call supports cancellation via an `AbortSignal` (or equivalent) that
  propagates to the underlying provider request.
- Retries use bounded, jittered backoff and only retry on errors classified as retryable
  (e.g. rate limit, transient network) — never blindly retry on every error.
- Every model call has an explicit timeout; a hung provider request must not hang the run
  indefinitely.
- Provider errors are normalized into a shared, typed error taxonomy (rate limit, auth,
  invalid request, content policy, timeout, unknown) before surfacing to calling code —
  calling code must never need to branch on a provider-specific error shape.
- Usage (input/output tokens, cost estimate, latency) is captured for every call and
  attached to the run per [[protocol-design]] and reported to [[observability]].
- Model fallback and routing (e.g. falling back to a secondary provider/model on failure,
  or routing by capability/cost) are implemented as an explicit, configurable policy in the
  runtime layer — not hardcoded per call site.
- The runtime's execution lifecycle (start → stream/generate → tool-call interruption →
  resume → complete/error) is explicit and consistent across providers.

# Architecture / Patterns

```text
Application / Agent code
        ↓ calls
Core Model Interface  (generate, stream, countTokens, capabilities)
        ↓ implemented by
Provider Adapter (OpenAI | Anthropic | Gemini | Ollama | ...)
```

Fallback/routing sits above the model interface as a policy layer choosing which adapter
instance to invoke per call, not inside any individual adapter.

# Anti-Patterns

- Calling `openai.chat.completions.create(...)` directly from a service outside the
  provider adapter.
- A retry loop with no backoff that hammers a rate-limited provider.
- Swallowing a provider-specific error type and letting it leak to application code
  unnormalized.
- A model call with no timeout that can hang a run forever.
- Hardcoding "if provider is X, do Y" logic in application/agent code instead of in the
  adapter/policy layer.

# Validation Checklist

- [ ] Model calls go through the core interface, never a provider SDK directly outside its adapter
- [ ] Streaming, cancellation, retry, and timeout are implemented for every new call path
- [ ] Provider errors are normalized to the shared error taxonomy
- [ ] Usage/token accounting is captured and forwarded to [[observability]]
- [ ] Fallback/routing logic lives in a policy layer, not hardcoded per call site
