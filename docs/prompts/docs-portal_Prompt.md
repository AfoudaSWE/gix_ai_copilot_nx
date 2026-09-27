# GIX AI Copilot SDK — Product Website + Documentation Portal

Build a complete, production-quality website and developer documentation portal for the **GIX AI Copilot SDK**.

Use these websites as **UX / information-architecture references only**:

- `https://www.copilotkit.ai/`
- `https://docs.copilotkit.ai/`

Do **not** clone their copyrighted design, copy, illustrations, branding, or page layouts pixel-for-pixel.

Instead:

> Recreate the level of polish, developer experience, navigation quality, documentation usability, interactive examples, and overall product structure using an original **GIX design system**.

The result should feel like:

```text
CopilotKit-quality developer experience
+
Vercel-quality technical polish
+
GIX branding
+
Enterprise AI positioning
```

---

# 1. PRODUCT

Product:

**GIX AI Copilot SDK**

Positioning:

> A framework-independent enterprise SDK for building safe, observable, application-aware AI copilots and agents capable of interacting with real software systems.

Alternative short headline:

> Build AI Copilots That Actually Understand Your Application.

Supporting message:

> Connect AI to your application context, tools, APIs, knowledge, workflows and UI — with enterprise security built into the runtime.

The website must explain the complete SDK developed across Phases 1–12.

---

# 2. FIRST — INSPECT THE REPOSITORY

Before writing code:

1. Read the repository.
2. Read all Phase 1–12 documentation.
3. Read the architecture documentation.
4. Read actual package APIs.
5. Read examples.
6. Read README files.
7. Inspect existing docs application if one exists.
8. Inspect existing website/design-system code.
9. Inspect GIX assets already available in the repository.

Important:

**Repository implementation is the source of truth.**

Never document an API simply because it appeared in a planning document.

Use:

```text
Actual implementation
        ↓
Tests
        ↓
Package README/API
        ↓
Phase documentation
        ↓
Roadmap
```

---

# 3. READ PROJECT DOCUMENTATION

Read:

```text
docs/
docs/phases/
docs/adr/
docs/production/
docs/migrations/
```

Especially:

```text
PROJECT_STATUS.md
ROADMAP.md
ARCHITECTURE_OVERVIEW.md
CHANGELOG_PHASES.md
TECHNICAL_DEBT.md
DECISIONS.md
```

Determine which features are:

```text
Stable
Beta
Experimental
Planned
```

Never present planned functionality as implemented.

---

# 4. TARGET APPLICATION STRUCTURE

Prefer:

```text
apps/
├── website/
│
└── docs/
```

or, if the repository architecture makes more sense:

```text
apps/
└── web/
    ├── marketing
    └── docs
```

Do not duplicate infrastructure unnecessarily.

Use the existing Nx/pnpm conventions.

---

# 5. TARGET DOMAINS

Design for:

```text
gixtechnology.com
```

Product website concept:

```text
ai.gixtechnology.com
```

Documentation concept:

```text
docs.ai.gixtechnology.com
```

or:

```text
ai.gixtechnology.com/docs
```

Do not modify DNS/deployment automatically.

Document the recommended domain configuration.

---

# 6. TECHNOLOGY

Prefer the project's established web stack.

If creating a new docs/marketing application from scratch, use:

```text
Next.js
TypeScript
Tailwind CSS
MDX
React
```

Use only justified dependencies.

Possible documentation/search tooling may be added after evaluating existing dependencies.

Do not introduce a large docs framework if the same experience can be built cleanly with the existing stack.

---

# 7. GIX BRAND

The entire website must look unmistakably GIX.

Primary visual language:

```text
Dark Charcoal
Black
Steel Gray
White
GIX Red
```

Primary red:

```text
#D61920
```

Alternative existing GIX red:

```text
#C1242A
```

Primary black:

```text
#000000
```

White:

```text
#FFFFFF
```

Use charcoal/steel neutrals for surfaces and borders.

---

# 8. DESIGN TOKENS

Create centralized tokens.

Example:

```css
--gix-black: #000000;
--gix-red: #d61920;
--gix-red-dark: #a90f15;

--gix-white: #ffffff;

--gix-gray-50: #fafafa;
--gix-gray-100: #f5f5f5;
--gix-gray-200: #e5e5e5;
--gix-gray-300: #d4d4d4;
--gix-gray-500: #737373;
--gix-gray-700: #404040;
--gix-gray-800: #262626;
--gix-gray-900: #171717;
--gix-gray-950: #0a0a0a;
```

Do not scatter arbitrary colors throughout components.

---

# 9. TYPOGRAPHY

Follow GIX typography.

Prefer:

```text
JetBrains
```

for brand/headline/technical personality where appropriate.

Use:

```text
Inter
```

for highly readable body/interface text if already available.

Code:

```text
JetBrains Mono
```

or the established monospace font.

Typography should feel:

```text
Technical
Premium
Modern
Enterprise
Developer-focused
```

---

# 10. VISUAL LANGUAGE

Use:

