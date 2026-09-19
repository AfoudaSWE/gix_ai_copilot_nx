# AI Copilot SDK — Phase 6: Generative UI & Shared State

Implement **Phase 6 only**.

Current phase:

```text
PHASE 06 — GENERATIVE UI & SHARED STATE
```

## Mission

Phases 1–5 established:

```text
Phase 01
Protocol + Core + Client + Server
        ↓
Phase 02
LLM Runtime + Providers + Streaming
        ↓
Phase 03
React SDK + Copilot UI
        ↓
Phase 04
Application Context + Shared State Foundation
        ↓
Phase 05
Tools + Frontend Actions + Backend Actions
```

Phase 6 turns structured AI output and tool activity into safe, interactive application UI.

Before:

```text
User
 ↓
AI
 ↓
Tool
 ↓
JSON Result
 ↓
Text Response
```

After:

```text
User
 ↓
AI
 ↓
Tool / Structured UI Request
 ↓
Schema Validation
 ↓
Trusted Component Registry
 ↓
Interactive Application UI
```

Example:

Instead of:

```text
Application APP-1024 is pending.
```

the Copilot can safely render:

```text
┌──────────────────────────────────────┐
│ Application APP-1024                 │
│                                      │
│ Applicant      Ahmed                 │
│ Status         Pending               │
│ Country        UAE                   │
│                                      │
│ [Open]                    [Review]   │
└──────────────────────────────────────┘
```

The model must NEVER generate executable React, JavaScript, HTML with scripts, event-handler source, or arbitrary application code.

---

# 0. STRICT PHASE GATE

Phase 6 includes:

* Generative UI protocol/contracts
* Generative component definitions
* Trusted component registry
* Component registration
* Component discovery
* Structured UI requests
* Structured component props
* Runtime schema validation
* Safe component resolution
* Safe React rendering
* Generative UI messages/content
* Tool-result rendering
* Tool-specific renderers
* Frontend-tool rendering
* Backend-tool rendering
* Loading/progress UI
* Error UI
* Interactive registered components
* Component actions through registered tools
* Shared AI/UI state
* State bindings
* State patches
* Patch validation
* Optimistic UI foundation
* Conflict/version foundation
* Streaming/progressive UI
* Headless generative UI APIs
* React generative UI APIs
* Accessibility
* Responsive rendering
* Phase 6 examples
* Tests
* Documentation

Phase 6 does NOT include:

```text
AI Action Firewall
Enterprise RBAC
ABAC
Human Approval
Supervisor Approval
Admin Approval
Two-Person Approval
Dry Run
Explain Before Execute
Enterprise Audit Trail
OpenAPI → Tool Generation
Automatic API Tool Creation
MCP
RAG
Knowledge Base
Persistent Memory
Agents
Multi-Agent
Long-Running Workflows
DevTools Platform
Angular SDK
Management Platform
```

Do NOT start Phase 7.

---

# 1. READ SKILLS

Before changes read:

```text
.claude/skills/ai-copilot-project/SKILL.md
.claude/skills/phase-gate/SKILL.md
```

Apply:

```text
project-architecture
typescript-standards
nx-monorepo
sdk-design
protocol-design
react-sdk
generative-ui
context-engine
tool-system
security
performance
accessibility
testing
documentation
git-workflow
code-review
dependency-policy
backward-compatibility
phase-gate
```

Generative UI is a major security boundary.

Read the security skill as well.

---

# 2. READ PREVIOUS PHASE DOCUMENTATION

Read:

```text
docs/phases/phase-01/
docs/phases/phase-02/
docs/phases/phase-03/
docs/phases/phase-04/
docs/phases/phase-05/
```

Pay particular attention to:

```text
Phase_4_Architecture.md
Phase_4_API.md
Phase_4_Handoff.md

Phase_5_Architecture.md
Phase_5_API.md
Phase_5_Handoff.md
```

Also read:

```text
docs/PROJECT_STATUS.md
docs/ARCHITECTURE_OVERVIEW.md
docs/ROADMAP.md
docs/DECISIONS.md
docs/TECHNICAL_DEBT.md

docs/roadmap/PHASE_4_TO_12_FEATURE_CHECKPOINT.md
```

Repository reality is the source of truth.

---

# 3. VERIFY PHASES 1–5

Run repository equivalents:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Verify:

```text
Protocol
Core
Client
Server

Model Runtime
Streaming
Provider Adapters

React SDK
Chat UI

Context Engine
Shared State

ToolDefinition
Tool Registry
Tool Runtime
Backend Tools
Frontend Tools
Tool Events
Model → Tool → Model
```

If Phase 5 is incomplete or has a blocking regression:

STOP.

Document the blocker.

Do not build Generative UI on an unstable tool system.

---

# 4. UPDATE PROJECT STATUS

When implementation begins:

```text
Phase 01    COMPLETE
Phase 02    COMPLETE
Phase 03    COMPLETE
Phase 04    COMPLETE
Phase 05    COMPLETE

Phase 06
GENERATIVE UI & SHARED STATE

IN PROGRESS

Phase 07
NOT STARTED
LOCKED
```

Only use COMPLETE when verified.

---

# 5. CORE SECURITY PRINCIPLE

This is the most important rule in Phase 6.

NEVER:

```text
Model
 ↓
React Source
 ↓
eval()
```

NEVER:

```text
Model
 ↓
JavaScript
 ↓
new Function()
```

NEVER:

```text
Model
 ↓
<script>
```

NEVER allow model-generated:

```text
onClick JavaScript
dynamic imports
module paths
component source
arbitrary HTML execution
```

Instead:

```text
Model
 ↓
Structured UI Request
 ↓
Schema Validation
 ↓
Trusted Component Registry
 ↓
Developer-Registered Component
 ↓
React
```

The model selects capabilities.

The developer owns executable code.

---

# 6. TARGET ARCHITECTURE

```text
                         MODEL
                           │
                           ▼
                 Structured UI Request
                           │
                           ▼
                   Protocol Validation
                           │
                           ▼
               Generative UI Runtime
                           │
                           ▼
               Component Registry
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
           FOUND                    NOT FOUND
              │                         │
              ▼                         ▼
       Props Validation            Safe Fallback
              │
              ▼
       Trusted Component
              │
              ▼
          React Renderer
              │
              ▼
        Interactive UI
```

