# Tools

A tool is a typed capability: a name (`namespace.action`), a description for the model, zod
input/output schemas, a declared risk, and an `execute` function. Only registered tools can act.

```ts
defineTool({
  name: 'payments.refund',
  description: 'Refund a payment',
  input: z.object({ paymentId: z.string(), amount: z.number().positive() }),
  security: { risk: 'write', approval: 'supervisor', requiredPermissions: ['payments.refund'] },
  dryRun: async (input) => ({ summary: `Refund ${input.amount}` }),
  execute: async (input, context) => refunds.create(input, { signal: context.signal }),
});
```

- **Where**: backend tools run on the server (`createCopilot({ tools })`, `createServer({
  toolRegistry })`). Frontend tools run in the browser (`useFrontendTool`,
  `injectFrontendTool`) and the server still decides whether the model may call them.
- **Risk**: `read-only`, `write`, `destructive`. Unclassified tools are held for approval by the
  default risk policy (fail closed).
- **Execution**: schema validation, timeouts, cancellation (`context.signal`), then the
  [Action Firewall](security.md) for every consequential call.
- **Generated sources**: [any HTTP/GraphQL API](connectors.md), [OpenAPI](openapi.md) and [MCP](mcp.md) produce the same
  `ToolDefinition`s, with the same enforcement.
- **CLI**: `npx aicopilot add tool payments-refund` creates the definition and a test.

Testing: `createToolMocks`, `expectToolCalled`, `expectActionDenied` in `@gixcopilot/testing`.
ADR [0010](../adr/0010-canonical-tool-architecture.md).
