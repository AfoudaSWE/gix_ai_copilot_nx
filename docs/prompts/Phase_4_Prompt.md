# AI Copilot SDK — Phase 4: Application Context & State

Implement **Phase 4 only** of the AI Copilot SDK.

Current phase:

```text
PHASE 04 — APPLICATION CONTEXT & STATE
```

## Mission

Phases 1–3 established:

```text
Phase 1
Protocol + Core + Client + Server

        ↓

Phase 2
LLM Runtime + Providers + Streaming

        ↓

Phase 3
React SDK + Headless Chat + Copilot UI
```

Phase 4 must make the Copilot understand the application surrounding the conversation.

Before Phase 4:

```text
User
 ↓
Chat
 ↓
LLM

"What is on this page?"

LLM:
"I don't know."
```

After Phase 4:

```text
Application
 ├── Current User
 ├── Current Page
 ├── Selected Entity
 ├── Visible Data
 ├── Component State
 └── Session State
          │
          ▼
     Context Engine
          │
          ▼
       AI Runtime
          │
          ▼
         LLM
```

The target developer experience includes APIs such as:

```tsx
useCopilotContext({
  name: "selectedApplication",
  description: "Application currently selected by the user",
  value: selectedApplication
});
```

and:

```tsx
const [filters, setFilters] = useCopilotState({
  name: "applicationFilters",
  initialValue: {
    status: "pending"
  }
});
```

However, design the final APIs based on the existing repository architecture rather than blindly copying these examples.

---

# 0. PHASE GATE

Implement Phase 4 only.

Phase 4 includes:

* Application context
* User context
* Page context
* Component context
* Session context
* Temporary context
* Context registration
* Context lifecycle
* Context scopes
* Context priority
* Context serialization
* Context resolution
* Context composition
* Context deduplication
* Context token budgeting
* Context truncation
* Context compression foundation
* Context sensitivity metadata
* Context debugging metadata
* Shared application state foundation
* Typed state
* State registration
* State subscriptions
* State updates
* State patches if justified
* React context hooks
* Context injection into model execution
* Context testing
* Context/state examples
* Phase 4 documentation

Phase 4 does NOT include:

```text
Tools
Frontend Tools
Backend Tools
Tool Calling
Automatic Tool Creation
OpenAPI → Tools
MCP
Generative UI
Agent Actions
HITL
Approvals
Action Firewall
RAG
Vector Database
Persistent Memory
Agents
Multi-Agent
Long-running workflows
DevTools UI
Angular SDK
```

Do NOT start Phase 5.

---

# 1. READ PROJECT SKILLS

Before modifying code read:

```text
.claude/skills/ai-copilot-project/SKILL.md
.claude/skills/phase-gate/SKILL.md
```

Apply at minimum:

```text
project-architecture
typescript-standards
nx-monorepo
sdk-design
protocol-design
react-sdk
context-engine
security
performance
testing
documentation
git-workflow
code-review
dependency-policy
backward-compatibility
phase-gate
```

Context may contain sensitive application data.

Therefore also read security rules before designing context serialization.

---

# 2. READ PREVIOUS PHASE DOCUMENTATION

Read all relevant documentation for:

```text
docs/phases/phase-01/
docs/phases/phase-02/
docs/phases/phase-03/
```

Especially:

```text
Phase_3_Architecture.md
Phase_3_Implementation.md
Phase_3_API.md
Phase_3_Issues.md
Phase_3_Handoff.md
```

Also read:

```text
docs/PROJECT_STATUS.md
docs/ARCHITECTURE_OVERVIEW.md
docs/ROADMAP.md
docs/DECISIONS.md
docs/TECHNICAL_DEBT.md
```

And the roadmap checkpoint:

```text
docs/roadmap/PHASE_4_TO_12_FEATURE_CHECKPOINT.md
```

if it exists.

Repository reality is the source of truth.

---

# 3. VERIFY PHASES 1–3

Before Phase 4 changes run the repository equivalents of:

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
SSE
Model Runtime
Providers
Streaming
Cancellation
React SDK
CopilotProvider
useCopilotChat
Copilot UI
React integration tests
```

If there is a serious blocking regression:

STOP.

Document the blocker.

Do not build Phase 4 on a broken foundation.

---

# 4. UPDATE PROJECT STATUS

When implementation actually begins update:

```text
Phase 01    COMPLETE
Phase 02    COMPLETE
Phase 03    COMPLETE
Phase 04    IN PROGRESS
Phase 05    NOT STARTED / LOCKED
```

Only mark previous phases COMPLETE if repository evidence confirms it.

---

# 5. PHASE 4 ARCHITECTURE

Current architecture:

```text
Application
     │
     ▼
React UI
     │
     ▼
React SDK
     │
     ▼
Client
     │
     ▼
Server
     │
     ▼
Core
     │
     ▼
Model Runtime
     │
     ▼
Provider
```

Phase 4 introduces:

```text
Application
     │
     ├───────────────┐
     │               │
     ▼               ▼
React SDK       Context/State
     │               │
     │        ┌──────┴──────┐
     │        ▼             ▼
     │   Context Engine   State Store
     │        │             │
     │        └──────┬──────┘
     │               │
     └───────┬───────┘
             ▼
           Client
             │
             ▼
           Server
             │
             ▼
        Core Runtime
             │
             ▼
       Context Builder
             │
             ▼
        Model Runtime
             │
             ▼
            LLM
```

Keep framework-independent context logic outside React.

---

# 6. PACKAGE ARCHITECTURE

Create a dedicated framework-independent package if justified:

```text
packages/context/
```

Package:

```text
@aicopilot/context
```

Recommended dependency direction:

```text
protocol
   ↑
   │
 context
   ↑
   │
 react