- large confident typography
- generous whitespace
- subtle grids
- dark technical surfaces
- restrained red accents
- thin steel-gray borders
- soft gradients
- subtle glow effects
- code windows
- architecture diagrams
- terminal demonstrations
- product UI previews
- animated protocol/event flows
- subtle motion
- premium hover states

Avoid:

- excessive glassmorphism
- rainbow gradients
- generic AI purple
- excessive glowing
- cartoon robots
- stock AI brains
- visual clutter
- huge amounts of red

Red is an **accent**, not the entire background.

---

# 11. WEBSITE EXPERIENCE

The website should have the usability quality of a leading developer-tool website.

Primary navigation:

```text
GIX AI

Product
Developers
Enterprise
Resources
Docs
GitHub

[Get Started]
```

If GitHub repository URL is not known, make it configurable rather than inventing one.

---

# 12. NAVBAR

Desktop:

```text
┌───────────────────────────────────────────────────────────────┐
│ GIX AI    Product  Developers  Enterprise  Resources   Docs  │
│                                                   Get Started │
└───────────────────────────────────────────────────────────────┘
```

Requirements:

- sticky
- subtle backdrop blur
- dark/light-aware
- dropdown menus
- keyboard navigation
- mobile menu
- active state
- accessible focus states

---

# 13. PRODUCT DROPDOWN

Include relevant capabilities:

```text
AI Copilot
Agents
Tools
Generative UI
Application Context
RAG
Memory
Workflows
Security
Observability
```

Each gets:

```text
icon
name
one-line description
```

---

# 14. DEVELOPERS DROPDOWN

```text
Documentation
Quickstart
React
Angular
Node.js
Examples
API Reference
CLI
OpenAPI
MCP
```

---

# 15. ENTERPRISE DROPDOWN

```text
AI Action Firewall
RBAC & ABAC
Human-in-the-Loop
Audit
Multi-Tenancy
PII Protection
Observability
Usage & Cost Controls
```

---

# 16. HERO

Create a premium hero.

Possible copy:

```text
BUILD AI
THAT UNDERSTANDS
YOUR APPLICATION.
```

Highlight:

```text
YOUR APPLICATION
```

with restrained GIX red.

Supporting copy:

> GIX AI is an enterprise SDK for building application-aware copilots and agents with tools, context, RAG, Generative UI, workflows and built-in security.

Actions:

```text
[Get Started]

[Read the Docs]
```

Then:

```text
npm install @gix-ai/react
```

Use the actual package name if different.

Never invent package names without verifying repository configuration.

---

# 17. HERO INTERACTIVE DEMO

The hero should contain a real interactive product visualization.

Example:

```text
┌─────────────────────────────────────────────┐
│ AI Copilot                                 │
│                                             │
│ User                                        │
│ Show me the selected application.           │
│                                             │
│ AI                                          │
│ I'll retrieve its latest details.           │
│                                             │
│ ● applications.get                          │
│                                             │
│ ┌───────────────────────────────────────┐   │
│ │ APP-1024                              │   │
│ │ Ahmed Hassan                          │   │
│ │ Status: Under Review                  │   │
│ │                                       │   │
│ │ [Open Application]                    │   │
│ └───────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

Beside it visualize:

```text
User
 ↓
Context
 ↓
Agent
 ↓
Tool
 ↓
Action Firewall
 ↓
Application
```

Animate events subtly.

---

# 18. TRUST / FRAMEWORK STRIP

Show:

```text
React
Angular
Node.js
OpenAI
Anthropic
Gemini
Ollama
OpenAPI
MCP
PostgreSQL
```

Only show integrations actually supported.

---

# 19. "BUILD MORE THAN A CHATBOT"

Create section:

```text
Build More Than a Chatbot
```

Cards:

### Application Context

Your AI understands the current application, user, page and state.

### Tools

Let AI safely interact with real application capabilities.

### Generative UI

Turn structured AI output into trusted interactive components.

### RAG

Connect enterprise knowledge while respecting permissions.

### Agents

Create specialist and orchestrator agents.

### Workflows

Run durable multi-step AI operations.

---

# 20. INTERACTIVE ARCHITECTURE

Build an animated architecture visualization.

```text
                       USER
                        │
                        ▼
                 ┌─────────────┐
                 │   Copilot   │
                 └──────┬──────┘
                        │
               Application Context
                        │
                        ▼
                 ┌─────────────┐
                 │ AI Runtime  │
                 └──────┬──────┘
                        │
      ┌─────────────────┼─────────────────┐
      ▼                 ▼                 ▼
    Tools              RAG              Agents
      │                 │                 │
      └─────────────────┼─────────────────┘
                        ▼
                Action Firewall
                        │
                        ▼
                 Your Systems
```

Allow hovering nodes for explanations.

---

# 21. GENERATIVE UI SECTION

Headline:

```text
AI That Builds the Right Interface.
```

Explain:

```text
Model
 ↓
Structured UI Request
 ↓
Schema Validation
 ↓
Trusted Component Registry
 ↓
Application UI
```

Visually demonstrate:

```text
"Show APP-1024"

          ↓

{
  "component": "ApplicationCard",
  "props": {
    "applicationId": "APP-1024"
  }
}

          ↓

