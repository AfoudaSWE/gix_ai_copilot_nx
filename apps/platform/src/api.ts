/**
 * The platform's only data access: the management HTTP API. The browser never talks to a
 * database, a model provider or a secret store; every decision is made server-side by the
 * management service. Types are declared here (not imported from server packages) so no
 * server code can reach the browser bundle.
 */
export type Role = 'owner' | 'admin' | 'operator' | 'viewer';

export interface Me {
  readonly subject: string;
  readonly tenantId?: string;
  readonly role?: Role;
  readonly platformAdmin: boolean;
}

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description?: string;
  readonly status: 'active' | 'archived';
  readonly updatedAt: string;
}

export interface Environment {
  readonly id: string;
  readonly name: string;
  readonly production: boolean;
}

export interface Resource {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly projectId?: string;
  readonly environment?: string;
  readonly currentVersion: number;
  readonly enabled: boolean;
  readonly updatedAt: string;
}

export interface ResourceVersion {
  readonly version: number;
  readonly spec: unknown;
  readonly stage: 'draft' | 'staging' | 'production';
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string;
}

export interface UsageRow {
  readonly key: Readonly<Record<string, string>>;
  readonly count: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly estimatedCostMicros: number;
  readonly pricedEvents: number;
  readonly events: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  send<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T>;
}

export interface ApiOptions {
  readonly baseUrl: string;
  /** Development bearer token. In production put the platform behind your SSO proxy/cookie. */
  readonly token?: string;
  readonly fetchImpl?: typeof fetch;
}

export function createApiClient(options: ApiOptions): ApiClient {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetchImpl(`${options.baseUrl}${path}`, {
      method,
      headers: {
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      credentials: 'same-origin',
    });
    const text = await response.text();
    const json: unknown = text ? JSON.parse(text) : undefined;
    if (!response.ok) {
      const error = (json as { error?: { code?: string; message?: string } } | undefined)?.error;
      throw new ApiError(response.status, error?.code ?? 'HTTP_ERROR', error?.message ?? `Request failed (${response.status}).`);
    }
    return json as T;
  };
  return {
    get: (path) => request('GET', path),
    send: (method, path, body) => request(method, path, body),
  };
}

/** Micros of the pricing currency, always labelled as an estimate. */
export function formatEstimatedCost(micros: number): string {
  return `${(micros / 1_000_000).toFixed(4)} (estimated)`;
}

export const ROLE_RANK: Readonly<Record<Role, number>> = { viewer: 0, operator: 1, admin: 2, owner: 3 };

export function can(me: Me | undefined, required: Role): boolean {
  return Boolean(me?.role && ROLE_RANK[me.role] >= ROLE_RANK[required]);
}
