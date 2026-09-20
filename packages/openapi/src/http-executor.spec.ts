import { describe, expect, it, vi } from 'vitest';
import { createFetchHttpExecutor, MissingPathParameterError, SsrfGuardError } from './http-executor.js';
import type { HttpExecutionRequest } from './http-executor.js';

function baseRequest(overrides: Partial<HttpExecutionRequest> = {}): HttpExecutionRequest {
  return {
    method: 'get',
    baseUrl: 'https://api.example.com/v1',
    pathTemplate: '/applications/{applicationId}',
    pathParams: { applicationId: 'app-1' },
    ...overrides,
  };
}

describe('createFetchHttpExecutor', () => {
  it('constructs a URL from baseUrl + pathTemplate + validated path params', async () => {
    let capturedUrl: string | undefined;
    const fetchImpl = vi.fn((url: string | URL) => {
      capturedUrl = url.toString();
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const executor = createFetchHttpExecutor({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await executor.execute(baseRequest());
    expect(capturedUrl).toBe('https://api.example.com/v1/applications/app-1');
  });

  it('appends query parameters, including repeated values for arrays', async () => {
    let capturedUrl: string | undefined;
    const fetchImpl = vi.fn((url: string | URL) => {
      capturedUrl = url.toString();
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const executor = createFetchHttpExecutor({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await executor.execute(
      baseRequest({ queryParams: { status: 'PENDING', tag: ['a', 'b'] } }),
    );
    const url = new URL(capturedUrl ?? '');
    expect(url.searchParams.get('status')).toBe('PENDING');
    expect(url.searchParams.getAll('tag')).toEqual(['a', 'b']);
  });

  it('encodes a path parameter value so it cannot inject extra path segments or a query string', async () => {
    let capturedUrl: string | undefined;
    const fetchImpl = vi.fn((url: string | URL) => {
      capturedUrl = url.toString();
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const executor = createFetchHttpExecutor({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await executor.execute(baseRequest({ pathParams: { applicationId: '../../etc/passwd?x=1' } }));
    expect(capturedUrl).toBe('https://api.example.com/v1/applications/..%2F..%2Fetc%2Fpasswd%3Fx%3D1');
  });

  it('rejects a non-http(s) base URL protocol', async () => {
    const executor = createFetchHttpExecutor({ fetchImpl: vi.fn() as unknown as typeof fetch });
    await expect(executor.execute(baseRequest({ baseUrl: 'file:///etc/passwd' }))).rejects.toThrow(SsrfGuardError);
  });

  it('rejects an invalid base URL', async () => {
    const executor = createFetchHttpExecutor({ fetchImpl: vi.fn() as unknown as typeof fetch });
    await expect(executor.execute(baseRequest({ baseUrl: 'not a url' }))).rejects.toThrow(SsrfGuardError);
  });

  it('throws MissingPathParameterError when a path template placeholder has no value', async () => {
    const executor = createFetchHttpExecutor({ fetchImpl: vi.fn() as unknown as typeof fetch });
    await expect(
      executor.execute(baseRequest({ pathParams: {} })),
    ).rejects.toThrow(MissingPathParameterError);
  });

  it('sends a JSON body and sets Content-Type when a body is present', async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = vi.fn((_url: string | URL, init?: RequestInit) => {
      capturedInit = init;
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const executor = createFetchHttpExecutor({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await executor.execute(baseRequest({ method: 'post', body: { officerId: 'off-1' } }));
    expect(capturedInit?.body).toBe(JSON.stringify({ officerId: 'off-1' }));
    const headers = new Headers(capturedInit?.headers);
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('does not overwrite an explicit Content-Type header', async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = vi.fn((_url: string | URL, init?: RequestInit) => {
      capturedInit = init;
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const executor = createFetchHttpExecutor({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await executor.execute(
      baseRequest({ method: 'post', body: { a: 1 }, headers: { 'Content-Type': 'application/merge-patch+json' } }),
    );
    const headers = new Headers(capturedInit?.headers);
    expect(headers.get('content-type')).toBe('application/merge-patch+json');
  });

  it('parses a JSON response body', async () => {
    const fetchImpl = vi.fn(() => new Response(JSON.stringify({ id: 'app-1' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const executor = createFetchHttpExecutor({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await executor.execute(baseRequest());
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ id: 'app-1' });
  });

  it('returns text for a text/* response and undefined for other content types', async () => {
    const textExecutor = createFetchHttpExecutor({
      fetchImpl: (() => new Response('hello', { status: 200, headers: { 'content-type': 'text/plain' } })) as unknown as typeof fetch,
    });
    expect((await textExecutor.execute(baseRequest())).body).toBe('hello');

    const binaryExecutor = createFetchHttpExecutor({
      fetchImpl: (() => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'application/octet-stream' } })) as unknown as typeof fetch,
    });
    expect((await binaryExecutor.execute(baseRequest())).body).toBeUndefined();
  });

  it('only surfaces allowlisted response headers, dropping everything else', async () => {
    const fetchImpl = vi.fn(
      () =>
        new Response('{}', {
          status: 200,
          headers: { 'content-type': 'application/json', 'set-cookie': 'session=abc', 'x-internal-trace': 't-1' },
        }),
    );
    const executor = createFetchHttpExecutor({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await executor.execute(baseRequest());
    expect(result.headers['content-type']).toBe('application/json');
    expect(result.headers['set-cookie']).toBeUndefined();
    expect(result.headers['x-internal-trace']).toBeUndefined();
  });

  it('aborts the request when the caller signal is already aborted', async () => {
    const fetchImpl = vi.fn((_url: string | URL, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const executor = createFetchHttpExecutor({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const controller = new AbortController();
    controller.abort();
    await expect(executor.execute(baseRequest({ signal: controller.signal }))).rejects.toThrow();
  });
});
