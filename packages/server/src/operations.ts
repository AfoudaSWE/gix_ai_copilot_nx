import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { CopilotEvent, Usage } from '@gixcopilot/protocol';

/**
 * Phase 12 operational endpoints (Section 108-111).
 *
 * - Liveness `/health` (already served by `createServer`): is the process up? It checks
 *   nothing external, so an unhealthy dependency never gets a healthy process restarted.
 * - Readiness `/ready`: can this instance serve traffic now? It checks required dependencies
 *   (database, Redis, pending migrations) with short timeouts, and never calls an LLM provider.
 * - Metrics `/metrics`: Prometheus text, opt-in and token-protected. Labels never contain
 *   tenant ids, user ids, prompts or other sensitive/high-cardinality values.
 */
export interface ReadinessCheck {
  readonly name: string;
  /** When false, a failure is reported but does not make the instance unready. Default true. */
  readonly critical?: boolean;
  check(): Promise<{ readonly ok: boolean; readonly error?: string }>;
}

export interface MetricsRegistry {
  inc(name: string, labels?: Readonly<Record<string, string>>, value?: number): void;
  set(name: string, labels: Readonly<Record<string, string>>, value: number): void;
  describe(name: string, type: 'counter' | 'gauge', help: string): void;
  render(): string;
}

const METRIC = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const escape = (value: string): string => value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');

export function createMetricsRegistry(): MetricsRegistry {
  const values = new Map<string, Map<string, number>>();
  const meta = new Map<string, { type: string; help: string }>();
  const key = (labels: Readonly<Record<string, string>> = {}): string =>
    Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, value]) => `${label}="${escape(value)}"`)
      .join(',');
  const series = (name: string): Map<string, number> => {
    if (!METRIC.test(name)) throw new Error(`Invalid metric name ${name}`);
    let entry = values.get(name);
    if (!entry) values.set(name, (entry = new Map<string, number>()));
    return entry;
  };
  return {
    describe: (name, type, help) => void meta.set(name, { type, help }),
    inc(name, labels, value = 1) {
      const entry = series(name);
      const id = key(labels);
      entry.set(id, (entry.get(id) ?? 0) + value);
    },
    set(name, labels, value) {
      series(name).set(key(labels), value);
    },
    render() {
      const lines: string[] = [];
      for (const [name, entry] of [...values.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const info = meta.get(name);
        if (info) lines.push(`# HELP ${name} ${info.help}`, `# TYPE ${name} ${info.type}`);
        for (const [labels, value] of entry) lines.push(`${name}${labels ? `{${labels}}` : ''} ${value}`);
      }
      return `${lines.join('\n')}\n`;
    },
  };
}

/** A run observer that feeds low-cardinality run metrics (status, model, token counts). */
export function createRunMetricsObserver(registry: MetricsRegistry) {
  registry.describe('copilot_runs_total', 'counter', 'Runs finished, by status.');
  registry.describe('copilot_active_runs', 'gauge', 'Runs currently streaming on this instance.');
  registry.describe('copilot_tokens_total', 'counter', 'Model tokens, by direction and model.');
  registry.describe('copilot_run_duration_seconds_sum', 'counter', 'Total run duration.');
  registry.describe('copilot_run_duration_seconds_count', 'counter', 'Number of timed runs.');
  registry.describe('copilot_tool_calls_total', 'counter', 'Tool calls finished, by outcome.');
  let active = 0;
  registry.set('copilot_active_runs', {}, 0);
  return {
    onRunStarted(): void {
      registry.set('copilot_active_runs', {}, ++active);
    },
    onEvent(event: CopilotEvent): void {
      if (event.type === 'tool.completed') registry.inc('copilot_tool_calls_total', { outcome: 'succeeded' });
      else if (event.type === 'tool.failed') registry.inc('copilot_tool_calls_total', { outcome: 'failed' });
    },
    onRunEnded(info: { readonly startedAt: string; readonly model?: { readonly provider: string; readonly model: string } }, outcome: { readonly status: string; readonly usage?: Usage }): void {
      registry.set('copilot_active_runs', {}, (active = Math.max(active - 1, 0)));
      registry.inc('copilot_runs_total', { status: outcome.status });
      registry.inc('copilot_run_duration_seconds_sum', {}, (Date.now() - Date.parse(info.startedAt)) / 1000);
      registry.inc('copilot_run_duration_seconds_count');
      if (outcome.usage) {
        const model = info.model ? `${info.model.provider}/${info.model.model}` : 'default';
        registry.inc('copilot_tokens_total', { direction: 'input', model }, outcome.usage.inputTokens);
        registry.inc('copilot_tokens_total', { direction: 'output', model }, outcome.usage.outputTokens);
      }
    },
  };
}

export interface OperationalRoutesOptions {
  readonly readiness?: readonly ReadinessCheck[];
  readonly checkTimeoutMs?: number;
  /** Omit to not serve `/metrics` at all. */
  readonly metrics?: { readonly registry: MetricsRegistry; readonly bearerToken?: string };
  /** Set while shutting down, so load balancers stop routing here before connections close. */
  readonly isShuttingDown?: () => boolean;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => (timer = setTimeout(() => reject(new Error('timeout')), ms)))]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function tokenMatches(header: string | undefined, expected: string): boolean {
  const provided = Buffer.from(header?.replace(/^Bearer\s+/i, '') ?? '');
  const wanted = Buffer.from(expected);
  return provided.length === wanted.length && timingSafeEqual(provided, wanted);
}

/** Adds `/ready` and (optionally) `/metrics` to an app created by `createServer`. */
export function registerOperationalRoutes(app: FastifyInstance, options: OperationalRoutesOptions): void {
  const checks = options.readiness ?? [];
  const timeoutMs = options.checkTimeoutMs ?? 2000;
  app.get('/ready', async (_request, reply) => {
    if (options.isShuttingDown?.()) return reply.status(503).send({ status: 'shutting-down', checks: [] });
    const results = await Promise.all(
      checks.map(async (check) => {
        const started = performance.now();
        try {
          const result = await withTimeout(check.check(), timeoutMs);
          return { name: check.name, ok: result.ok, critical: check.critical ?? true, latencyMs: Math.round(performance.now() - started), ...(result.error ? { error: result.error } : {}) };
        } catch (error) {
          return { name: check.name, ok: false, critical: check.critical ?? true, latencyMs: Math.round(performance.now() - started), error: (error as Error).message === 'timeout' ? 'timeout' : 'check failed' };
        }
      }),
    );
    const ready = results.every((result) => result.ok || !result.critical);
    return reply.status(ready ? 200 : 503).send({ status: ready ? 'ready' : 'not-ready', checks: results });
  });
  const metrics = options.metrics;
  if (metrics) {
    app.get('/metrics', async (request, reply) => {
      if (metrics.bearerToken && !tokenMatches(request.headers.authorization, metrics.bearerToken)) return reply.status(401).send({ error: { code: 'AUTHENTICATION_REQUIRED', message: 'Metrics token required.' } });
      const memory = process.memoryUsage();
      metrics.registry.set('process_resident_memory_bytes', {}, memory.rss);
      metrics.registry.set('process_uptime_seconds', {}, Math.round(process.uptime()));
      return reply.header('content-type', 'text/plain; version=0.0.4').send(metrics.registry.render());
    });
  }
}
