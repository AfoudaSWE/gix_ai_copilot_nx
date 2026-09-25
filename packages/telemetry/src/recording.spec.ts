import { describe, expect, it } from 'vitest';
import { composeTelemetry, createNoopTelemetry } from './adapter.js';
import { diagnostic } from './diagnostics.js';
import type { LogDiagnostic } from './diagnostics.js';
import { createRecordingTelemetry } from './recording.js';

describe('createRecordingTelemetry', () => {
  it('records nested spans with parent/child linkage and durations', () => {
    let clock = 1_000;
    const telemetry = createRecordingTelemetry({ now: () => new Date(clock), mode: 'redacted' });
    const root = telemetry.startSpan('copilot.run', { correlation: { runId: 'run-1' } });
    clock += 10;
    const child = telemetry.startSpan('model.call', { parent: root, attributes: { 'copilot.model.name': 'm' } });
    clock += 25;
    child.end('ok');
    clock += 5;
    root.end('ok');

    const session = telemetry.session();
    const ended = session.spans;
    expect(ended.map((span) => span.name)).toEqual(['model.call', 'copilot.run']);
    expect(ended[0]?.parentSpanId).toBe(root.spanId);
    expect(ended[0]?.traceId).toBe(root.traceId);
    expect(ended[0]?.durationMs).toBe(25);
    expect(ended[1]?.durationMs).toBe(40);
    expect(ended[1]?.attributes['copilot.run_id']).toBe('run-1');
    // Started + ended for each span are both in the event stream.
    expect(session.events.filter((event) => event.type === 'span').length).toBe(4);
  });

  it('notifies subscribers and honors the capacity ring buffer', () => {
    const telemetry = createRecordingTelemetry({ capacity: 3 });
    const seen: string[] = [];
    const unsubscribe = telemetry.subscribe((event) => seen.push(event.type));
    for (let index = 0; index < 5; index += 1) {
      telemetry.recordEvent(diagnostic<LogDiagnostic>({ type: 'log', level: 'info', message: `m${index}` }));
    }
    unsubscribe();
    telemetry.recordEvent(diagnostic<LogDiagnostic>({ type: 'log', level: 'info', message: 'after' }));
    expect(seen).toHaveLength(5);
    const session = telemetry.session();
    expect(session.events).toHaveLength(3);
    expect(session.dropped).toBe(3);
  });

  it("'off' mode records nothing and reports enabled: false", () => {
    const telemetry = createRecordingTelemetry({ mode: 'off' });
    expect(telemetry.enabled).toBe(false);
    telemetry.startSpan('x').end();
    telemetry.recordEvent(diagnostic<LogDiagnostic>({ type: 'log', level: 'info', message: 'ignored' }));
    telemetry.recordMetric({ name: 'copilot.runs', kind: 'counter', value: 1, attributes: {} });
    expect(telemetry.session().events).toHaveLength(0);
    expect(telemetry.session().metrics.counters).toEqual({});
  });

  it('scrubs secret-shaped span attributes before storing them', () => {
    const telemetry = createRecordingTelemetry();
    telemetry.startSpan('tool.execute', { attributes: { api_key: 'sk-abcdefghijklmnopqrstuvwxyz123456', ok: 'value' } }).end();
    const span = telemetry.session().spans[0];
    expect(span?.attributes['api_key']).toBe('[REDACTED]');
    expect(span?.attributes['ok']).toBe('value');
  });

  it('scrubs direct diagnostic events before storing or notifying subscribers', () => {
    const telemetry = createRecordingTelemetry({ mode: 'development-verbose' });
    const received: LogDiagnostic[] = [];
    telemetry.subscribe((event) => { if (event.type === 'log') received.push(event); });
    telemetry.recordEvent(diagnostic<LogDiagnostic>({ type: 'log', level: 'info', message: 'ok', fields: { password: 'super-secret' } }));
    expect(received[0]?.fields?.['password']).toBe('[REDACTED]');
    expect(JSON.stringify(telemetry.session())).not.toContain('super-secret');
  });

  it('masks PII in direct events in the default redacted mode', () => {
    const telemetry = createRecordingTelemetry();
    telemetry.recordEvent(diagnostic<LogDiagnostic>({ type: 'log', level: 'info', message: 'Contact jordan.miles@example.com' }));
    expect(JSON.stringify(telemetry.session())).not.toContain('jordan.miles@example.com');
  });

  it('does not retain direct log payloads in metadata-only mode', () => {
    const telemetry = createRecordingTelemetry({ mode: 'metadata-only' });
    telemetry.recordEvent(diagnostic<LogDiagnostic>({ type: 'log', level: 'info', message: 'confidential business text' }));
    expect(telemetry.session().events).toEqual([]);
  });

  it('a throwing subscriber never breaks recording', () => {
    const telemetry = createRecordingTelemetry();
    telemetry.subscribe(() => {
      throw new Error('boom');
    });
    expect(() => telemetry.recordEvent(diagnostic<LogDiagnostic>({ type: 'log', level: 'info', message: 'ok' }))).not.toThrow();
    expect(telemetry.session().events).toHaveLength(1);
  });

  it('clear() resets events, spans and metrics', () => {
    const telemetry = createRecordingTelemetry();
    telemetry.startSpan('x').end();
    telemetry.recordMetric({ name: 'copilot.runs', kind: 'counter', value: 1, attributes: {} });
    telemetry.clear();
    const session = telemetry.session();
    expect(session.events).toHaveLength(0);
    expect(session.spans).toHaveLength(0);
    expect(session.metrics.counters).toEqual({});
  });
});

describe('composeTelemetry', () => {
  it('fans spans, events and metrics out to every enabled adapter and links children per adapter', () => {
    const a = createRecordingTelemetry();
    const b = createRecordingTelemetry();
    const composed = composeTelemetry([a, createNoopTelemetry(), b]);
    const root = composed.startSpan('copilot.run');
    composed.startSpan('model.call', { parent: root }).end();
    root.end();
    composed.recordEvent(diagnostic<LogDiagnostic>({ type: 'log', level: 'info', message: 'x' }));
    composed.recordMetric({ name: 'copilot.runs', kind: 'counter', value: 1, attributes: {} });
    for (const adapter of [a, b]) {
      const session = adapter.session();
      expect(session.spans.map((span) => span.name)).toEqual(['model.call', 'copilot.run']);
      expect(session.spans[0]?.parentSpanId).toBe(session.spans[1]?.spanId);
      expect(session.events.some((event) => event.type === 'log')).toBe(true);
      expect(session.metrics.counters['copilot.runs']).toBe(1);
    }
  });

  it('collapses to a no-op when nothing is enabled and picks the strictest redaction mode', () => {
    expect(composeTelemetry([createNoopTelemetry(), createRecordingTelemetry({ mode: 'off' })]).enabled).toBe(false);
    const composed = composeTelemetry([createRecordingTelemetry({ mode: 'development-verbose' }), createRecordingTelemetry({ mode: 'metadata-only' })]);
    expect(composed.redaction?.mode).toBe('metadata-only');
  });
});
