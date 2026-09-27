# @gixcopilot/vue

Vue 3 adapter for the AI Copilot SDK. It wraps the same framework-independent chat store
(`@gixcopilot/headless`) as the React and Angular adapters: a plugin, composables with reactive
state, and an accessible `<CopilotChat>` component. The browser only talks to your copilot
server; provider API keys never reach it.

## Install

The fastest way is the installer, which also adds a Node copilot server:

```bash
npm create @gixcopilot@latest
```

Or add the package yourself:

```bash
npm install @gixcopilot/vue
```

Requires Vue `^3.5`. ESM only. `zod` is an optional peer, needed only for `useFrontendTool`.

## Usage

```ts
// main.ts
import { createApp } from 'vue';
import { createCopilotPlugin } from '@gixcopilot/vue';
import '@gixcopilot/vue/styles.css';
import App from './App.vue';

createApp(App)
  .use(createCopilotPlugin({ endpoint: '/api/copilot' })) // your copilot server's base URL
  .mount('#app');
```

```vue
<!-- App.vue -->
<script setup lang="ts">
import { CopilotChat } from '@gixcopilot/vue';
</script>

<template>
  <CopilotChat label="Support copilot" placeholder="Ask anything…" />
</template>
```

In development, proxy `/api/copilot` to the copilot server (`vite.config.ts`):

```ts
server: { proxy: { '/api/copilot': { target: 'http://127.0.0.1:4000', rewrite: (p) => p.replace(/^\/api\/copilot/, '') } } }
```

### Build your own UI

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { useCopilot } from '@gixcopilot/vue';

const { messages, busy, error, sendMessage, stop, retry } = useCopilot();
const draft = ref('');
</script>
```

`useCopilot()` returns reactive `state`, `messages`, `status`, `error`, `busy`, `toolCalls`,
`approvals`, `pendingApprovals`, `agentRuns`, `workflowRuns` and `generativeUiRequests`, and
the actions `sendMessage`, `stop`, `retry`, `regenerate`, `clear`, `approveAction` and
`rejectAction`. `sendMessage` returns whether the turn was accepted, not whether it succeeded.

### Tell the copilot about the page

```ts
import { useCopilotContext } from '@gixcopilot/vue';

useCopilotContext({ name: 'Current application', value: () => application.value, sensitivity: 'internal' });
```

A ref or getter keeps the context current; it is removed when the component unmounts. Nothing
is sent to the model unless it is registered.

### Browser-side tools

```ts
import { z } from 'zod';
import { useFrontendTool } from '@gixcopilot/vue';

useFrontendTool({
  name: 'navigation.openApplication',
  description: 'Open an application in the UI',
  input: z.object({ applicationId: z.string() }),
  execute: async ({ applicationId }) => {
    await router.push(`/applications/${applicationId}`);
    return { opened: applicationId };
  },
});
```

Input is schema-validated before `execute` runs; the server still decides whether the model may
call the tool.

### Several copilots

`provideCopilot(config)` inside a component's `setup()` gives that subtree its own copilot,
disposed with the component. `createCopilot(config)` creates one outside Vue (call `dispose()`).

## Documentation

- [Getting started](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/getting-started.md)
- [Context and state](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/context-and-state.md)
- [Source](https://github.com/AfoudaSWE/gix_ai_copilot_nx/tree/main/packages/vue)

## License

MIT
