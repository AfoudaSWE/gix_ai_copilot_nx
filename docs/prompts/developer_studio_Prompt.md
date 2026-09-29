# GIX Copilot — Developer Studio, Discovery & Safe Generation Enhancement

## Mission

Enhance the existing GIX Copilot SDK with a complete **development-time integration control plane**.

The target developer journey is:

```text
npm add gixcopilot
        ↓
npx gixcopilot init
        ↓
Minimal GIX Integration
        ↓
Run Application
        ↓
Open /__gix
        ↓
DEVELOPMENT STUDIO
        ↓
Configuration
        ↓
Discovery
        ↓
Generators
        ↓
Preview / Diff
        ↓
Developer Approval
        ↓
Apply Selected Changes
        ↓
Validation
        ↓
Test Copilot
```

Diagnostics is NOT a sequential wizard step.

Diagnostics is a persistent health layer available throughout the entire Developer Studio.

The most important product principle is:

> AI proposes. The developer decides.

No discovery, AI analysis, or generator is allowed to silently modify the consumer application.

---

# 0. READ THE EXISTING REPOSITORY FIRST

Before writing code, inspect:

```text
README.md
AGENTS.md
CONSTITUTION.md

docs/PROJECT_STATUS.md
docs/architecture/
docs/adr/
docs/guides/

.claude/skills/
```

Inspect all relevant existing packages, especially:

```text
packages/protocol
packages/core
packages/client
packages/server

packages/headless
packages/react
packages/angular
packages/vue
packages/ui

packages/context
packages/tools
packages/generative-ui
packages/security

packages/openapi
packages/mcp
packages/connectors

packages/knowledge
packages/rag
packages/memory

packages/agents
packages/workflows
packages/jobs

packages/telemetry
packages/devtools
packages/testing
packages/evals

packages/config
packages/management

packages/create
packages/cli
packages/node

packages/providers/
```

Also inspect:

```text
apps/devtools
apps/platform
apps/api
apps/docs
```

where present.

The repository is the source of truth.

Do not recreate functionality that already exists.

---

# 1. ARCHITECTURAL DECISION — TWO PLANES

Introduce and document a clear architectural separation between:

```text
DEVELOPMENT PLANE
```

and:

```text
APPLICATION PLANE
```

Target:

```text
                        GIX COPILOT
                            │
             ┌──────────────┴──────────────┐
             │                             │
             ▼                             ▼

      DEVELOPMENT PLANE              APPLICATION PLANE

         /__gix                       End-user Copilot
             │                             │
             │                             │
      Project Discovery              Business Context
      API Discovery                  Business Tools
      Code Analysis                  Business Agents
      UI Discovery                   Business Skills
      Context Discovery              Generative UI
      Security Analysis              Knowledge / RAG
      Generators                     Application State
      Preview / Diff
      Diagnostics
             │                             │
             └──────────────┬──────────────┘
                            │
                            ▼
                     GIX CORE RUNTIME
                            │
                            ▼
                    ACTION FIREWALL
```

This distinction must exist in:

- architecture
- types
- configuration
- runtime registration
- security
- Studio
- tests
- documentation.

---

# 2. DEVELOPMENT PLANE

The Development Plane exists only to help developers integrate and configure GIX Copilot.

It can contain capabilities such as:

```text
repo.*
project.*
api.*
code.*
git.*
validate.*
ui discovery
context discovery
security analysis
configuration analysis
diagnostics
```

and internal development agents such as:

```text
project-discovery
repo-explorer
api-explorer
tool-builder
context-analyzer
ui-analyzer
security-analyzer
```

These capabilities power `/__gix`.

They are NOT automatically application Copilot capabilities.

---

# 3. APPLICATION PLANE

The Application Plane is what the application's real users interact with.

Example generated/configured capabilities:

```text
applications.list
applications.get
applications.create

payments.getStatus

appointments.list
appointments.cancel

customers.get
customers.search
```

Application context might include:

```text
currentUser
currentPage
currentApplication
selectedCustomer
tenant
permissions
```

Application agents might include:

```text
application-assistant
payment-assistant
appointment-assistant
customer-support-agent
```

These are application/domain capabilities.

---

# 4. CRITICAL SECURITY RULE

Installing GIX Copilot must NOT automatically expose Development Plane capabilities to the production Copilot.

For example:

```text
repo.readFile
repo.search
repo.applyPatch
shell.run
git.commit
project.detect
api.discover
```

must NOT become normal end-user Copilot tools.

Default:

```text
Development Plane
→ development only

Application Plane
→ explicit application configuration
```

Production builds must not expose Development Plane endpoints or tools unless there is a separately designed and explicitly authorized feature.