---

# 7. PACKAGE ARCHITECTURE

Evaluate creating:

```text
packages/ui/
```

Package:

```text
@aicopilot/ui
```

and/or framework-neutral Generative UI contracts in:

```text
@aicopilot/core
```

or a dedicated package if justified.

Keep:

```text
Generative UI Contracts
Component Request Contracts
State Patch Contracts
```

framework-independent.

React rendering belongs in:

```text
@aicopilot/react
```

Do NOT make core depend on React.

---

# 8. GENERATIVE COMPONENT DEFINITION

Design a canonical trusted component definition.

Conceptually:

```ts
interface GenerativeComponentDefinition<TProps> {
  name: string;

  description?: string;

  propsSchema: Schema<TProps>;

  metadata?: GenerativeComponentMetadata;
}
```

React registration associates this definition with a trusted React component.

---

# 9. TARGET REGISTRATION API

Something conceptually equivalent:

```tsx
registerGenerativeComponent({
  name: "ApplicationCard",

  description:
    "Displays summary information for an application",

  props: z.object({
    applicationId: z.string(),
    applicantName: z.string(),
    status: z.string()
  }),

  component: ApplicationCard
});
```

Exact API should follow existing architecture.

---

# 10. REACT HOOK REGISTRATION

Consider ergonomic component-scoped registration:

```tsx
useGenerativeComponent({
  name: "ApplicationCard",

  props: ApplicationCardSchema,

  component: ApplicationCard
});
```

If implemented:

```text
mount
 ↓
register

update
 ↓
update registration

unmount
 ↓
dispose
```

StrictMode must not leak duplicate registrations.

---

# 11. COMPONENT REGISTRY

Implement a trusted registry.

Conceptually:

```ts
const registry =
  createGenerativeComponentRegistry();

registry.register(...);

registry.get(...);

registry.list(...);

registry.unregister(...);
```

Requirements:

```text
stable identity
duplicate handling
registration lifecycle
lookup
discovery
metadata
multiple registry instances
```

No mandatory global singleton.

---

# 12. COMPONENT IDENTITY

Use stable component names.

Examples:

```text
ApplicationCard
ApplicationTable
PaymentStatus
DocumentList
ApplicantSummary
StatusBadge
```

Optional namespace support:

```text
applications.card
applications.table
payments.status
```

Choose one deterministic convention.

---

# 13. COMPONENT DESCRIPTIONS

Descriptions help the model select appropriate components.

Example:

```text
Displays a compact summary of one application.
```

Descriptions are guidance.

They are NOT security policy.

---

# 14. COMPONENT METADATA

Potential metadata:

```text
category
tags
interactive
supportsStreaming
supportsState
version
```

Keep metadata extensible.

Do not over-design.

---

# 15. STRUCTURED UI REQUEST

Define a provider-neutral request.

Conceptually:

```ts
interface GenerativeUIRequest {
  id: string;

  component: string;

  props: unknown;

  metadata?: Record<string, unknown>;
}
```

Example:

```json
{
  "component": "ApplicationCard",
  "props": {
    "applicationId": "APP-1024",
    "applicantName": "Ahmed",
    "status": "PENDING"
  }
}
```

---

# 16. UI REQUEST VALIDATION

Pipeline:

```text
Model Output
    ↓
Parse
    ↓
Validate Request Envelope
    ↓
Resolve Component
    ↓
Validate Props
    ↓
Render
```

Unknown component:

```text
DO NOT render arbitrary fallback HTML.
```

Return safe diagnostic/fallback UI.

---

# 17. PROP VALIDATION

Model-generated props are untrusted.

Example:

Expected:

```ts
z.object({
  applicationId: z.string(),
  status: z.enum([
    "PENDING",
    "APPROVED",
    "REJECTED"
  ])
})
```

Model returns:

```json
{
  "applicationId": 123,
  "status": "HACKED"
}
```

Expected:

```text
Validation fails
 ↓
Component NOT rendered
 ↓
Safe error/fallback
```

---

# 18. NO ARBITRARY COMPONENT IMPORTS

The model must never request:

```text
../../AdminPanel
```

or:

```text
https://evil.example/component.js
```

Only exact trusted registry entries are resolvable.

---

# 19. GENERATIVE UI CONTENT PART

Extend the protocol where appropriate with a structured content part.

Conceptually:

```text
text
image
tool-call
tool-result
generative-ui
```

Example:

```ts
{
  type: "generative-ui",
  component: "ApplicationCard",
  props: {...}
}
```

Maintain protocol version compatibility.

---

# 20. GENERATIVE UI EVENTS

If needed define events such as:

```text
ui.requested
ui.resolved
ui.rendered
ui.failed
ui.updated
```

Do not create events solely for React render internals unless useful across the protocol.

Preserve:

```text
runId
messageId
uiRequestId
sequence
timestamp
```

where appropriate.

---

# 21. MODEL INTEGRATION

The model/runtime needs a provider-neutral way to know available UI capabilities.

Potential:

```text
Available Generative Components

ApplicationCard
- Displays one application
- props schema ...

ApplicationTable
- Displays multiple applications
- props schema ...
```

Do not hardcode OpenAI-specific structured-output APIs into core.

---

# 22. COMPONENT DISCOVERY

Create a resolution/discovery boundary similar to tools.

Future Phase 7 may need:

```text
All Components
      ↓
Permission/Policy Filtering
      ↓
Allowed Components
      ↓
Model
```

Phase 6 default resolver may return enabled components.

Do not implement RBAC yet.

---

# 23. GENERATIVE UI RUNTIME

Implement a framework-independent runtime responsible for:

```text
request validation
component lookup
props validation
normalized result
diagnostics
state-binding metadata
```

Actual React rendering remains in React package.

---

# 24. TEXT + UI RESPONSE

A response should support:

```text
Assistant Message

"Here is the application you requested:"

[ApplicationCard]
```

The protocol must support ordered mixed content.

Example:

```text
Text
UI
Text
Tool activity
UI
```

Preserve ordering.

---

# 25. MULTIPLE GENERATED COMPONENTS

Support:

```text
Assistant
 ↓
ApplicationCard APP-1001
ApplicationCard APP-1002
ApplicationCard APP-1003
```

Each needs independent:

```text
request ID
props
render state
error state
```

---

# 26. TOOL RESULT → UI

This is a major Phase 6 capability.

Phase 5:

```text
Tool
 ↓
JSON
 ↓
Model
 ↓
Text
```

Phase 6:

```text
Tool
 ↓
Result
 ↓
Renderer Resolution
 ↓
Trusted Component
```

Example:

```text
applications.get
 ↓
Application
 ↓
ApplicationCard
```

---

# 27. TOOL RENDERERS

Allow developers to associate a renderer with a tool.

Conceptually:

```tsx
registerToolRenderer({
  tool: "applications.get",

  component: ApplicationToolResult
});
```

or integrate renderer metadata with tool registration.

Choose the architecture that avoids tight coupling.

---

# 28. TOOL RENDER STATES

Tool renderers should support:

```text
requested
running
success
error
cancelled
```

Example:

```text
Loading:

Checking APP-1024...

Success:

┌─────────────────────────┐
│ APP-1024                │
│ Pending                 │
└─────────────────────────┘

Error:

Unable to load APP-1024.
```

---

# 29. STREAMING TOOL UI

While tool execution runs:

```text
User
 ↓
Tool
 ↓
[Loading UI]
 ↓
Tool completes
 ↓
[Result UI]
```

Do not wait until the final assistant message to show all progress.

Use Phase 5 lifecycle events.

---

# 30. DEFAULT TOOL RENDERER

Provide safe generic rendering.

Example:

```text
✓ applications.get completed
```

Do not dump huge raw JSON automatically.

Do not expose sensitive arguments/results by default.

---

# 31. CUSTOM TOOL RENDERER

Target experience:

```tsx
useToolRenderer({
  tool: "applications.get",

  render({ status, result }) {
    if (status === "running") {
      return <ApplicationSkeleton />;
    }

    if (status === "success") {
      return (
        <ApplicationCard
          application={result}
        />
      );
    }

    return <ApplicationError />;
  }
});
```

Exact API may differ.

---

# 32. INTERACTIVE GENERATED COMPONENTS

Generated components may contain developer-defined buttons.

Example:

```text
ApplicationCard

[Open]
[View Documents]
```

But those interactions must be trusted application code.

---

# 33. COMPONENT ACTIONS

Preferred:

```text
Generated Component
      ↓
Registered Tool
      ↓
Tool Runtime
```

Example:

```text
[Open]
 ↓
navigation.openApplication
```

Do not allow model-generated callback source.

---

# 34. ACTION REFERENCES

If structured UI needs actions, use references.

Example:

```json
{
  "component": "ApplicationCard",
  "props": {
    "applicationId": "APP-1024"
  },
  "actions": [
    {
      "id": "open",
      "tool": "navigation.openApplication",
      "arguments": {
        "applicationId": "APP-1024"
      }
    }
  ]
}
```

Only execute registered tools.

Validate arguments again through Phase 5 Tool Runtime.

---

# 35. DO NOT BYPASS TOOL RUNTIME

Bad:

```text
Generated Button
 ↓
Direct arbitrary API call
```

Preferred:

```text
Generated Button
 ↓
Registered Tool
 ↓
Tool Runtime
 ↓
Application
```

This prepares all consequential actions for the Phase 7 Action Firewall.

---

# 36. SHARED AI/UI STATE

Phase 4 established shared-state primitives.

Phase 6 extends them for controlled AI/UI interaction.

Target:

```text
Application UI
      ↕
Shared State
      ↕
Generative UI
      ↕
Future Agent
```

Do not build agents yet.

---

# 37. STATE BINDING

Allow a generated component to bind to registered shared state without arbitrary state access.

Conceptually:

```json
{
  "component": "ApplicationFilters",
  "state": {
    "source": "applicationFilters"
  }
}
```

Exact contract should be carefully designed.

---

# 38. STATE ACCESS MUST BE EXPLICIT

The model must not be able to enumerate and mutate every application state value.

State must be explicitly exposed for:

```text
read
write
```

where applicable.

Potential permissions at the state-definition level:

```text
modelReadable
modelWritable
```

These are capability metadata, not enterprise authorization.

Phase 7 will add real policy enforcement.

---

# 39. READ-ONLY STATE

Support:

```text
AI/UI can read
AI cannot modify
```

Example:

```text
currentApplicationId
currentUserLocale
```

---

# 40. WRITABLE SHARED STATE

Support explicitly writable state.

Example:

```text
applicationFilters
selectedTab
displayMode
```

Do not automatically make application business records writable.

---

# 41. STATE PATCH CONTRACT

Define a provider-neutral patch format.

Possible JSON Patch-inspired model:

```json
{
  "op": "replace",
  "path": "/status",
  "value": "APPROVED"
}
```

But do not automatically adopt full RFC 6902 if unnecessary.

Use the smallest safe abstraction required.

---

# 42. PATCH OPERATIONS

Potential initial operations:

```text
set
replace
remove
```

Maybe:

```text
append
```

if justified.

Avoid an excessively powerful expression language.

---

# 43. PATCH VALIDATION

Pipeline:

```text
AI/UI Patch
    ↓
Resolve State
    ↓
Check Writable
    ↓
Validate Path
    ↓
Apply Patch
    ↓
Validate Result Schema
    ↓
Commit
```

Invalid patch:

```text
must not mutate state
```

---

# 44. STATE SCHEMA

Writable shared state should support schemas.

Example:

```ts
z.object({
  status: z.enum([
    "all",
    "pending",
    "approved"
  ])
})
```

AI attempts:

```json
{
  "status": "DROP_DATABASE"
}
```

Expected:

```text
Rejected
```

---

# 45. STATE VERSION

Introduce a lightweight version/revision.

Example:

```text
revision: 12
```

Patch request:

```text
baseRevision: 12
```

After successful patch:

```text
revision: 13
```

This prepares for conflict handling.

---

# 46. STATE CONFLICT

If:

```text
AI starts from revision 12
```

but UI has moved to:

```text
revision 14
```

do not blindly overwrite.

Return:

```text
STATE_CONFLICT
```

or use a documented reconciliation strategy.

