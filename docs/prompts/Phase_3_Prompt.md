# AI Copilot SDK — Phase 3: React Copilot UI

Implement **Phase 3 only** of the AI Copilot SDK.

Current phase:

```text
PHASE 03 — REACT COPILOT UI
```

The objective is to build a production-quality React SDK and reusable Copilot UI on top of the framework-independent client/runtime created in Phases 1–2.

Target developer experience:

```tsx
<CopilotProvider runtimeUrl="/api/copilot">
  <App />
  <CopilotPopup />
</CopilotProvider>
```

and:

```tsx
const {
  messages,
  sendMessage,
  stop,
  regenerate,
  status
} = useCopilotChat();
```

The React layer must NOT reimplement the protocol, client transport, model runtime, or provider logic.

Do NOT start Phase 4.

---

# 0. Phase Gate

Phase 3 includes:

* React SDK package
* UI component package
* Copilot provider
* React hooks
* headless chat state
* message rendering
* streaming UI
* chat input
* stop generation
* regenerate
* retry
* error states
* loading states
* suggestions
* popup
* sidebar
* full chat
* Markdown rendering
* code blocks
* attachments UI shell if justified
* theming
* light/dark modes
* responsive design
* accessibility
* RTL
* component customization
* React example applications
* React integration testing
* Phase 3 documentation

Phase 3 does NOT include:

* application-aware context engine
* `useCopilotContext`
* `useCopilotState`
* application state synchronization
* frontend tools
* backend tools
* tool calling
* Generative UI
* shared agent/UI state
* HITL
* approvals
* Action Firewall
* OpenAPI tools
* MCP
* RAG
* persistent memory
* agents
* multi-agent workflows
* DevTools platform
* Angular SDK implementation
* management platform

Do not implement Phase 4+ features.

---

# 1. Read Skills

Before implementation read:

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
accessibility
performance
testing
documentation
git-workflow
code-review
dependency-policy
backward-compatibility
phase-gate
```

Also consult security guidance for rendering model-generated content safely.

---

# 2. Read Previous Phase Documentation

Read Phase 1 documentation:

```text
docs/phases/phase-01/
```

Read all Phase 2 documentation:

```text
docs/phases/phase-02/Phase_2_Docs.md
docs/phases/phase-02/Phase_2_Architecture.md
docs/phases/phase-02/Phase_2_Implementation.md
docs/phases/phase-02/Phase_2_Status.md
docs/phases/phase-02/Phase_2_Testing.md
docs/phases/phase-02/Phase_2_Decisions.md
docs/phases/phase-02/Phase_2_API.md
docs/phases/phase-02/Phase_2_Files.md
docs/phases/phase-02/Phase_2_Issues.md
docs/phases/phase-02/Phase_2_Handoff.md
```

Also read:

```text
docs/PROJECT_STATUS.md
docs/ARCHITECTURE_OVERVIEW.md
docs/ROADMAP.md
docs/DECISIONS.md
docs/TECHNICAL_DEBT.md
```

Repository reality is the source of truth.

---

# 3. Verify Phases 1–2

Before modifying code run the repository equivalents of:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Verify:

```text
Protocol               ✓
Core                   ✓
Client                  ✓
Server                  ✓
Model Runtime           ✓
Provider Registry       ✓
Mock Provider           ✓
Real Provider Adapter   ✓
SSE Streaming           ✓
Cancellation            ✓
Timeout                 ✓
Retry                   ✓
Integration Tests       ✓
```

If a blocking regression exists:

STOP.

Document the problem rather than building Phase 3 on a broken foundation.

---

# 4. Phase 3 Goal

Existing architecture:

```text
LLM
 ↓
Provider Adapter
 ↓
Model Runtime
 ↓
Core
 ↓
Protocol
 ↓
Server / SSE
 ↓
Client
```

Phase 3 adds:

```text
LLM
 ↓
Provider Adapter
 ↓
Runtime
 ↓
Protocol
 ↓
Client
 ↓
React SDK
 ↓
Headless Chat State
 ↓
UI Components
 ↓