```

Server/core integration may consume public context contracts where appropriate.

Do not make `@aicopilot/context` depend on React.

Correct:

```text
@aicopilot/react
       ↓
@aicopilot/context
```

Forbidden:

```text
@aicopilot/context
       ↓
React
```

---

# 7. CORE CONTEXT MODEL

Define a framework-independent context representation.

Conceptually:

```ts
interface CopilotContextItem<T = unknown> {
  id: string;
  name: string;
  description?: string;

  scope: ContextScope;

  value: T;

  priority?: number;

  sensitivity?: ContextSensitivity;

  metadata?: Record<string, unknown>;
}
```

Exact design is your responsibility.

Do not expose arbitrary framework objects.

Context must be serializable before crossing transport boundaries.

---

# 8. CONTEXT SCOPES

Support clearly defined scopes.

At minimum:

```text
GLOBAL
USER
APPLICATION
PAGE
COMPONENT
SESSION
TEMPORARY
```

Define them consistently.

Possible TypeScript:

```ts
type ContextScope =
  | "global"
  | "user"
  | "application"
  | "page"
  | "component"
  | "session"
  | "temporary";
```

Document semantics.

---

# 9. GLOBAL CONTEXT

Examples:

```text
Company terminology
Product terminology
Application-wide instructions
Environment information
```

Do not use global context as a dumping ground.

---

# 10. USER CONTEXT

Examples:

```text
User ID
Display name
Locale
Role names
Preferences
```

Be cautious with:

```text
Email
Phone
Personal information
Sensitive identifiers
```

Context metadata should allow sensitivity classification.

Phase 7 will provide stronger enforcement.

---

# 11. APPLICATION CONTEXT

Examples:

```text
Application name
Application module
Current workspace
Feature configuration
Business domain
```

Example:

```json
{
  "application": "VAS",
  "module": "Customer Application"
}
```

---

# 12. PAGE CONTEXT

Examples:

```text
Current route
Page title
Page type
Current entity
Visible filters
Visible dataset summary
```

Do not automatically serialize the entire DOM.

Do not automatically scrape arbitrary page content.

Context should be explicit.

---

# 13. COMPONENT CONTEXT

Components should be able to expose focused information.

Example:

```tsx
useCopilotContext({
  name: "selectedApplication",
  scope: "component",
  value: application
});
```

Unmounting the component should remove the context item unless persistence was explicitly configured.

Test lifecycle cleanup.

---

# 14. SESSION CONTEXT

Session context may represent temporary workflow information such as:

```text
Current workflow
Current search
Current task
Current wizard progress
```

This is NOT persistent AI memory.

Do not confuse:

```text
Session Context
```

with Phase 9:

```text
Durable Memory
```

---

# 15. TEMPORARY CONTEXT

Temporary context can represent short-lived information such as:

```text
Open modal
Hovered/selected object
Temporary calculation
Transient user action
```

It should have a clearly defined lifecycle.

Optional TTL may be considered only if it meaningfully improves the architecture.

Do not overbuild.

---

# 16. CONTEXT REGISTRY

Implement a central framework-independent registry.

Conceptually:

```ts
const registry = createContextRegistry();

registry.register(...);

registry.update(...);

registry.remove(...);

registry.get(...);

registry.list(...);
```

Requirements:

```text
Registration
Update
Removal
Subscription
Scope filtering
Priority handling
Lifecycle
Stable IDs
```

Do not require a global singleton.

Support multiple Copilot instances.

---

# 17. CONTEXT REGISTRATION HANDLE

Prefer safe lifecycle management.

Conceptually:

```ts
const registration = registry.register(context);

registration.update(newValue);

registration.dispose();
```

This makes React lifecycle cleanup easier.

---

# 18. CONTEXT DUPLICATION

Define behavior when the same context ID/name is registered multiple times.

Do not allow silent unpredictable replacement.

Possible strategies:

```text
unique ID registration
owner ID
scope + name identity
```

Choose and document a deterministic rule.

---

# 19. CONTEXT RESOLVER

Implement a resolver that takes available context and determines what is relevant for a model request.

Conceptually:

```text
Context Registry
      ↓
Context Resolver
      ↓
Resolved Context
```

Phase 4 does NOT need AI-based context selection.

Start deterministic.

Use:

```text
scope
priority
enabled state
budget
sensitivity policy
```

Do not call an extra LLM just to select context.

---

# 20. CONTEXT PRIORITY

Support explicit priority.

For example:

```text
CRITICAL
HIGH
NORMAL
LOW
```

or numeric priority.

Pick one clean model.

Example:

```text
Current selected application    HIGH
Current page                    HIGH
User locale                     NORMAL
Help text                       LOW
```

Priority affects budget selection.

Priority must NOT be confused with security authorization.

---

# 21. CONTEXT SERIALIZATION

Create a controlled serialization pipeline.

Do NOT simply run:

```ts
JSON.stringify(applicationState)
```

on arbitrary application objects.

Provide a deliberate serialization boundary.

Conceptually:

```text
Application Object
       ↓
Context Serializer
       ↓
Safe Serializable Context
       ↓
Context Engine
```

Handle:

```text
undefined
Date
bigint if needed
circular references
functions
DOM elements
class instances
large nested objects
```

Unsupported data should fail or be safely normalized according to documented behavior.

---

# 22. CONTEXT FORMAT

Model-facing context should have a stable structured format.

For example:

```text
[Context: selectedApplication]
Scope: component
Description: Application currently selected by user

