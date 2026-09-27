# Angular

`@gixcopilot/angular` (Angular 21, **Beta**) adapts the same framework-independent client and
chat store as React. It uses signals, DI and trusted components, and has no second AI runtime.

<!-- snippet: angular-main.ts -->
```ts
import { ChangeDetectionStrategy, Component, provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { CopilotChatComponent, provideCopilot } from '@gixcopilot/angular';

@Component({
  selector: 'app-root',
  imports: [CopilotChatComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<aicopilot-chat label="Copilot" />',
})
class AppComponent {}

await bootstrapApplication(AppComponent, {
  providers: [provideZonelessChangeDetection(), provideCopilot({ endpoint: '/api/copilot' })],
});
```

| API | Purpose |
| --- | --- |
| `provideCopilot({ endpoint \| client, model?, getHeaders?, context? })` | App-wide, or in a component's `providers` for an isolated copilot |
| `injectCopilot()` / `CopilotService` | Signals: `state`, `messages`, `status`, `busy`, `error`, `toolCalls`, `approvals`, `pendingApprovals`, `agentRuns`, `workflowRuns`, `generativeUiRequests`; actions `sendMessage`, `stop`, `retry`, `regenerate`, `clear`, `approveAction`, `rejectAction`, `invokeTool` |
| `injectCopilotContext({ id, name, value })` | `value` may be a signal; removed when the injection context is destroyed |
| `injectFrontendTool({ name, description, input, execute })` | Canonical tool runtime, schema-validated |
| `injectCopilotState({ id, name, initialValue, exposeToModel?, modelWritable? })` | Returns `{ value: Signal, set, update }` |
| `injectGenerativeComponent({ name, description, props, component })` | The model selects your component; props are validated twice; nothing is compiled at runtime |
| `<aicopilot-chat>` | Accessible OnPush chat: live log, labelled composer, stop/retry, approvals, `direction="rtl"` |

Notes: shipped components use decorator inputs feeding signals so they behave the same under
JIT (tests) and AOT (production). All exports are SSR-safe. The library is built with
ng-packagr (partial Ivy). Example: `examples/angular-basic`. Reference:
[packages/angular](../../packages/angular/README.md).
