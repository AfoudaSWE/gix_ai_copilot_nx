# Examples

Every example builds and has its own integration test in CI.

| Example | Shows |
| --- | --- |
| `examples/protocol-demo` | Protocol and streaming without a model |
| `examples/model-streaming` | Model runtime and providers |
| `examples/react-basic` | React + UI + server |
| `examples/react-context` | Application context and state |
| `examples/react-tools` | Frontend and backend tools |
| `examples/react-generative-ui` | Trusted generative UI |
| `examples/react-enterprise` | Security, approvals, audit |
| `examples/react-rag` | Knowledge and citations |
| `examples/openapi`, `examples/mcp` | Integrations |
| `examples/agent-basic`, `examples/multi-agent` | Agents, routing, delegation |
| `examples/workflow-approval`, `examples/workflow-compensation` | Durable workflows |
| `examples/devtools`, `examples/evals` | Inspection and evaluations |
| `examples/angular-basic` | Angular adapter end to end |
| `examples/node-basic` | Plain Node with a firewall-checked tool |
| `apps/api`, `apps/worker`, `apps/platform`, `docker-compose.yml` | The production deployment |

Mock providers and fixture data are labelled as such in each example. Real integrations use
real adapters (OpenAI with `OPENAI_API_KEY`, PostgreSQL/pgvector, Redis).