User
```

The UI must remain replaceable.

A developer must be able to use:

```text
@aicopilot/react
```

without:

```text
@aicopilot/ui
```

if they want to build their own interface.

This is a critical requirement.

---

# 5. Create Packages

Create:

```text
packages/
├── react/
└── ui/
```

Package names:

```text
@aicopilot/react
@aicopilot/ui
```

Use the actual npm scope already established by the repository if different.

---

# 6. Package Responsibilities

## @aicopilot/react

Responsible for:

```text
React Provider
React Context
Hooks
Chat State
Streaming State
Thread State
Message State
Runtime Connection
Lifecycle
Actions
```

It should NOT contain opinionated visual styling.

---

## @aicopilot/ui

Responsible for:

```text
Chat
Popup
Sidebar
Messages
Input
Buttons
Suggestions
Loading UI
Error UI
Markdown
Code rendering
Themes
Responsive layout
Accessibility
```

It consumes:

```text
@aicopilot/react
```

Correct:

```text
UI
 ↓
React SDK
 ↓
Client
 ↓
Protocol
```

Forbidden:

```text
UI
 ↓
OpenAI
```

or:

```text
React SDK
 ↓
Fastify internals
```

---

# 7. Dependency Direction

Target:

```text
@aicopilot/protocol
        ↑
        │
@aicopilot/client
        ↑
        │
@aicopilot/react
        ↑
        │
 @aicopilot/ui
```

React SDK may consume public client/protocol APIs.

UI may consume React SDK.

Neither may depend on:

```text
provider-openai
server implementation
Fastify
model provider SDKs
```

---

# 8. React Version

Use the repository-compatible modern React version.

Prefer React 19 when compatible with the established workspace.

Do not upgrade unrelated dependencies solely to force a particular version.

Document the supported React peer dependency range.

React should normally be a peer dependency for publishable React packages.

---

# 9. CopilotProvider

Create the primary provider.

Conceptual API:

```tsx
<CopilotProvider
  runtimeUrl="/api/copilot"
>
  <App />
</CopilotProvider>
```

Also support dependency injection of an existing client where appropriate:

```tsx
<CopilotProvider client={client}>
  <App />
</CopilotProvider>
```

Do not force applications to use a global singleton.

---

# 10. Provider Responsibilities

`CopilotProvider` should own/wire:

```text
Copilot Client
Chat Sessions
Streaming lifecycle
Cancellation
Error handling
Configuration
```

Do NOT turn the provider into a giant state container for future features.

Phase 4 context/state functionality belongs later.

---

# 11. Headless API

The React SDK must expose useful headless APIs.

Primary hook:

```ts
useCopilotChat()
```

Potential result:

```ts
{
  messages,
  status,
  error,

  sendMessage,
  stop,
  regenerate,
  retry,
  clear
}
```

Exact naming should follow existing SDK conventions.

Prioritize API clarity and long-term stability.

---

# 12. Chat Status

Define explicit status rather than multiple conflicting booleans.

Consider:

```text
idle
submitting
streaming
completed
error
```

or a similar minimal state model.

Do not blindly copy another SDK.

Document state transitions.

---

# 13. React Chat State Machine

Conceptually:

```text
IDLE
 ↓
SUBMITTING
 ↓
STREAMING
 ├────→ IDLE
 ├────→ ERROR
 └────→ STOPPED
```

Determine whether `STOPPED` should be externally observable or represented as idle + completion metadata.

Avoid impossible combinations such as:

```text
isLoading = false
isStreaming = true
status = error
```

Use one canonical state.

---

# 14. Message Model

Reuse protocol/client message contracts wherever appropriate.

Do not create a completely separate incompatible React message model.

React-specific presentation state may wrap protocol messages when needed.

Distinguish:

```text
Protocol Message
       vs
UI Presentation State
```

---

# 15. Streaming State

Streaming must update the active assistant message incrementally.

Expected:

```text
message.started
      ↓
Create assistant message
      ↓
message.delta
      ↓
Append content
      ↓
message.delta
      ↓
Append content
      ↓
message.completed
      ↓
Finalize message
```

Do not create one React message per token.

Update the existing streaming message.

---

# 16. React Rendering Performance

Streaming can produce many updates.

Design carefully.

Avoid:

```text
entire application rerenders
for every token
```

Consider:

* narrow contexts
* selectors where appropriate
* memoization
* external store pattern if justified
* batching
* chunk aggregation

Do not introduce Redux as a required public dependency.

If an internal state library is considered, justify it against a small custom store or React primitives.

The public API must not expose the internal state library.

---

# 17. StrictMode

Test under React StrictMode.

Avoid:

* duplicate network requests
* duplicate event subscriptions
* leaked listeners
* duplicated assistant messages
* duplicated abort controllers

Effects must clean up correctly.

---

# 18. useCopilot

Provide a general SDK access hook if architecturally useful:

```ts
const copilot = useCopilot();
```

Potential responsibilities:

```text
client
configuration
runtime status
```

Do not expose unnecessary internals.

---

# 19. useCopilotChat

This is the main headless chat hook.

Example:

```tsx
const {
  messages,
  status,
  sendMessage,
  stop,
  regenerate,
  error
} = useCopilotChat();
```

Requirements:

* fully typed
* stable actions where practical
* cancellation-safe
* stream-safe
* useful without UI package

---

# 20. useMessages

If useful, provide:

```ts
useMessages()
```

for components that only need messages.

Avoid forcing components to subscribe to the entire chat state.

---

# 21. useThread

Provide thread access if Phase 1–2 thread contracts support it:

```ts
useThread()
```

Do not implement persistent conversation storage yet.

Phase 9 owns persistent memory.

---

# 22. Sending Messages

Expected flow:

```text
User submits
    ↓