Keep Phase 6 implementation simple and deterministic.

---

# 47. OPTIMISTIC UI FOUNDATION

For safe local interactions:

```text
User action
 ↓
Optimistic state
 ↓
Execution
 ↓
Confirm / rollback
```

Create foundation only where useful.

Do not implement distributed transactional AI actions.

That belongs to later enterprise capabilities.

---

# 48. ROLLBACK FOUNDATION

If an optimistic state patch fails validation/execution:

```text
restore previous state
```

Do not confuse UI rollback with Phase 7+ compensating business transactions.

---

# 49. STATE PATCH EVENTS

If protocol support is needed:

```text
state.patch.requested
state.patch.applied
state.patch.rejected
state.conflict
```

Keep them provider-neutral.

---

# 50. PROGRESS UI

Support richer progress rendering based on existing runtime/tool events.

Example:

```text
Analyzing application...

✓ Application loaded
✓ Documents checked
● Checking payment
○ Preparing result
```

No agents yet.

The progress model should still be useful later for agents.

---

# 51. PROGRESS MODEL

Potential:

```ts
interface ProgressStep {
  id: string;
  label: string;

  status:
    | "pending"
    | "running"
    | "completed"
    | "failed";
}
```

Do not tightly bind progress to tools only.

Future Phase 10 agents should be able to use it.

---

# 52. PROGRESS EVENTS

If justified:

```text
progress.started
progress.updated
progress.completed
progress.failed
```

Avoid excessive event proliferation.

Reuse existing events where possible.

---

# 53. STREAMING GENERATIVE UI

Support progressive UI where safely possible.

Example:

```text
Model starts ApplicationCard request
 ↓
Skeleton
 ↓
Props become complete
 ↓
Validated
 ↓
ApplicationCard
```

Do not render invalid partial props.

---

# 54. PARTIAL PROPS

If provider streaming produces partial structured data:

```text
buffer
 ↓
parse when possible
 ↓
validate
 ↓
render only valid state
```

Do not pass malformed partial objects to trusted components unless a component explicitly supports a typed partial contract.

---

# 55. UI REQUEST UPDATE

Support a component request being updated during the same run if architecture requires it.

Example:

```text
ApplicationAnalysis

status = loading

        ↓

ApplicationAnalysis

status = completed
score = 82
```

Updates must preserve request identity.

---

# 56. GENERATIVE UI ERROR BOUNDARY

One component renderer failure must not crash the entire Copilot.

Use React error boundaries or equivalent safe isolation.

Example:

```text
Component rendering failed.

[Show text response]
```

Preserve diagnostics for developers.

---

# 57. FALLBACK BEHAVIOR

Unknown component:

```text
safe text fallback
```

Invalid props:

```text
safe error state
```

Renderer exception:

```text
safe fallback
```

Never display raw stack traces to end users.

---

# 58. HEADLESS API

Generative UI must not require the default CopilotChat.

Custom UIs should be able to consume normalized data.

Potential:

```text
useGenerativeUI()
useGenerativeUIRequests()
```

Only add hooks justified by the existing architecture.

Avoid API proliferation.

---

# 59. DEFAULT COPILOT UI INTEGRATION

Existing:

```tsx
<CopilotChat />
```

should automatically render supported structured UI content when a registry/provider is configured.

Existing text-only behavior must remain unchanged.

---

# 60. CUSTOM MESSAGE RENDERING

Allow applications to override rendering.

Conceptually:

```tsx
<CopilotChat
  renderGenerativeUI={...}
/>
```

or registry-based resolution.

Use the API most consistent with Phase 3.

---

# 61. THEME INTEGRATION

Generated components are application-owned and may use application styles.

SDK-owned fallback/loading/error/progress UI should follow Phase 3 theming.

Do not force one design system on application components.

---

# 62. ACCESSIBILITY

Generated SDK UI must support:

```text
keyboard navigation
focus visibility
semantic elements
screen readers
ARIA where appropriate
reduced motion
high zoom
responsive layouts
```

Interactive components supplied by application developers remain their responsibility, but SDK examples should model good behavior.

---

# 63. RTL

Phase 3 supports RTL.

Phase 6 SDK-owned UI must preserve RTL behavior.

Do not hardcode left/right assumptions.

---

# 64. MOBILE

Test generated UI inside:

```text
Popup
Sidebar
Full Chat
```

for narrow screens.

Large generated components must not destroy chat layout.

---

# 65. TOOL RESULT EXAMPLE

Create:

```text
examples/react-generative-ui/
```

Example flow:

```text
User:
"Show APP-1024"

        ↓

Model calls:
applications.get

        ↓

Tool Result

        ↓

ApplicationCard renderer

        ↓

┌─────────────────────────────┐
│ APP-1024                    │
│ Ahmed                       │
│ Pending                     │
│                             │
│ [Open]                      │
└─────────────────────────────┘
```

---

# 66. STRUCTURED UI EXAMPLE

Also demonstrate model-selected UI without requiring a tool.

Example:

```text
User:
"Show these applications as cards."
```

Model returns structured requests for:

```text
ApplicationCard
ApplicationCard
ApplicationCard
```

using deterministic mock data/provider.

---

# 67. INTERACTIVE ACTION EXAMPLE

`ApplicationCard`:

```text
[Open]
```

calls:

```text
navigation.openApplication
```

through the Phase 5 frontend tool system.

Never execute model-generated callback code.

---

# 68. SHARED STATE EXAMPLE

Example:

```text
ApplicationFilterPanel

Status:
[All] [Pending] [Approved]
```

Backed by:

```text
applicationFilters
```

Demonstrate:

```text
UI changes state
 ↓
Copilot sees updated explicitly exposed state

and

Validated AI/state patch
 ↓
UI updates
```

No enterprise authorization yet.

---

# 69. STATE CONFLICT EXAMPLE

Test:

```text
revision 10
```

AI proposes patch based on 10.

UI changes state to:

```text
revision 11
```

Old patch should not silently overwrite revision 11.

---

# 70. PROGRESS EXAMPLE

Demonstrate:

```text
Getting application information...

✓ Application loaded
● Loading documents

then

✓ Application loaded
✓ Documents loaded
```

Can be deterministic/mock.

---

# 71. MOCK GENERATIVE MODEL

