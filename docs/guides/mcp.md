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

Example: `examples/mcp`. ADR [0013](../adr/0013-openapi-mcp-integration-architecture.md).
