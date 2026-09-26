import { createModelRuntime } from '@gixcopilot/provider';
import type { ModelProvider, ModelRuntime } from '@gixcopilot/provider';
import { createActionFirewallMiddleware } from '@gixcopilot/security';
import type { ActionFirewall } from '@gixcopilot/security';
import { createFirewallTelemetry, createToolTelemetry, instrumentModelRuntime, withTelemetryMetadata } from '@gixcopilot/telemetry';
import type { TelemetryAdapter } from '@gixcopilot/telemetry';
import { createStaticToolResolver, createToolRuntime } from '@gixcopilot/tools';
import type { AnyToolDefinition, ToolResolver, ToolRuntime } from '@gixcopilot/tools';
import type { SecurityFixture } from './security.js';

export interface ToolStack {
  readonly resolver: ToolResolver;
  readonly toolRuntime: ToolRuntime;
  readonly firewall?: ActionFirewall;
}

/**
 * The same tool pipeline `@gixcopilot/server` builds (permission-aware discovery, then the
 * Action Firewall, then validation and execution), with the same telemetry wiring - so a test
 * sees exactly the tool and security diagnostics production would record.
 */
export function createToolStack(options: {
  readonly tools: readonly AnyToolDefinition[];
  readonly security?: SecurityFixture;
  readonly telemetry: TelemetryAdapter;
  readonly toolTimeoutMs?: number;
}): ToolStack {
  const { security, telemetry } = options;
  const resolver = security ? security.resolver(options.tools) : createStaticToolResolver(options.tools);
  const toolTelemetry = telemetry.enabled ? createToolTelemetry(telemetry) : undefined;
  let firewall: ActionFirewall | undefined;
  if (security) {
    const tenantId = security.securityContext.tenant?.tenantId;
    const instrumented = telemetry.enabled ? createFirewallTelemetry(telemetry, { tracker: toolTelemetry?.tracker }).instrument(security.firewall) : security.firewall;
    // Carry the run correlation into the firewall's own diagnostic, as the server does.
    firewall = {
      ...instrumented,
      evaluate: (request, context) =>
        instrumented.evaluate(request, { ...context, metadata: withTelemetryMetadata(context.metadata, { correlation: { runId: request.runId, tenantId } }) }),
    };
  }
  const raw = createToolRuntime({
    resolver,
    defaultTimeoutMs: options.toolTimeoutMs,
    middleware: [
      ...(security && firewall ? [createActionFirewallMiddleware({ firewall, resolver, getContext: () => security.securityContext })] : []),
      ...(toolTelemetry ? [toolTelemetry.middleware] : []),
    ],
    onEvent: toolTelemetry ? (event) => toolTelemetry.onEvent(event) : undefined,
  });
  return { resolver, toolRuntime: toolTelemetry?.instrument(raw) ?? raw, firewall };
}

/** A model runtime over deterministic (or real) providers, instrumented like the server's. */
export function createInstrumentedModelRuntime(providers: readonly ModelProvider[], telemetry: TelemetryAdapter, defaultModel = 'test-model'): ModelRuntime {
  const runtime = createModelRuntime({ providers: [...providers], defaultProvider: providers[0]?.id ?? 'test', defaultModel });
  if (!telemetry.enabled) return runtime;
  const traced = instrumentModelRuntime(runtime, telemetry);
  return { registry: runtime.registry, stream: (request) => traced.stream(request) };
}
