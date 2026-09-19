import { createDemoServer } from './backend.js';

const app = createDemoServer();
await app.listen({ host: '127.0.0.1', port: 4320 });
console.log('Copilot tools demo runtime listening at http://127.0.0.1:4320');
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app.close();
  });