---

# 5. DEVELOPMENT STUDIO

Create/enhance a development-only Studio.

Canonical route:

```text
/__gix
```

Preferred sections:

```text
Overview

Configuration
├── Appearance
├── Models
├── Copilot
└── Security

Discovery
├── Project
├── APIs
├── Components
├── Context
├── Auth & Permissions
└── Knowledge

Generators
├── API → Tools
├── OpenAPI → Tools
├── State → Context
├── Components → Generative UI
├── Auth → Security Policies
├── Project → Agents
├── Project → Skills
└── Docs → Knowledge

Review
├── Proposed Changes
├── Diff
├── Security Review
└── Approval

Diagnostics

DevTools
```

Do not make this a generic admin dashboard.

It is a developer integration workspace.

---

# 6. DEVELOPMENT-ONLY ENFORCEMENT

Client-side hiding is insufficient.

Both:

```text
/__gix
```

and:

```text
/__gix/api/*
```

must be unavailable in production.

Target:

```text
DEVELOPMENT
→ Studio registered

PRODUCTION
→ Studio not registered / 404
```

Add automated tests proving this.

---

# 7. CONFIGURATION

The first major Studio experience is Configuration.

The developer should be able to configure:

## Appearance

```text
Copilot Name
Title
Subtitle
Welcome Message
Placeholder

Logo
Assistant Avatar

Primary Color
Accent Color
Background
Surface
Text
Muted
Border
Success
Warning
Error

Light / Dark / System

Popup / Sidebar / Embedded
Position
Width
Height
Radius
```

Reuse the real `@gixcopilot/ui`.

Do not create a fake preview implementation.

Changes should appear in a live Copilot preview.

---

# 8. MODEL CONFIGURATION

Initially support the existing OpenAI provider.

Architecture must remain provider-neutral.

Studio fields:

```text
Provider
API Key
Model
Base URL if supported
Timeout
Retries
```

The browser must never receive an existing stored API key.

Allowed browser response:

```json
{
  "provider": "openai",
  "configured": true
}
```

Forbidden:

```json
{
  "apiKey": "sk-..."
}
```

---

# 9. TEST MODEL CONNECTION

Provide:

```text
[Test Connection]
```

Flow:

```text
Studio
 ↓
Development Server
 ↓
Existing Provider Adapter
 ↓
Model
```

Never call OpenAI directly from React.

Return only safe diagnostics:

```text
success
provider
model
latency
normalized error
```

---

# 10. COPILOT CONFIGURATION

Configure supported properties such as:

```text
name
description
system instructions
default model
welcome message
suggestions
streaming
attachments if implemented
```

Explicitly communicate:

> System instructions influence model behavior. They are not a security boundary.

---

# 11. SECURITY CONFIGURATION

Show:

```text
Action Firewall
Default Policy
Approval Policy
PII Protection
Audit
Tool Policies
```

Security configuration must reuse existing `@gixcopilot/security`.

Do not create a Studio-only security system.

---

# 12. DISCOVERY PRINCIPLE

All discovery is:

```text
READ ONLY
```

Discovery must never modify source files.

Flow:

```text
Repository
   ↓
Discovery
   ↓
Normalized Model
   ↓
Discovery Report
```

No:

```text
Discovery
→ Write Files
```

---

# 13. PROJECT DISCOVERY

Create/reuse:

```text
discoverProject
```

Developer action:

```text
[ Discover Project ]
```

Inspect:

```text
workspace
framework
language
package manager

applications
libraries

frontend
backend

entry points
routes

APIs
components
state

authentication
authorization
permissions

documentation
database

tests
build tooling

existing GIX integration
```

---

# 14. PROJECT DETECTORS

Use adapter/detector architecture.

Support what the current repository can reliably support.

Target candidates:

```text
Nx
React
Angular
Vue
Next.js
Vite

Node.js
Fastify
Express
NestJS

TypeScript
JavaScript
```

Do not create brittle framework assumptions in the core.

---

# 15. NORMALIZED PROJECT MODEL

Create a typed normalized discovery representation.

Conceptually:

```ts
interface DiscoveredProject {
  workspace: WorkspaceInfo;
  frameworks: FrameworkInfo[];
  applications: ApplicationInfo[];
  libraries: LibraryInfo[];

  apis: ApiSource[];
  routes: RouteInfo[];
  components: ComponentInfo[];

  contextCandidates: ContextCandidate[];

  authentication?: AuthenticationInfo;
  permissions: PermissionInfo[];

  knowledgeSources: KnowledgeCandidate[];

  diagnostics: DiscoveryDiagnostic[];
}
```