┌──────────────────────────┐
│ APP-1024                 │
│ Under Review             │
│                          │
│ [Open Application]       │
└──────────────────────────┘
```

Emphasize:

> The model selects components. It never generates executable application code.

---

# 22. TOOLS SECTION

Create interactive code example.

```ts
defineTool({
  name: "applications.get",
  description: "Get an application",
  inputSchema: z.object({
    applicationId: z.string()
  }),

  async execute({ applicationId }) {
    return applications.get(applicationId);
  }
});
```

Show lifecycle visually:

```text
AI
 ↓
Tool Request
 ↓
Validation
 ↓
Security
 ↓
Execution
 ↓
Result
 ↓
AI
```

---

# 23. OPENAPI SECTION

Headline:

```text
Turn APIs Into AI Capabilities.
```

Visual:

```text
openapi.yaml

      ↓

GIX AI

      ↓

Tool Registry

      ↓

AI Agent
```

Example command:

```bash
npx aicopilot import-openapi ./openapi.yaml
```

Use actual CLI/package command.

---

# 24. MCP SECTION

Show:

```text
GIX AI Runtime
      │
      ├── Native Tools
      ├── OpenAPI
      └── MCP
             │
       ┌─────┼─────┐
       ▼     ▼     ▼
     Tools Resources Prompts
```

Explain that MCP tools still go through enterprise security policies.

---

# 25. RAG SECTION

Create visual:

```text
Documents
Databases
APIs
Web
Object Storage
       │
       ▼
     Load
       ↓
     Parse
       ↓
     Chunk
       ↓
    Embed
       ↓
   pgvector
       ↓
Permission Filter
       ↓
    Retrieve
       ↓
      LLM
```

Emphasize permission-aware retrieval.

---

# 26. AGENT SECTION

Headline:

```text
From Copilot to Agentic Systems.
```

Visualization:

```text
                   Orchestrator
                        │
         ┌──────────────┼──────────────┐
         ▼              ▼              ▼
     Research        Support       Application
      Agent           Agent           Agent
         │              │              │
         └──────────────┼──────────────┘
                        ▼
                       Tools
```

---

# 27. WORKFLOW SECTION

Show durable workflow:

```text
START
 ↓
PLAN
 ↓
RESEARCH
 ↓
TOOL
 ↓
APPROVAL
 ↓
EXECUTE
 ↓
VERIFY
 ↓
COMPLETE
```

Animate current step.

---

# 28. SECURITY SECTION

This should be a major GIX differentiator.

Headline:

```text
AI With Boundaries.
```

Display the AI Action Firewall:

```text
LLM
 ↓
Tool Request
 ↓
Authentication
 ↓
RBAC
 ↓
ABAC
 ↓
Validation
 ↓
PII Policy
 ↓
Business Rules
 ↓
Rate Limit
 ↓
Approval
 ↓
Audit
 ↓
ALLOW / DENY
 ↓
Execution
```

Use subtle red indicators for security checkpoints.

---

# 29. HUMAN-IN-THE-LOOP

Visualize:

```text
AI wants to:

Refund $2,450

Risk:
HIGH

Reason:
Customer refund request

Requires:
SUPERVISOR APPROVAL

[Reject]        [Approve]
```

Do not make this a fake claim if the underlying SDK does not support it.

---

# 30. DEVTOOLS SECTION

Headline:

```text
Understand What Your AI Is Doing.
```

Create DevTools preview with tabs:

```text
Messages
Context
State
Tools
RAG
Events
Trace
Security
Tokens
Cost
Evals
```

Show event timeline.

---

# 31. OBSERVABILITY

Visualize:

```text
Run
 ├── Model Call      820ms
 ├── Context         12ms
 ├── Tool            145ms
 ├── RAG             210ms
 └── Render          8ms

Tokens
Input: 1,842
Output: 426

Estimated Cost
$...
```

Use real demo fixture values only when clearly marked as demo data.

---

# 32. FRAMEWORK SECTION

Create tabs:

```text
React
Angular
Node
```

React:

```tsx
<CopilotProvider>
  <CopilotChat />
</CopilotProvider>
```

Angular:

```ts
provideCopilot({
  endpoint: "/api/copilot"
});
```

Node:

```ts
const copilot = createCopilot({
  ...
});
```

Use actual APIs from repository.

---

# 33. QUICKSTART

Section:

```text
From Zero to Copilot
```

Steps:

```text
01 Install
02 Configure
03 Add Server
04 Add UI
05 Add Context
06 Add Tools
07 Run
```

Make each step expandable.

---

# 34. TERMINAL DEMO

Create animated terminal.

Example:

```text
$ npx aicopilot init

✓ Project detected
✓ Configuration created
✓ React SDK configured
✓ Server created

Your AI Copilot is ready.

$ pnpm dev
```

Animation must respect `prefers-reduced-motion`.

---

# 35. CODE EXAMPLES

Every code block should support:

```text
syntax highlighting
copy
filename
language
line highlighting where useful
wrap toggle
```

---

# 36. CTA

Near bottom:

```text
BUILD YOUR FIRST
AI COPILOT.
```

Buttons:

```text
[Get Started]

