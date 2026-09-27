# OpenAPI integrations

`@gixcopilot/openapi` turns an OpenAPI 3 document into canonical tools. Endpoints are **never
exposed wholesale**: generation is an allowlist. Mutating methods require approval by default,
and generated tools pass the Action Firewall like any other tool.

```sh
npx aicopilot import-openapi ./openapi.yaml --id visa-api
# -> aicopilot.openapi.visa-api.json: every operation "expose": false
# -> src/integrations/visa-api.ts: registerOpenAPI with only the exposed operations
```

- `inspectOpenAPI(...)` previews names, schemas and exposure decisions without registering.
- `registerOpenAPI({ integrationId, source, baseUrl, include, operations, registry,
  credentialProvider })` registers the chosen operations. Credentials come from a server-side
  provider, never from the model.
- HTTP execution has SSRF guards, response size limits, timeouts and normalized errors.
- Platform: `POST /management/v1/openapi/import` lists operations **disabled**; enable them and
  set per-operation approval in a new version; a refresh keeps previous decisions.

Example: `examples/openapi`. ADR [0013](../adr/0013-openapi-mcp-integration-architecture.md).