{
  "id": "APP-1024",
  "status": "PENDING",
  "country": "AE"
}
```

Do not mix everything into one undocumented string.

Preserve metadata internally.

---

# 23. CONTEXT ENGINE

Implement the central context engine.

Pipeline:

```text
Context Registry
      ↓
Collect
      ↓
Validate
      ↓
Serialize
      ↓
Filter
      ↓
Deduplicate
      ↓
Prioritize
      ↓
Budget
      ↓
Compress/Truncate
      ↓
Resolved Context
      ↓
Model Request
```

Each stage should be testable.

Avoid one giant function.

---

# 24. CONTEXT DEDUPLICATION

Avoid sending identical data repeatedly.

Example:

```text
Application context:
APP-1024

Page context:
APP-1024

Component context:
APP-1024
```

should not blindly triple token usage.

Define deterministic deduplication rules.

Do not remove context merely because values look vaguely similar.

Prefer identity/hash/explicit metadata over fuzzy guessing.

---

# 25. TOKEN BUDGET

Context cannot grow forever.

Support configuration conceptually like:

```ts
createContextEngine({
  maxContextTokens: 8_000
});
```

The actual budget may also be constrained by model configuration.

Do not hardcode one model's context window.

---

# 26. TOKEN ESTIMATION

Provide a token estimation abstraction.

Do not tightly couple the context package to OpenAI tokenizers.

Conceptually:

```ts
interface TokenEstimator {
  estimate(text: string): number;
}
```

Provide a lightweight default estimator if necessary.

Allow provider-specific/accurate estimators later.

Document that approximate counts are estimates.

---

# 27. BUDGET ALLOCATION

A simple strategy is sufficient.

Example:

```text
Critical context       always attempt to include
High priority          include next
Normal                 include while budget remains
Low                    include last
```

Never bypass an explicit security/sensitivity exclusion because something has high priority.

---

# 28. CONTEXT TRUNCATION

If context exceeds budget, truncate safely.

Do not generate invalid JSON.

Possible strategies:

```text
Drop low-priority item

Use configured serializer summary

Limit arrays

Limit string lengths
```

Document exactly what happens.

---

# 29. COMPRESSION FOUNDATION

Create a clean abstraction for future compression.

Example:

```ts
interface ContextCompressor {
  compress(
    context: SerializedContext,
    budget: number
  ): Promise<SerializedContext>;
}
```

Phase 4 may implement deterministic compression/truncation.

Do NOT build a complicated LLM summarization pipeline unless strictly required.

If future LLM compression is anticipated, create the boundary only.

---

# 30. CONTEXT SENSITIVITY

Introduce metadata such as:

```text
PUBLIC
INTERNAL
SENSITIVE
RESTRICTED
```

or an equivalent model.

This is metadata/foundation only.

Phase 7 owns the full security policy system.

Do not pretend sensitivity metadata alone enforces enterprise security.

---

# 31. CONTEXT ENABLE/DISABLE

Allow context registration to be conditionally enabled.

Example:

```tsx
useCopilotContext({
  name: "selectedApplication",
  value: application,
  enabled: Boolean(application)
});
```

Disabled context must not reach the model.

---

# 32. MODEL INTEGRATION

This is a mandatory Phase 4 outcome.

Resolved application context must reach the model runtime.

Expected:

```text
User Message
     +
System Instructions
     +
Resolved Application Context
     ↓
Model Request
```

Do not merely build a context registry that is never used.

---

# 33. CONTEXT PLACEMENT

Determine how application context enters model requests.

Potential approaches:

```text
structured system message
dedicated model-neutral context structure
runtime augmentation layer
```

Choose an approach compatible with the provider-neutral architecture.

Do not add OpenAI-specific behavior to the context engine.

Document the decision in an ADR if significant.

---

# 34. MODEL REQUEST DEBUG METADATA

Preserve internal metadata so developers can later inspect:

```text
Context IDs
Scopes
Priorities
Estimated tokens
Included/excluded status
Exclusion reason
```

Do not expose sensitive values unnecessarily.

This becomes the foundation for Phase 11 Context Inspector.

---

# 35. CONTEXT RESOLUTION RESULT

Consider returning something conceptually like:

```ts
interface ResolvedContext {
  items: ResolvedContextItem[];
  content: string;

  estimatedTokens: number;

  excluded: ContextExclusion[];
}
```

Useful exclusion reasons:

```text
disabled
budget
duplicate
invalid
sensitivity-policy
serialization-failure
```

Phase 4 may not implement all policy types, but design cleanly.

---

# 36. REACT useCopilotContext

Implement React integration.

Target developer experience:

```tsx
useCopilotContext({
  name: "selectedApplication",

  description:
    "The application currently selected by the user",

  scope: "component",

  value: {
    id: application.id,
    status: application.status
  }
});
```

Lifecycle:

```text
Component mount
      ↓
Register Context

Props/state change
      ↓
Update Context

Component unmount
      ↓
Remove Context
```

StrictMode must not create leaked/duplicate registrations.

---

# 37. STABLE CONTEXT IDs

Avoid context re-registration every render.

Design identity semantics carefully.

Support explicit IDs where useful.

Example:

```tsx
useCopilotContext({
  id: "selected-application",
  ...
});
```

---

# 38. REACT CONTEXT VALUE CHANGES

If the value changes:

```text
Pending
 ↓
Approved
```

the context registry should update without unnecessarily destroying/recreating unrelated state.

Test rapid changes.

---

# 39. CONTEXT OWNER

Consider associating registrations with an owner/source.

Example metadata:

```text
owner:
  component
  page
  application
