import { describe, expect, it } from 'vitest';
import { assertSafeWebUrl, SsrfGuardError } from './ssrf-guard.js';

describe('assertSafeWebUrl', () => {
  it('rejects non-http(s) protocols', async () => {
    await expect(assertSafeWebUrl(new URL('file:///etc/passwd'))).rejects.toThrow(SsrfGuardError);
    await expect(assertSafeWebUrl(new URL('ftp://example.com/x'))).rejects.toThrow(SsrfGuardError);
  });

  it('rejects a literal loopback IP', async () => {
    await expect(assertSafeWebUrl(new URL('http://127.0.0.1/'))).rejects.toThrow(SsrfGuardError);
    await expect(assertSafeWebUrl(new URL('http://[::1]/'))).rejects.toThrow(SsrfGuardError);
  });

  it('rejects RFC1918 private ranges', async () => {
    await expect(assertSafeWebUrl(new URL('http://10.0.0.5/'))).rejects.toThrow(SsrfGuardError);
    await expect(assertSafeWebUrl(new URL('http://172.16.0.5/'))).rejects.toThrow(SsrfGuardError);
    await expect(assertSafeWebUrl(new URL('http://192.168.1.1/'))).rejects.toThrow(SsrfGuardError);
  });

  it('rejects the cloud metadata link-local address', async () => {
    await expect(assertSafeWebUrl(new URL('http://169.254.169.254/latest/meta-data'))).rejects.toThrow(
      SsrfGuardError,
    );
  });

  it('allows a public-looking literal IP', async () => {
    await expect(assertSafeWebUrl(new URL('https://93.184.216.34/'))).resolves.toBeUndefined();
  });
});
