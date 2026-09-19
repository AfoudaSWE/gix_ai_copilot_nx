import { createDemoServer } from './backend.js';

const app = createDemoServer();
await app.listen({ host: '127.0.0.1', port: 4321 });
console.log('Copilot generative-UI demo runtime listening at http://127.0.0.1:4321');
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app.close();
  });