```

This can help debugging and cleanup.

Do not expose React internals in the framework-independent context contract.

---

# 40. SHARED STATE FOUNDATION

Introduce framework-independent shared state primitives.

Goal:

```text
Application
    ↕
Shared Copilot State
    ↕
React SDK
```

Phase 4 shared state is NOT yet agent-controlled Generative UI state.

Phase 6 will expand this.

---

# 41. STATE MODEL

Conceptually:

```ts
interface CopilotStateDefinition<T> {
  id: string;
  name: string;

  initialValue: T;

  scope?: StateScope;
}
```

Support typed state.

Avoid `Record<string, any>` as the public architecture.

---

# 42. STATE STORE

Provide a framework-independent store.

Conceptually:

```ts
const state = createCopilotStateStore();

state.register(...);

state.get(...);

state.set(...);

state.update(...);

state.subscribe(...);
```

Requirements:

```text
Typed values
Subscriptions
Deterministic updates
Cleanup
Multiple stores
No mandatory global singleton
```

---

# 43. STATE VS CONTEXT

Document this distinction carefully.

```text
STATE

Mutable application/Copilot data.

Example:
selectedFilters
draftApplication
currentStep
```

versus:

```text
CONTEXT

Information selected/prepared for model consumption.

Example:
Current filters are:
status = pending
```

State may become context.

But not every state value must automatically be sent to the model.

This distinction is critical.

---

# 44. STATE EXPOSURE

A state registration should explicitly control whether it is exposed to the model.

Do NOT automatically expose every application state value.

Conceptually:

```ts
{
  exposeToModel: true
}
```

or use an explicit bridge between state and context.

Choose the safer architecture.

---

# 45. useCopilotState

Target API concept:

```tsx
const [filters, setFilters] = useCopilotState({
  name: "applicationFilters",

  initialValue: {
    status: "all"
  }
});
```

It should feel React-native.

But the underlying state implementation must remain framework-independent.

---

# 46. EXTERNAL STATE

Where practical allow integration with existing application state rather than forcing duplication.

Conceptually:

```tsx
useCopilotState({
  name: "filters",
  value: filters,
  onChange: setFilters
});
```

This controlled mode can coexist with internal mode if designed cleanly.

Do not require Redux/Zustand.

---

# 47. STATE PATCHES

Evaluate whether patch-based updates are useful.

Potential future Phase 6 need:

```json
{
  "op": "replace",
  "path": "/status",
  "value": "approved"
}
```

Do not introduce a heavy patch framework unless justified.

A minimal patch abstraction may be established if it clearly supports future shared state.

---

# 48. IMMUTABILITY

State updates should not encourage uncontrolled mutation.

Prefer:

```ts
setState(previous => ({
  ...previous,
  status: "approved"
}));
```

or equivalent.

Document behavior.

---

# 49. STATE VALIDATION

Allow optional runtime validation.

Example:

```ts
schema: z.object({
  status: z.string()
})
```

Do not force Zod types into every public generic if a cleaner abstraction exists, but align with project conventions.

Invalid state updates should fail predictably.

---

# 50. STATE SUBSCRIPTIONS

Components should be able to subscribe narrowly.

Avoid rerendering all Copilot consumers whenever one state item changes.

Performance matters because Phase 6 may add highly interactive state.

---

# 51. CONTEXT FROM STATE

Provide a deliberate pattern for exposing state to AI.

For example conceptually:

```tsx
useCopilotState({
  name: "filters",
  value: filters,
  exposeToModel: {
    description: "Current application filters",
    priority: "normal"
  }
});
```

or require:

```tsx
useCopilotContext({
  name: "filters",
  value: filters
});
```

Choose one architecture and document why.

Prefer explicitness and security.

---

# 52. APPLICATION-AWARE CHAT EXAMPLE

Create an example such as:

```text
examples/react-context/
```

Example application:

```text
Applications Page

┌──────────────────────────────────────┐
│ Applications                         │
│                                      │
│ Status: [Pending ▼]                  │
│                                      │
│ APP-1001   Ahmed      Pending        │
│ APP-1002   Sara       Pending        │
│ APP-1003   Omar       Pending        │
└──────────────────────────────────────┘

                              [AI]
```

Register:

```text
Current page
Current filters
Selected application
Current user role
```

Then demonstrate:

```text
User:
"What application am I looking at?"

AI:
"You currently have APP-1002 selected."
```

No tools.

The AI only understands provided context.

---

# 53. CONTEXT CHANGE EXAMPLE

Demonstrate:

```text
Select APP-1001

Ask:
"What is selected?"

→ APP-1001

Select APP-1003

Ask:
"What is selected?"

