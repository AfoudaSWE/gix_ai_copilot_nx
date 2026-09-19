# Task: Create the Engineering Skills System for the AI Copilot SDK

You are preparing the engineering instruction system for a new production-grade AI Copilot SDK.

## Important

This task is ONLY about creating the Claude `SKILL.md` files and their supporting structure.

DO NOT implement Phase 1.

DO NOT create the SDK packages yet.

DO NOT implement application features.

DO NOT install application dependencies.

DO NOT build the Copilot.

DO NOT proceed to any development phase after completing the skills.

When all skills have been created and validated, STOP and provide a completion report.

---

# 1. Project Vision

We are building a production-grade, TypeScript-first AI Copilot and Agent SDK.

The project should eventually support:

* Framework-independent core
* React SDK
* Angular SDK
* Node.js server SDK
* LLM provider adapters
* Streaming
* Application-aware context
* Shared state
* Frontend tools
* Backend tools
* Structured outputs
* Generative UI
* Human-in-the-loop
* Approval workflows
* AI Action Firewall
* Authentication integration
* RBAC
* ABAC
* PII protection
* Audit trails
* OpenAPI → AI tools
* MCP
* RAG
* Knowledge management
* Memory
* Agent runtime
* Multi-agent systems
* Workflows
* Long-running agents
* DevTools
* Tracing
* Evaluations
* Simulation
* React support
* Angular support
* CLI
* Multi-tenancy
* Usage tracking
* Cost controls
* Enterprise management platform

The project is NOT merely a chatbot component.

The long-term goal is:

> A framework-independent enterprise SDK for building safe, observable, application-aware AI copilots and agents capable of interacting with real software systems.

---

# 2. Architectural Principle

The architecture must follow:

```text
TypeScript Core
      ↓
Own Protocol
      ↓
Own Runtime
      ↓
Adapters
```

External technologies must generally be integrations/adapters rather than hard dependencies of the core.

Examples:

```text
React       → adapter
Angular     → adapter

OpenAI      → provider adapter
Anthropic   → provider adapter
Gemini      → provider adapter
Ollama      → provider adapter

OpenAPI     → integration
MCP         → integration

PostgreSQL  → persistence adapter
Redis       → infrastructure adapter
```

The core must remain framework-independent.

---

# 3. Planned Technology Stack

The skills should assume the following preferred stack unless a later architecture decision explicitly changes it:

```text
Language
TypeScript

Runtime
Node.js

Monorepo
Nx
pnpm

Validation
Zod

Backend
Fastify

Streaming
HTTP + SSE

Optional realtime
WebSocket

Frontend
React

Secondary frontend adapter
Angular

Database
PostgreSQL

ORM
Drizzle ORM

Vector search
pgvector

Cache
Redis

Jobs
BullMQ

API
OpenAPI 3.1

Agent/tool interoperability
MCP

Observability
OpenTelemetry

Unit/integration testing
Vitest

Browser testing
Playwright

Documentation
Next.js + MDX

Deployment
Docker

Package distribution
npm
```

Do not treat all of these as dependencies that must immediately be installed.

They describe the planned architecture.

---

# 4. Fixed Development Phases

The project has exactly 12 high-level implementation phases.

These phases are currently fixed.

```text
Phase 01
Foundation & Architecture

Phase 02
LLM Runtime & Streaming

Phase 03
React Copilot UI

Phase 04
Application Context & State

Phase 05
Tools & Agent Actions

Phase 06
Generative UI & Shared State

Phase 07
Enterprise Security & HITL

Phase 08
OpenAPI + MCP + Integrations

Phase 09
Knowledge + RAG + Memory

Phase 10
Agents + Multi-Agent + Workflows

Phase 11
DevTools + Testing + Evals + Observability

Phase 12
Production Platform + Ecosystem
```

A critical requirement is that Claude must NEVER automatically continue from one phase to another.

The user explicitly controls phase progression.

---

# 5. Create Skills Directory

Create:

```text
.claude/
└── skills/
```

Inside it, create the following skill directories.

