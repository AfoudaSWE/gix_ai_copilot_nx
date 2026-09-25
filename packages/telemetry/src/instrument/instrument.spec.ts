import { describe, expect, it } from 'vitest';
import { CopilotError } from '@gixcopilot/protocol';
import { createNoopTelemetry } from '../adapter.js';
import { createRecordingTelemetry } from '../recording.js';
import { instrumentModelRuntime } from './model-runtime.js';
import { createToolTelemetry } from './tool-runtime.js';
import { createFirewallTelemetry, deriveSecurityStages } from './firewall.js';
import { instrumentApprovalStore } from './approvals.js';
import type { ApprovalRequestLike } from './approvals.js';
import { createRetrieverTelemetry } from './retriever.js';
import { instrumentContextEngine } from './context-engine.js';
import { instrumentMemoryService } from './memory.js';
import { observeStateStore } from './state-store.js';
import { withTelemetryMetadata } from './telemetry-metadata.js';

describe('instrumentation', () => {
  it('nests a model call, records usage, and returns the original runtime when disabled', async () => {
    let clock = 1_000;
    const recorder = createRecordingTelemetry({ now: () => new Date(clock), nextId: () => `id-${++clock}` });
    const root = recorder.startSpan('copilot.run', { correlation: { runId: 'run-1' } });
    const runtime = {
      async *stream(_request: { messages: readonly unknown[]; metadata?: Readonly<Record<string, unknown>> }) {
        await Promise.resolve();
        yield { type: 'model.started' } as const;
        yield { type: 'content.delta', delta: 'hello' } as const;
        yield { type: 'model.completed', finishReason: 'stop', usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 } } as const;
      },
    };
    expect(instrumentModelRuntime(runtime, createNoopTelemetry())).toBe(runtime);
    const wrapped = instrumentModelRuntime(runtime, recorder, { now: () => clock++ });
    const events = [];
    for await (const event of wrapped.stream({ messages: [], metadata: withTelemetryMetadata(undefined, { parentSpan: root, correlation: { runId: 'run-1' } }) })) events.push(event);
    expect(events).toHaveLength(3);
    const call = recorder.session().events.find((event) => event.type === 'model.call');
    expect(call).toMatchObject({ type: 'model.call', status: 'completed', usage: { totalTokens: 3 }, correlation: { runId: 'run-1' } });
    expect(recorder.session().spans[0]?.parentSpanId).toBe(root.spanId);
  });

  it('tracks authorization and execution from the firewall decision without exposing arguments', async () => {
    let clock = 0;
    const recorder = createRecordingTelemetry({ now: () => new Date(clock) });
    const tool = createToolTelemetry(recorder, { now: () => ++clock });
    const firewall = createFirewallTelemetry(recorder, { tracker: tool.tracker, now: () => ++clock });
    const request = { toolCallId: 'call-1', name: 'write', arguments: { password: 'super-secret' }, context: { runId: 'run-1', signal: new AbortController().signal } };
    const runtime = {
      async execute(_invocation: typeof request) {
        await firewall.instrument({ evaluate: (_request: object, _context: object) => Promise.resolve({ decision: 'deny' as const, reason: { code: 'PERMISSION_DENIED', message: 'No access' } }) }).evaluate(
          { actionId: 'action-1', runId: 'run-1', toolCallId: 'call-1', action: 'write', arguments: {}, metadata: {} },
          { identity: { subject: 'user-1', roles: [] } },
        );
        tool.onEvent({ phase: 'started', toolCallId: 'call-1', name: 'write' });
        return { status: 'success' as const, toolCallId: 'call-1', data: { ok: true } };
      },
    };
    await expect(tool.instrument(runtime).execute(request)).resolves.toMatchObject({ status: 'success' });
    const execution = recorder.session().events.find((event) => event.type === 'tool.execution');
    expect(execution).toMatchObject({ securityDecision: 'deny', securityReasonCode: 'PERMISSION_DENIED' });
    if (execution?.type === 'tool.execution') expect(execution.phases.map((phase) => phase.phase)).toEqual(['requested', 'authorization', 'execution', 'completed']);
    expect(JSON.stringify(recorder.session())).not.toContain('super-secret');
    expect(deriveSecurityStages({ decision: 'deny', reason: { code: 'RATE_LIMITED', message: '' } }, [])[2]).toMatchObject({ stage: 'rate-limit', outcome: 'deny' });
    expect(tool.instrument(runtime)).not.toBe(runtime);
    expect(createToolTelemetry(createNoopTelemetry()).instrument(runtime)).toBe(runtime);
  });

  it('records retrieval exclusions, context budget, memory denial, and state conflicts', async () => {
    const recorder = createRecordingTelemetry({ now: () => new Date(0) });
    const retriever = {
      retrieve(_query: { text: string; topK?: number }, _context: { securityContext: object }) {
        return Promise.resolve({
          items: [{ citationId: 'S1', item: { chunk: { id: 'chunk-1', content: 'safe excerpt' }, score: 0.9, provenance: { sourceId: 'source-1', documentId: 'doc-1' } } }],
          citations: [{}],
          diagnostics: { query: 'q', retrievedCount: 2, authorizedCount: 1, excludedCount: 1, rerankedCount: 0, includedCount: 1, exclusions: [{ chunkId: 'private', reason: 'acl' }] },
        });
      },
    };
    const retrieval = createRetrieverTelemetry(recorder);
    await retrieval.instrument(retriever).retrieve({ text: 'q', topK: 2 }, { securityContext: {} });
    const rag = recorder.session().events.find((event) => event.type === 'rag.retrieval');
    if (rag?.type === 'rag.retrieval') expect(rag.candidates.map((candidate) => [candidate.chunkId, candidate.selected])).toEqual([['chunk-1', true], ['private', false]]);
    const engine = { resolve(_registry: object) { return Promise.resolve({ items: [{ id: 'a', name: 'A', scope: 'page', priority: 'normal', sensitivity: 'public', estimatedTokens: 3, truncated: false, text: 'hello' }], content: 'hello', estimatedTokens: 3, excluded: [], diagnostics: { itemsRegistered: 1, itemsIncluded: 1, itemsExcluded: 0, resolutionMs: 2 } }); } };
    await instrumentContextEngine(engine, recorder, { maxContextTokens: 10 }).resolve({});
    expect(recorder.session().events.find((event) => event.type === 'context.resolved')).toMatchObject({ budgetTokens: 10, usedTokens: 3, remainingTokens: 7, byScope: [{ scope: 'page', estimatedTokens: 3 }] });
    const memory = { save(_input: { type: string; value: unknown }): Promise<never> { return Promise.reject(new CopilotError('MEMORY_WRITE_DENIED', 'denied')); }, get(_id: string) { return Promise.resolve(null); }, search(_query?: object) { return Promise.resolve([]); }, forget(_id?: string) { return Promise.resolve(); } };
    await expect(instrumentMemoryService(memory, recorder).save({ type: 'fact', value: 'x' })).rejects.toBeDefined();
    expect(recorder.session().events.find((event) => event.type === 'memory.operation')).toMatchObject({ operation: 'write', outcome: 'denied' });
    const state = { set<T>(_id: string, _value: T) { return; }, update<T>(_id: string, _updater: (value: T) => T) { return; }, getRevision(_id: string) { return 2; }, get<T>(_id: string): T | undefined { return undefined; }, applyPatch(_id: string, _patch: { op: string; value: unknown }, _baseRevision: number) { return { status: 'conflict' as const, currentRevision: 2 }; } };
    observeStateStore(state, recorder).applyPatch('slot', { op: 'replace', value: 'x' }, 1);
    expect(recorder.session().events.find((event) => event.type === 'state.patch')).toMatchObject({ outcome: 'conflict', fromRevision: 1, toRevision: 2 });
    expect(createRetrieverTelemetry(createNoopTelemetry()).instrument(retriever)).toBe(retriever);
    expect(instrumentContextEngine(engine, createNoopTelemetry()).engine).toBe(engine);
    expect(instrumentMemoryService(memory, createNoopTelemetry())).toBe(memory);
    expect(observeStateStore(state, createNoopTelemetry())).toBe(state);
  });

  it('measures an approval wait and returns the original store when disabled', async () => {
    let clock = 1_000;
    const recorder = createRecordingTelemetry({ now: () => new Date(clock) });
    const request: ApprovalRequestLike = { approvalId: 'approval-1', actionId: 'write', runId: 'run-1', approvalLevel: 'user', status: 'pending', createdAt: new Date(clock).toISOString(), summary: 'write', approvals: [] };
    const store = {
      create(_input: unknown) { return Promise.resolve(request); },
      approve(_id: string) { return Promise.resolve({ ...request, status: 'approved', approvals: [{ approverSubject: 'user-1', at: new Date(clock).toISOString() }] }); },
      reject(_id: string) { return Promise.resolve(request); },
      expire(_id: string) { return Promise.resolve(request); },
      cancel(_id: string) { return Promise.resolve(request); },
    };
    expect(instrumentApprovalStore(store, createNoopTelemetry())).toBe(store);
    const wrapped = instrumentApprovalStore(store, recorder, { now: () => clock });
    await wrapped.create({});
    clock += 20;
    await wrapped.approve('approval-1');
    expect(recorder.session().events.find((event) => event.type === 'approval' && event.phase === 'approved')).toMatchObject({ waitMs: 20 });
    expect(recorder.session().spans.find((span) => span.name === 'approval.wait')?.durationMs).toBe(20);
  });
});