→ APP-1003
```

This proves context updates dynamically.

---

# 54. PAGE CONTEXT EXAMPLE

Navigate conceptually:

```text
/applications
```

to:

```text
/applications/APP-1003
```

Context should change appropriately.

Do not implement a router integration package unless needed.

Example application can register route/page data manually.

---

# 55. STATE EXAMPLE

Demonstrate:

```tsx
const [filters, setFilters] = useCopilotState(...);
```

Change:

```text
All
→ Pending
→ Approved
```

Verify subscribed components update.

If state is explicitly exposed as context, verify the model receives the new value.

---

# 56. CONTEXT SIZE EXAMPLE

Create a deterministic test/example with intentionally large context.

Verify:

```text
priority
budget
exclusion
truncation
```

Example:

```text
Critical       included
High           included
Normal         partially included / included
Low            excluded because of budget
```

Do not rely on a live model for this test.

---

# 57. CONTEXT DEBUG OUTPUT

Provide development-accessible data through an API, not necessarily a UI.

Conceptually:

```ts
const debug = contextEngine.inspect();
```

Potential output:

```json
{
  "estimatedTokens": 1300,
  "included": [
    {
      "name": "selectedApplication",
      "scope": "component",
      "priority": "high",
      "estimatedTokens": 120
    }
  ],
  "excluded": [
    {
      "name": "largeDataset",
      "reason": "budget"
    }
  ]
}
```

This is the foundation for Phase 11 DevTools.

Do NOT build the DevTools panel now.

---

# 58. PRIVACY / SECURITY BASELINE

Context is untrusted application data.

Treat it carefully.

Do not allow context values to override actual system security policy.

Never use context such as:

```text
userRole: admin
```

as authoritative authorization.

Context tells the model something.

It does NOT grant permissions.

Phase 7 will establish authorization.

This distinction must be documented.

---

# 59. PROMPT INJECTION CONSIDERATION

Application context may contain text such as:

```text
Ignore previous instructions...
```

Do not assume application context is trusted just because it came from the application.

Keep:

```text
System Instructions
Application Context
User Input
```

logically separated where possible.

Document the trust boundary.

Do not attempt to solve all prompt injection problems in Phase 4.

---

# 60. SERIALIZATION SECURITY

Prevent accidental serialization of:

```text
functions
DOM nodes
framework internals
access tokens
authorization headers
passwords
secrets
```

Sensitive data is primarily the application's responsibility in Phase 4, but provide metadata/hooks that Phase 7 can enforce.

---

# 61. CONTEXT ERROR ISOLATION

One broken context item should not necessarily destroy the entire Copilot request.

Example:

```text
10 context items

1 serialization failure
```

Depending on severity/configuration:

```text
exclude broken item
record diagnostic
continue
```

or fail if the item is marked critical.

Define behavior.

---

# 62. OBSERVABILITY FOUNDATION

Record lightweight context metrics:

```text
items registered
items included
items excluded
estimated tokens
serialization duration
resolution duration
```

Do not build the Phase 11 observability platform.

Use existing logging/telemetry abstractions.

---

# 63. PUBLIC API DESIGN

Potential `@aicopilot/context` exports:

```ts
createContextRegistry
createContextEngine
createCopilotStateStore

ContextScope
ContextItem
ResolvedContext
ContextPriority
ContextSensitivity
ContextSerializer
ContextCompressor
TokenEstimator
```

Potential `@aicopilot/react` additions:

```ts
useCopilotContext
useCopilotState
```

Only export stable APIs.

Keep internal resolution implementation private.

---

# 64. BACKWARD COMPATIBILITY

Phase 3 code such as:

```tsx
<CopilotProvider>
  <CopilotPopup />
</CopilotProvider>
```

must continue to work without application context.

Context must be optional.

No existing application should suddenly be required to register context.

---

# 65. MULTIPLE COPILOT PROVIDERS

If the architecture allows multiple `CopilotProvider` instances, their contexts/states must remain isolated unless intentionally shared.

Test:

```text
Provider A
  context A

Provider B
  context B
```

A must not see B automatically.

---

# 66. SSR SAFETY

`@aicopilot/context` must be SSR-safe.

Do not depend on:

```text
window
document
localStorage
```

React hooks should follow Phase 3 SSR conventions.

---

# 67. PERFORMANCE

Avoid:

```text
rebuilding every context item on every token
```

Context resolution should occur at appropriate request boundaries.

State changes should not cause unnecessary chat-tree rerenders.

Measure/inspect relevant hot paths.

---

# 68. UNIT TESTS — CONTEXT REGISTRY

Test:

```text
register
update
remove
dispose
subscriptions
scope filtering
duplicate handling
multiple registries
cleanup
```

---

# 69. UNIT TESTS — SERIALIZATION

Test:

```text
primitive values
objects
arrays
dates
nested data
undefined
functions
circular references
large strings
large arrays
invalid data
```

Verify safe deterministic behavior.

---

# 70. UNIT TESTS — CONTEXT ENGINE

Test:

```text
collection
validation
scope
priority
deduplication
budget
truncation
exclusion
token estimation
diagnostics
```

---

# 71. UNIT TESTS — STATE STORE

Test:

```text
register
get
set
functional update
subscribe
unsubscribe
validation
cleanup
multiple stores
```

---

# 72. REACT TESTS

Test:

```text
useCopilotContext registration
updates
unmount cleanup
StrictMode
disabled context
multiple context items
provider isolation

useCopilotState
controlled state
uncontrolled state
subscriptions
validation
cleanup
```

---

# 73. MODEL INTEGRATION TEST

Mandatory:

```text
React Component
      ↓
useCopilotContext
      ↓
Context Registry
      ↓
Context Engine
      ↓
Server/Core
      ↓
Model Request
      ↓
Mock Provider
```

Verify the mock provider receives the resolved context in the intended model-neutral format.

---

# 74. END-TO-END TEST

Mandatory flow:

```text
Open React example

Select APP-1002

Ask:
"What application is selected?"

Context:
APP-1002

Mock model:
returns APP-1002

Change selection:
APP-1003

Ask again

Model receives:
APP-1003
```

Do not hardcode the UI response independently of model input just to make the test pass.

---

# 75. BUDGET INTEGRATION TEST

Register more context than the configured budget.

Verify:

```text
High priority context included

Low priority context excluded

