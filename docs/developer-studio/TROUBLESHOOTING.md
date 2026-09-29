# Developer Studio troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `/__gix` is 404 | `NODE_ENV` is `production`, or `registerStudio` was not called. The Studio never runs in production. |
| `403 HOST_NOT_ALLOWED` | You opened the Studio through a hostname that isn't allowed. Use `localhost`, or add the name to `allowedHosts`. |
| `403 STUDIO_TOKEN_REQUIRED` | The server restarted and the token changed. Reload `/__gix`. |
| `403 ORIGIN_NOT_ALLOWED` / `CROSS_SITE` | The request came from another origin, such as a dev proxy on another port. Open the Studio from the server's own origin, or add that origin to `allowedOrigins`. |
| Discovery warns `AST_UNAVAILABLE` | Install `typescript` as a devDependency and re-scan. |
| Discovery warns `SWAGGER_2_UNSUPPORTED` | Convert the document to OpenAPI 3.x. |
| An API or component is missing | The file may be gitignored, over 512 KiB, or use a pattern the analyzer doesn't recognize. Check the discovery diagnostics. |
| Approve is blocked | The Security Review lists the blocking findings. Fix them with edits or deselect the items. |
| Apply says "Nothing was written" | A target file changed after generation. Regenerate, or deselect the conflicting items, and approve again. |
| `APPLIED WITH VALIDATION ERRORS` | The files were written, but a project check failed. Read the output, then fix forward or use **Roll back this apply**. |
| Test Connection: `PROVIDER_NOT_CONFIGURED` | Pass a provider factory for that provider in `providers`, or a `modelRuntime`. |