Extend mock provider to emit deterministic:

```text
structured UI request
tool call + rendered result
state patch
progress update
```

as needed.

No real API key should be required for tests.

---

# 72. UNIT TESTS — COMPONENT REGISTRY

Test:

```text
register
lookup
list
dispose
duplicate
enable/disable
multiple registries
metadata
```

---

# 73. UNIT TESTS — UI REQUEST

Test:

```text
valid request
unknown component
invalid envelope
invalid props
missing props
extra props according to schema policy
```

---

# 74. UNIT TESTS — SAFE RENDERING

Verify:

```text
unknown components cannot import modules
strings cannot become executable callbacks
script-like content is treated as data/text
invalid props do not render component
```

---

# 75. UNIT TESTS — TOOL RENDERERS

Test:

```text
requested
running
success
error
cancelled
custom renderer
default renderer
large result
```

---

# 76. UNIT TESTS — STATE PATCHES

Test:

```text
valid set
valid replace
invalid state ID
read-only state
invalid path
invalid value
schema violation
revision increment
revision conflict
rollback
```

---

# 77. REACT TESTS

Test:

```text
component registration
unmount cleanup
StrictMode
multiple providers
registry isolation
component rendering
fallback rendering
renderer exception
tool rendering
state binding
progress UI
```

---

# 78. MIXED CONTENT TEST

Verify ordered rendering:

```text
Text

ApplicationCard

Text

Tool Progress

PaymentStatus

Text
```

Ordering must match protocol content order.

---

# 79. END-TO-END GENERATIVE UI TEST

Mandatory:

```text
React
 ↓
User:
"Show APP-1024"
 ↓
Mock Model
 ↓
applications.get
 ↓
Tool Runtime
 ↓
Application Result
 ↓
Generative Renderer
 ↓
ApplicationCard
```

Verify correct props.

---

# 80. END-TO-END INTERACTIVE TEST

Mandatory:

```text
ApplicationCard
 ↓
[Open]
 ↓
Registered frontend tool
 ↓
navigation.openApplication
 ↓
Application state/router changes
```

No direct arbitrary action execution.

---

# 81. END-TO-END STATE TEST

Mandatory:

```text
Shared State
status = all
revision = 1

AI requests valid patch

status = pending
revision = 2

React UI updates
```

Then test invalid/conflicting patch.

---

# 82. SECURITY TEST

Attempt model output conceptually containing:

```json
{
  "component": "../../AdminPanel",
  "props": {}
}
```

Expected:

```text
REJECTED
```

Attempt:

```json
{
  "component": "ApplicationCard",
  "props": {
    "onClick": "fetch('evil')"
  }
}
```

Expected:

```text
schema rejection or inert data
```

No executable callback is created.

---

# 83. REGRESSION TESTING

All previous capabilities must remain valid:

```text
Protocol
Streaming
Cancellation
Provider Runtime
React Chat
Context
State
Backend Tools
Frontend Tools
Tool Loop
Parallel Tools
Structured Outputs
```

---

# 84. PERFORMANCE

Avoid:

```text
rerendering entire chat for every small progress event
```

Avoid:

```text
revalidating every historical generated component on every token
```

Use stable identities.

Memoize where justified.

Measure before adding complexity.

---

# 85. COMPONENT REQUEST SIZE

Protect against huge model-generated prop payloads.

Provide configurable limits where justified.

Do not allow a generated component request to carry arbitrarily large datasets.

For large data, prefer IDs/references and registered tools/state.

---

# 86. STATE SIZE

Shared state is not a database.

Avoid storing huge application datasets inside Copilot state.

Document this.

---

# 87. TRUST BOUNDARIES

Document:

```text
Model Output
UNTRUSTED

Generated Props
UNTRUSTED

State Patches
UNTRUSTED

Registered Components
TRUSTED APPLICATION CODE

Registered Tools
TRUSTED CAPABILITIES
```

Even trusted capabilities will receive stronger authorization/policy enforcement in Phase 7.

---

# 88. PHASE 7 COMPATIBILITY

Phase 6 must prepare for:

```text
Generated UI Action
      ↓
Registered Tool
      ↓
AI Action Firewall
      ↓
Approval if required
      ↓
Execute
```

Do not let generated UI bypass the tool runtime.

This is mandatory.

---

# 89. PHASE 8 COMPATIBILITY

Later:

```text
OpenAPI
 ↓
Automatic Tool
 ↓
Tool Result
 ↓
Generative UI
```

should work without redesign.

Example future flow:

```text
GET /applications/{id}
       ↓
Generated Tool
       ↓
Application JSON
       ↓
ApplicationCard
```

Do NOT implement OpenAPI conversion now.

---

# 90. PHASE 10 COMPATIBILITY

Later agents should be able to emit:

```text
progress
tool activity
structured UI
shared state updates
```

using the same protocol.

Do not tie Generative UI only to direct chat completion.

---

# 91. PHASE 11 COMPATIBILITY

Preserve diagnostic metadata needed for future DevTools:

```text
UI request ID
component
validation result
renderer
tool source
state patch
revision
failure reason
duration
```

Do not build DevTools now.

---

# 92. DOCUMENTATION

Populate:

```text
docs/phases/phase-06/
```

Required:

```text
Phase_6_Docs.md
Phase_6_Architecture.md
Phase_6_Implementation.md
Phase_6_Status.md
Phase_6_Testing.md
Phase_6_Decisions.md
Phase_6_API.md
Phase_6_Files.md
Phase_6_Issues.md
Phase_6_Handoff.md
```

---

# 93. ARCHITECTURE DOCUMENTATION

Document:

```text
Generative UI contracts
Component Registry
Component Resolver
Structured UI Requests
Prop Validation
React Renderer
Tool Renderers
Interactive Actions
Shared State
State Patches
Revision Handling
Progress UI
Streaming UI
Fallback/Error Handling
```

---

# 94. SECURITY ARCHITECTURE DOCUMENT

Include:

```text
Model
 ↓
UNTRUSTED STRUCTURED REQUEST
 ↓
Envelope Validation
 ↓
Trusted Registry Lookup
 ↓
Props Validation
 ↓
Trusted Component
```

Explicitly document why arbitrary generated React/JavaScript is prohibited.