[Read Documentation]
```

---

# 37. FOOTER

Structure:

```text
GIX AI

Product
  Copilot
  Agents
  Generative UI
  Security

Developers
  Documentation
  API
  React
  Angular
  Node
  Examples

Integrations
  OpenAPI
  MCP
  Providers

Resources
  Architecture
  Security
  GitHub

GIX
  GIX Technology
```

Only include real destinations.

---

# 38. DOCUMENTATION PORTAL

Now create the documentation experience.

It should provide the usability expected from a modern SDK documentation portal.

Layout:

```text
┌──────────────────────────────────────────────────────────────────┐
│ GIX AI Docs       Search Documentation...        GitHub   Theme  │
├────────────────┬─────────────────────────────────┬───────────────┤
│                │                                 │               │
│ Sidebar        │ Documentation                   │ On This Page  │
│                │                                 │               │
│                │                                 │               │
└────────────────┴─────────────────────────────────┴───────────────┘
```

---

# 39. DOCS TOP NAV

Include:

```text
GIX AI
Documentation
API Reference
Examples
GitHub
```

Global search in center/appropriate position.

Keyboard shortcut:

```text
Ctrl/Cmd + K
```

---

# 40. DOCS SIDEBAR

Suggested hierarchy:

```text
GETTING STARTED

Introduction
Installation
Quickstart
Architecture
Core Concepts


FRAMEWORKS

React
Angular
Node.js


COPILOT

Chat
Threads
Messages
Streaming
Suggestions


APPLICATION AWARENESS

Context
State
Shared State


TOOLS

Introduction
Frontend Tools
Backend Tools
Tool Registry
Structured Outputs
Tool Rendering


GENERATIVE UI

Introduction
Component Registry
Structured UI
Tool Result Rendering
Interactive Components
Streaming UI


SECURITY

Overview
AI Action Firewall
Authentication
RBAC
ABAC
PII Protection
Human-in-the-Loop
Approvals
Audit


INTEGRATIONS

OpenAPI
MCP


KNOWLEDGE

RAG
Data Sources
Chunking
Embeddings
Retrieval
Reranking
Citations
Permissions


MEMORY

Overview
Working Memory
Session Memory
Durable Memory
Security


AGENTS

Overview
Creating Agents
Specialist Agents
Routing
Handoffs
Multi-Agent


WORKFLOWS

Overview
Long-Running Workflows
Checkpoints
Retries
Cancellation
Compensation


OBSERVABILITY

Tracing
Events
Metrics
Tokens
Cost


DEVTOOLS

Overview
Context Inspector
Tool Inspector
Event Viewer
Replay
Time Travel


TESTING

Unit Testing
Integration Testing
Agent Simulation
Mock Providers


EVALUATIONS

Overview
Datasets
Metrics
Regression Testing
CI


PRODUCTION

Configuration
PostgreSQL
Redis
Workers
Multi-Tenancy
Rate Limiting
Budgets
Model Routing
Fallback
Scaling
Deployment
Docker
Security


CLI

Overview
init
add agent
add tool
import-openapi
dev
test
eval
doctor


REFERENCE

API Reference
Protocol
Events
Configuration
Errors
```

Only publish pages corresponding to actual functionality.

---

# 41. DOCS LANDING PAGE

Hero:

```text
GIX AI Documentation
```

Subtitle:

> Build secure, application-aware AI copilots and agents with TypeScript.

Quick links:

```text
Quickstart
React
Angular
Node.js
Tools
Generative UI
Agents
Security
```

Then installation:

```bash
npm install ...
```

Use actual packages.

---

# 42. DOCUMENTATION PAGE STRUCTURE

Every major page should follow a predictable format:

```text
Title

Short explanation

What you'll learn

Concept

Architecture

Installation / Setup

Implementation

Example

How it works

Configuration

API

Common patterns

Security considerations

Troubleshooting

Next steps
```

Do not force irrelevant headings onto every page.

---

# 43. DOCS "ON THIS PAGE"

Desktop right sidebar:

```text
On this page

Overview
Architecture
Installation
Example
Configuration
API
Security
Next Steps
```

Highlight section based on scroll position.

---

# 44. DOCS SEARCH

Implement useful search.

Search:

```text
page title
headings
body
API names
hooks
classes
functions
CLI commands
```

Support:

```text
Cmd/Ctrl + K
```

Results grouped by category.

---

# 45. SEARCH UX

Example:

```text
┌─────────────────────────────────────────────┐
│ Search GIX AI Docs...                      │
├─────────────────────────────────────────────┤
│ Getting Started                            │
│   Quickstart                               │
│                                             │
│ React                                      │
│   useCopilotContext                        │
│   useFrontendTool                          │
│                                             │
│ Security                                   │
│   Action Firewall                          │
└─────────────────────────────────────────────┘
```

Keyboard navigable.

---

# 46. API REFERENCE

Generate API reference from actual exported APIs where practical.

Group by package:

```text
@aicopilot/core
@aicopilot/client
@aicopilot/react
@aicopilot/angular
@aicopilot/tools
@aicopilot/agents
...
```

Use actual package namespace.

---

# 47. API PAGE

Example:

```text
useCopilotContext()

