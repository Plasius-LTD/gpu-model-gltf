# ADR-0007: Hosted OIDC Package Publication

- Status: Accepted
- Date: 2026-08-11

## Context

`@plasius/gpu-model-gltf` must publish without a long-lived npm write token and without
accepting CI evidence for another source snapshot.

## Decision

Publication is phase-isolated: dependency installation, package validation, SBOM generation, and immutable tarball packing run in `validate_and_pack` without the `production` environment or OIDC permission. The final hosted `publish` job downloads only that sealed artifact, explicitly installs npm 11.6.2, runs no repository dependency code, and publishes the tarball with lifecycle scripts disabled. It re-fetches current `main` immediately before the first release mutation and again immediately before npm publication. `.npmrc` contains no registry-auth placeholder, and release preparation returns the reviewed current `main` HEAD rather than package-file history.

Publish only from the GitHub-hosted `production` job using npm trusted
publishing. Prove the prepared SHA is still the exact remote `main` head and
that push-triggered `ci.yml` succeeded for it. Require Node 24 and npm 11.5.1 or
newer, request provenance, and prohibit reusable or automatic npm write-token
fallbacks. Reviewed CI uses explicit GitHub-hosted runners.

The one-time `0.1.0` bootstrap path was removed after the package was published;
all subsequent releases must use trusted publishing.

## Interrupted publication recovery

A requested patch/minor/major bump reuses a prepared version only while both
npm and GitHub publication are incomplete. Once either immutable publication is
complete, select a fresh version using the existing local/registry/tag maximum
and requested bump. A draft or missing GitHub release must not cause reuse of an
already-published npm version. Explicit `bump=none` and all exact-main, tag and
duplicate-publication guards remain unchanged. Tests execute the real selection
branch across interrupted/complete/none states. Recovery goes through the same
PR, CI and main/production OIDC flow; no manual tag/changelog rewrite.

## Consequences

Missing trust configuration, moved `main`, absent CI, unsupported runtime, or
missing OIDC identity fails closed before publication.

## Test implications

Workflow tests enforce source, CI, runtime, identity, runner, and token rules.
