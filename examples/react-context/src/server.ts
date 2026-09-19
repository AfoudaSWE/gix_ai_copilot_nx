import { createDemoServer } from './backend.js';

const app = createDemoServer();
await app.listen({ host: '127.0.0.1', port: 4319 });
console.log('Copilot context-aware demo runtime listening at http://127.0.0.1:4319');
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app.close();
  });
