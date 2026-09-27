# MCP

`@gixcopilot/mcp` connects to MCP servers (stdio or streamable HTTP) and maps their tools to
canonical tool definitions. Exposure is **deny by default**. MCP tools still pass the Action
Firewall, and server trust levels are diagnostic only (never a bypass).

```sh
npx aicopilot add mcp files --url https://mcp.example.com/mcp   # nothing exposed yet
npx aicopilot mcp list
```

Then list tool names under `"include"` in `aicopilot.mcp.json` and register them with
`registerMCP({ serverId, transport, registry, include })`. Credentials belong in the server
environment. The platform's MCP view shows configuration and connection status, and never a
credential.

## Serve your application as an MCP server

The other direction: expose your own tools (hand-written, [OpenAPI](openapi.md) or
[connector](connectors.md) tools for any API) to MCP clients such as desktop assistants, IDEs and
other agents.

```sh
npx aicopilot mcp serve apis/crm.api.yaml              # stdio; read-only tools unless --allow-writes
npx aicopilot mcp serve apis/crm.api.yaml --http --port 3333 --token-env MCP_TOKEN
```

In code, `createMcpToolServer({ name, tools, runtime })` serves over stdio (`connectStdio()`) or
Streamable HTTP (`handleRequest(request)`, web-standard). The `runtime` is required and should
carry the Action Firewall middleware, so MCP callers get the same authentication, permissions,
approvals and audit as the copilot. See [Connect any API](connectors.md#expose-the-connected-app-as-an-mcp-server).

Example: `examples/mcp`. ADR [0013](../adr/0013-openapi-mcp-integration-architecture.md).
