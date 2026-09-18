# @aicopilot/protocol

## Purpose

Transport-independent wire protocol for the AI Copilot SDK. Defines the shapes exchanged
between a client and a server — `Message`, `Thread`, `Run`, and the `CopilotEvent` union —
plus runtime validation (Zod) and (de)serialization for those shapes.

## Responsibilities

- Define `Message`, `Thread`, `Run`, `Usage`, and `CopilotEvent` (and its 8 concrete
  variants) as plain TypeScript types.
- Define the normalized `CopilotError` taxonomy and its safe-to-serialize public
  projection.
- Provide `parseEvent()` / `serializeEvent()` for validating and (de)serializing events at
  a transport boundary, with explicit, three-way handling of known / forward-compatible
  unknown / malformed input.
- Own the protocol version constant (`PROTOCOL_VERSION`).
- Provide branded ID types (`RunId`, `ThreadId`, `MessageId`, `EventId`) and their
  factories.

## Public API

See `src/index.ts` for the full barrel export. Everything a consumer needs is re-exported
from `@aicopilot/protocol`'s root — no deep imports into `src/` are supported (the
package's `exports` field only exposes `.`).

## Dependencies

- `zod` — schema validation for `parseEvent`. This is the only runtime dependency; kept
  deliberately minimal per the dependency-policy skill, since every other package in the
  workspace depends on this one.

## Non-responsibilities

- **No run lifecycle logic.** This package defines `RunStatus` as a type; enforcing valid
  transitions between statuses is `@aicopilot/core`'s job.
- **No transport implementation.** HTTP, SSE, and WebSocket all belong to
  `@aicopilot/server` / `@aicopilot/client`; this package only defines what flows over
  them.
- **No tool/agent/RAG/memory types.** Those belong to later phases (5, 8, 9, 10) and are
  intentionally absent — see `docs/adr/0003-event-driven-protocol.md` for how the event
  union is designed to grow additively when that work begins.
- **No framework dependency.** No React, Angular, Node-only API, or browser-only API is
  used here — this package must run unmodified in a browser or a server.

## Basic Usage

```ts
import {
  parseEvent,
  serializeEvent,
  createRunId,
  createThreadId,
  createEventId,
  PROTOCOL_VERSION,
} from '@aicopilot/protocol';

const event = {
  id: createEventId(),
  runId: createRunId(),
  threadId: createThreadId(),
  sequence: 1,
  timestamp: new Date().toISOString(),
  protocolVersion: PROTOCOL_VERSION,
  type: 'run.started' as const,
};

const wire = serializeEvent(event);
const result = parseEvent(JSON.parse(wire));

if (result.kind === 'known') {
  console.log(result.event.type); // 'run.started'
}
```
