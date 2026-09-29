import type { FrameworkId, FrameworkInfo, FrameworkRole } from './model.js';

export interface PackageManifest {
  /** Workspace-relative path of the package.json. */
  readonly path: string;
  /** Directory of the manifest ('' for the root). */
  readonly directory: string;
  readonly name?: string;
  readonly private?: boolean;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly scripts: Readonly<Record<string, string>>;
  readonly workspaces?: readonly string[];
}

/** What a detector sees: the manifests of one unit (or the whole repository) and its files. */
export interface DetectionInput {
  readonly manifests: readonly PackageManifest[];
  /** Workspace-relative file paths inside the scope being detected. */
  readonly files: readonly string[];
}

/**
 * A framework detector (§14). Detection is an adapter, never a hard-coded assumption in the
 * discovery core: add a detector to support a new framework.
 */
export interface ProjectDetector {
  readonly id: FrameworkId;
  readonly role: FrameworkRole;
  detect(input: DetectionInput): FrameworkInfo | undefined;
}

function dependencyDetector(id: FrameworkId, role: FrameworkRole, packages: readonly string[], configFiles: readonly RegExp[] = []): ProjectDetector {
  return {
    id,
    role,
    detect({ manifests, files }) {
      const evidence: string[] = [];
      let version: string | undefined;
      for (const manifest of manifests) {
        for (const name of packages) {
          const spec = manifest.dependencies[name];
          if (spec !== undefined) {
            evidence.push(`${manifest.path} (${name}@${spec})`);
            version ??= spec;
          }
        }
      }
      for (const file of files) {
        const base = file.split('/').pop() ?? file;
        if (configFiles.some((pattern) => pattern.test(base))) evidence.push(file);
      }
      return evidence.length > 0 ? { id, role, ...(version ? { version } : {}), evidence: [...new Set(evidence)].slice(0, 5) } : undefined;
    },
  };
}

const BACKEND_PACKAGES = ['fastify', 'express', '@nestjs/core', 'koa', 'hono', '@hapi/hapi', '@gixcopilot/node', '@gixcopilot/server'];

export const DEFAULT_DETECTORS: readonly ProjectDetector[] = [
  dependencyDetector('nx', 'workspace', ['nx'], [/^nx\.json$/]),
  dependencyDetector('nextjs', 'frontend', ['next'], [/^next\.config\.[cm]?[jt]s$/]),
  dependencyDetector('react', 'frontend', ['react']),
  dependencyDetector('angular', 'frontend', ['@angular/core'], [/^angular\.json$/]),
  dependencyDetector('vue', 'frontend', ['vue']),
  dependencyDetector('vite', 'build', ['vite'], [/^vite\.config\.[cm]?[jt]s$/]),
  dependencyDetector('nestjs', 'backend', ['@nestjs/core'], [/^nest-cli\.json$/]),
  dependencyDetector('fastify', 'backend', ['fastify']),
  dependencyDetector('express', 'backend', ['express']),
  {
    id: 'node',
    role: 'backend',
    detect({ manifests }) {
      const evidence = manifests.flatMap((manifest) => {
        const backend = BACKEND_PACKAGES.find((name) => manifest.dependencies[name] !== undefined);
        if (backend) return [`${manifest.path} (${backend})`];
        const start = manifest.scripts['start'] ?? manifest.scripts['serve'];
        return start && /\b(node|tsx|ts-node)\b/.test(start) ? [`${manifest.path} (scripts.start)`] : [];
      });
      return evidence.length > 0 ? { id: 'node', role: 'backend', evidence: evidence.slice(0, 5) } : undefined;
    },
  },
  dependencyDetector('typescript', 'language', ['typescript'], [/^tsconfig(\..+)?\.json$/]),
];

export const FRONTEND_FRAMEWORKS: ReadonlySet<FrameworkId> = new Set(['react', 'angular', 'vue', 'nextjs']);
export const BACKEND_FRAMEWORKS: ReadonlySet<FrameworkId> = new Set(['node', 'fastify', 'express', 'nestjs']);

export function runDetectors(detectors: readonly ProjectDetector[], input: DetectionInput): FrameworkInfo[] {
  return detectors.flatMap((detector) => {
    const found = detector.detect(input);
    return found ? [found] : [];
  });
}
