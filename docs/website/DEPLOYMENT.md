# Deployment

`pnpm exec nx run docs:build` produces a fully static site in `apps/docs/web-dist/`:

- one `index.html` per route (for example `docs/tools/index.html`),
- hashed assets in `assets/` (cache them for a year: `Cache-Control: public, max-age=31536000, immutable`),
- `404.html`, `sitemap.xml`, `robots.txt` and `favicon.svg`.

## Host requirements

Serve `/<path>` from `/<path>/index.html`, and unknown paths from `/404.html` with status 404.
Most static hosts do this (Netlify, Cloudflare Pages, S3 with CloudFront, or nginx with
`try_files $uri $uri/index.html =404;` and `error_page 404 /404.html;`). HTML should be
revalidated on each request (`Cache-Control: no-cache`).

## Recommended domains (not configured automatically)

| Host | Purpose |
| --- | --- |
| `ai.gixtechnology.com` | Website and docs (`/docs`) from this build |
| `docs.ai.gixtechnology.com` | Optional alias that redirects to `ai.gixtechnology.com/docs` |

The build assumes it is served from the domain root. At build time, set `VITE_SITE_URL` (origin
for canonical URLs and the sitemap), and `VITE_GITHUB_URL` and `VITE_GITHUB_BRANCH` (edit and
source links). DNS and hosting are left to the operator.

## Security headers

Recommended: a Content-Security-Policy of `default-src 'self'` that allows the inline theme
script by hash, `img-src 'self' data:` and `frame-ancestors 'none'`, plus
`Referrer-Policy: strict-origin-when-cross-origin`. The site loads no third-party scripts, fonts
or analytics and sets no cookies.
