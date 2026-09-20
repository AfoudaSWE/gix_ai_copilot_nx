import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class SsrfGuardError extends Error {
  override readonly name = 'SsrfGuardError';
}

function ipv4ToInt(ip: string): number {
  return ip
    .split('.')
    .reduce((acc, octet) => (acc << 8) + Number(octet), 0);
}

function inV4Range(ip: string, base: string, prefixLength: number): boolean {
  const mask = prefixLength === 0 ? 0 : (~0 << (32 - prefixLength)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

/** RFC 1918 + loopback + link-local (includes the 169.254.169.254 cloud metadata address) + CGNAT + "this network". */
const BLOCKED_V4_RANGES: readonly [base: string, prefixLength: number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function isPrivateIpv4(ip: string): boolean {
  return BLOCKED_V4_RANGES.some(([base, prefixLength]) => inV4Range(ip, base, prefixLength));
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
    return true; // fe80::/10 link-local
  }
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // fc00::/7 unique local
  if (normalized.startsWith('ff')) return true; // multicast
  if (normalized.startsWith('::ffff:')) return true; // includes canonical hex IPv4-mapped literals
  const v4Mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (v4Mapped?.[1]) return isPrivateIpv4(v4Mapped[1]);
  return false;
}

function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIpv4(ip);
  if (version === 6) return isPrivateIpv6(ip);
  return true; // not a recognizable literal IP - fail closed
}

/**
 * Best-effort SSRF guard for the web loader (Section 20/6). Resolves the hostname and rejects
 * loopback/RFC1918/link-local/metadata-service/CGNAT addresses before a fetch is attempted, and
 * restricts to http/https. This is a real, meaningful check, not a complete one: it does not
 * defend against DNS-rebinding between this check and the actual `fetch()` call (a TOCTOU gap
 * that would require pinning the resolved IP into the connection itself, which the platform
 * `fetch()` API does not expose) - documented explicitly rather than claimed as airtight.
 */
export async function assertSafeWebUrl(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfGuardError(`Unsupported protocol "${url.protocol}" - only http/https are allowed.`);
  }
  if (url.username || url.password) throw new SsrfGuardError('Embedded URL credentials are not allowed.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname) && isPrivateIp(hostname)) {
    throw new SsrfGuardError(`"${hostname}" resolves to a disallowed address range.`);
  }
  if (!isIP(hostname)) {
    const records = await lookup(hostname, { all: true }).catch((error: unknown) => {
      throw new SsrfGuardError(`Could not resolve host "${hostname}": ${String(error)}`);
    });
    const blocked = records.find((record) => isPrivateIp(record.address));
    if (!records.length) throw new SsrfGuardError('Host did not resolve to any address.');
    if (blocked) {
      throw new SsrfGuardError(
        `"${hostname}" resolves to a disallowed address (${blocked.address}).`,
      );
    }
  }
}