Use repository naming standards.

---

# 16. DISCOVERY REPORT

Example UI:

```text
PROJECT DISCOVERY


Workspace

Nx


Frontend

React


Backend

Node / Fastify


Language

TypeScript


DISCOVERED

Applications                 3
Libraries                   12
API Operations              42
Routes                      19
Components                  84
Context Candidates           7
Permissions                 14
Knowledge Sources            9
```

Do not fabricate counts.

Everything must come from actual discovery.

---

# 17. API DISCOVERY

Provide:

```text
[ Discover APIs ]
```

Find supported API definitions from sources such as:

```text
OpenAPI
Swagger

frontend API services
typed clients

backend routes

fetch wrappers
supported HTTP clients
```

Use AST/schema/framework adapters where appropriate.

Do not rely exclusively on regex.

---

# 18. API DISCOVERY RESULT

Example:

```text
METHOD    PATH                         SOURCE

GET       /applications               application-api
GET       /applications/{id}          application-api
POST      /applications               application-api
PUT       /applications/{id}          application-api
DELETE    /applications/{id}          application-api
```

Each operation should expose discovered metadata where available:

```text
method
path
operationId
input
output
authentication
permissions
source
```

---

# 19. COMPONENT DISCOVERY

Provide:

```text
[ Discover Components ]
```

Analyze supported frontend frameworks.

Find potential trusted Generative UI components.

Example:

```text
ApplicationSummary
PaymentStatusCard
AppointmentList
CustomerProfile
```

Discovery does NOT register them.

It only recommends candidates.

---

# 20. CONTEXT DISCOVERY

Provide:

```text
[ Discover Context ]
```

Find useful application context candidates such as:

```text
currentUser
currentRoute
currentApplication
selectedEntity
tenant
permissions
pageState
applicationState
```

Again:

```text
discover
≠
register
```

---

# 21. AUTHENTICATION DISCOVERY

Provide read-only analysis for:

```text
authentication mechanism
user model
session mechanism
token handling
authorization patterns
permission definitions
```

Never expose authentication secrets.

---

# 22. PERMISSION DISCOVERY

Discover permission constants/definitions where possible.

Example:

```text
APPLICATION_VIEW
APPLICATION_UPDATE
APPLICATION_DELETE

PAYMENT_VIEW

APPOINTMENT_CANCEL
```

These become candidates for generated tool policies.

They are not automatically trusted.

---

# 23. KNOWLEDGE DISCOVERY

Discover potential sources:

```text
README
docs/
Markdown
API documentation
architecture documentation
supported PDFs/documents
```

Do not automatically index them.

The developer chooses what becomes knowledge.

---

# 24. DISCOVERY SAFETY

Discovery must:

```text
respect workspace root
respect ignore rules
skip node_modules
skip build output
skip .git
bound file size
bound result count
support cancellation
avoid secrets
```

Default secret exclusions:

```text
.env
.env.*
*.pem
*.key

id_rsa
id_ed25519

credentials.*
secrets.*
```

---

# 25. DIAGNOSTICS IS CROSS-CUTTING

Diagnostics must NOT exist only after Discovery.

It must be continuously available.

Architecture:

```text
                    DIAGNOSTICS
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼

 Configuration       Discovery        Generators
        │                │                │
        └────────────────┼────────────────┘
                         │
                         ▼
                    Review / Diff
                         │
                         ▼
                       Apply
                         │
                         ▼
                    Validation
```

---

# 26. DIAGNOSTICS BEFORE DISCOVERY

Example:

```text
Runtime                 ✓ Healthy
Server                  ✓ Connected
Provider                ✓ Connected
Streaming               ✓ Working
Action Firewall         ✓ Enabled
DevTools                ✓ Connected

Project Discovery       Not run
API Discovery           Not run

Generated Tools         0
Generated Context       0
```

---

# 27. DIAGNOSTICS AFTER DISCOVERY

Example:

```text
Project Discovery       ✓ Complete

APIs                    42
Components              84
Permissions             14
Context Candidates       7

Discovery Warnings       2
```

---

# 28. DIAGNOSTICS AFTER GENERATION

Example:

```text
Tool Candidates          31
Context Candidates        5
UI Candidates             4

Security Warnings         3
Conflicts                 1
```

---

# 29. DIAGNOSTICS AFTER APPLY

Example:

```text
Registered Tools         27
Context Sources           5
Generative UI             4

Typecheck                 ✓
Tests                     ✓
Security                  ✓
Integration               ✓
```

---

# 30. GENERATORS

Generators turn discovery data into proposals.

They do NOT directly mutate the repository.

Canonical architecture:

```text
Discovery Data
      ↓
Generator
      ↓
Proposal
      ↓
Preview
      ↓
Developer Approval
      ↓
Apply
```

---

# 31. GENERATOR CONTRACT

Every generator must follow:

```text
DISCOVER
   ↓
ANALYZE
   ↓
RECOMMEND
   ↓
GENERATE PROPOSAL
   ↓
VALIDATE PROPOSAL
   ↓
SECURITY REVIEW
   ↓
PREVIEW
   ↓
DIFF
   ↓
DEVELOPER APPROVAL
   ↓
APPLY
   ↓
VALIDATE RESULT
```

No exceptions for AI-powered generators.

---

# 32. API → TOOL GENERATOR

Major feature:

```text
Generate Tools From API
```

Flow:

```text
Discovered APIs
      ↓
Select Operations
      ↓
Analyze Schemas
      ↓
Analyze Auth
      ↓
Analyze Permissions
      ↓
Classify Risk
      ↓
Generate Tool Candidates
      ↓
Generate Policy Candidates
      ↓
Preview
```

---

# 33. API TOOL EXAMPLE

Discovered:

```text
GET    /applications
GET    /applications/{id}
POST   /applications
PUT    /applications/{id}
DELETE /applications/{id}
```

Suggested:

```text
applications.list

Risk:
READ_ONLY

Permission:
APPLICATION_VIEW

Approval:
NONE
```

```text
applications.get

Risk:
READ_ONLY

Permission:
APPLICATION_VIEW

Approval:
NONE
```

```text
applications.create

Risk:
WRITE

Permission:
APPLICATION_CREATE

Approval:
USER_CONFIRMATION
```

```text
applications.update

Risk:
WRITE

Permission:
APPLICATION_UPDATE

Approval:
USER_CONFIRMATION
```

```text
applications.delete

Risk:
DESTRUCTIVE

Permission:
APPLICATION_DELETE

Approval:
ADMIN_APPROVAL

Default:
DISABLED
```

---

# 34. RISK HEURISTICS

Initial suggestion:

```text
GET
→ READ_ONLY

POST
→ WRITE

PUT
→ WRITE

PATCH
→ WRITE

DELETE
→ DESTRUCTIVE
```

This is only a heuristic.

It must be editable before approval.

HTTP method alone is not authoritative.

---

# 35. TOOL OUTPUT

Generated application tools must use the existing canonical GIX tool architecture.

Target:

```text
Generated API Tool
        ↓
ToolDefinition
        ↓
Tool Registry
        ↓
Tool Resolver
        ↓
AI Action Firewall
        ↓
Execution
```

Do not create a generated-tool runtime.

---

# 36. OPENAPI → TOOL GENERATOR

Reuse:

```text
@gixcopilot/openapi
```

Flow:

```text
OpenAPI
 ↓
Operations
 ↓
Tool Candidates
 ↓
Security Candidates
 ↓
Preview
 ↓
Approval
```

Do not automatically expose every OpenAPI operation.

---

# 37. STATE → CONTEXT GENERATOR

Use discovered context candidates.

Example:

```text
currentUser
currentRoute
selectedApplication
permissions
```

Generate proposals for existing `@gixcopilot/context`.

Do not create another state/context architecture.

---

# 38. COMPONENT → GENERATIVE UI GENERATOR

Use:

```text
@gixcopilot/generative-ui
```

Flow:

```text
Components
 ↓
Candidate Analysis
 ↓
Trusted Component Proposal
 ↓
Developer Review
 ↓
Registry Generation
```

Never allow arbitrary executable UI from the model.

---

# 39. AUTH → SECURITY POLICY GENERATOR

Use discovered permissions and generated tool metadata.

Example:

```text
applications.update
       +
APPLICATION_UPDATE
       ↓
Tool Policy Candidate
```

Generated policies must use the existing Action Firewall.

---

# 40. PROJECT → AGENT GENERATOR

Important distinction:

This generator creates/recommends **Application Plane agents**.

Not Development Plane agents.

For example, after discovering:

```text
Applications API
Payments API
Appointments API
```

GIX might recommend:

```text
application-assistant
payment-assistant
appointment-assistant
```

These are proposals.

Developer decides whether they should exist.

---

# 41. PROJECT → SKILL GENERATOR

Likewise generate/recommend application-domain skills.

Example:

```text
application-search
application-review
payment-status-analysis
appointment-management
```

These are Application Plane skills.

Do not expose internal Studio engineering skills to production automatically.

---

# 42. DOCS → KNOWLEDGE GENERATOR

Discovery:

```text
README
docs/application/
docs/payments/
docs/appointments/
```

