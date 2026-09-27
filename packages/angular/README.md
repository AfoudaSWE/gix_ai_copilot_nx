# @gixcopilot/angular

Angular adapter for the AI Copilot SDK (**Beta**, Angular 21). It adapts the same
framework-independent client, chat store (`@gixcopilot/headless`), context engine, tool runtime,
state store and trusted generative-UI registry that the React adapter uses. It does not have a
second AI runtime: streaming, reconnect, tool execution and security all live below it.

```sh
pnpm add @gixcopilot/angular zod
```

```ts
// main.ts
bootstrapApplication(AppComponent, {
  providers: [provideCopilot({ endpoint: '/api/copilot' })],
});
```

```ts
// app.component.ts
@Component({
  selector: 'app-root',
  imports: [CopilotChatComponent],
  template: `<aicopilot-chat label="Support copilot" />`,
})
export class AppComponent {
  private readonly copilot = injectCopilot(); // signals: messages(), status(), busy(), error() …

  constructor() {
    injectCopilotContext({ id: 'current-page', name: 'Current page', value: signal({ route: '/applications/APP-1' }) });
    injectFrontendTool({
      name: 'navigation.openApplication',
      description: 'Open an application',
      input: z.object({ applicationId: z.string() }),
      execute: async ({ applicationId }) => ({ opened: applicationId }),
    });
  }
}
```

| API | Purpose |
| --- | --- |
| `provideCopilot(config)` | Provides one copilot (app-wide, or per component for isolation) |
| `injectCopilot()` / `CopilotService` | Signals (`state`, `messages`, `status`, `busy`, `error`, `toolCalls`, `approvals`, `agentRuns`, `workflowRuns`, `generativeUiRequests`) and actions (`sendMessage`, `stop`, `retry`, `regenerate`, `clear`, `approveAction`, `rejectAction`, `invokeTool`) |
| `injectCopilotContext(item)` | Application context for the model; a signal value stays current; removed on destroy |
| `injectFrontendTool(options)` | A frontend tool on the canonical tool runtime (schema-validated) |
| `injectCopilotState(options)` | Shared state as a signal; model writes only through the validated state-patch tool when `modelWritable` |
| `injectGenerativeComponent(options)` / `<aicopilot-generative-ui>` | Trusted generative UI: the model selects a registered component; props are schema-validated; nothing is compiled at runtime |
| `<aicopilot-chat>` | Accessible OnPush chat (live log, labelled composer, stop/retry, approvals, RTL via `direction`) |

Security: provider keys never go in the browser; `endpoint` is your server. The model can only
choose a registered component and supply schema-valid props; text is rendered with Angular
interpolation, never as HTML. Registrations are tied to the injection context and released on
destroy. Every export works during SSR (no browser globals are touched at import or provide time).

Build: `ng-packagr` (partial Ivy, AOT-compatible); `pnpm publish` publishes `dist/`. Tests run
in JIT mode under Vitest. Signal `input()`s are not used in shipped components (decorator
inputs feed signals instead) so that JIT consumers and tests behave the same as AOT.
See [the Angular guide](../../docs/guides/angular.md) and `examples/angular-basic`.
