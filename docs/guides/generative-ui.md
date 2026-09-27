# Generative UI

```text
structured UI request (from the model) → trusted component registry → schema validation → your component
```

The model never generates markup or code. It selects a component *you* registered and supplies
props that must pass that component's zod schema. Unregistered names and invalid props render
nothing.

- React: `useGenerativeComponent({ name, description, props, component })`,
  `useGenerativeUIRequests()`, `useToolRenderer()`; `@gixcopilot/ui` renders requests inline.
- Angular: `injectGenerativeComponent({ ... })` and `<aicopilot-generative-ui [request]>`.
  Props are validated again at render time, and nothing is compiled at runtime.
- Actions from a rendered component go through `useInvokeTool()` / `copilot.invokeTool()`,
  so the server's firewall decides.

Example: `examples/react-generative-ui`, `examples/angular-basic`. ADR
[0011](../adr/0011-generative-ui-and-state-patch-architecture.md).