Generator proposes:

```text
Application Knowledge
Payment Knowledge
Appointment Knowledge
```

Developer selects sources before indexing.

---

# 43. DEVELOPMENT ENGINE INTERNAL CAPABILITIES

The Studio itself may use built-in Development Plane tools.

Examples:

```text
repo.getInfo
repo.getTree
repo.listFiles
repo.readFile
repo.search
repo.findFile

project.detect
project.getInfo
project.getApps
project.getDependencies
project.getRoutes

api.discover
api.listOperations
api.inspectOperation

ui.discoverComponents

context.discover

auth.discover
permission.discover

config.inspect

diagnostics.*
```

These are internal developer capabilities.

---

# 44. DEVELOPMENT AGENTS

Studio may internally use specialized agents such as:

```text
project-discovery
repo-explorer
api-explorer
tool-builder
context-analyzer
ui-analyzer
security-analyzer
```

These are not automatically production application agents.

---

# 45. DEVELOPMENT SKILLS

Studio may internally use skills such as:

```text
repository-understanding
project-discovery
api-discovery
api-analysis
api-to-tool-generation
openapi-to-tool-generation
context-discovery
generative-ui-discovery
permission-analysis
tool-security-review
```

Again:

```text
Development Skill
≠
Application Skill
```

---

# 46. DEVELOPMENT CAPABILITY VISIBILITY

Internal capabilities should not all be sent to the model at once.

Use:

```text
Request
 ↓
Relevant Development Agent
 ↓
Relevant Skill
 ↓
Relevant Tool Set
 ↓
Security Filter
 ↓
Model
```

This reduces tool/context bloat.

---

# 47. PREVIEW / DIFF

This is a major product feature.

Nothing generated by the Studio should be applied without entering Preview.

Preview must show:

```text
Files Created
Files Modified
Files Removed

Configuration Changes

Tools Added
Tools Changed
Tools Disabled

Context Added

Generative UI Added

Agents Added

Skills Added

Knowledge Added

Security Policies Added/Changed

Warnings
Conflicts
```

---

# 48. CODE DIFF

Show actual source/config diff where files are involved.

Example:

```diff
+ .gix/tools/applications.ts
+ .gix/security/application-policies.ts
+ .gix/context/application-context.ts

~ gixcopilot.config.ts
```

Developer should be able to inspect individual files.

---

# 49. SELECTIVE APPROVAL

Developer must be able to select changes.

Example:

```text
☑ applications.list
☑ applications.get
☑ applications.create
☐ applications.update
☐ applications.delete
```

Then:

```text
[ Apply Selected ]
```

Do not require all-or-nothing approval.

---

# 50. EDIT BEFORE APPROVAL

Allow safe editable metadata before approval where appropriate:

```text
Tool Name
Description
Risk
Permission
Approval Level
Enabled
Agent Assignment
```

Validate every change.

Do not allow UI edits to bypass mandatory security rules.

---

# 51. REJECT

Developer can:

```text
Reject All
```

Result:

```text
No repository changes.
```

Proposal may remain available for further editing/regeneration.

---

# 52. APPROVAL

Explicit action:

```text
[ Approve Selected Changes ]
```

Only this transitions proposal state into an apply operation.

---

# 53. APPLY ENGINE

The Apply Engine must be deterministic.

Do NOT allow the model to directly write arbitrary repository files.

Architecture:

```text
AI / Generator
      ↓
Structured Proposal
      ↓
Validator
      ↓
Security Review
      ↓
Developer Approval
      ↓
Apply Engine
      ↓
Repository
```

This is critical.

---

# 54. WORKSPACE PROTECTION

All file changes must remain within the configured workspace.

Block:

```text
../
../../
external absolute paths
home directory
SSH directories
system directories
unrelated repositories
```

---

# 55. SECRET PROTECTION

Before applying generated files:

```text
Secret Scan
```

Block/warn on accidental inclusion of:

```text
API keys
tokens
passwords
private keys
credentials
```

Never place secrets into generated source code.

---

# 56. CONFLICT DETECTION

Before apply:

```text
Proposal
 ↓
Current Repository State
 ↓
Conflict Detection
```

If a file changed since proposal generation:

```text
STOP that file
```

Show conflict.

Do not blindly overwrite.

---

# 57. TRANSACTIONAL APPLY

Where practical:

```text
Prepare
 ↓
Validate
 ↓
Apply
 ↓
Post-Validate
```

If deterministic validation proves the generated integration is invalid, provide rollback/recovery behavior where technically safe.

Do not promise rollback for irreversible external actions.

---

# 58. POST-APPLY VALIDATION