---

# 95. SHARED STATE DIAGRAM

Document:

```text
               Application UI
                     │
                     ▼
                State Store
                 ↕       ↕
         Registered UI   Copilot
                 │         │
                 └────┬────┘
                      ▼
               Validated Patch
                      │
                      ▼
               Revision Check
                      │
                      ▼
                  New State
```

---

# 96. TOOL/UI DIAGRAM

Document:

```text
Model
 ↓
Tool Call
 ↓
Tool Runtime
 ↓
Tool Result
 ↓
Renderer Registry
 ↓
Trusted Component
 ↓
User Interaction
 ↓
Registered Tool
```

---

# 97. API DOCUMENTATION

Document actual public APIs such as:

```text
registerGenerativeComponent
createGenerativeComponentRegistry
GenerativeUIRequest
GenerativeComponentDefinition
useGenerativeComponent
useToolRenderer
StatePatch
ProgressStep
```

Only list APIs actually implemented.

---

# 98. ADRS

Potential ADRs:

```text
Trusted component registry

No arbitrary generated executable UI

Generative UI protocol representation

Tool-result rendering architecture

State patch format

State revision/conflict strategy

Generated UI action → Tool Runtime rule

Streaming Generative UI strategy
```

Create ADRs only where justified.

Update:

```text
docs/DECISIONS.md
```

---

# 99. PROJECT STATUS

At successful completion:

```text
Phase 01    COMPLETE
Phase 02    COMPLETE
Phase 03    COMPLETE
Phase 04    COMPLETE
Phase 05    COMPLETE
Phase 06    COMPLETE

Phase 07
ENTERPRISE SECURITY & HITL

NOT STARTED
LOCKED
```

---

# 100. CHANGELOG

Update:

```text
docs/CHANGELOG_PHASES.md
```

with actual implementation.

Potential categories:

```text
Generative UI
Trusted Component Registry
Tool Renderers
Interactive Components
Shared State Patches
Revision Handling
Progress UI
Streaming UI
```

---

# 101. TECHNICAL DEBT

Update:

```text
docs/TECHNICAL_DEBT.md
```

for real debt only.

Do NOT call these technical debt:

```text
Action Firewall
HITL
OpenAPI
MCP
RAG
Agents
```

They are planned phases.

---

# 102. RECOMMENDED COMMITS

```text
feat(ui): add generative UI contracts

feat(ui): add trusted component registry

feat(ui): add structured UI validation

feat(react): add generative component registration

feat(react): render structured UI content

feat(ui): add tool result renderer architecture

feat(react): add interactive tool renderers

feat(state): add validated shared state patches

feat(state): add revision conflict handling

feat(ui): add progress rendering

feat(ui): add streaming generative UI foundation

test(ui): cover trusted component resolution

test(state): cover state patches and conflicts

test(integration): verify generative UI flow

docs(phase-06): document generative UI architecture
```

Adjust based on repository reality.

Do not invent commit hashes.

---

# 103. IMPLEMENTATION ORDER

Follow this sequence unless repository evidence requires a documented change:

```text
STEP 01
Read skills

STEP 02
Read Phase 1–5 documentation

STEP 03
Read roadmap checkpoint

STEP 04
Verify previous phases

STEP 05
Inspect repository

STEP 06
Mark Phase 6 IN PROGRESS

STEP 07
Design framework-neutral UI contracts

STEP 08
Design component identity

STEP 09
Design GenerativeUIRequest

STEP 10
Implement component registry

STEP 11
Implement registration lifecycle

STEP 12
Implement component resolver

STEP 13
Implement request validation

STEP 14
Implement prop validation

STEP 15
Implement safe failure behavior

STEP 16
Extend protocol content model

STEP 17
Integrate model/runtime structured UI

STEP 18
Implement React registry integration

STEP 19
Implement React component renderer

STEP 20
Implement error isolation

STEP 21
Implement mixed text/UI content

STEP 22
Implement multiple UI requests

STEP 23
Design tool renderer architecture

STEP 24
Implement default tool renderer

STEP 25
Implement custom tool renderer

STEP 26
Implement loading/error/cancelled rendering

STEP 27
Integrate Phase 5 tool events

STEP 28
Implement interactive action references

STEP 29
Route actions through Tool Runtime

STEP 30
Review Phase 4 state architecture

STEP 31
Design state patch contract

STEP 32
Implement writable/read-only exposure

STEP 33
Implement patch validation

STEP 34
Implement state revision

STEP 35
Implement conflict handling

STEP 36
Implement rollback foundation

STEP 37
Integrate state with React

STEP 38
Implement progress model

STEP 39
Implement progress rendering

STEP 40
Implement streaming UI foundation

STEP 41
Implement partial-request safety

STEP 42
Add accessibility

STEP 43
Validate RTL

STEP 44
Validate responsive rendering

STEP 45
Create react-generative-ui example

STEP 46
Create tool-result UI example

STEP 47
Create interactive action example

STEP 48
Create shared-state example

STEP 49
Create progress example

STEP 50
Write registry tests

STEP 51
Write validation/security tests

STEP 52
Write tool-renderer tests

STEP 53
Write state-patch tests

STEP 54
Write React tests

STEP 55
Write Generative UI E2E test

STEP 56
Write interactive action E2E test

STEP 57
Write state E2E test

STEP 58
Review security boundaries

STEP 59
Review Phase 7 compatibility

STEP 60
Review Phase 8 compatibility

STEP 61
Review Phase 10 compatibility

STEP 62
Review performance

STEP 63
Review public APIs

STEP 64
Update Phase 6 documentation

STEP 65
Update global documentation

STEP 66
Run complete regression suite

STEP 67
Self-review

STEP 68
Produce completion report

STEP 69
STOP
```

---

# 104. REQUIRED DEVELOPER EXPERIENCE

Something conceptually equivalent must work:

```tsx
const ApplicationCardSchema = z.object({
  applicationId: z.string(),
  applicantName: z.string(),
  status: z.string()
});

registerGenerativeComponent({
  name: "ApplicationCard",

  description:
    "Displays an application summary",

  props: ApplicationCardSchema,

  component: ApplicationCard
});
```

Then the runtime can receive:

