# React

`@gixcopilot/react` is headless (hooks and a provider); `@gixcopilot/ui` is an accessible
styled chat built on it. Both use the framework-neutral chat store in `@gixcopilot/headless`.

```tsx
<CopilotProvider runtimeUrl="/api/copilot" getHeaders={() => ({ authorization: `Bearer ${token}` })}>
  <CopilotChat />            {/* or CopilotPopup / CopilotSidebar, or your own UI with the hooks */}
</CopilotProvider>
```

| Hook | Purpose |
| --- | --- |
| `useCopilotChat()` | Snapshot (`messages`, `status`, `error`, `toolCalls`, `approvals`, …) plus actions (`sendMessage`, `stop`, `retry`, `regenerate`, `clear`, `approveAction`, `rejectAction`) |
| `useCopilot()` | Stable actions and the client without re-rendering on tokens |
| `useMessages()`, `useCopilotStatus()`, `useThread()`, `useToolCalls()` | Narrow subscriptions |
| `useApprovals()`, `usePendingApprovals()`, `useApproval(id)` | Human-in-the-loop state |
| `useAgentRuns()`, `useWorkflowRuns()` and friends | Agent and workflow progress (structured facts only) |
| `useCopilotContext(item)` | Register application context (Phase 4) |
| `useCopilotState(options)` | Shared state; `modelWritable` only through validated patches |
| `useFrontendTool(options)` | A browser-side tool on the canonical tool runtime |
| `useGenerativeComponent(options)`, `useGenerativeUIRequests()` | Trusted generative UI |
| `useCitations()` | RAG citations for the current answer |

SSR: the provider renders on the server (hooks read an empty snapshot). Server dependencies
never reach the bundle (lint-enforced; measured in `tools/bundle-report.mjs`).

Examples: `examples/react-basic`, `react-context`, `react-tools`, `react-generative-ui`,
`react-rag`, `react-enterprise`. Reference: [packages/react](../../packages/react/README.md),
[packages/ui](../../packages/ui/README.md).
