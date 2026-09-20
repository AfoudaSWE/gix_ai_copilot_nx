import { measureIntegration } from '@gixcopilot/tools';
import type { AnyToolDefinition, ToolRegistration, ToolRegistry } from '@gixcopilot/tools';
import { generateOpenAPITools } from './tool-generator.js';
import type { GenerateOpenAPIToolsOptions } from './tool-generator.js';
import type { OpenAPIGenerationReport, OpenAPIToolSourceMetadata, RegistrationConflict } from './types.js';

export interface RegisterOpenAPIOptions extends GenerateOpenAPIToolsOptions {
  readonly registry: ToolRegistry;
}

export interface OpenAPIIntegration {
  readonly integrationId: string;
  /** The most recent registration report (Section 60) - starts as the initial
   * `registerOpenAPI` call's result and updates in place after each `refresh()`. */
  readonly report: OpenAPIGenerationReport;
  readonly toolNames: readonly string[];
  /**
   * Re-loads the source, regenerates tools, and reconciles them against the registry (Section
   * 61): an operation still present gets `update()`d in place (keeping its registration slot,
   * so anything holding a reference keeps working); an operation that disappeared from the
   * spec is `dispose()`d, never left behind as a stale, still-callable tool (Section 62); a
   * newly-appeared operation is registered for the first time.
   */
  refresh(): Promise<OpenAPIGenerationReport>;
  /** Unregisters every tool this integration owns. Idempotent. */
  dispose(): void;
}

function operationDescriptorOf(tool: AnyToolDefinition): string {
  const custom = tool.metadata?.custom as Partial<OpenAPIToolSourceMetadata> | undefined;
  if (custom?.method !== undefined && custom.path !== undefined) {
    return `${custom.method.toUpperCase()} ${custom.path}`;
  }
  return tool.name;
}

/**
 * Generates tools from an OpenAPI document and registers them into `registry` (Section 5's
 * "register into the EXISTING Tool Registry", never a parallel one). A tool name already
 * registered by something else (another integration, a hand-written tool) is never silently
 * overwritten - the registry's own `register()` rejects the duplicate by default, and that
 * rejection is captured here as an additional `conflicts` entry rather than propagating as an
 * unhandled error that would abort every other operation's registration (Section 60's report
 * is meant to describe partial success, not force all-or-nothing registration).
 */
export async function registerOpenAPI(options: RegisterOpenAPIOptions): Promise<OpenAPIIntegration> {
  const { registry, ...generateOptions } = options;
  const registrations = new Map<string, ToolRegistration>();
  let disposed = false;

  async function generateAndReconcile(): Promise<OpenAPIGenerationReport> {
    const { tools, report } = await generateOpenAPITools(generateOptions);
    if (disposed) return { ...report, generated: 0 };
    const nextNames = new Set(tools.map((tool) => tool.name));

    for (const [name, registration] of registrations) {
      if (!nextNames.has(name)) {
        registration.dispose();
        registrations.delete(name);
      }
    }

    const extraConflicts: RegistrationConflict[] = [];
    let registeredCount = 0;
    for (const tool of tools) {
      const existing = registrations.get(tool.name);
      if (existing) {
        existing.update(tool);
        registeredCount += 1;
        continue;
      }
      try {
        registrations.set(tool.name, registry.register(tool));
        registeredCount += 1;
      } catch {
        extraConflicts.push({ name: tool.name, operations: [operationDescriptorOf(tool)] });
      }
    }

    return { ...report, generated: registeredCount, conflicts: [...report.conflicts, ...extraConflicts] };
  }

  const reconcile = () => measureIntegration(options.onTelemetry, { stage: 'register', integrationId: options.integrationId }, generateAndReconcile);
  let pending = Promise.resolve();
  let currentReport = await reconcile();

  return {
    integrationId: options.integrationId,
    get report() {
      return currentReport;
    },
    get toolNames() {
      return Array.from(registrations.keys());
    },
    async refresh() {
      if (disposed) throw new Error('OpenAPI integration is disposed.');
      const task = pending.then(async () => {
        if (disposed) throw new Error('Integration is disposed.');
        currentReport = await reconcile();
        return currentReport;
      });
      pending = task.then(() => {}, () => {});
      return task;
    },
    dispose() {
      disposed = true;
      for (const registration of registrations.values()) registration.dispose();
      registrations.clear();
    },
  };
}