Diagnostic explains:
budget
```

Ensure generated model request respects the configured context budget as closely as the estimator allows.

---

# 76. REGRESSION TESTING

Run all Phase 1–3 tests.

Phase 4 must not break:

```text
protocol
client
server
providers
streaming
React chat
UI
stop
retry
regenerate
```

---

# 77. DOCUMENTATION

Populate:

```text
docs/phases/phase-04/
```

Required:

```text
Phase_4_Docs.md
Phase_4_Architecture.md
Phase_4_Implementation.md
Phase_4_Status.md
Phase_4_Testing.md
Phase_4_Decisions.md
Phase_4_API.md
Phase_4_Files.md
Phase_4_Issues.md
Phase_4_Handoff.md
```

Do not leave placeholders when Phase 4 is complete.

---

# 78. PHASE 4 ARCHITECTURE DOCUMENT

`Phase_4_Architecture.md` must explain:

```text
Context Registry
Context Engine
Context Resolver
Serializer
Priority
Budget
Token Estimator
Compression boundary
State Store
React integration
Model integration
```

Include diagrams.

---

# 79. CONTEXT FLOW DOCUMENTATION

Include:

```text
React Component
      ↓
useCopilotContext
      ↓
Context Registry
      ↓
Context Resolver
      ↓
Serializer
      ↓
Priority
      ↓
Budget
      ↓
Resolved Context
      ↓
Model Runtime
      ↓
Provider
```

---

# 80. STATE FLOW DOCUMENTATION

Include:

```text
Application
    ↓
useCopilotState
    ↓
State Store
    ↓
Subscription
    ↓
Application

optional explicit exposure

State
 ↓
Context
 ↓
Model
```

---

# 81. API DOCUMENTATION

`Phase_4_API.md` must document public APIs including:

```text
useCopilotContext
useCopilotState

ContextScope
ContextPriority
ContextSensitivity

Context Registry APIs

Context Engine APIs

State Store APIs
```

Include usage examples.

---

# 82. DECISIONS / ADRs

Potential ADRs:

```text
Context package boundary

Context scope model

Context identity/lifecycle

Context serialization format

Context token budgeting strategy

State vs Context separation

State exposure policy

Model context injection strategy
```

Only create ADRs for meaningful architectural decisions.

Update:

```text
docs/DECISIONS.md
```

---

# 83. PROJECT STATUS

At completion:

```text
Phase 01    COMPLETE
Phase 02    COMPLETE
Phase 03    COMPLETE
Phase 04    COMPLETE

Phase 05
Tools & Agent Actions

NOT STARTED
LOCKED
```

Only mark Phase 4 COMPLETE after acceptance criteria pass.

---

# 84. CHANGELOG

Update:

```text
docs/CHANGELOG_PHASES.md
```

Record:

```text
Context Engine
Context Registry
Context scopes
Token budgeting
Shared state foundation
React context hooks
React state hooks
Model integration
```

based on actual implementation.

---

# 85. TECHNICAL DEBT

Update:

```text
docs/TECHNICAL_DEBT.md
```

only when real debt exists.

Do not classify these planned future features as debt:

```text
Tools
RAG
Agents
Security Firewall
```

They belong to future phases.

---

# 86. GIT COMMIT PLAN

Recommended boundaries:

```text
feat(context): add context domain contracts

feat(context): add context registry

feat(context): add context serialization

feat(context): add priority and token budgeting

feat(context): add context resolution engine

feat(state): add framework-independent copilot state store

feat(react): add useCopilotContext

feat(react): add useCopilotState

feat(runtime): inject resolved application context into model requests

test(context): cover registry resolution and budgeting

test(react): cover context and state hooks

test(integration): verify application-aware model requests

docs(phase-04): document context and state architecture
```

Adjust to actual repository architecture.

Do not create fake commits.

---

# 87. IMPLEMENTATION ORDER

Follow this order unless repository evidence requires a documented adjustment:

```text
STEP 01
Read skills

STEP 02
Read Phase 1–3 documentation

STEP 03
Read roadmap checkpoint

STEP 04
Verify previous phases

STEP 05
Inspect repository

STEP 06
Mark Phase 4 IN PROGRESS

STEP 07
Design context package boundary

STEP 08
Define context contracts

STEP 09
Define scopes

STEP 10
Define priority

STEP 11
Define sensitivity metadata

STEP 12
Implement Context Registry

STEP 13
Implement registration lifecycle

STEP 14
Implement subscriptions

STEP 15
Implement serialization

STEP 16
Implement validation

STEP 17
Implement deterministic deduplication

STEP 18
Implement TokenEstimator abstraction

STEP 19
Implement context budgeting

STEP 20
Implement safe truncation

STEP 21
Create compression abstraction

STEP 22
Implement Context Resolver

STEP 23
Implement Context Engine

STEP 24
Implement diagnostics/inspection data

STEP 25
Write context tests

STEP 26
Design shared state architecture

STEP 27
Implement state contracts

STEP 28
Implement state store

STEP 29
Implement subscriptions

STEP 30
Implement optional validation

STEP 31
Define explicit state/context relationship

STEP 32
Write state tests

STEP 33
Integrate context with CopilotProvider

STEP 34
Implement useCopilotContext

STEP 35
Implement useCopilotState

STEP 36
Test React lifecycle/StrictMode

STEP 37
Integrate resolved context with model execution

STEP 38
Test model integration

STEP 39
Create react-context example

STEP 40
Create dynamic context example

STEP 41
Create context-budget example/test

STEP 42
Write integration tests

STEP 43
Write E2E test

STEP 44
Review security/trust boundaries

STEP 45
Review performance

STEP 46
Review public APIs

STEP 47
Review dependency boundaries

STEP 48
Update Phase 4 documentation

STEP 49
Update global documentation

STEP 50
Run complete regression suite

STEP 51
Self-review

