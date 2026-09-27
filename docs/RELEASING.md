# Internal release candidates

The repository owner chose proprietary distribution with no public npm publication. No
license grant is implied by the source or package tarballs. Do not publish
`@gixcopilot/*` packages to the public npm registry.

The manual [internal release candidate workflow](../.github/workflows/release.yml) runs
validation, packs the packages, tests clean consumers against those tarballs, and previews
the version. It has read-only repository permissions and no publish step or
npm publishing credential. The tarballs are local validation artifacts; distribution to a
private registry requires a separate, explicitly authorized process and rights review.

Version previews use the existing Nx fixed release group and conventional commits. Local
equivalents are `pnpm exec nx release version prerelease --dry-run`,
`node tools/verify-packages.mjs`, and `node tools/consumer-test.mjs`. The package verifier
checks contents and exports; its missing-license notices reflect this proprietary choice.

The owner confirmed revocation and rotation of the real credential that previously
appeared in `examples/react-generative-ui/.env.example` and completion of its exposure
review. The current tree contains a blank placeholder. This provider-side action is
owner-attested; repository checks cannot verify it.
