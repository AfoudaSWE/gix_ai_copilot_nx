import { describe, expect, it } from 'vitest';
import type { DiagnosticEvent } from '@gixcopilot/telemetry';
import { SECRET, recordScenario } from './fixtures.spec-helper.js';
import { exportBundle, importBundle, stricterMode } from './bundle.js';
import { overview } from './inspectors.js';
import { createDevTools } from './recorder.js';
import { projectSession } from './session.js';

describe('debug bundle export/import (Section 166-168)', () => {
  it('a redacted export round-trips into an identical projection in another DevTools instance', async () => {
    const devtools = createDevTools({ source: await recordScenario() });
    const bundle = devtools.exportBundle();
    expect(bundle).toMatchObject({ format: 'gixcopilot.devtools.bundle', version: 1, mode: 'redacted' });
    expect(bundle.metadata.runIds).toContain('run-a');
    const imported = importBundle(JSON.stringify(bundle));
    expect(overview(projectSession(imported.snapshot, { tenantId: 'tenant-a' }))).toEqual(overview(devtools.getSession({ tenantId: 'tenant-a' })));
    expect(JSON.stringify(bundle)).not.toContain(SECRET);
  });

  it('metadata-only exports strip every payload but keep ids, counts and timings', async () => {
    const devtools = createDevTools({ source: await recordScenario('development-verbose') });
    const bundle = devtools.exportBundle({ mode: 'metadata-only' });
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain('APP-1024 is under review');
    expect(serialized).not.toContain('Approval policy excerpt');
    expect(bundle.snapshot.events.some((event) => event.type === 'protocol.event')).toBe(false);
    const tool = bundle.snapshot.events.find((event): event is Extract<DiagnosticEvent, { type: 'tool.execution' }> => event.type === 'tool.execution');
    expect(tool?.arguments).toBeUndefined();
    expect(tool?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('can never be more permissive than the recording', async () => {
    const devtools = createDevTools({ source: await recordScenario('metadata-only') });
    expect(devtools.exportBundle({ mode: 'development-verbose' }).mode).toBe('metadata-only');
    expect(stricterMode('redacted', 'development-verbose')).toBe('redacted');
  });

  it('a viewer-scoped export only contains that tenant', async () => {
    const devtools = createDevTools({ source: await recordScenario() });
    const serialized = JSON.stringify(devtools.exportBundle({ viewer: { tenantId: 'tenant-a' } }));
    expect(serialized).not.toContain('hr.salaries');
  });

  it('rejects anything that is not a well-formed bundle, and never executes imported content', () => {
    expect(() => importBundle('{}')).toThrow('Not a DevTools debug bundle');
    expect(() => importBundle({ format: 'gixcopilot.devtools.bundle', version: 2 })).toThrow('Unsupported bundle version');
    expect(() => importBundle({ format: 'gixcopilot.devtools.bundle', version: 1, mode: 'redacted', snapshot: { events: [{ type: 'run' }], spans: [] } })).toThrow('malformed');
    const hostile = exportBundle({ startedAt: new Date(0).toISOString(), mode: 'redacted', dropped: 0, spans: [], events: [] });
    const withCode = { ...hostile, snapshot: { ...hostile.snapshot, events: [] }, toString: 'globalThis.pwned = true' };
    importBundle(JSON.parse(JSON.stringify(withCode)));
    expect((globalThis as Record<string, unknown>)['pwned']).toBeUndefined();
  });
});

describe('recorder subscriptions (Section 24, 227)', () => {
  it('delivers live events only for runs the viewer may see', async () => {
    const telemetry = await recordScenario();
    const devtools = createDevTools({ source: telemetry });
    const seenByA: string[] = [];
    const unsubscribe = devtools.subscribe((event) => seenByA.push(event.correlation.runId ?? ''), { tenantId: 'tenant-a' });
    telemetry.startSpan('copilot.run', { correlation: { runId: 'run-b', tenantId: 'tenant-b' } }).end();
    telemetry.startSpan('copilot.run', { correlation: { runId: 'run-a', tenantId: 'tenant-a' } }).end();
    unsubscribe();
    expect(seenByA.length).toBeGreaterThan(0);
    expect(seenByA).not.toContain('run-b');
  });
});