```json
{
  "component": "ApplicationCard",
  "props": {
    "applicationId": "APP-1024",
    "applicantName": "Ahmed",
    "status": "PENDING"
  }
}
```

and safely render the registered `ApplicationCard`.

---

# 105. REQUIRED TOOL RESULT EXPERIENCE

Something conceptually equivalent:

```tsx
useToolRenderer({
  tool: "applications.get",

  render({ status, result }) {
    if (status === "running") {
      return <ApplicationSkeleton />;
    }

    if (status === "success") {
      return (
        <ApplicationCard
          {...result}
        />
      );
    }

    return <ApplicationError />;
  }
});
```

must work without modifying Tool Runtime.

---

# 106. REQUIRED INTERACTION EXPERIENCE

Generated UI:

```text
┌─────────────────────────────┐
│ APP-1024                    │
│ Pending                     │
│                             │
│ [Open]                      │
└─────────────────────────────┘
```

Interaction:

```text
Open
 ↓
navigation.openApplication
 ↓
Phase 5 Tool Runtime
 ↓
Frontend Tool
 ↓
Application
```

Never:

```text
Open
 ↓
model-generated JS
```

---

# 107. REQUIRED SHARED STATE EXPERIENCE

Something conceptually equivalent:

```tsx
const [filters, setFilters] =
  useCopilotState({
    id: "applicationFilters",

    initialValue: {
      status: "all"
    },

    schema: z.object({
      status: z.enum([
        "all",
        "pending",
        "approved"
      ])
    }),

    ai: {
      readable: true,
      writable: true
    }
  });
```

Then a valid AI patch may update:

```text
all
 ↓
pending
```

through the controlled state patch pipeline.

An invalid value must be rejected.

---

# 108. PHASE 6 ACCEPTANCE CRITERIA

Phase 6 is COMPLETE only when:

## Architecture

* [ ] Generative UI contracts are framework-neutral.
* [ ] React rendering is separate from core contracts.
* [ ] Trusted component registry exists.
* [ ] No arbitrary model-generated executable code.
* [ ] Existing tool architecture remains canonical.
* [ ] Existing state architecture remains canonical.

## Registry

* [ ] components register.
* [ ] components resolve.
* [ ] duplicates handled deterministically.
* [ ] registration cleanup works.
* [ ] multiple registries/providers remain isolated.

## Validation

* [ ] request envelope validated.
* [ ] component existence validated.
* [ ] props validated.
* [ ] invalid requests fail safely.
* [ ] unknown components fail safely.
* [ ] renderer exceptions isolated.

## Rendering

* [ ] structured UI renders.
* [ ] mixed text/UI works.
* [ ] multiple components work.
* [ ] loading works.
* [ ] errors work.
* [ ] cancelled state works.
* [ ] responsive behavior works.
* [ ] RTL remains valid.
* [ ] accessibility baseline passes.

## Tools

* [ ] tool-result renderer works.
* [ ] default renderer works.
* [ ] custom renderer works.
* [ ] tool progress updates UI.
* [ ] generated actions use registered tools.
* [ ] generated UI cannot bypass Tool Runtime.

## Shared State

* [ ] explicit readable state works.
* [ ] explicit writable state works.
* [ ] read-only state cannot be patched.
* [ ] patches validated.
* [ ] result state schema validated.
* [ ] revisions work.
* [ ] conflicts detected.
* [ ] rollback/failure behavior works.

## Streaming

* [ ] partial invalid props are not blindly rendered.
* [ ] valid completed requests render.
* [ ] UI request identity remains stable.
* [ ] progress updates do not corrupt message ordering.

## Testing

* [ ] registry tests pass.
* [ ] validation tests pass.
* [ ] security tests pass.
* [ ] tool-renderer tests pass.
* [ ] state-patch tests pass.
* [ ] React tests pass.
* [ ] Generative UI E2E passes.
* [ ] interactive action E2E passes.
* [ ] shared-state E2E passes.
* [ ] Phase 1–5 regression passes.

## Documentation

* [ ] Phase_6_Docs updated.
* [ ] Phase_6_Architecture updated.
* [ ] Phase_6_Implementation updated.
* [ ] Phase_6_Status updated.
* [ ] Phase_6_Testing updated.
* [ ] Phase_6_Decisions updated.
* [ ] Phase_6_API updated.
* [ ] Phase_6_Files updated.
* [ ] Phase_6_Issues updated.
* [ ] Phase_6_Handoff updated.
* [ ] PROJECT_STATUS updated.
* [ ] CHANGELOG_PHASES updated.
* [ ] DECISIONS updated.
* [ ] TECHNICAL_DEBT updated if applicable.

## Phase Gate

* [ ] no Action Firewall.
* [ ] no RBAC/ABAC enforcement.
* [ ] no approval workflows.
* [ ] no HITL.
* [ ] no OpenAPI auto-tools.
* [ ] no MCP.
* [ ] no RAG.
* [ ] no durable memory.
* [ ] no agents.
* [ ] no Phase 7+ implementation.

---

# 109. VALIDATION

Run repository equivalents:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Also run:

```text
Phase 1 regression
Phase 2 regression
Phase 3 regression
Phase 4 regression
Phase 5 regression

Generative UI unit tests
Registry tests
Props validation tests
Security tests
Tool renderer tests
Shared state patch tests
React tests
Accessibility tests
E2E Generative UI
E2E Interactive Action
E2E Shared State
```

Run:

```text
examples/react-generative-ui
```

Verify:

```text
Structured component rendering
Tool result rendering
Interactive registered actions
State updates
State conflict
Loading/progress
Errors
Cancellation
Mobile
RTL
Keyboard usage
```

Record exact results in:

```text
docs/phases/phase-06/Phase_6_Testing.md
```

Never report PASS unless actually run.

---

# 110. SELF-REVIEW

Before completion ask:

## Security

Can model output become JavaScript?

Can model output specify an import path?

Can it execute arbitrary HTML?

Can it create arbitrary event handlers?

Can it bypass Tool Runtime?

If yes, fix immediately.

## Registry

Can an unknown component render?

Can duplicate registrations behave unpredictably?

Can components leak after unmount?

## Props

Are model props validated before render?

Can invalid props crash chat?

## State

Can AI mutate unexposed state?

