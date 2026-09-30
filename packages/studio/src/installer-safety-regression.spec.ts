import { describe, expect, it } from 'vitest';
import type { ApiOperation, ApiSourceKind } from './discovery/model.js';
import { normalizeApiOperations } from './discovery/normalize.js';
import { applyEdits } from './proposals/edit.js';
import { EMPTY_ITEMS, summarize } from './proposals/model.js';
import type { ChangeProposal, ToolProposal } from './proposals/model.js';
import { safeSelection } from './proposals/safe.js';

function tool(method: ApiOperation['method'], suggestedRisk: ToolProposal['risk']): ToolProposal {
  return { id: method, name: `items.${method.toLowerCase()}`, description: 'Items operation', operation: { method, path: '/items', source: 'api', file: 'api.json', key: `${method} /items` }, suggestedRisk, risk: suggestedRisk, selected: true, enabled: true, approval: 'user-confirmation', inputSchema: {}, confidence: 'high', conflicts: [] };
}

function operation(kind: ApiSourceKind, input: Record<string, unknown>, path = '/items/{id}'): ApiOperation {
  return { id: kind, method: 'GET', path, input, permissions: [], source: kind, sourceKind: kind, file: `${kind}.json` };
}

function normalize(first: ApiOperation, second: ApiOperation) {
  return normalizeApiOperations([first, second].map((entry) => ({ id: entry.id, kind: entry.sourceKind, file: entry.file, operations: [entry] })))[0];
}

describe('installer safety regressions', () => {
  it('does not bulk approve POST or DELETE tools after editable risk downgrades', () => {
    const items = applyEdits({ ...EMPTY_ITEMS, tools: [tool('GET', 'read-only'), tool('POST', 'write'), tool('DELETE', 'destructive')] }, ['POST', 'DELETE'].map((id) => ({ collection: 'tools', id, changes: { risk: 'read-only', enabled: true } })));
    const content = { ...items, fileChanges: [], warnings: [], conflicts: [], securityReview: [] };
    const proposal: ChangeProposal = { ...content, id: 'proposal', generator: 'api-tools', title: 'Safety', createdAt: '', updatedAt: '', status: 'ready-for-review', summary: summarize(content), diagnostics: [] };
    expect(proposal.tools.every((entry) => entry.risk === 'read-only')).toBe(true);
    expect(safeSelection(proposal)).toEqual(['GET']);
    expect(safeSelection({ ...proposal, tools: [{ ...tool('GET', 'read-only'), risk: 'write' }] })).toEqual([]);
  });

  it.each([
    [{ type: 'string' }, { type: 'integer' }],
    [{ type: 'string', enum: ['open', 'closed'] }, { type: 'string', enum: ['open'] }],
    [{ type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, { type: 'object', properties: { name: { type: 'string' } } }],
    [{ type: 'object', properties: { nested: { type: 'string' } } }, { type: 'object', properties: { nested: { type: 'boolean' } } }],
    [{ type: 'array', items: { type: 'string' } }, { type: 'array', items: { type: 'number' } }],
  ])('marks same-field incompatible property contracts for review (%j vs %j)', (first, second) => {
    const result = normalize(operation('openapi', { type: 'object', properties: { body: first } }), operation('swagger', { type: 'object', properties: { body: second } }));
    expect(result?.confidence).toBe('review');
    expect(result?.conflicts).not.toEqual([]);
    expect(result?.input).toEqual({ type: 'object', properties: { body: first } });
  });

  it('detects top-level required changes', () => {
    const input = { type: 'object', properties: { id: { type: 'string' } } };
    expect(normalize(operation('openapi', { ...input, required: ['id'] }), operation('swagger', input))?.confidence).toBe('review');
  });

  it('detects path/query placement and query-name differences despite equal parameter counts', () => {
    const first = operation('openapi', { type: 'object', properties: { id: { type: 'string' } } });
    const second = operation('swagger', { type: 'object', properties: { id: { type: 'string' } } }, '/items/{itemId}');
    expect(normalize(first, second)?.confidence).toBe('review');
    expect(normalize(operation('openapi', { properties: { search: { type: 'string' } } }, '/items'), operation('swagger', { properties: { filter: { type: 'string' } } }, '/items'))?.confidence).toBe('review');
  });

  it('accepts equivalent contracts with renamed path params and reordered keys, required fields and enums', () => {
    const first = operation('openapi', { type: 'object', properties: { id: { type: 'string' }, body: { type: 'object', properties: { state: { type: 'string', enum: ['open', 'closed'] } }, required: ['state'] } }, required: ['id', 'body'] });
    const second = operation('swagger', { required: ['body', 'itemId'], properties: { body: { required: ['state'], properties: { state: { enum: ['closed', 'open'], type: 'string' } }, type: 'object' }, itemId: { type: 'string' } }, type: 'object' }, '/api/v1/items/{itemId}');
    expect(normalize(first, second)).toMatchObject({ confidence: 'high', conflicts: [] });
  });
});