STEP 52
Produce completion report

STEP 53
STOP
```

---

# 88. REQUIRED DEVELOPER EXPERIENCE

At completion, something conceptually equivalent to this must work:

```tsx
function ApplicationDetails({
  application
}: {
  application: Application;
}) {
  useCopilotContext({
    id: "selected-application",
    name: "selectedApplication",
    description:
      "Application currently being viewed by the user",
    scope: "page",
    priority: "high",

    value: {
      id: application.id,
      status: application.status,
      applicantName: application.applicantName
    }
  });

  return <ApplicationView application={application} />;
}
```

Then:

```text
User:
"What application am I looking at?"

Copilot:
"You are currently viewing application APP-1024,
which is pending."
```

The response must come through the normal model/runtime pipeline.

---

# 89. REQUIRED STATE EXPERIENCE

Something conceptually equivalent to:

```tsx
const [filters, setFilters] = useCopilotState({
  id: "application-filters",

  initialValue: {
    status: "all",
    country: null
  }
});
```

must work.

The underlying state must not require React.

---

# 90. REQUIRED CONTEXT INSPECTION FOUNDATION

Something conceptually equivalent to:

```ts
contextEngine.inspect();
```

should make it possible to determine:

```text
REGISTERED CONTEXT

selectedApplication
scope: page
priority: high
tokens: 82
included: YES

applicationFilters
scope: page
priority: normal
tokens: 34
included: YES

largeDataset
scope: component
priority: low
tokens: 7,820
included: NO
reason: CONTEXT_BUDGET
```

Do not build the visual inspector yet.

Phase 11 owns that UI.

---

# 91. PHASE 4 ACCEPTANCE CRITERIA

Phase 4 is COMPLETE only when:

## Architecture

* [ ] Context implementation is framework-independent.
* [ ] React integration is an adapter over framework-independent context.
* [ ] Context does not depend on provider SDKs.
* [ ] State implementation is framework-independent.
* [ ] Context and state are separate concepts.
* [ ] Existing Phase 1–3 architecture remains valid.

## Context

* [ ] Context Registry exists.
* [ ] Context registration works.
* [ ] Context updates work.
* [ ] Context removal works.
* [ ] Context lifecycle works.
* [ ] Context scopes exist.
* [ ] Context priority exists.
* [ ] Serialization exists.
* [ ] Deduplication exists.
* [ ] Token estimation exists.
* [ ] Budget enforcement exists.
* [ ] Safe truncation exists.
* [ ] Diagnostics exist.
* [ ] Sensitivity metadata exists.

## State

* [ ] Shared state store exists.
* [ ] Typed state works.
* [ ] subscriptions work.
* [ ] updates work.
* [ ] cleanup works.
* [ ] optional validation works if designed.
* [ ] state is not automatically exposed to model without explicit behavior.

## React

* [ ] `useCopilotContext` works.
* [ ] context updates with React state.
* [ ] unmount removes context.
* [ ] StrictMode does not leak registrations.
* [ ] `useCopilotState` works.
* [ ] controlled/uncontrolled behavior works if supported.
* [ ] multiple providers remain isolated.

## Model Integration

* [ ] Resolved context reaches model requests.
* [ ] provider-neutral architecture remains intact.
* [ ] model receives updated context.
* [ ] context is not merely stored locally.
* [ ] context debugging metadata exists.

## Performance

* [ ] Context is not rebuilt per streamed token.
* [ ] State subscriptions are reasonably scoped.
* [ ] no obvious registration leaks exist.

## Security

* [ ] Context is not treated as authorization.
* [ ] unsafe objects are not blindly serialized.
* [ ] model context remains untrusted data.
* [ ] secrets are not intentionally exposed.
* [ ] trust boundaries are documented.

## Testing

* [ ] registry tests pass.
* [ ] serialization tests pass.
* [ ] context engine tests pass.
* [ ] budget tests pass.
* [ ] state tests pass.
* [ ] React hook tests pass.
* [ ] integration test passes.
* [ ] E2E context test passes where configured.
* [ ] Phase 1–3 regression tests pass.

## Documentation

* [ ] Phase_4_Docs updated.
* [ ] Phase_4_Architecture updated.
* [ ] Phase_4_Implementation updated.
* [ ] Phase_4_Status updated.
* [ ] Phase_4_Testing updated.
* [ ] Phase_4_Decisions updated.
* [ ] Phase_4_API updated.
* [ ] Phase_4_Files updated.
* [ ] Phase_4_Issues updated.
* [ ] Phase_4_Handoff updated.
* [ ] PROJECT_STATUS updated.
* [ ] CHANGELOG_PHASES updated.
* [ ] DECISIONS updated.
* [ ] TECHNICAL_DEBT updated if applicable.

## Phase Gate

* [ ] No native tool execution.
* [ ] No frontend tools.
* [ ] No backend tools.
* [ ] No automatic OpenAPI tools.
* [ ] No MCP.
* [ ] No Generative UI.
* [ ] No Action Firewall.
* [ ] No RAG.
* [ ] No agents.
* [ ] No Phase 5+ implementation.

---

# 92. VALIDATION

Run repository equivalents of:

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

Context unit tests
State unit tests
React context tests
Context integration tests
Context budget tests
E2E context test
```

Run the React context example.

Verify manually or via E2E:

```text
Context registration

Context update

Context removal

Selected entity changes

Model receives new context

Token budget works

State updates work

No context leak after unmount
```

Record exact results in:

```text
docs/phases/phase-04/Phase_4_Testing.md
```

Never claim PASS for something not actually run.

---

# 93. SELF-REVIEW