```text
.claude/skills/

ai-copilot-project/
project-architecture/
typescript-standards/
nx-monorepo/
sdk-design/
protocol-design/
node-backend/
react-sdk/
angular-sdk/
ai-runtime/
tool-system/
agent-architecture/
context-engine/
generative-ui/
security/
action-firewall/
hitl/
openapi-tools/
mcp/
rag/
memory/
observability/
testing/
ai-evals/
devtools/
database/
redis-jobs/
api-design/
performance/
accessibility/
documentation/
git-workflow/
code-review/
dependency-policy/
backward-compatibility/
phase-gate/
```

Every directory must contain:

```text
SKILL.md
```

---

# 6. Required Skills

Create all of the following.

## 6.1 ai-copilot-project

This is the MASTER project skill.

It must explain:

* Project vision
* Architectural principles
* 12 phases
* Technology direction
* Package philosophy
* Security philosophy
* Testing philosophy
* Documentation philosophy
* Adapter-first architecture
* Framework independence
* Phase-gate requirement

It should also explain when Claude should consult each specialized skill.

This file should remain concise enough to act as a navigation/index skill.

Do not duplicate every specialized skill inside it.

---

## 6.2 project-architecture

Define architectural rules.

Must include:

* framework-independent core
* dependency direction
* package boundaries
* domain boundaries
* public vs internal APIs
* adapter architecture
* runtime architecture
* transport abstraction
* storage abstraction
* model abstraction
* tool abstraction
* security boundaries
* no circular dependencies
* dependency inversion
* separation of concerns

Target conceptual architecture:

```text
Framework SDKs
      ↓
Client SDK
      ↓
Protocol
      ↓
Server
      ↓
Core Runtime
      ↓
Agents / Context / Tools
      ↓
Adapters
```

---

## 6.3 typescript-standards

Define strict TypeScript engineering rules.

Include:

* strict mode
* avoid `any`
* prefer `unknown`
* explicit public types
* discriminated unions
* generics
* immutable data where appropriate
* error typing
* exhaustive switches
* type-only imports
* naming conventions
* interfaces vs types guidance
* no unsafe casts without justification
* API documentation
* barrel export rules
* public API stability

---

## 6.4 nx-monorepo

Define Nx + pnpm rules.

Include:

* package organization
* apps vs libraries
* tags
* dependency boundaries
* buildable/publishable libraries
* test targets
* lint targets
* affected commands
* caching
* package naming
* avoiding cross-package internal imports

Future package direction:

```text
@aicopilot/protocol
@aicopilot/core
@aicopilot/client
@aicopilot/server
@aicopilot/react
@aicopilot/angular
@aicopilot/ui
@aicopilot/agents
@aicopilot/tools
@aicopilot/context
@aicopilot/memory
@aicopilot/rag
@aicopilot/openapi
@aicopilot/mcp
@aicopilot/security
@aicopilot/telemetry
@aicopilot/evals
@aicopilot/devtools
```

These are planned packages, not instructions to create them during this task.

---

## 6.5 sdk-design

Define rules for developer-facing SDK APIs.

Include:

* simple defaults
* progressive disclosure
* headless APIs
* composability
* stable public contracts
* tree shaking
* minimal dependencies
* typed configuration
* extension points
* plugin/adapter architecture
* error design
* lifecycle APIs
* async APIs
* cancellation
* backward compatibility

---

## 6.6 protocol-design

Define the future Copilot protocol principles.

Cover:

```text
Message
Thread
Run
Event
ToolCall
ToolResult
State
Context
Approval
Usage
Error
```

Include event-driven design, versioning, ordering, correlation IDs, idempotency where appropriate, cancellation, reconnect, streaming, backwards compatibility and transport independence.

Do not implement the protocol during this task.

---

## 6.7 node-backend

Define Node.js server engineering standards.

Preferred stack:

```text
Node.js
TypeScript
Fastify
Zod
```

Cover:

* routes
* services
* dependency injection
* configuration
* logging
* error handling
* streaming
* graceful shutdown
* validation
* security
* testing
* separation from AI provider implementations

---

## 6.8 react-sdk

Define React SDK standards.

Cover:

* provider architecture
* hooks
* headless hooks
* UI separation
* controlled/uncontrolled APIs
* render optimization
* React state boundaries
* accessibility
* SSR considerations
* error boundaries
* Suspense only where justified
* framework-neutral core

Potential future APIs:

```text
CopilotProvider
useCopilot
useCopilotChat
useAgent
useMessages
useThread
useCopilotContext
useCopilotState
useFrontendTool
```