Optimistic user message
    ↓
Client.run()
    ↓
Run begins
    ↓
Assistant message starts
    ↓
Streaming deltas
    ↓
Assistant message completes
```

Handle send failures cleanly.

Do not lose the user's submitted text on recoverable errors.

---

# 23. Stop Generation

Implement:

```ts
stop()
```

UI:

```text
[■ Stop]
```

Expected:

```text
React
 ↓
Client cancel
 ↓
Server
 ↓
Core
 ↓
Model runtime
 ↓
Provider cancellation
```

Do not implement a fake client-side-only stop.

---

# 24. Regenerate

Implement:

```ts
regenerate()
```

Expected behavior should be clearly defined.

Typically:

```text
Last relevant user message
      ↓
Start new model run
      ↓
Replace or supersede previous assistant response
```

Choose explicit semantics.

Document them.

Do not silently mutate conversation history in surprising ways.

---

# 25. Retry

Differentiate:

```text
Retry failed transport/run
```

from:

```text
Regenerate completed answer
```

These are different user actions.

Document the difference.

---

# 26. Clear Chat

Implement local clear/reset where appropriate:

```ts
clear()
```

Do not imply this deletes server-side persistent memory because persistent memory does not exist yet.

---

# 27. UI Component Architecture

Build reusable components.

Recommended:

```text
CopilotChat
CopilotPopup
CopilotSidebar

ChatHeader
MessageList
UserMessage
AssistantMessage
SystemMessage if needed
ChatInput
SendButton
StopButton
RetryButton
RegenerateButton
Suggestions
TypingIndicator
ErrorMessage
EmptyState
```

Keep components composable.

---

# 28. CopilotChat

Create full embedded chat:

```tsx
<CopilotChat />
```

Expected layout:

```text
┌──────────────────────────────┐
│ AI Copilot                   │
├──────────────────────────────┤
│                              │
│ User message                 │
│                              │
│ Assistant response...        │
│                              │
│                              │
├──────────────────────────────┤
│ Ask anything...       [Send] │
└──────────────────────────────┘
```

It should work with sensible defaults.

---

# 29. CopilotPopup

Create:

```tsx
<CopilotPopup />
```

Expected:

```text
                         ┌────────────────────┐
                         │ AI Copilot         │
                         ├────────────────────┤
                         │                    │
                         │ Conversation       │
                         │                    │
                         ├────────────────────┤
                         │ Ask...      [Send] │
                         └────────────────────┘
                                  ▲
                                  │
                                [AI]
```

Requirements:

* open/close
* keyboard accessible
* mobile responsive
* focus management
* configurable placement where practical

---

# 30. CopilotSidebar

Create:

```tsx
<CopilotSidebar />
```

Support a layout appropriate for application copilots.

Example:

```text
┌─────────────────────────────┬───────────────────┐
│                             │ AI Copilot        │
│                             │                   │
│ Application                 │ Conversation      │
│                             │                   │
│                             │                   │
│                             │ Ask...            │
└─────────────────────────────┴───────────────────┘
```

Do not build application context integration yet.

---

# 31. Controlled Components

Where useful support controlled APIs.

For example:

```tsx
<CopilotPopup
  open={open}
  onOpenChange={setOpen}
/>
```

Also allow convenient uncontrolled defaults.

Follow standard React conventions.

---

# 32. Component Customization

Consumers should be able to customize major UI areas.

Potential patterns:

```tsx
<CopilotChat
  components={{
    AssistantMessage: CustomAssistantMessage
  }}
/>
```

or slots/render props.

Choose a consistent API.

Avoid dozens of one-off customization props.

---

# 33. Styling Strategy

Keep styling isolated from the React logic package.

Preferred:

```text
@aicopilot/react
    logic

