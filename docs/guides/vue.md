# Vue

`@gixcopilot/vue` (**Beta**) is the Vue 3 adapter. It wraps the same framework-independent chat
store (`@gixcopilot/headless`) as the React and Angular adapters, so streaming, stop/retry,
approvals, context and frontend tools behave identically.

The quickest setup is the installer, run inside your Vue app:

```sh
npm create @gixcopilot@latest
```

It installs `@gixcopilot/vue`, adds `src/copilot/CopilotPanel.vue`, proxies `/api/copilot` in
`vite.config.ts`, and creates a Node copilot server in `copilot-server/`.

## Manual setup

```ts
// main.ts
import { createApp } from 'vue';
import { createCopilotPlugin } from '@gixcopilot/vue';
import '@gixcopilot/vue/styles.css';
import App from './App.vue';

createApp(App).use(createCopilotPlugin({ endpoint: '/api/copilot' })).mount('#app');
```

```vue
<script setup lang="ts">
import { CopilotChat, useCopilotContext } from '@gixcopilot/vue';

const props = defineProps<{ orderId: string }>();
useCopilotContext({ name: 'Current order', value: () => props.orderId });
</script>

<template>
  <CopilotChat label="Order assistant" />
</template>
```

| API | Use |
| --- | --- |
| `createCopilotPlugin(config)` | App-wide copilot (`app.use`), disposed on unmount |
| `provideCopilot(config)` | A copilot for one component subtree, disposed with it |
| `useCopilot()` | Reactive `messages`, `status`, `error`, `busy`, `toolCalls`, `approvals`… and `sendMessage`, `stop`, `retry`, `regenerate`, `clear`, `approveAction`, `rejectAction` |
| `useCopilotContext(item)` | Page context for the model; a ref or getter keeps it current |
| `useFrontendTool(options)` | A schema-validated browser tool (needs `zod`) |
| `<CopilotChat>` | Accessible chat: live log, labelled composer, Stop, Retry, approvals; text is never rendered as HTML |

`config` takes `endpoint` (your server's base URL) or `client`, plus optional `model`,
`threadId`, `context` and `getHeaders` (e.g. an `Authorization` header). Provider API keys never
belong in the browser. See [Context and state](context-and-state.md) and [Tools](tools.md).