Do not implement them now.

---

## 6.9 angular-sdk

Define how Angular will wrap the same core.

Cover:

* Angular services
* providers
* signals
* dependency injection
* directives/components
* RxJS only where appropriate
* no duplicate runtime implementation
* framework-independent core requirement

---

## 6.10 ai-runtime

Define AI runtime architecture.

Cover:

* model abstraction
* provider adapters
* streaming
* retries
* timeout
* cancellation
* usage
* token accounting
* normalized errors
* provider independence
* execution lifecycle
* model fallback
* model routing

---

## 6.11 tool-system

Define tool architecture.

Cover:

```text
Tool Definition
Tool Registry
Frontend Tool
Backend Tool
Remote Tool
Tool Schema
Tool Execution
Tool Result
Tool Error
```

Include:

* Zod validation
* typed inputs
* typed outputs
* namespaces
* versioning
* discovery
* middleware
* cancellation
* timeout
* parallel execution
* permission metadata

---

## 6.12 agent-architecture

Define future agent principles.

Cover:

* agent definition
* instructions
* models
* tools
* knowledge
* state
* lifecycle
* delegation
* handoff
* routing
* orchestration
* planner/executor separation
* specialist agents
* long-running execution

Avoid tying the core to LangChain or any external agent framework.

---

## 6.13 context-engine

Define context management.

Cover:

```text
System Context
User Context
Application Context
Page Context
Component Context
Session Context
Conversation Context
RAG Context
Tool Context
```

Include:

* priority
* token budgeting
* deduplication
* compression
* summarization
* sensitivity
* serialization
* scopes
* debugging

---

## 6.14 generative-ui

Define safe Generative UI architecture.

Critical rule:

The model must NOT generate executable JavaScript or arbitrary React code.

Use:

```text
Model
 ↓
Structured component request
 ↓
Schema validation
 ↓
Trusted Component Registry
 ↓
React component
```

Cover:

* component registry
* schemas
* props validation
* streaming UI
* tool-result rendering
* loading states
* errors
* interactive actions
* security

---

## 6.15 security

Define security principles.

Cover:

* zero trust for model output
* authentication boundaries
* authorization
* RBAC
* ABAC
* tenant isolation
* secrets
* PII
* prompt injection
* tool security
* RAG security
* input validation
* output validation
* audit
* rate limiting
* least privilege

Critical rule:

Never rely on system prompts as the security boundary.

---

## 6.16 action-firewall

Define the AI Action Firewall.

Every consequential agent tool request should conceptually pass through:

```text
Tool Request
    ↓
Authentication
    ↓
Authorization
    ↓
RBAC / ABAC
    ↓
Schema Validation
    ↓
Business Policies
    ↓
PII / Data Policy
    ↓
Rate Limit
    ↓
Approval Policy
    ↓
Audit
    ↓
Execution
```

Define:

* allow
* deny
* require approval
* dry-run
* explain-before-execute
* reversible
* compensatable
* irreversible actions

---

## 6.17 hitl

Define Human-in-the-Loop architecture.

Support future approval levels:

```text
NONE
USER_CONFIRMATION
SUPERVISOR_APPROVAL
ADMIN_APPROVAL
TWO_PERSON_APPROVAL
```

Cover:

* pause
* resume
* interrupt
* approve
* reject
* expiration
* audit
* authorization
* approval state

---

## 6.18 openapi-tools

Define OpenAPI → Tool architecture.

Cover:

* OpenAPI 3.1
* endpoint discovery
* operationId
* schemas
* parameters
* auth
* tool names
* descriptions
* allowlists
* denylists
* approval policies
* overrides
* generated vs runtime tools

Never automatically expose all API endpoints to the model.

---

## 6.19 mcp

Define MCP integration architecture.

Cover:

* MCP client
* server connections
* tool discovery
* resources
* prompts
* schema mapping
* connection lifecycle
* authentication
* failures
* Action Firewall integration

MCP tools must not bypass the normal security pipeline.

---

## 6.20 rag

Define RAG architecture.

Cover:

```text
Source
 ↓
Loader
 ↓
Parser
 ↓
Chunker
 ↓
Embeddings
 ↓
Vector Store
 ↓
Retriever
 ↓
ACL Filter
 ↓
Optional Reranker
 ↓
Context
```