Register application context with the Copilot runtime.

Signature

Parameters

Returns

Example

Lifecycle

Security

Related APIs
```

---

# 48. CODE TABS

Support:

```text
React | Angular | Node
```

where the same concept applies.

Example:

```text
Application Context
```

can show framework-specific implementation while explaining the same core concept.

---

# 49. INTERACTIVE EXAMPLES

Where practical:

```text
Code
        +
Live Preview
```

Example:

```text
useFrontendTool
Generative UI
Shared State
```

Avoid embedding fake production behavior.

---

# 50. ARCHITECTURE DIAGRAMS

Create reusable diagram components.

Examples:

### Runtime

```text
Application
 ↓
Client SDK
 ↓
Protocol
 ↓
Runtime
 ↓
Provider
```

### Tools

```text
Model
 ↓
Tool Request
 ↓
Tool Runtime
 ↓
Security
 ↓
Executor
```

### RAG

```text
Query
 ↓
Retriever
 ↓
ACL
 ↓
Reranker
 ↓
Context
```

### Agents

```text
Orchestrator
 ↓
Specialists
 ↓
Tools
```

Use CSS/SVG/React components rather than raster images where possible.

---

# 51. VISUAL DOCS

Technical concepts should not be walls of text.

Use:

```text
architecture diagrams
sequence diagrams
flow visualizations
code
tables
callouts
interactive demos
```

---

# 52. CALLOUTS

Support:

```text
INFO
TIP
WARNING
SECURITY
EXPERIMENTAL
```

Security callout should use restrained GIX red.

---

# 53. COPY BUTTON

Every code block:

```text
Copy
```

with success feedback.

---

# 54. PREVIOUS / NEXT

Bottom:

```text
← Previous

Next →
```

---

# 55. EDIT PAGE

If public repository configuration exists:

```text
Edit this page on GitHub
```

Do not invent repository URL.

---

# 56. PAGE FEEDBACK

Optional:

```text
Was this page helpful?

Yes
No
```

Do not implement backend analytics unless required.

---

# 57. VERSION SELECTOR

Prepare docs architecture for:

```text
v1.x
v2.x
```

Do not create nonexistent versions.

---

# 58. STATUS BADGES

Support:

```text
Stable
Beta
Experimental
Deprecated
```

based on actual package documentation.

---

# 59. DARK MODE

Default GIX experience may be dark.

Support:

```text
Dark
Light
System
```

if appropriate.

Dark mode:

```text
#000
#0a0a0a
#171717
white text
red accent
```

Light:

```text
white
soft gray
black text
red accent
```

---

# 60. GIX BACKGROUND STYLE

Use subtle technical grid.

Example concept:

```css
background-image:
  linear-gradient(...),
  linear-gradient(...);
```

Keep extremely subtle.

---

# 61. RED GLOW

Only for important interactive points:

```text
CTA
active architecture node
security decision
selected navigation
```

Avoid glowing every element.

---

# 62. MOTION

Use subtle animations:

```text
fade
slide
event pulse
architecture flow
terminal typing
card transitions
```

Avoid distracting continuous animation.

Respect:

```css
prefers-reduced-motion
```

---

# 63. PAGE TRANSITIONS

Fast and subtle.

Documentation must feel instant.

---

# 64. RESPONSIVE

Test:

```text
1440
1280
1024
768
430
390
```

Marketing site and docs must work on mobile.

---

# 65. MOBILE DOCS

Desktop:

```text
Sidebar | Content | TOC
```

Mobile:

```text
Header
Content
```

Sidebar becomes drawer.

TOC becomes expandable menu.

---

# 66. ACCESSIBILITY

Target WCAG AA.

Ensure:

```text
keyboard navigation
focus indicators
semantic HTML
ARIA where needed
contrast
screen-reader labels
reduced motion
accessible dialogs
accessible code controls
```

---

# 67. RTL

GIX may support Arabic audiences.

Ensure layout infrastructure supports:

```html
dir="rtl"
```

Do not necessarily translate content yet.

But avoid CSS that breaks RTL.

---

# 68. SEO

Marketing pages:

- meaningful title
- description
- canonical metadata
- OpenGraph
- Twitter/X card metadata
- structured metadata where useful
- sitemap
- robots.txt

Documentation pages should also have per-page metadata.

---

# 69. PERFORMANCE

Target strong Core Web Vitals.

Avoid shipping massive animation libraries for trivial effects.

Lazy-load expensive demos.

---

# 70. IMAGES

Optimize images.

Prefer:

```text
SVG
WebP
AVIF
```

as appropriate.

---

# 71. CODE SPLITTING

Heavy interactive demos should not block first paint.

---

# 72. SEARCH INDEX

Generate documentation search index at build time if using local search.

Do not send entire documentation corpus unnecessarily to every client.

---

# 73. DOCUMENTATION CONTENT SOURCE

Prefer MDX.

Example:

```text
content/
├── docs/
│   ├── getting-started/
│   ├── react/
│   ├── angular/
│   ├── tools/
│   ├── generative-ui/
│   ├── security/
│   ├── openapi/
│   ├── mcp/
│   ├── rag/
│   ├── memory/
│   ├── agents/
│   ├── workflows/
│   ├── devtools/
│   ├── testing/
│   ├── evals/
│   ├── production/
│   └── reference/
```

Adapt to actual architecture.

---

# 74. MDX COMPONENTS

Provide reusable:

```text
Callout
CodeBlock
CodeTabs
Steps
ArchitectureDiagram
APIReference
PackageInstall
Terminal
FeatureStatus
Card
CardGrid
Tabs
Accordion
Demo
```

---

# 75. AUTOMATED API DOCS

Investigate generating references from TypeScript exports.

Potential pipeline:

```text
TypeScript
 ↓