@aicopilot/ui
    styling + components
```

Use the project's selected styling strategy.

Tailwind may be used for development/building UI if consistent with the architecture, but do not require the consumer application to install/configure Tailwind merely to use the package unless deliberately chosen and documented.

For a reusable library, consider compiled CSS/CSS variables.

---

# 34. Design Tokens

Use CSS custom properties for public theming.

Conceptually:

```css
--copilot-background
--copilot-foreground
--copilot-muted
--copilot-border
--copilot-primary
--copilot-radius
--copilot-font-family
```

Use semantic names.

Do not expose implementation-specific class names as the primary theme API.

---

# 35. Light and Dark Modes

Support:

```text
light
dark
system
```

or equivalent.

Allow host application override.

Do not assume the host application's theme implementation.

---

# 36. Markdown

Assistant responses should support safe Markdown.

Support common elements:

```text
paragraphs
headings
lists
links
tables
blockquote
inline code
code blocks
```

Sanitize appropriately.

Never execute arbitrary HTML/JavaScript from model output.

---

# 37. Code Blocks

Provide readable code blocks.

Include where practical:

```text
language label
copy button
horizontal scrolling
```

Syntax highlighting is optional if it introduces significant bundle weight.

If added, evaluate bundle impact.

---

# 38. Links

Model-generated links should be rendered safely.

Consider:

```text
target behavior
rel attributes
unsafe protocols
```

Never allow `javascript:` links.

---

# 39. Attachments UI

Phase 3 may provide the UI shell for attachments only if useful.

Example:

```text
[📎] document.pdf ×
```

Do NOT build:

* document ingestion
* RAG
* embeddings
* knowledge indexing

Those belong to Phase 9.

If backend attachment transport is not part of existing contracts, keep attachment functionality disabled or UI-only and document it clearly.

Do not pretend it works end-to-end.

---

# 40. Suggested Prompts

Implement static/configurable suggestions.

Example:

```tsx
<CopilotChat
  suggestions={[
    "Explain this page",
    "What can you help me with?"
  ]}
/>
```

Phase 3 suggestions are UI configuration.

Do not generate application-aware suggestions using Phase 4 context.

---

# 41. Empty State

Provide a polished empty state.

Example:

```text
            AI Copilot

How can I help?

[Explain something]
[Help me complete a task]
[What can you do?]
```

Make it configurable.

---

# 42. Loading State

Distinguish:

```text
submitting
```

from:

```text
streaming
```

Avoid excessive spinners.

During streaming, the content itself communicates activity.

---

# 43. Typing Indicator

A typing indicator may be shown before the first content delta.

Stop showing it once content starts streaming.

---

# 44. Error UI

Provide useful error states.

Examples:

```text
Connection lost.
[Retry]

The request timed out.
[Try again]

Generation was stopped.
```

Do not expose:

```text
stack traces
API keys
provider secrets
raw internal errors
```

---

# 45. Auto Scroll

Implement sensible chat auto-scroll.

Rules:

* follow new output when user is already near bottom
* do not constantly force scroll if user manually scrolled upward
* provide a "Jump to latest" control if useful

Test long streamed responses.

---

# 46. Input Behavior

Desktop convention:

```text
Enter
→ send

