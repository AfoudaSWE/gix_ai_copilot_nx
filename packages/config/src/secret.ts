import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const REDACTED = '[secret]';
const inspectSymbol = Symbol.for('nodejs.util.inspect.custom');

/**
 * A secret value that cannot leak by accident: `String(secret)`, template literals,
 * `JSON.stringify` and `util.inspect`/`console.log` all print `[secret]`. The raw value is only
 * available through an explicit `reveal()`, which is what reviewers should look for.
 */
export class Secret {
  readonly #value: string;
  /** Where the value came from (e.g. `env:OPENAI_API_KEY`), safe to log. */
  readonly source: string;

  constructor(value: string, source: string) {
    this.#value = value;
    this.source = source;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [inspectSymbol](): string {
    return `Secret(${this.source})`;
  }
}

export function isSecret(value: unknown): value is Secret {
  return value instanceof Secret;
}

/**
 * Where secrets come from. Implement this for a vault or cloud secret manager; the SDK ships
 * environment and mounted-file providers. A provider returns `undefined` for an unknown name.
 */
export interface SecretProvider {
  readonly name: string;
  get(name: string): Promise<Secret | undefined>;
}

/** Reads `name` from the process environment (or the given env object). */
export function createEnvSecretProvider(env: Readonly<Record<string, string | undefined>> = process.env): SecretProvider {
  return {
    name: 'env',
    get(name) {
      const value = env[name];
      return Promise.resolve(value === undefined || value === '' ? undefined : new Secret(value, `env:${name}`));
    },
  };
}

/**
 * Reads mounted secret files (Docker/Kubernetes secrets, e.g. `/run/secrets/<name>`). The name
 * must be a plain file name; path traversal is rejected. Trailing newlines are trimmed.
 */
export function createFileSecretProvider(directory = '/run/secrets'): SecretProvider {
  return {
    name: 'file',
    async get(name) {
      if (!/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith('.')) return undefined;
      try {
        const value = (await readFile(join(directory, name), 'utf8')).replace(/\r?\n$/, '');
        return value === '' ? undefined : new Secret(value, `file:${name}`);
      } catch {
        return undefined;
      }
    },
  };
}

/** Tries each provider in order; the first that knows the name wins. */
export function composeSecretProviders(...providers: readonly SecretProvider[]): SecretProvider {
  return {
    name: providers.map((provider) => provider.name).join('+'),
    async get(name) {
      for (const provider of providers) {
        const secret = await provider.get(name);
        if (secret) return secret;
      }
      return undefined;
    },
  };
}
