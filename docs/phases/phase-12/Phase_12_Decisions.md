# Phase 12 decisions

- [ADR 0020](../../adr/0020-production-runtime-and-control-plane.md): production runtime, management boundary, tenant scope and persistence.
- [ADR 0021](../../adr/0021-model-fallback-and-usage-enforcement.md): fallback safety and usage admission.
- Internal release candidate validation uses the existing Nx release toolchain, a fixed
  version group and package tarball consumer tests. See [versioning](../../VERSIONING.md)
  and [releasing](../../RELEASING.md).
- The owner chose proprietary distribution and no public npm publication. The manual
  candidate workflow has no publish step or npm publishing credential.