Shift + Enter
→ newline
```

Support IME correctly.

Do not submit while text composition is active.

---

# 47. Input State

Disable or alter actions appropriately while:

```text
submitting
streaming
```

During streaming:

```text
Send
```

may become:

```text
Stop
```

depending on design.

---

# 48. Accessibility

Meet strong accessibility requirements.

At minimum:

* keyboard navigation
* logical tab order
* focus visibility
* semantic controls
* ARIA where required
* screen-reader labels
* live-region strategy for streamed responses
* accessible popup/dialog behavior
* accessible sidebar
* contrast
* reduced motion
* escape handling

Avoid announcing every streamed token individually to screen readers.

Design a sensible announcement strategy.

---

# 49. RTL

Support:

```text
dir="rtl"
```

Ensure:

* layout direction
* popup alignment
* message alignment
* input
* icons
* spacing
* scrolling

work correctly.

Do not hardcode left/right where logical CSS properties can be used.

---

# 50. Internationalization Readiness

Do not build a complete translation platform yet.

But UI strings should be configurable/centralized rather than scattered throughout components.

Examples:

```text
Send
Stop
Retry
Copy
Regenerate
Ask anything
```

---

# 51. Responsive Design

Support:

```text
desktop
tablet
mobile
```

Popup on small screens may become nearly/full-screen if appropriate.

Ensure virtual keyboard behavior is reasonable.

---

# 52. Reduced Motion

Respect:

```css
prefers-reduced-motion
```

Animations should not be required for functionality.

---

# 53. Error Boundaries

Use error boundaries where useful around customizable rendering.

A broken custom message renderer should not necessarily crash the entire host application.

Do not hide developer errors silently.

---

# 54. UI Security

Treat all model-generated output as untrusted.

Do not:

* execute generated JS
* use unsanitized `dangerouslySetInnerHTML`
* execute generated React
* dynamically import model-provided modules

Phase 6 Generative UI will use trusted registered components, not arbitrary generated code.

Do not implement that system now.

---

# 55. Package Exports

Design intentional public APIs.

Possible React exports:

```ts
CopilotProvider
useCopilot
useCopilotChat
useMessages
useThread
```

Possible UI exports:

```ts
CopilotChat
CopilotPopup
CopilotSidebar
MessageList
UserMessage
AssistantMessage
ChatInput
Suggestions
```

Do not expose internal stores/components accidentally.

---

# 56. Tree Shaking

Configure packages so consumers can import only what they need.

Avoid a single module that eagerly imports every heavy optional feature.

Review `sideEffects` and package exports.

---

# 57. SSR Safety

React package imports should not immediately access:

```text
window
document
localStorage
```

Browser-specific behavior should happen in appropriate lifecycle boundaries.

Document SSR support level.

Do not build Next.js-specific logic into core React package.

---

# 58. Client Creation

Avoid recreating `CopilotClient` on every render.

Provider should create/manage the client predictably when using `runtimeUrl`.

If an externally supplied client changes, behavior must be defined.

---

# 59. Concurrency

Decide Phase 3 behavior when a user attempts another send during active generation.

Possible policy:

```text
one active run per chat
```

is acceptable for Phase 3.

Document it.

Do not implement complex concurrent agent runs yet.

---

# 60. Stale Event Protection

Ensure events from an old/cancelled run cannot corrupt a newer run.

Use:

```text
runId
```

and existing protocol correlation.

Test:

```text
Run A starts
Run A cancelled
Run B starts
late event from A arrives
```

Run B must remain correct.

---

# 61. Example Applications

Create examples such as:

```text
examples/
├── react-basic/
└── react-custom-ui/
```

At minimum `react-basic` should demonstrate:

```tsx
<CopilotProvider>
  <CopilotPopup />
</CopilotProvider>
```

The custom example should demonstrate headless usage:

```tsx
useCopilotChat()
```

without requiring the default UI.

---

# 62. Mock Provider Development

Examples and UI tests should be able to run against the deterministic mock provider from Phase 2.

Developers must not need an OpenAI API key to work on UI.

---

# 63. Optional Real Provider Demo

If Phase 2 supports configured OpenAI execution, the example may optionally use it.

Credentials remain server-side.

Do not embed provider keys in React environment variables that are exposed to the browser.

---

# 64. Storybook Decision

Evaluate whether Storybook or another component workbench is justified.

Do NOT automatically add it.

If the project already uses one, integrate with it.

If not, weigh:

```text
benefit
dependency cost
maintenance
bundle/build complexity
```

A dedicated example app may be sufficient for Phase 3.

Document the decision.

---

# 65. Unit Tests — React SDK

Test:

* provider initialization
* externally supplied client
* message state
* send
* streaming
* completion
* errors
* stop
* regenerate
* retry
* clear
* unmount cleanup
* StrictMode
* stale events
* multiple provider instances

---

# 66. Component Tests

Test:

* chat rendering
* empty state
* user message
* assistant message
* streaming message
* input
* send
* stop
* retry
* regenerate
* popup open/close
* sidebar
* suggestions
* error state

Prefer user-observable behavior over implementation details.

---

# 67. Accessibility Tests

Test:

* keyboard navigation
* button labels
* dialog semantics
* focus behavior
* Enter/Shift+Enter
* Escape
* screen-reader semantics
* RTL where practical

If an accessibility testing library is added, justify the dependency.

---

# 68. Markdown Security Tests

Test malicious/untrusted content.

Examples:

```text
<script>
javascript: URLs
unsafe HTML
malformed Markdown
```

Verify it cannot execute code.

---

# 69. Integration Tests

Mandatory flow:

```text
React UI
   ↓
React SDK
   ↓
Client
   ↓
Server
   ↓
Core
   ↓