Preferred initial vector solution:

```text
PostgreSQL + pgvector
```

Include:

* metadata
* provenance
* citations
* tenant isolation
* permission-aware retrieval
* evaluation

---

## 6.21 memory

Clearly distinguish:

```text
Conversation History
Working Memory
Session Memory
Durable Memory
Semantic Memory
```

Cover:

* storage
* retrieval
* expiration
* user control
* tenant isolation
* security
* avoiding accidental permanent storage

---

## 6.22 observability

Use OpenTelemetry as the preferred foundation.

Cover tracing of:

* runs
* model calls
* tools
* RAG
* workflows
* approvals

Metrics:

* latency
* tokens
* cost
* errors
* retries
* tool duration

Include correlation IDs and structured logs.

---

## 6.23 testing

Preferred technologies:

```text
Vitest
Playwright
MSW
Testcontainers where justified
```

Define:

* unit tests
* integration tests
* protocol tests
* contract tests
* browser tests
* security tests
* regression tests

Require deterministic tests wherever possible.

---

## 6.24 ai-evals

Define AI-specific evaluation principles.

Cover:

* datasets
* expected tools
* forbidden tools
* groundedness
* task completion
* permission compliance
* regression testing
* model comparison
* prompt comparison
* latency
* token usage
* cost

Do not present subjective model judging as mathematically certain.

---

## 6.25 devtools

Define future AI DevTools.

Future panels:

```text
Messages
Agent
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

Cover:

* context inspector
* tool inspector
* trace visualization
* event timeline
* conversation replay
* state debugging
* prompt/version inspection

---

## 6.26 database

Preferred initial persistence:

```text
PostgreSQL
Drizzle ORM
pgvector
```

Define:

* schema conventions
* migrations
* transactions
* indexes
* tenant keys
* timestamps
* optimistic concurrency
* repository/adapters
* no database coupling in core

---

## 6.27 redis-jobs

Preferred technologies:

```text
Redis
BullMQ
```

Cover:

* background jobs
* retries
* idempotency
* job status
* cancellation
* checkpoints
* dead-letter handling
* observability

---

## 6.28 api-design

Define API conventions.

Cover:

* REST where appropriate
* resource naming
* versioning
* request IDs
* errors
* validation
* pagination
* idempotency
* OpenAPI
* streaming endpoints
* status codes

---

## 6.29 performance

Define performance rules.

Track:

* browser bundle size
* startup time
* streaming first-token latency
* server latency
* context building
* RAG latency
* tool latency
* unnecessary React renders
* memory
* database queries

Require measurement before optimization.

---

## 6.30 accessibility

Define UI requirements.

Include:

* WCAG
* keyboard navigation
* focus management
* screen readers
* ARIA
* reduced motion
* responsive UI
* RTL
* internationalization readiness

---

## 6.31 documentation

Require:

* README
* package README
* API docs
* architecture docs
* ADRs
* examples
* migration guides
* troubleshooting
* security notes

Documentation examples must compile whenever practical.

---

## 6.32 git-workflow

Define:

* conventional commits
* small focused commits
* no unrelated modifications
* meaningful commit messages
* branch conventions
* PR expectations
* changelog considerations

Example:

```text
feat(protocol): add typed run events

test(protocol): cover event serialization

docs(architecture): document protocol boundaries
```

---

## 6.33 code-review

Create a mandatory self-review checklist.

Before Claude reports a development task as complete, verify:

* requirements
* architecture
* types
* tests
* security
* performance
* public APIs
* documentation
* backwards compatibility
* unnecessary dependencies
* dead code
* formatting
* lint
* build

Claude must not claim tests/builds passed unless they were actually executed.

---

## 6.34 dependency-policy

Define strict dependency rules.

Before adding a dependency:

1. Explain what problem it solves.
2. Determine whether the platform already solves it.
3. Check maintenance implications.
4. Consider bundle size.
5. Consider security.
6. Avoid dependency duplication.
7. Keep core dependencies minimal.
8. Prefer adapters for optional functionality.

Do not add major frameworks merely for convenience.

---

## 6.35 backward-compatibility

Define:

* Semantic Versioning
* public API compatibility
* protocol versions
* event compatibility
* schema evolution
* deprecation
* migration paths
* feature detection
* adapters

Breaking changes require explicit justification.

---

## 6.36 phase-gate

This is mandatory and should contain strict instructions.

Use these principles:

```text
PHASE GATE

