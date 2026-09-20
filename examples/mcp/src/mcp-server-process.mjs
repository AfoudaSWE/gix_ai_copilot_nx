// A standalone MCP server, spawned as a real child process over stdio (Section 71's stdio
// transport) - deliberately plain JavaScript, not TypeScript, so it can be spawned directly by
// `node` with no prior build step, keeping `pnpm test` build-free (mirrors this repo's other
// examples never requiring `pnpm build` before `pnpm test`).
//
// A small "widget inventory" service, in-memory only, safe to call repeatedly: `searchWidgets`
// (read), `getWidget` (read), `restockWidget` (write - the model must have this tool exposed
// deliberately; `registerMCP` denies every tool by default, Section 79).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const widgets = new Map([
  ['WID-1', { id: 'WID-1', name: 'Left-handed screwdriver', quantity: 3 }],
  ['WID-2', { id: 'WID-2', name: 'Analog cloud storage', quantity: 0 }],
  ['WID-3', { id: 'WID-3', name: 'Chocolate teapot', quantity: 12 }],
]);

const server = new McpServer({ name: 'widget-inventory', version: '1.0.0' });

server.registerTool(
  'searchWidgets',
  { description: 'Search the widget inventory by name substring.', inputSchema: { query: z.string().optional() } },
  ({ query }) => {
    const results = Array.from(widgets.values()).filter(
      (widget) => !query || widget.name.toLowerCase().includes(query.toLowerCase()),
    );
    return { content: [{ type: 'text', text: JSON.stringify(results) }], structuredContent: { results } };
  },
);

server.registerTool(
  'getWidget',
  { description: 'Get a widget by id.', inputSchema: { id: z.string() } },
  ({ id }) => {
    const widget = widgets.get(id);
    if (!widget) return { content: [{ type: 'text', text: `Widget "${id}" was not found.` }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(widget) }], structuredContent: widget };
  },
);

server.registerTool(
  'restockWidget',
  { description: 'Add stock to a widget.', inputSchema: { id: z.string(), quantity: z.number().int().positive() } },
  ({ id, quantity }) => {
    const widget = widgets.get(id);
    if (!widget) return { content: [{ type: 'text', text: `Widget "${id}" was not found.` }], isError: true };
    const updated = { ...widget, quantity: widget.quantity + quantity };
    widgets.set(id, updated);
    return { content: [{ type: 'text', text: JSON.stringify(updated) }], structuredContent: updated };
  },
);

await server.connect(new StdioServerTransport());
