import { createEnterpriseServer } from './backend.js';

const apiKey = process.env['OPENAI_API_KEY'];
const model = process.env['OPENAI_MODEL'];
if (apiKey && !model) throw new Error('Set OPENAI_MODEL when configuring real OpenAI chat.');
const app = createEnterpriseServer({ apiKey, model });
await app.listen({ host: '127.0.0.1', port: 4322 });
console.log(`Enterprise example: http://127.0.0.1:4322 (${apiKey ? 'real OpenAI' : 'direct actions; chat unavailable'})`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