Model Runtime
   ↓
Mock Provider
   ↓
Streaming
   ↓
React UI updates incrementally
```

Test:

```text
send
stream
complete
stop
error
retry
```

---

# 70. Browser E2E

Use Playwright where appropriate.

Test at least:

```text
Open popup
Send message
Observe streaming
Stop generation
Retry failure
Close/reopen
Keyboard operation
Mobile viewport
```

Do not require external provider credentials.

---

# 71. Performance Validation

Measure or inspect:

* unnecessary full-tree rerenders
* message-list rendering
* streaming update frequency
* package size
* dependency weight

Do not claim performance improvements without evidence.

Document significant findings.

---

# 72. Documentation

Populate:

```text
docs/phases/phase-03/
```

Required:

```text
Phase_3_Docs.md
Phase_3_Architecture.md
Phase_3_Implementation.md
Phase_3_Status.md
Phase_3_Testing.md
Phase_3_Decisions.md
Phase_3_API.md
Phase_3_Files.md
Phase_3_Issues.md
Phase_3_Handoff.md
```

Do not leave placeholders after Phase 3 completion.

---

# 73. Architecture Documentation

`Phase_3_Architecture.md` must include:

```text
Application
     │
     ▼
CopilotProvider
     │
     ▼
React SDK
     │
     ▼
@aicopilot/client
     │
     ▼
Protocol
     │
     ▼
Server
```

UI architecture:

```text
@aicopilot/ui
       ↓
@aicopilot/react
       ↓
@aicopilot/client
```

State flow:

```text
User Input
    ↓
sendMessage()
    ↓
Client Run
    ↓
Protocol Events
    ↓
React Store/State
    ↓
Selectors/Hooks
    ↓
Components
```

---

# 74. API Documentation

Document all public React APIs in:

```text
Phase_3_API.md
```

For each:

```text
name
package
signature
parameters
return type
behavior
example
errors
lifecycle considerations
```

Include public UI components and customization APIs.

---

# 75. Update Global Documentation

Update as applicable:

```text
docs/PROJECT_STATUS.md
docs/ARCHITECTURE_OVERVIEW.md
docs/CHANGELOG_PHASES.md
docs/DECISIONS.md
docs/TECHNICAL_DEBT.md
```

Do not mark Phase 4 started.

---

# 76. ADRs

Create ADRs only for meaningful decisions.

Potential decisions:

```text
Headless React package vs UI package separation

React state architecture

UI styling/theming strategy

Markdown rendering strategy

Streaming update strategy

React peer dependency policy
```

Update `docs/DECISIONS.md`.

---

# 77. Git Commit Plan

Recommended boundaries:

```text
feat(react): add copilot provider foundation

feat(react): add headless chat hooks

feat(react): support streaming message state

feat(react): add stop retry and regenerate actions

feat(ui): add core chat components

feat(ui): add popup and sidebar variants

feat(ui): add markdown and code rendering

feat(ui): add theming and responsive design

feat(ui): improve accessibility and rtl support

test(react): cover chat runtime integration

test(ui): add component and accessibility tests

test(e2e): verify react copilot workflow

docs(phase-03): document react sdk and ui architecture
```

Adjust to repository reality.

Do not create fake commits.

---

# 78. Implementation Order

Follow this sequence:

```text
STEP 01
Read skills

STEP 02
Read Phase 1–2 docs

STEP 03
Verify previous phases

STEP 04
Inspect repository

STEP 05
Mark Phase 3 IN PROGRESS

STEP 06
Design React package boundary

STEP 07
Design UI package boundary

STEP 08
Create @aicopilot/react

STEP 09
Implement CopilotProvider

STEP 10
Implement canonical chat state

STEP 11
Implement useCopilot

STEP 12
Implement useCopilotChat

STEP 13
Implement useMessages/useThread as justified

STEP 14
Implement send flow

STEP 15
Implement streaming state

STEP 16
Implement cancellation/stop

STEP 17
Implement retry

STEP 18
Implement regenerate

STEP 19
Implement clear/reset

STEP 20
Test headless React SDK

STEP 21
Create @aicopilot/ui

STEP 22
Implement base components

STEP 23
Implement CopilotChat

STEP 24
Implement CopilotPopup

STEP 25
Implement CopilotSidebar

STEP 26
Implement suggestions/empty states

STEP 27
Implement Markdown/code rendering

STEP 28
Implement errors/loading states

STEP 29
Implement theming

STEP 30
Implement dark/light modes

STEP 31
Implement responsive behavior

