import type { ProjectClassification } from '@gixcopilot/studio';

export const MANIFEST_FILE = '.gix/manifest.json';

/** `.gix/manifest.json` (§58): what `gix init` found and did. Never holds secrets. */
export interface GixManifest {
  readonly sdkVersion: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly workspace: { readonly kind: string; readonly packageManager: string; readonly classification: ProjectClassification };
  readonly applications: readonly { readonly path: string; readonly role: string; readonly framework?: string }[];
  readonly selectedApplications: readonly string[];
  readonly server: { readonly strategy: 'dedicated'; readonly file: string; readonly port: number };
  readonly uiIntegrations: readonly { readonly app: string; readonly framework: string; readonly proposal?: string }[];
  readonly generatedFiles: readonly string[];
  readonly modifiedFiles: readonly string[];
  readonly apiSources: readonly { readonly kind: string; readonly file: string; readonly operations: number }[];
  readonly discovery: { readonly discoveredAt: string; readonly operations: number; readonly routes: number; readonly pages: number; readonly components: number; readonly permissions: number };
  readonly proposals: readonly { readonly id: string; readonly generator: string }[];
}

export function parseManifest(text: string | undefined): GixManifest | undefined {
  if (!text) return undefined;
  try {
    const value = JSON.parse(text) as Partial<GixManifest>;
    return typeof value.sdkVersion === 'string' && value.workspace !== undefined ? (value as GixManifest) : undefined;
  } catch {
    return undefined;
  }
}