API Extractor / TypeDoc
 ↓
Structured API Data
 ↓
Documentation Pages
```

Only introduce a dependency after checking repository tooling.

---

# 76. DOCUMENTATION VALIDATION

Prevent:

```text
broken internal links
missing headings
invalid code snippets
unknown API references
```

Add CI validation.

---

# 77. CODE EXAMPLE VALIDATION

Critical examples should compile.

Prefer importing examples from tested source instead of maintaining duplicate code.

---

# 78. COPY MUST MATCH ACTUAL SDK

Do not write:

```text
useCopilotAgent()
```

unless that API actually exists.

Verify every API.

---

# 79. PACKAGE INSTALL COMMANDS

Verify actual package names.

Never guess.

---

# 80. ARCHITECTURE STATUS

Diagrams must distinguish:

```text
Implemented
Optional
External
```

when needed.

---

# 81. GIX BRAND COMPONENTS

Create reusable:

```text
GixLogo
GixWordmark
GixButton
GixBadge
GixCard
GixCodeWindow
GixArchitectureNode
GixSectionHeading
GixGradientText
```

Reuse them across website/docs.

---

# 82. LOGO

Use existing official GIX logo asset from repository.

If unavailable, use a text wordmark placeholder:

```text
GIX
```

Do not invent a permanent replacement logo.

---

# 83. WEBSITE ROUTES

Recommended:

```text
/
 /product
 /generative-ui
 /tools
 /agents
 /rag
 /security
 /enterprise
 /integrations/openapi
 /integrations/mcp
 /developers
 /examples
```

Avoid empty pages just to satisfy route count.

---

# 84. DOCS ROUTES

Example:

```text
/docs
/docs/quickstart

/docs/react
/docs/angular
/docs/node

/docs/context
/docs/state

/docs/tools
/docs/tools/frontend
/docs/tools/backend

/docs/generative-ui

/docs/security
/docs/security/action-firewall
/docs/security/hitl

/docs/openapi
/docs/mcp

/docs/rag
/docs/memory

/docs/agents
/docs/workflows

/docs/devtools
/docs/testing
/docs/evals

/docs/production

/docs/api
```

---

# 85. URL DESIGN

Use readable URLs.

Good:

```text
/docs/tools/frontend
```

Bad:

```text
/docs/page?id=134
```

---

# 86. 404

Create branded documentation 404.

Include search.

---

# 87. EMPTY STATES

Create intentional empty states for:

```text
search
examples
API filters
```

---

# 88. ERROR BOUNDARIES

Interactive demos must not crash documentation page.

---

# 89. MARKETING COPY STYLE

Copy should be:

```text
Technical
Direct
Confident
Concise
Enterprise-aware
```

Avoid:

```text
"Revolutionary"
"Magical"
"World-changing"
"100% secure"
```

Prefer explainable technical value.

---

# 90. PRIMARY MARKETING STORY

Tell this story:

```text
Chat
 ↓
Application Awareness
 ↓
Tools
 ↓
Generative UI
 ↓
Enterprise Security
 ↓
Knowledge
 ↓
Agents
 ↓
Workflows
 ↓
Production
```

---

# 91. DIFFERENTIATION SECTION

Create:

```text
Built for Real Applications
```

Highlight actual differentiators:

```text
Framework Independent
Application Context
Permission-Aware Tools
AI Action Firewall
Generative UI
OpenAPI → Tools
MCP
Permission-Aware RAG
Durable Workflows
DevTools
Evaluations
Multi-Tenancy
Cost Controls
```

Only include implemented capabilities.

---

# 92. SECURITY-FIRST MESSAGE

A central marketing statement:

```text
AI CAN REASON.

YOUR APPLICATION
DECIDES WHAT IT
CAN DO.
```

Then show Action Firewall.

This should become one of the strongest GIX visual sections.

---

# 93. DEVELOPER-FIRST MESSAGE

Another section:

```text
YOUR APP.
YOUR COMPONENTS.
YOUR TOOLS.
YOUR DATA.
YOUR RULES.
```

---

# 94. ORIGINALITY REQUIREMENT

Important:

The CopilotKit websites are references for:

```text
information hierarchy
developer usability
navigation ideas
documentation discoverability
interactive technical storytelling
```

They are **not templates to copy**.

Do not copy:

```text
exact sections
exact wording
exact CSS
exact illustrations
exact animations
exact page structure
logos
assets
proprietary examples
```

Create an original GIX experience.

---

# 95. SHARED WEBSITE/DOCS DESIGN SYSTEM

Do not make marketing and docs look like unrelated applications.

Architecture:

```text
packages/
└── website-ui/
```

or equivalent shared package.

Share:

```text
tokens
logo
buttons
typography
code styles
cards
icons
navigation primitives
theme
```

---

# 96. DOCUMENTATION GENERATION

Create documentation from:

```text
Repository
+
Phase Docs
+
Public TypeScript APIs
+
Examples
```

Do not manually invent API behavior.

---

# 97. DOCUMENTATION QUALITY PASS

For every page ask:

```text
What is it?

