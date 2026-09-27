import { createApp, h } from 'vue';
import { CopilotChat, createCopilotPlugin } from '@gixcopilot/vue';
import '@gixcopilot/vue/styles.css';

createApp({ render: () => h(CopilotChat, { label: 'Copilot' }) })
  .use(createCopilotPlugin({ endpoint: '/api/copilot' }))
  .mount('#app');