After apply automatically run relevant checks.

Examples:

```text
configuration validation
typecheck
lint
tests
build
security validation
integration diagnostics
```

Use the actual project's detected commands.

Do not assume `pnpm`.

---

# 59. VALIDATION RESULT

Example:

```text
APPLY COMPLETE


Generated Tools

4


Context Sources

3


Security Policies

4


VALIDATION

Configuration          ✓
Typecheck              ✓
Lint                   ✓
Tests                  ✓
Security               ✓
Integration            ✓
```

---

# 60. FAILURE EXPERIENCE

If validation fails:

```text
APPLIED WITH VALIDATION ERRORS
```

Show:

```text
what failed
affected files
diagnostics
safe recovery options
```

Never claim success when validation failed.

---

# 61. PROJECT RE-SCAN

Provide:

```text
[ Re-scan Project ]
```

Compare:

```text
Previous Discovery
vs
Current Repository
```

Show:

```text
New APIs
Changed APIs
Removed APIs

New Components
Changed Components

New Permissions

New Context Candidates
```

---

# 62. SYNC COPILOT

Provide:

```text
[ Sync Copilot ]
```

But define it as:

```text
Re-scan
 ↓
Compare
 ↓
Recommend
 ↓
Preview
 ↓
Developer Approval
```

Never:

```text
Sync
→ silently rewrite
```

---

# 63. CONFIGURATION SOURCE OF TRUTH

Use the existing GIX configuration architecture.

Do not create competing configuration stores.

Studio should display resolved configuration:

```text
Default
Project
Environment
Runtime
```

with secret values redacted.

---

# 64. PROPOSAL MODEL

Create a framework-independent structured proposal model.

Conceptually:

```ts
interface ChangeProposal {
  id: string;
  generator: string;
  createdAt: string;

  summary: ProposalSummary;

  fileChanges: FileChange[];
  configChanges: ConfigChange[];

  tools: ToolProposal[];
  context: ContextProposal[];
  ui: GenerativeUIProposal[];
  agents: AgentProposal[];
  skills: SkillProposal[];
  knowledge: KnowledgeProposal[];
  policies: PolicyProposal[];

  diagnostics: Diagnostic[];
  warnings: Warning[];
  conflicts: Conflict[];

  status:
    | 'draft'
    | 'ready-for-review'
    | 'approved'
    | 'rejected'
    | 'applied'
    | 'failed';
}
```

Adapt to repository conventions.

---

# 65. GENERATOR API

Create a reusable generator abstraction.

Conceptually:

```ts
interface Generator<TInput, TOutput> {
  id: string;

  analyze(input: TInput): Promise<Analysis>;

  generate(
    analysis: Analysis
  ): Promise<ChangeProposal>;

  validate(
    proposal: ChangeProposal
  ): Promise<ValidationResult>;
}
```

Generation must return structured proposals.

It must not mutate the repository.

---

# 66. APPLY API

Separate:

```text
generate()
```

from:

```text
apply()
```

This separation must be architectural, not just a UI convention.

Generators cannot directly call apply.

---

# 67. DEVELOPMENT API

Use a development-only API namespace.

Conceptually:

```text
/__gix/api/status
/__gix/api/config

/__gix/api/discovery/project
/__gix/api/discovery/apis
/__gix/api/discovery/components
/__gix/api/discovery/context
/__gix/api/discovery/security
/__gix/api/discovery/knowledge

/__gix/api/generators

/__gix/api/proposals
/__gix/api/proposals/:id
/__gix/api/proposals/:id/approve
/__gix/api/proposals/:id/reject
/__gix/api/proposals/:id/apply

/__gix/api/diagnostics
```

Follow existing server conventions.

---

# 68. DEVELOPMENT API SECURITY

Even though it is development-only, protect:

```text
origin
same-origin
CSRF where relevant
workspace
paths
secrets
mutations
```

Do not assume localhost automatically equals trusted.

---

# 69. STUDIO OVERVIEW

The `/__gix` landing page should immediately answer:

```text
Is GIX connected?

Is my model configured?

Has the project been discovered?

What has GIX found?

What can GIX generate?

Are there pending proposals?

Is my integration healthy?
```

---

# 70. OVERVIEW EXAMPLE

```text
GIX COPILOT


Project

customer-portal


Environment

Development


Runtime

Healthy


Model

OpenAI — Connected


PROJECT

Discovery              Complete
APIs                   42
Components             84
Permissions            14
Context Candidates      7


COPILOT

Tools                  12
Agents                  1
Skills                  3
Context Sources         4


PENDING

Tool Proposal           18 changes
Security Warnings        2


[ Discover Project ]

[ Generate Tools ]

[ Review Proposal ]

[ Test Copilot ]
```