STEP 32
Implement accessibility

STEP 33
Implement RTL

STEP 34
Implement customization API

STEP 35
Write component tests

STEP 36
Write accessibility/security tests

STEP 37
Create React examples

STEP 38
Write integration tests

STEP 39
Write Playwright E2E tests

STEP 40
Review rendering performance

STEP 41
Review dependency boundaries

STEP 42
Review public APIs

STEP 43
Update Phase 3 documentation

STEP 44
Update global documentation

STEP 45
Run complete regression suite

STEP 46
Self-review

STEP 47
Produce completion report

STEP 48
STOP
```

---

# 79. Required End-to-End Result

By the end of Phase 3 this must work conceptually:

```tsx
import {
  CopilotProvider
} from "@aicopilot/react";

import {
  CopilotPopup
} from "@aicopilot/ui";

export function App() {
  return (
    <CopilotProvider runtimeUrl="/api/copilot">
      <MainApplication />

      <CopilotPopup
        title="AI Copilot"
        suggestions={[
          "What can you help me with?",
          "Explain event-driven architecture"
        ]}
      />
    </CopilotProvider>
  );
}
```

User experience:

```text
Application
                                      [AI]
                                       │
                                       ▼
                            ┌─────────────────────┐
                            │ AI Copilot          │
                            ├─────────────────────┤
                            │                     │
                            │ User                │
                            │ Explain SSE         │
                            │                     │
                            │ Copilot             │
                            │ Server-Sent         │
                            │ Events allow...     │
                            │ █                   │
                            │                     │
                            ├─────────────────────┤
                            │ Ask anything...     │
                            └─────────────────────┘
```

The response must visibly stream.

---

# 80. Headless Result

This must also work without `@aicopilot/ui`:

```tsx
function CustomCopilot() {
  const {
    messages,
    status,
    sendMessage,
    stop
  } = useCopilotChat();

  return (
    <MyCustomChat
      messages={messages}
      streaming={status === "streaming"}
      onSend={sendMessage}
      onStop={stop}
    />
  );
}
```

This requirement proves that:

```text
React logic ≠ UI
```

---

# 81. Acceptance Criteria

Phase 3 is COMPLETE only when:

## Packages

* [ ] `@aicopilot/react` exists.
* [ ] `@aicopilot/ui` exists.
* [ ] React is not added to framework-independent core.
* [ ] UI is separated from headless React logic.

## Provider

* [ ] `CopilotProvider` works.
* [ ] runtime URL configuration works.
* [ ] supplied client configuration works if supported.
* [ ] cleanup works.

## Hooks

* [ ] `useCopilotChat` works.
* [ ] message state works.
* [ ] streaming works.
* [ ] send works.
* [ ] stop works.
* [ ] retry works.
* [ ] regenerate works.
* [ ] clear/reset works.

## UI

* [ ] `CopilotChat` works.
* [ ] `CopilotPopup` works.
* [ ] `CopilotSidebar` works.
* [ ] message rendering works.
* [ ] Markdown works safely.
* [ ] code blocks work.
* [ ] suggestions work.
* [ ] error states work.
* [ ] loading states work.
* [ ] empty state works.

## UX

* [ ] light mode works.
* [ ] dark mode works.
* [ ] responsive layout works.
* [ ] keyboard navigation works.
* [ ] RTL works.
* [ ] reduced motion considered.
* [ ] accessibility requirements pass.

## Streaming

* [ ] assistant message updates incrementally.
* [ ] no message-per-token bug.
* [ ] stale events cannot corrupt newer runs.
* [ ] stop cancels actual backend generation.
* [ ] stream cleanup works.

## Testing

* [ ] React SDK tests pass.
* [ ] component tests pass.
* [ ] Markdown security tests pass.
* [ ] accessibility tests pass.
* [ ] integration tests pass.
* [ ] E2E tests pass where configured.
* [ ] Phase 1–2 regression tests pass.

## Documentation

* [ ] all Phase 3 docs updated.
* [ ] architecture updated.
* [ ] API documented.
* [ ] testing evidence recorded.
* [ ] handoff completed.
* [ ] global project status updated.

## Phase Gate

* [ ] no application context engine.
* [ ] no `useCopilotContext`.
* [ ] no frontend tools.
* [ ] no backend tools.
* [ ] no Generative UI.
* [ ] no HITL.
* [ ] no RAG.
* [ ] no agents.
* [ ] no Phase 4+ implementation.

---

# 82. Validation

Run repository equivalents of:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Also run:

```text
React package tests
UI tests
integration tests
E2E tests
Phase 1 regression
Phase 2 regression
```

Run the React example.

Verify manually or through E2E:

```text
popup opens
message sends
response streams
stop works
retry works
regenerate works
keyboard works
mobile layout works
```

Record results in:

```text
docs/phases/phase-03/Phase_3_Testing.md
```

Do not claim a test passed unless actually executed.

---

# 83. Self-Review

Before completion verify:

### Architecture

Did React leak into core?

Did UI logic leak into client?

Can `@aicopilot/react` work without `@aicopilot/ui`?

Can a developer build completely custom UI?

### React

Are subscriptions cleaned up?

Does StrictMode cause duplicate requests?

Are actions stable?

Are stale events ignored?

Are multiple provider instances isolated?

### Streaming

Does the active assistant message update rather than creating hundreds of messages?

Can cancellation leave a zombie stream?

### UI

Does popup keyboard navigation work?

Does focus return correctly?

Does RTL work?

Does mobile work?

### Security

Can model Markdown execute JavaScript?

Can unsafe links execute?

Is raw HTML safely handled?

### Performance

Does every token rerender the entire application?

Are large dependencies justified?

### Phase Gate

Did we accidentally implement Phase 4 context?

Did we implement tools?

Did we implement Generative UI?

Fix violations before completion.

---

# 84. Completion Report

Produce:

```text
AI COPILOT SDK
PHASE 03 — REACT COPILOT UI