Why use it?

How does it work?

How do I install/configure it?

What is the smallest example?

What happens internally?

What can go wrong?

What are the security implications?

What should I read next?
```

---

# 98. FIRST-TIME USER JOURNEY

A new developer should be able to:

```text
Landing Page
 ↓
Get Started
 ↓
Quickstart
 ↓
Install
 ↓
Configure Model
 ↓
Add Copilot
 ↓
Send Message
 ↓
Add Context
 ↓
Add Tool
 ↓
Add Generative UI
```

without searching external resources.

---

# 99. ENTERPRISE USER JOURNEY

An architect should be able to:

```text
Landing Page
 ↓
Enterprise
 ↓
Architecture
 ↓
Security
 ↓
Action Firewall
 ↓
RAG Permissions
 ↓
Multi-Tenancy
 ↓
Observability
 ↓
Deployment
```

---

# 100. AGENT DEVELOPER JOURNEY

```text
Docs
 ↓
Agents
 ↓
Create Agent
 ↓
Give Tools
 ↓
Give Knowledge
 ↓
Configure Memory
 ↓
Add Specialists
 ↓
Create Workflow
 ↓
Test
 ↓
Evaluate
 ↓
Deploy
```

---

# 101. DOCUMENTATION HOME CARDS

Create cards:

```text
Quickstart
5-minute introduction

React
Build React copilots

Angular
Build Angular copilots

Tools
Connect AI to actions

Generative UI
Render application UI

RAG
Connect enterprise knowledge

Agents
Build autonomous systems

Security
Control AI actions
```

---

# 102. HOMEPAGE LIVE CODE

Create tabs:

```text
React
Angular
Node
```

with real examples.

---

# 103. FEATURE EXPLORER

Optional high-value section:

```text
Copilot
Tools
UI
RAG
Agents
Security
```

Selecting one updates:

```text
architecture visualization
description
code
live preview
```

---

# 104. HOMEPAGE ANIMATION

Create a subtle event flow:

```text
User message
 ↓
Context attached
 ↓
Model reasoning
 ↓
Tool requested
 ↓
Security checked
 ↓
Tool executed
 ↓
UI generated
```

No fake chain-of-thought content.

Display observable runtime events, not hidden reasoning.

---

# 105. NEVER DISPLAY PRIVATE CHAIN OF THOUGHT

If demonstrating AI reasoning, use:

```text
Planning
Selecting tool
Executing tool
Generating response
```

Do not display hidden internal reasoning.

---

# 106. EXAMPLES PAGE

Create searchable/filterable examples.

Filters:

```text
Framework

React
Angular
Node

Capability

Tools
Generative UI
RAG
Agents
Security
MCP
OpenAPI
```

---

# 107. EXAMPLE CARD

```text
Generative UI

React

Turn structured AI output into trusted
application components.

[View Example]
[Source]
```

Only link source if available.

---

# 108. API SEARCH

API reference search should support names such as:

```text
useCopilotContext
defineTool
createAgent
```

using actual APIs.

---

# 109. COPY DEEP LINK

Headings should expose anchor links.

---

# 110. KEYBOARD UX

Support:

```text
Cmd/Ctrl + K → search

Esc → close modal

Arrow keys → search navigation
```

---

# 111. ANALYTICS

Do not add third-party tracking by default.

If analytics architecture exists, respect privacy configuration.

---

# 112. COOKIE BANNER

Do not create one unless cookies/tracking actually require it.

---

# 113. TESTING

Add:

### Unit

```text
navigation
search
theme
MDX components
code blocks
API rendering
```

### Integration

```text
docs navigation
search
routing
theme
responsive navigation
```

### E2E

```text
homepage → docs
docs → quickstart
search → API
mobile menu
copy code
theme
```

---

# 114. ACCESSIBILITY TESTING

Test:

```text
navbar
dropdown
mobile menu
search dialog
sidebar
TOC
tabs
code blocks
interactive demos
```

---

# 115. VISUAL REGRESSION

If existing tooling supports it, capture major pages:

```text
homepage
docs home
quickstart
API reference
security
generative UI
mobile docs
```

---

# 116. PERFORMANCE VALIDATION

Run actual tooling available in repository.

Check:

```text
bundle
images
fonts
search index
hydration
interactive demos
```

---

# 117. SEO VALIDATION

Check:

```text
titles
descriptions
canonical
sitemap
robots
OpenGraph
structured headings
```

---

# 118. DOCS CI

CI should verify:

```text
docs build
broken links
code examples
API generation
search index
```

where tooling supports it.

---

# 119. FINAL VISUAL CHECK

Review every page for:

```text
alignment
spacing
typography
contrast
red usage
dark mode
light mode
code readability
sidebar width
TOC
mobile
RTL readiness
```

---

# 120. FINAL PRODUCT WEBSITE

The finished homepage should communicate this flow:

```text
GIX AI
│
├── Hero
│
├── Frameworks
│
├── Application Awareness
│
├── Tools
│
├── Generative UI
│
├── OpenAPI + MCP
│
├── RAG + Memory
│
├── Agents
│
├── Workflows
│
├── Security / Action Firewall
│
├── DevTools + Evals
│
├── Production
│
├── Quickstart
│
└── CTA
```

---

# 121. FINAL DOCUMENTATION EXPERIENCE

The docs should feel like:

```text
                 GIX AI DOCS

                      Search
                        │
          ┌─────────────┴─────────────┐
          │                           │
       Learn                       Reference
          │                           │
  ┌───────┼────────┐         ┌────────┼─────────┐
  ▼       ▼        ▼         ▼        ▼         ▼
