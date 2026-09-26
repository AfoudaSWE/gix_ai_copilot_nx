/**
 * Framework-agnostic assertion failure: every `expect*` helper in this package throws this,
 * so it works under Vitest, Jest, node:test or a plain script alike.
 */
export class TestAssertionError extends Error {
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = 'TestAssertionError';
    this.details = details;
  }
}

export function fail(message: string, details?: unknown): never {
  throw new TestAssertionError(message, details);
}
