import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Copilot } from '@gixcopilot/node';
import type { AnyToolDefinition, ToolRegistry } from '@gixcopilot/tools';

export { createCopilot } from '@gixcopilot/node';
export type { Copilot, CreateCopilotOptions } from '@gixcopilot/node';
export { createMockProvider } from '@gixcopilot/provider-mock';
export { createOpenAIProvider } from '@gixcopilot/provider-openai';
export { createActionFirewall, createInMemoryAuditSink, createStaticAuthenticationAdapter } from '@gixcopilot/security';
export { createToolRegistry, defineTool } from '@gixcopilot/tools';

/**
 * Attaches the Developer Studio in development only. The Studio is loaded lazily, so a
 * production server never even loads it (§6, §64), and `/__gix` does not exist there.
 */
export async function attachStudio(copilot: Copilot, options: { readonly root: string; readonly environment?: string }): Promise<boolean> {
  if (process.env['NODE_ENV'] === 'production' || options.environment === 'production') return false;
  const studio = await import('@gixcopilot/studio/server');
  return (await studio.attachStudio(copilot, options)) !== undefined;
}

export interface LoadGeneratedToolsOptions {
  /** Project root; tools are read from `<root>/.gix/tools`. */
  readonly root: string;
  /** Trusted base URL of your API, from configuration (never from model input). */
  readonly baseUrl?: string;
  readonly log?: (line: string) => void;
}

export interface LoadedTools {
  readonly registered: readonly string[];
  readonly skipped: readonly { readonly file: string; readonly reason: string }[];
}

/**
 * Registers the tools the Studio generated **and you approved and applied** (§47): every
 * module in `.gix/tools/` exports either `create<Name>Tools(options)` (HTTP tools) or
 * `register<Name>Tools(registry, options)` (OpenAPI tools). Nothing else is loaded, and each
 * tool still runs through the Action Firewall with the security it was approved with.
 */
export async function loadGeneratedTools(registry: ToolRegistry, options: LoadGeneratedToolsOptions): Promise<LoadedTools> {
  const directory = join(options.root, '.gix', 'tools');
  let files: string[];
  try {
    files = readdirSync(directory).filter((file) => /\.(ts|js|mjs)$/.test(file) && !file.endsWith('.d.ts')).sort();
  } catch {
    return { registered: [], skipped: [] };
  }
  const before = new Set(registry.list().map((tool) => tool.name));
  const skipped: { file: string; reason: string }[] = [];
  for (const file of files) {
    const module = (await import(pathToFileURL(join(directory, file)).href)) as Record<string, unknown>;
    for (const [name, value] of Object.entries(module)) {
      if (typeof value !== 'function') continue;
      if (/^register\w*Tools$/.test(name)) {
        await (value as (registry: ToolRegistry, options: { baseUrl?: string }) => Promise<unknown>)(registry, options.baseUrl ? { baseUrl: options.baseUrl } : {});
      } else if (/^create\w*Tools$/.test(name)) {
        if (!options.baseUrl) {
          skipped.push({ file, reason: 'set GIX_API_BASE_URL to the API these tools call' });
          continue;
        }
        for (const tool of (value as (options: { baseUrl: string }) => readonly AnyToolDefinition[])({ baseUrl: options.baseUrl })) registry.register(tool);
      }
    }
  }
  for (const entry of skipped) options.log?.(`GIX: skipped ${entry.file}: ${entry.reason}.`);
  return { registered: registry.list().map((tool) => tool.name).filter((name) => !before.has(name)), skipped };
}