Before completion ask:

## Architecture

Did React leak into `@aicopilot/context`?

Did provider-specific code leak into context?

Did we create tools early?

## Context

Can arbitrary unserializable objects crash everything?

Can context registration leak?

Can duplicate registrations occur?

Can context grow without bounds?

Does budget enforcement actually work?

## State

Are state and context accidentally the same thing?

Is every state value being sent to the model automatically?

If yes, fix it.

## React

Does StrictMode duplicate context?

Does changing a context value create unnecessary registrations?

Does unmount clean up?

## Security

Are roles/context mistakenly being treated as authorization?

Could secrets accidentally be included?

Is model-generated/context text treated as trusted?

## Performance

Is context recomputed for every streamed token?

Do state updates rerender the entire application?

## Compatibility

Does normal Phase 3 chat still work without context?

## Phase Gate

Did we accidentally implement:

```text
defineTool
useFrontendTool
OpenAPI tool generation
Generative UI
MCP
```

If yes, remove/defer those changes.

---

# 94. COMPLETION REPORT

Produce:

```text
AI COPILOT SDK
PHASE 04 — APPLICATION CONTEXT & STATE


STATUS

COMPLETE / INCOMPLETE


PREVIOUS PHASE REGRESSION

Phase 1:
PASS / FAIL

Phase 2:
PASS / FAIL

Phase 3:
PASS / FAIL


IMPLEMENTED

Context Package:
- ...

Context Contracts:
- ...

Context Scopes:
- ...

Context Registry:
- ...

Context Lifecycle:
- ...

Serialization:
- ...

Priority:
- ...

Deduplication:
- ...

Token Estimation:
- ...

Token Budget:
- ...

Truncation:
- ...

Compression Foundation:
- ...

Sensitivity Metadata:
- ...

Diagnostics:
- ...

State Store:
- ...

State Validation:
- ...

State Subscriptions:
- ...

useCopilotContext:
- ...

useCopilotState:
- ...

Model Integration:
- ...

Examples:
- ...


PUBLIC APIs

@aicopilot/context:
- ...

@aicopilot/react:
- ...


CONTEXT PIPELINE

Registry:
PASS / FAIL

Serialization:
PASS / FAIL

Priority:
PASS / FAIL

Deduplication:
PASS / FAIL

Budget:
PASS / FAIL

Diagnostics:
PASS / FAIL

Model Injection:
PASS / FAIL


STATE PIPELINE

Registration:
PASS / FAIL

Updates:
PASS / FAIL

Subscriptions:
PASS / FAIL

Validation:
PASS / FAIL

React Integration:
PASS / FAIL


TEST RESULTS

Lint:
PASS / FAIL / NOT RUN

Typecheck:
PASS / FAIL / NOT RUN

Unit Tests:
PASS / FAIL / NOT RUN

Context Tests:
PASS / FAIL / NOT RUN

State Tests:
PASS / FAIL / NOT RUN

React Tests:
PASS / FAIL / NOT RUN

Integration Tests:
PASS / FAIL / NOT RUN

E2E:
PASS / FAIL / NOT RUN

Build:
PASS / FAIL / NOT RUN


SECURITY VALIDATION

Context not used as authorization:
PASS / FAIL

Unsafe serialization prevented:
PASS / FAIL

Sensitivity metadata:
PASS / FAIL

Trust boundaries documented:
PASS / FAIL


ARCHITECTURE VALIDATION

Framework-independent context:
PASS / FAIL

Framework-independent state:
PASS / FAIL

React adapter separation:
PASS / FAIL

Provider independence:
PASS / FAIL

State/context separation:
PASS / FAIL

Backward compatibility:
PASS / FAIL

No Phase 5+ implementation:
PASS / FAIL


DEPENDENCIES ADDED

- dependency:
  package:
  reason:


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

Phase_4_Docs:
PASS / FAIL

Phase_4_Architecture:
PASS / FAIL

Phase_4_Implementation:
PASS / FAIL

Phase_4_Status:
PASS / FAIL

Phase_4_Testing:
PASS / FAIL

Phase_4_Decisions:
PASS / FAIL

Phase_4_API:
PASS / FAIL

Phase_4_Files:
PASS / FAIL

Phase_4_Issues:
PASS / FAIL

Phase_4_Handoff:
PASS / FAIL


REMAINING PHASE 4 WORK

None

or

- ...


NEXT PHASE

Phase 05 — Tools & Agent Actions

Planned major capabilities:

- ToolDefinition
- Tool Registry
- Backend Tools
- Frontend Tools
- useFrontendTool
- defineTool
- Typed Tool Inputs
- Typed Tool Outputs
- Tool Validation
- Tool Execution
- Tool Streaming Events
- Tool Errors
- Tool Cancellation
- Parallel Tool Calls
- Tool Metadata
- Structured Outputs

STATUS

LOCKED / NOT STARTED

Waiting for explicit user instruction.
```

---

# 95. FINAL STOP RULE

After Phase 4 is implemented, tested, documented and reviewed:

STOP.

Do NOT start:

```text
PHASE 05 — TOOLS & AGENT ACTIONS
```

Specifically, do not implement:

```ts
defineTool()
useFrontendTool()
```

Do not implement:

```text
Tool Registry
Tool Execution
Tool Calling
Automatic Tool Generation
OpenAPI Tools
MCP Tools
```

Phase 5 will establish the canonical tool architecture.

Phase 8 will later use that architecture for:

```text
OpenAPI
   ↓
Automatic Tool Creation
   ↓
Canonical Tool Registry
   ↓
Security Pipeline
```

Wait for explicit user authorization.