Development occurs sequentially.

Claude must work ONLY on the phase explicitly requested by the user.

Claude MUST NOT automatically begin another phase.

Claude MUST NOT implement future-phase functionality because it appears useful.

Claude may create an abstraction boundary needed by the current phase, but must not implement the future feature behind it.

At the beginning of a phase:

1. Identify current phase.
2. Read relevant skills.
3. Inspect repository state.
4. Produce/confirm implementation plan.
5. Work only inside approved scope.

During implementation:

1. Follow current phase requirements.
2. Keep changes scoped.
3. Test continuously.
4. Do not hide failures.
5. Do not silently expand scope.

At completion:

1. Run required tests.
2. Run lint.
3. Run typecheck.
4. Run build where applicable.
5. Review git diff.
6. Perform self-review.
7. Update documentation required by the phase.
8. Produce a completion report.
9. Identify remaining issues honestly.
10. STOP.

Never continue to the next phase unless the user explicitly requests it.
```

---

# 7. Skill File Quality Requirements

Every `SKILL.md` must be practical.

Avoid vague instructions such as:

> Write clean code.

Instead write enforceable rules such as:

> Public package APIs must not expose internal implementation types.

or:

> Model-generated tool arguments must be schema validated before tool execution.

Each skill should generally contain:

```text
---
name:
description:
---

# Purpose

# When to Apply

# Required Rules

# Architecture / Patterns

# Anti-Patterns

# Validation Checklist
```

Adapt this structure when another structure makes more sense.

---

# 8. Avoid Duplication

Do not copy the same long security rules into every skill.

Reference the relevant skill instead.

Examples:

```text
Tool execution security
→ action-firewall skill

General security
→ security skill

TypeScript rules
→ typescript-standards skill

