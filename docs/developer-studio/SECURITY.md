# Developer Studio security

## Production isolation

`studioPlugin` and `registerStudio` register nothing when `NODE_ENV=production` (or
`environment: 'production'`). `/__gix` and every `/__gix/api/*` route return 404. There is no
override. Client-side hiding is not relied on. Tests cover both entry points.

## Development API protection

localhost alone is not treated as trusted. Every request must pass:

1. **Host allowlist** (default `localhost`, `127.0.0.1`, `[::1]`). This blocks DNS rebinding.
2. **Origin**: when present, it must equal the Studio's own origin or an `allowedOrigins` entry.
3. **`Sec-Fetch-Site`**: when present, it must be `same-origin` or `none`.
4. **Studio token** on every `/__gix/api/*` call: a random 256-bit token per server process,
   embedded in the page and compared in constant time.
5. **State-changing requests** (POST/PUT/PATCH/DELETE) must carry an Origin or a same-origin
   Referer.
6. An optional `authorize(request)` hook for shared development machines.

Responses use `Cache-Control: no-store`, `nosniff`, `no-referrer` and `X-Frame-Options: DENY`.
The page's CSP allows only nonce'd inline script/style and same-origin `connect-src`, with
`frame-ancestors 'none'`. The page renders all data with `textContent`.

## Secrets

- Discovery never reads secret files; see [Discovery](DISCOVERY.md#safety).
- The model API key is write-only and memory-only; see [Configuration](CONFIGURATION.md).
- Generated output is scanned for API keys, tokens, private keys, JWTs, credential assignments
  and connection strings with passwords. A finding blocks approval and apply. Findings report
  the kind and line, never the value.
- Validation output, connection errors and displayed configuration are redacted.

## Workspace protection

Every write goes through `WorkspaceGuard.resolve`, which rejects `..` segments, absolute and UNC
paths, NUL bytes, symlink escapes, `.git`, `.ssh` and `node_modules`. The workspace root itself
may not be a filesystem root or the home directory. Generated files must be under `.gix/`, and
secret file names are never written.

## Action Firewall

Generated tools carry a `ToolSecurityManifest` (risk, approval, required permissions) and execute
through the existing registry, runtime and Action Firewall. Destructive tools start disabled.
Nothing the Studio generates bypasses the firewall.