---

# 71. COMMAND PALETTE

Optional but recommended:

```text
Ctrl/Cmd + K
```

Commands:

```text
Discover Project
Discover APIs
Generate Tools
Generate Context
Discover Components
Review Proposals
Run Diagnostics
Test Model
Open DevTools
```

---

# 72. DEVELOPMENT PLANE TESTS

Test:

```text
Development Plane available in development
Development Plane unavailable in production

repo tools unavailable to application users

development agents not automatically application agents

development skills not automatically application skills
```

---

# 73. DISCOVERY TESTS

Test representative fixtures:

```text
React
Angular
Vue
Nx
Node backend
```

according to current supported framework matrix.

Test:

```text
framework detection
workspace detection
API detection
route detection
component detection
permission detection
context candidates
knowledge candidates
secret exclusion
ignored paths
```

---

# 74. GENERATOR TESTS

For every generator:

```text
input discovery
analysis
proposal
validation
preview
```

must work without applying changes.

Explicitly test:

```text
generate()
```

does NOT mutate repository.

---

# 75. APPROVAL TESTS

Test:

```text
proposal generated
repository unchanged

proposal rejected
repository unchanged

proposal partially selected
only selected changes applied

proposal approved
apply succeeds

duplicate apply prevented
```

---

# 76. SECURITY TESTS

Mandatory:

```text
path traversal blocked
secret file reading blocked
secret output blocked
unauthorized Development Plane access blocked
production Studio blocked
production development API blocked
destructive generated tools disabled by default
Action Firewall still enforced
```

---

# 77. CONFLICT TESTS

Test:

```text
generate proposal
change source file externally
attempt apply
```

Expected:

```text
conflict detected
no blind overwrite
```

---

# 78. DIAGNOSTICS TESTS

Diagnostics must correctly reflect lifecycle:

```text
before discovery
after discovery
after generation
after approval
after apply
after validation failure
```

---

# 79. UI / ACCESSIBILITY

Studio must be:

```text
desktop-first
responsive
keyboard accessible
screen-reader friendly
high contrast
clear focus states
```

Follow existing GIX visual identity:

```text
dark charcoal
black
steel gray
white
GIX red
```

Use existing design tokens where possible.

---

# 80. DEVTOOLS INTEGRATION

Reuse Phase 11 DevTools.

Studio should link to or embed appropriate inspectors:

```text
Events
Context
Tools
Agents
Security
Tokens
Trace
```

Do not create a competing trace/debugging system.

---

# 81. TELEMETRY

Use existing telemetry architecture.

Development telemetry must never capture:

```text
API keys
secrets
raw credentials
private keys
```

---

# 82. DOCUMENTATION

Create/update:

```text
docs/developer-studio/
```

Recommended:

```text
README.md
ARCHITECTURE.md

DEVELOPMENT_VS_APPLICATION_PLANE.md

CONFIGURATION.md
PROJECT_DISCOVERY.md
API_DISCOVERY.md
COMPONENT_DISCOVERY.md
CONTEXT_DISCOVERY.md
SECURITY_DISCOVERY.md

GENERATORS.md
API_TOOL_GENERATOR.md
CONTEXT_GENERATOR.md
GENERATIVE_UI_GENERATOR.md
AGENT_GENERATOR.md
SKILL_GENERATOR.md

PROPOSALS.md
PREVIEW_AND_DIFF.md
APPROVALS.md
APPLY_ENGINE.md

DIAGNOSTICS.md
SECURITY.md
TROUBLESHOOTING.md
```

---

# 83. ARCHITECTURE DOCUMENTATION

Explicitly document:

```text
Development Plane
vs
Application Plane
```

This must become a formal architectural rule.

Consider ADR if consistent with repository process.

---

# 84. ROOT README

Update README only with implemented facts.

Explain the target workflow:

```text
Install
 ↓
Initialize
 ↓
Open Developer Studio
 ↓
Configure
 ↓
Discover
 ↓
Generate
 ↓
Preview
 ↓
Approve
 ↓
Apply
 ↓
Validate
```

Do not claim automatic project modification.

---

# 85. IMPORTANT INSTALLER BOUNDARY

This task focuses on the Studio enhancement and underlying architecture.

Do not turn:

```text
npm add gixcopilot
```

into an unsafe automatic repository mutation.

The future/installer integration should remain:

```text
npm add gixcopilot

npx gixcopilot init
```

where `init` performs only the minimal bootstrap required to run GIX and `/__gix`.

The Studio performs the deeper discovery/generation workflow.

---