React   Angular   Node      API     Events     CLI
  │
  ▼
Context
  │
  ▼
Tools
  │
  ▼
Generative UI
  │
  ▼
Security
  │
  ▼
RAG
  │
  ▼
Agents
  │
  ▼
Production
```

---

# 122. DOCUMENTATION FILES

Create/update appropriate documentation about the website itself:

```text
docs/website/
├── README.md
├── ARCHITECTURE.md
├── DESIGN_SYSTEM.md
├── CONTENT_STRUCTURE.md
├── DOCS_AUTHORING.md
├── SEARCH.md
├── SEO.md
├── ACCESSIBILITY.md
├── DEPLOYMENT.md
└── MAINTENANCE.md
```

---

# 123. README

Explain how developers can:

```text
run website
run docs
add documentation page
add navigation entry
add code example
add diagram
update API reference
build
test
deploy
```

---

# 124. VALIDATION

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Also run the actual website/docs E2E and accessibility suites.

Record real results only.

---

# 125. COMPLETION REPORT

Return:

```text
GIX AI WEBSITE + DOCUMENTATION


STATUS
COMPLETE / INCOMPLETE


WEBSITE

Homepage:
PASS / FAIL

Navigation:
PASS / FAIL

Hero:
PASS / FAIL

Architecture:
PASS / FAIL

Generative UI:
PASS / FAIL

Tools:
PASS / FAIL

RAG:
PASS / FAIL

Agents:
PASS / FAIL

Security:
PASS / FAIL

DevTools:
PASS / FAIL

Quickstart:
PASS / FAIL

Responsive:
PASS / FAIL

Accessibility:
PASS / FAIL


DOCUMENTATION

Docs Home:
PASS / FAIL

Sidebar:
PASS / FAIL

Search:
PASS / FAIL

TOC:
PASS / FAIL

Quickstart:
PASS / FAIL

React:
PASS / FAIL

Angular:
PASS / FAIL

Node:
PASS / FAIL

Context:
PASS / FAIL

Tools:
PASS / FAIL

Generative UI:
PASS / FAIL

Security:
PASS / FAIL

OpenAPI:
PASS / FAIL

MCP:
PASS / FAIL

RAG:
PASS / FAIL

Memory:
PASS / FAIL

Agents:
PASS / FAIL

Workflows:
PASS / FAIL

DevTools:
PASS / FAIL

Testing:
PASS / FAIL

Evals:
PASS / FAIL

Production:
PASS / FAIL

CLI:
PASS / FAIL

API Reference:
PASS / FAIL


GIX BRAND

Colors:
PASS / FAIL

Typography:
PASS / FAIL

Design Tokens:
PASS / FAIL

Dark Mode:
PASS / FAIL

Light Mode:
PASS / FAIL

Responsive:
PASS / FAIL

RTL Ready:
PASS / FAIL


QUALITY

Lint:
PASS / FAIL

Typecheck:
PASS / FAIL

Tests:
PASS / FAIL

Build:
PASS / FAIL

E2E:
PASS / FAIL

Accessibility:
PASS / FAIL

Broken Links:
PASS / FAIL

Code Examples:
PASS / FAIL


FILES CREATED

- ...


FILES MODIFIED

- ...


DEPENDENCIES

- ...


ARCHITECTURE DECISIONS

- ...


KNOWN ISSUES

- ...


FINAL RESULT

READY / NOT READY
```

---

# FINAL RULE

The objective is **not** to clone CopilotKit.

The objective is to create a GIX-owned developer platform with the same level of documentation quality and developer usability.

The final identity should be:

```text
COPILOTKIT
Reference for developer experience

        ↓

GIX AI
Original architecture
Original design
Original content
Original brand
Enterprise-focused
```

A visitor should immediately recognize:

> This is a GIX product.

And a developer should be able to go from:

```text
"I just discovered GIX AI"
```

to:

```text
"I have my first Copilot running"
```

without leaving the GIX website or documentation.