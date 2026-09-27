# SEO

Every route is prerendered with:

- a unique `<title>` and `<meta name="description">` (docs pages use their H1 and first paragraph),
- `<link rel="canonical">` on `VITE_SITE_URL` (default `https://ai.gixtechnology.com`),
- OpenGraph and Twitter card tags,
- JSON-LD (`SoftwareSourceCode`) on the homepage,
- `noindex` on the 404 page.

`sitemap.xml` lists every prerendered URL, and `robots.txt` points to it. The unit suite checks
that every route has a unique title, a description and the correct canonical URL; the E2E suite
checks the served HTML, the sitemap and robots.txt.

Set `VITE_SITE_URL` at build time if the site is served from a different origin.