Can AI mutate read-only state?

Can an old patch overwrite newer state?

Can invalid patches partially mutate state?

## Tools

Do generated actions go through Phase 5 tools?

If not, fix.

## Performance

Does one progress event rerender all chat history?

Are historical UI requests repeatedly validated unnecessarily?

## Compatibility

Does text-only chat still work?

Do Phase 5 tools still work without custom renderers?

## Phase Gate

Did we accidentally implement:

Action Firewall?

Approval workflows?

OpenAPI?

MCP?

Agents?

If yes, remove/defer.

---

# 111. COMPLETION REPORT

Produce:

```text
AI COPILOT SDK
PHASE 06 — GENERATIVE UI & SHARED STATE


STATUS

COMPLETE / INCOMPLETE


PREVIOUS PHASE REGRESSION

Phase 1:
PASS / FAIL

Phase 2:
PASS / FAIL

Phase 3:
PASS / FAIL

Phase 4:
PASS / FAIL

Phase 5:
PASS / FAIL


IMPLEMENTED

Generative UI Contracts:
- ...

Component Registry:
- ...

Component Resolver:
- ...

Structured UI Requests:
- ...

Props Validation:
- ...

React Renderer:
- ...

Mixed Content:
- ...

Tool Renderers:
- ...

Interactive Actions:
- ...

Shared State:
- ...

State Patches:
- ...

State Revision:
- ...

Conflict Handling:
- ...

Progress UI:
- ...

Streaming UI:
- ...

Fallback/Error UI:
- ...

Examples:
- ...


PUBLIC APIs

Core/UI:
- ...

React:
- ...

Protocol:
- ...

State:
- ...


GENERATIVE UI PIPELINE

Structured Request:
PASS / FAIL

Registry Lookup:
PASS / FAIL

Props Validation:
PASS / FAIL

Trusted Rendering:
PASS / FAIL

Fallback:
PASS / FAIL

Error Isolation:
PASS / FAIL


TOOL UI PIPELINE

Tool Running:
PASS / FAIL

Tool Result:
PASS / FAIL

Custom Renderer:
PASS / FAIL

Interactive Action:
PASS / FAIL

Tool Runtime Routing:
PASS / FAIL


SHARED STATE PIPELINE

Readable State:
PASS / FAIL

Writable State:
PASS / FAIL

Patch Validation:
PASS / FAIL

Schema Validation:
PASS / FAIL

Revision:
PASS / FAIL

Conflict:
PASS / FAIL

Rollback:
PASS / FAIL


SECURITY VALIDATION

No arbitrary JS:
PASS / FAIL

No dynamic imports:
PASS / FAIL

No arbitrary callbacks:
PASS / FAIL

Unknown components rejected:
PASS / FAIL

Props validated:
PASS / FAIL

Generated actions use Tool Runtime:
PASS / FAIL


TEST RESULTS

Lint:
PASS / FAIL / NOT RUN

Typecheck:
PASS / FAIL / NOT RUN

Unit Tests:
PASS / FAIL / NOT RUN

Generative UI Tests:
PASS / FAIL / NOT RUN

React Tests:
PASS / FAIL / NOT RUN

State Tests:
PASS / FAIL / NOT RUN

Security Tests:
PASS / FAIL / NOT RUN

Accessibility:
PASS / FAIL / NOT RUN

Integration:
PASS / FAIL / NOT RUN

E2E:
PASS / FAIL / NOT RUN

Build:
PASS / FAIL / NOT RUN


FUTURE ARCHITECTURE CHECK

Action Firewall compatible:
PASS / FAIL

OpenAPI-generated tool results compatible:
PASS / FAIL

MCP tool results compatible:
PASS / FAIL

Agent progress compatible:
PASS / FAIL

DevTools diagnostics preserved:
PASS / FAIL


DEPENDENCIES ADDED

- dependency:
  package:
  reason:


PROTOCOL CHANGES

- ...


ARCHITECTURE DECISIONS

- ...


FILES CREATED

- ...


FILES MODIFIED

- ...


COMMITS

- ...


ISSUES

- ...


TECHNICAL DEBT

- ...


DOCUMENTATION

Phase_6_Docs:
PASS / FAIL

Phase_6_Architecture:
PASS / FAIL

Phase_6_Implementation:
PASS / FAIL

Phase_6_Status:
PASS / FAIL

Phase_6_Testing:
PASS / FAIL

Phase_6_Decisions:
PASS / FAIL

Phase_6_API:
PASS / FAIL

Phase_6_Files:
PASS / FAIL

Phase_6_Issues:
PASS / FAIL

Phase_6_Handoff:
PASS / FAIL


REMAINING PHASE 6 WORK

None

or

- ...


NEXT PHASE

Phase 07 — Enterprise Security & HITL

Planned major capabilities:

- AI Action Firewall
- Authentication Integration
- Identity Propagation
- RBAC
- ABAC
- Permission-Aware Tool Discovery
- Context Security Policies
- PII Controls
- Guardrails
- Human-in-the-Loop
- User Confirmation
- Supervisor Approval
- Admin Approval
- Two-Person Approval
- Interrupt / Resume
- Dry Run
- Explain Before Execute
- Action Classification
- Audit Trail
- Action History
- Security Events

STATUS

LOCKED / NOT STARTED

Waiting for explicit user instruction.
```

---

# 112. FINAL STOP RULE

After Phase 6 is implemented, tested, documented and reviewed:

STOP.

Do NOT start:

```text
PHASE 07 — ENTERPRISE SECURITY & HITL
```

Specifically do not implement yet:

```text
AI Action Firewall
RBAC
ABAC
Approval Workflows
HITL
PII Policy Engine
Dry Run
Explain Before Execute
Enterprise Audit
```

But confirm Phase 6 has preserved the future execution path:

```text
Generated UI
      ↓
Registered Action
      ↓
Tool Runtime
      ↓
[PHASE 7 FIREWALL INSERTION POINT]
      ↓
Tool Executor
```

This boundary is mandatory.

Phase 7 must be able to secure actions from:

```text
Chat
Frontend Tools
Backend Tools
Generative UI
Future OpenAPI Tools
Future MCP Tools
Future Agents
```

through the same security pipeline.

Wait for explicit user authorization.