Testing requirements
→ testing skill
```

Skills should work together as a coherent engineering handbook.

---

# 9. Add Skill Routing

Inside the master `ai-copilot-project/SKILL.md`, create a routing table.

Example:

```text
Task                         Required Skills
------------------------------------------------------------
Architecture                 project-architecture
TypeScript implementation    typescript-standards
Monorepo                     nx-monorepo
Public SDK API               sdk-design
Protocol                     protocol-design
Node backend                 node-backend
React                        react-sdk
Angular                      angular-sdk
Model runtime                ai-runtime
Tools                        tool-system
Agents                       agent-architecture
Context                      context-engine
Generative UI                generative-ui
Security                     security + action-firewall
Approval                     hitl
OpenAPI                      openapi-tools
MCP                          mcp
RAG                          rag
Memory                       memory
Tracing                      observability
Tests                        testing
AI evaluation                ai-evals
DevTools                     devtools
Database                     database
Jobs                         redis-jobs
API                          api-design
Performance                  performance
Accessibility                accessibility
Documentation                documentation
Git                          git-workflow
Review                       code-review
Dependencies                 dependency-policy
Compatibility                backward-compatibility
Every phase                  phase-gate
```

---

# 10. Phase-to-Skill Mapping

Also include a phase mapping.

### Phase 1

Primary skills:

```text
ai-copilot-project
project-architecture
typescript-standards
nx-monorepo
sdk-design
protocol-design
testing
documentation
git-workflow
code-review
dependency-policy
backward-compatibility
phase-gate
```

### Phase 2

Add:

```text
ai-runtime
node-backend
api-design
observability
```

### Phase 3

Add:

```text
react-sdk
accessibility
performance
```

### Phase 4

Add:

```text
context-engine
```

### Phase 5

Add:

```text
tool-system
security
```

### Phase 6

Add:

```text
generative-ui
```

### Phase 7

Add:

```text
security
action-firewall
hitl
```

### Phase 8

Add:

```text
openapi-tools
mcp
```

### Phase 9

Add:

```text
rag
memory
database
```

### Phase 10

Add:

```text
agent-architecture
redis-jobs
```

### Phase 11

Add:

```text
observability
devtools
ai-evals
testing
```

### Phase 12

Use all relevant skills, particularly:

```text
angular-sdk
performance
documentation
backward-compatibility
dependency-policy
```

---

# 11. Create a Skills README

Also create:

```text
.claude/skills/README.md
```

It should explain:

* what these skills are
* directory structure
* how skills are selected
* the master skill
* phase-gate behavior
* how to add new skills
* how to modify existing skills
* how to avoid duplicated rules

Include the complete skills table.

---

# 12. Validate the Skill System

After creating the files, validate them.

Check:

1. Every required directory exists.
2. Every required `SKILL.md` exists.
3. Frontmatter is valid.
4. Skill names are consistent.
5. No duplicate skill names.
6. Master skill references valid skills.
7. Phase mappings reference valid skills.
8. No skill accidentally instructs Claude to implement a product phase.
9. No skill contradicts the framework-independent core principle.
10. Security rules consistently treat model output as untrusted.
11. Tool rules require schema validation.
12. MCP/OpenAPI tools go through the same security pipeline.
13. RAG includes authorization before retrieval/context exposure.
14. Git/testing instructions prohibit false success claims.
15. Phase Gate explicitly prevents automatic progression.

If practical, create a small validation script that checks the skills directory structure and frontmatter.

Do not introduce a large dependency solely for this validation script.

---

# 13. Expected Final Structure

The result should resemble:

```text
.claude/
└── skills/
    ├── README.md
    │
    ├── ai-copilot-project/
    │   └── SKILL.md
    ├── project-architecture/
    │   └── SKILL.md
    ├── typescript-standards/
    │   └── SKILL.md
    ├── nx-monorepo/
    │   └── SKILL.md
    ├── sdk-design/
    │   └── SKILL.md
    ├── protocol-design/
    │   └── SKILL.md
    ├── node-backend/
    │   └── SKILL.md
    ├── react-sdk/
    │   └── SKILL.md
    ├── angular-sdk/
    │   └── SKILL.md
    ├── ai-runtime/
    │   └── SKILL.md
    ├── tool-system/
    │   └── SKILL.md
    ├── agent-architecture/
    │   └── SKILL.md
    ├── context-engine/
    │   └── SKILL.md
    ├── generative-ui/
    │   └── SKILL.md
    ├── security/
    │   └── SKILL.md
    ├── action-firewall/
    │   └── SKILL.md
    ├── hitl/
    │   └── SKILL.md
    ├── openapi-tools/
    │   └── SKILL.md
    ├── mcp/
    │   └── SKILL.md
    ├── rag/
    │   └── SKILL.md
    ├── memory/
    │   └── SKILL.md
    ├── observability/
    │   └── SKILL.md
    ├── testing/
    │   └── SKILL.md
    ├── ai-evals/
    │   └── SKILL.md
    ├── devtools/
    │   └── SKILL.md
    ├── database/
    │   └── SKILL.md
    ├── redis-jobs/
    │   └── SKILL.md
    ├── api-design/
    │   └── SKILL.md
    ├── performance/
    │   └── SKILL.md
    ├── accessibility/
    │   └── SKILL.md
    ├── documentation/
    │   └── SKILL.md
    ├── git-workflow/
    │   └── SKILL.md
    ├── code-review/
    │   └── SKILL.md
    ├── dependency-policy/
    │   └── SKILL.md
    ├── backward-compatibility/
    │   └── SKILL.md
    └── phase-gate/
        └── SKILL.md
```

---

# 14. Completion Report

After creating and validating everything, respond with:

```text
AI COPILOT SKILLS SETUP

Status:
COMPLETE / INCOMPLETE

Skills created:
X / 36

Master skill:
PASS / FAIL

Skill routing:
PASS / FAIL

Phase mapping:
PASS / FAIL

Phase Gate:
PASS / FAIL

Validation:
PASS / FAIL

Files created:
...

Important decisions:
...

Problems found:
...

Remaining work:
...
```

If something failed, report it honestly.

Do not claim validation passed unless it was actually performed.

---

# 15. Final Stop Condition

After the skill system is created and validated:

STOP.

Do NOT:

* start Phase 1
* initialize the SDK monorepo
* create product packages
* install the future SDK stack
* implement protocol types
* implement AI runtime
* implement React components
* implement tools
* implement agents

Wait for the user's explicit Phase 1 prompt.
