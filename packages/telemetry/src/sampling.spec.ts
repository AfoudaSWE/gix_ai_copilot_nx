import { describe, expect, it } from 'vitest';
import { ATTR } from './conventions.js';
import { recordLog } from './logs.js';
import { createRecordingTelemetry } from './recording.js';
import { createRatioSampler, neverSample } from './sampling.js';

describe('trace sampling (Section 159)', () => {
  it('an unsampled root drops its whole span subtree but keeps diagnostic events', () => {
    const telemetry = createRecordingTelemetry({ shouldSample: neverSample });
    const root = telemetry.startSpan('copilot.run', { correlation: { runId: 'run-1' } });
    const child = telemetry.startSpan('model.call', { parent: root });
    child.end();
    root.end();
    recordLog(telemetry, 'info', 'still recorded', { correlation: { runId: 'run-1' } });

    const session = telemetry.session();
    expect(session.spans).toEqual([]);
    expect(session.events.filter((event) => event.type === 'span')).toEqual([]);
    expect(session.events.some((event) => event.type === 'log' && event.correlation.runId === 'run-1')).toBe(true);
  });

  it('the ratio sampler gives one run id the same verdict every time', () => {
    const sampler = createRatioSampler(0.5);
    const verdicts = Array.from({ length: 5 }, () => sampler('copilot.run', { [ATTR.runId]: 'run-42' }));
    expect(new Set(verdicts).size).toBe(1);
  });

  it('the ratio sampler keeps roughly the configured share of runs', () => {
    const sampler = createRatioSampler(0.25);
    let kept = 0;
    for (let index = 0; index < 4_000; index += 1) {
      if (sampler('copilot.run', { [ATTR.runId]: `run-${index}` })) kept += 1;
    }
    expect(kept / 4_000).toBeGreaterThan(0.2);
    expect(kept / 4_000).toBeLessThan(0.3);
  });

  it('rejects an out-of-range ratio', () => {
    expect(() => createRatioSampler(1.5)).toThrow(RangeError);
  });
});

describe('recordLog (Section 8, 14)', () => {
  it('redacts secrets in the message and in fields', () => {
    const telemetry = createRecordingTelemetry({ mode: 'redacted' });
    recordLog(telemetry, 'warn', 'retrying with key sk-abcdefghijklmnopqrstuvwxyz', {
      fields: { password: 'hunter2', attempt: 2 },
      correlation: { runId: 'run-1' },
    });
    const serialized = JSON.stringify(telemetry.session().events);
    expect(serialized).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).toContain('"attempt":2');
  });

  it('is dropped entirely under metadata-only and off', () => {
    for (const mode of ['metadata-only', 'off'] as const) {
      const telemetry = createRecordingTelemetry({ mode });
      recordLog(telemetry, 'info', 'hello');
      expect(telemetry.session().events).toEqual([]);
    }
  });
});