# 86. EXPECTED INIT RESPONSIBILITY

Conceptually:

```text
npx gixcopilot init
```

should eventually only need to establish:

```text
GIX packages
runtime bootstrap
Copilot server
framework UI bootstrap
development Studio bootstrap
basic configuration
development proxy
```

It should NOT need to immediately generate:

```text
application API tools
application agents
application skills
Generative UI
context adapters
knowledge
security policies
```

Those belong to Studio.

---

# 87. VALIDATION COMMANDS

Use repository commands.

At minimum:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Use:

```bash
pnpm validate
```

if that remains the authoritative repository command.

Also run relevant E2E tests.

---

# 88. SELF REVIEW

Before completion inspect:

```text
git status
git diff
```

Review:

```text
architecture boundaries
Development/Application Plane separation
generator/apply separation
security
secret handling
production exposure
public APIs
dependency graph
tests
documentation
```

---

# 89. COMPLETION GATE

Return:

```text
GIX COPILOT DEVELOPMENT STUDIO ENHANCEMENT


ARCHITECTURE

Development Plane:
PASS / FAIL

Application Plane:
PASS / FAIL

Plane Isolation:
PASS / FAIL

Production Isolation:
PASS / FAIL


CONFIGURATION

Appearance:
PASS / FAIL

Model Configuration:
PASS / FAIL

OpenAI Secret Handling:
PASS / FAIL

Copilot Configuration:
PASS / FAIL

Security Configuration:
PASS / FAIL


DISCOVERY

Project:
PASS / FAIL

APIs:
PASS / FAIL

Components:
PASS / FAIL

Context:
PASS / FAIL

Authentication:
PASS / FAIL

Permissions:
PASS / FAIL

Knowledge:
PASS / FAIL

Read-only Guarantee:
PASS / FAIL


DIAGNOSTICS

Continuous Diagnostics:
PASS / FAIL

Pre-Discovery:
PASS / FAIL

Post-Discovery:
PASS / FAIL

Post-Generation:
PASS / FAIL

Post-Apply:
PASS / FAIL


GENERATORS

Generator Framework:
PASS / FAIL

API → Tools:
PASS / FAIL

OpenAPI → Tools:
PASS / FAIL

State → Context:
PASS / FAIL

Components → Generative UI:
PASS / FAIL

Auth → Security:
PASS / FAIL

Project → Agents:
PASS / FAIL

Project → Skills:
PASS / FAIL

Docs → Knowledge:
PASS / FAIL


PROPOSALS

Structured Proposal:
PASS / FAIL

Preview:
PASS / FAIL

Diff:
PASS / FAIL

Selective Approval:
PASS / FAIL

Reject:
PASS / FAIL

Conflict Detection:
PASS / FAIL


APPLY

Generator Cannot Mutate:
PASS / FAIL

Explicit Approval Required:
PASS / FAIL

Apply Engine:
PASS / FAIL

Workspace Protection:
PASS / FAIL

Secret Scan:
PASS / FAIL

Post-Apply Validation:
PASS / FAIL


SECURITY

Action Firewall:
PASS / FAIL

Path Traversal:
PASS / FAIL

Secret Protection:
PASS / FAIL

Dev API Protection:
PASS / FAIL

Production Studio Protection:
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

Documentation:
PASS / FAIL


FINAL STATUS

COMPLETE / INCOMPLETE
```

If any mandatory item fails:

```text
FINAL STATUS: INCOMPLETE
```

Explain what remains.

---

# 90. STOP CONDITION

When this enhancement is complete:

STOP.

Do not automatically proceed to publishing or consumer npm installation changes.

The next task will enhance the consumer installation experience around:

```bash
npm add gixcopilot
npx gixcopilot init
```

using the completed Developer Studio architecture.

---

# FINAL PRODUCT PRINCIPLE

The final architecture should enforce:

```text
INSTALL
   ↓
CONFIGURE
   ↓
DISCOVER
   ↓
UNDERSTAND
   ↓
GENERATE PROPOSAL
   ↓
PREVIEW / DIFF
   ↓
DEVELOPER DECIDES
   ↓
APPLY
   ↓
VALIDATE
```

Never:

```text
INSTALL
   ↓
AI MODIFIES EVERYTHING
```

And the architectural separation must remain:

```text
DEVELOPMENT PLANE
       │
       │ discovers / analyzes / proposes
       ▼
   APPLICATION
       ▲
       │ approved generated integration
       │
APPLICATION PLANE
```

The Developer Studio is the control plane.

The Application Copilot is the runtime experience.

They share GIX core infrastructure, but they do not share authority by default.

> AI proposes. The developer decides.