# Phase 12 issues

- The owner chose proprietary distribution and no public npm publication. Internal tarball
  validation remains available; see [Releasing](../../RELEASING.md).
- A real credential previously appeared in `examples/react-generative-ui/.env.example`.
  Its current-tree placeholder is blank. The owner confirmed revocation, rotation and
  exposure review. Provider-side revocation is owner-attested rather than independently
  verifiable from the repository.
- Paid-provider smoke tests require credentials and opt-in. Their status must be reported from the final validation run, not inferred from deterministic mock tests.
- Live run cancellation and frontend tool-result routing require affinity to the API instance that started the run. The registry and bridge are process-local; an instance loss ends active streams. See [Scaling](../../production/SCALING.md).