STATUS
COMPLETE / INCOMPLETE


PREVIOUS PHASE REGRESSION

Phase 1:
PASS / FAIL

Phase 2:
PASS / FAIL


IMPLEMENTED

React SDK:
- ...

CopilotProvider:
- ...

Hooks:
- ...

Chat State:
- ...

Streaming:
- ...

Stop:
- ...

Retry:
- ...

Regenerate:
- ...

UI Package:
- ...

CopilotChat:
- ...

CopilotPopup:
- ...

CopilotSidebar:
- ...

Markdown:
- ...

Theming:
- ...

Responsive:
- ...

Accessibility:
- ...

RTL:
- ...

Examples:
- ...


PUBLIC APIs

@aicopilot/react:
- ...

@aicopilot/ui:
- ...


TEST RESULTS

Lint:
PASS / FAIL / NOT RUN

Typecheck:
PASS / FAIL / NOT RUN

Unit Tests:
PASS / FAIL / NOT RUN

React Tests:
PASS / FAIL / NOT RUN

UI Tests:
PASS / FAIL / NOT RUN

Accessibility Tests:
PASS / FAIL / NOT RUN

Security Tests:
PASS / FAIL / NOT RUN

Integration Tests:
PASS / FAIL / NOT RUN

E2E:
PASS / FAIL / NOT RUN

Build:
PASS / FAIL / NOT RUN


ARCHITECTURE VALIDATION

Framework-independent core:
PASS / FAIL

React/UI separation:
PASS / FAIL

Headless React API:
PASS / FAIL

Streaming:
PASS / FAIL

Cancellation:
PASS / FAIL

StrictMode safety:
PASS / FAIL

Safe Markdown:
PASS / FAIL

Accessibility:
PASS / FAIL

RTL:
PASS / FAIL

No Phase 4+ implementation:
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

Phase_3_Docs:
PASS / FAIL

Phase_3_Architecture:
PASS / FAIL

Phase_3_Implementation:
PASS / FAIL

Phase_3_Status:
PASS / FAIL

Phase_3_Testing:
PASS / FAIL

Phase_3_Decisions:
PASS / FAIL

Phase_3_API:
PASS / FAIL

Phase_3_Files:
PASS / FAIL

Phase_3_Issues:
PASS / FAIL

Phase_3_Handoff:
PASS / FAIL


REMAINING PHASE 3 WORK

None

or

- ...


NEXT PHASE

Phase 04 — Application Context & State

STATUS

LOCKED / NOT STARTED

Waiting for explicit user instruction.
```

---

# 85. Final Stop Rule

After Phase 3 is implemented, tested, documented and reviewed:

STOP.

Do NOT begin:

```text
PHASE 04 — APPLICATION CONTEXT & STATE
```

Specifically, do not create:

```ts
useCopilotContext()
useCopilotState()
```

Do not implement:

```text
Application context
Page context
Component context
Context prioritization
Context compression
Token budgeting
Application state synchronization
Context Inspector
```

Those belong to Phase 4.

Wait for explicit user authorization.
