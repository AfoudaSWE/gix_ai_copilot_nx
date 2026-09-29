import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createCopilot } from '@gixcopilot/node';
import type { Copilot } from '@gixcopilot/node';
import type { ModelProvider, ModelRequest } from '@gixcopilot/provider';
import { createActionFirewall, createInMemoryAuditSink, createStaticAuthenticationAdapter } from '@gixcopilot/security';
import { attachStudio } from '@gixcopilot/studio/server';
import type { AttachStudioOptions } from '@gixcopilot/studio/server';
import type { StudioService } from '@gixcopilot/studio';
import { defineTool } from '@gixcopilot/tools';

export const SAMPLE_APP = fileURLToPath(new URL('../sample-app/', import.meta.url));

/** A deterministic model that records which tools each request offered to it. */
export function createRecordingProvider(): { provider: ModelProvider; requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  return {
    requests,
    provider: {
      id: 'mock',
      async *stream(request) {
        requests.push(request);
        await Promise.resolve();
        yield { type: 'model.started' };
        yield { type: 'content.delta', delta: 'Hello from the sample copilot (mock provider).' };
        yield { type: 'model.completed', finishReason: 'stop' };
      },
    },
  };
}

export interface StudioExample {
  readonly copilot: Copilot;
  readonly studio: StudioService | undefined;
  readonly requests: ModelRequest[];
}

/**
 * An application copilot (one read-only tool, an Action Firewall, a mock model) with the
 * Developer Studio attached for development. `root` is the application the Studio discovers.
 */
export async function createStudioExample(root: string, options: Partial<AttachStudioOptions> = {}): Promise<StudioExample> {
  const { provider, requests } = createRecordingProvider();
  const copilot = createCopilot({
    model: { provider: 'mock', model: 'demo' },
    providers: [provider],
    tools: [
      defineTool({
        name: 'applications.list',
        description: 'List visa applications',
        input: z.object({}),
        security: { risk: 'read-only', requiredPermissions: ['APPLICATION_VIEW'] },
        execute: () => Promise.resolve([{ id: 'APP-1', status: 'under_review' }]),
      }),
    ],
    security: {
      // A local development fixture token, not a real credential.
      authentication: createStaticAuthenticationAdapter({ 'local-dev-token': { subject: 'officer-1', roles: ['officer'], permissions: ['APPLICATION_VIEW'], attributes: { tenantId: 'demo' } } }),
      firewall: createActionFirewall({ audit: createInMemoryAuditSink() }),
    },
  });
  const studio = await attachStudio(copilot, { root, ...options });
  return { copilot, studio, requests };
}

/** A throwaway copy of the sample app, so applying proposals never touches the repository. */
export function copySampleApp(): string {
  const target = mkdtempSync(join(tmpdir(), 'gix-studio-example-'));
  cpSync(SAMPLE_APP, target, { recursive: true });
  return target;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = process.env['STUDIO_ROOT'] ?? (process.env['STUDIO_COPY_ROOT'] === '1' ? copySampleApp() : SAMPLE_APP);
  const preview = process.env['STUDIO_PREVIEW_DIR'];
  const { copilot } = await createStudioExample(root, preview ? { previewDirectory: preview } : {});
  const address = await copilot.listen({ port: Number(process.env['PORT'] ?? 4120) });
  console.log(`Copilot on ${address}; Developer Studio at ${address}/__gix (discovering ${root})`);
}
