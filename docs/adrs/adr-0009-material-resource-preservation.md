# ADR0009: Material resource preservation in the bounded importer

Date: 2026-10-21. Status: accepted. Project: gpu-model-gltf#14;
parent Feature site#1150; conformance coordinator site#1160.

## Context

The released resource importer already bounds acquisition, dense geometry and
PNG/JPEG decoding, but rejects every extension. Existing gpu-shared and renderer
use common KHR material parameters and texture transforms. Released core0.5.0
adds the required validated slots; bridge0.3.0 shares its exact private core
identity, and renderer0.2.53 maps all twelve extension slots. Reimplementing those
contracts, raw texture indices in metadata, or permissive fallback loses fidelity.

## Decision

Add one adapter-owned closed material grammar, separate from shared core/runtime
ownership. [TDR0004](../tdrs/tdr-0004-material-resource-fidelity.md) records exact
defaults, ranges, channels, transfer functions and consumer limits. Factor fields
map to core when available and otherwise finite KHR-keyed metadata; validated core
slots own all texture references. Materialize normative defaults, including IOR1.5
without an explicit extension, because renderer defaults differ. Preserve transform
scale/offset/rotation and UV override without baking or inventing UV0. Reject unknown
optional/required extensions, invalid declarations, unsupported properties/locations,
malformed factors and unsupported combinations before resource I/O.

The shared static structural validator accepts an internal admission callback for
this grammar. Every strict/static entry point retains its extension-free default;
no public validation bypass is added. Shared bounded JSON value readers are factored
into a leaf module, avoiding a runtime import cycle between resolution and materials.

Expose the already Khronos-validated normalized source GLB as `normalizedGlb` on the
import result: immutable Blob payload, exact SHA-256 and byte length. It embeds
relative/data resources while retaining image bytes, source material/transform/sampler
semantics and image metadata. Embedded views are reused, making this normalization
stable under repeated round trips. This is source-preserving export, not edited
canonical serialization or deterministic glTF resource-package export (Task #16).
Normalizing a source over the entry ceiling does not grant an increased reimport
limit; budgets only tighten. Canonical geometry repacking order can differ after
JSON key normalization; semantic attribute/accessor mapping, not packed-buffer byte
order, defines geometry equivalence. Image byte/hash identity is exact.

Adopt runtime dependency core ^0.4.6 (resolved0.4.6) → exact0.5.0, and add exact
**test-only** bridge0.3.0/renderer0.2.53 from npm. No codec/validator changes,
unpublished/local references, new package or broad cached adapter. Use the same core
instance and module format across producer/bridge. Third-party dependencies retain
their package notices; runtime audit and full lockfile install remain required.

## Alternatives

- Rejecting all extensions leaves the tracked material contract incomplete.
- Passing arbitrary metadata or ignoring unknown extensions risks silent feature loss.
- Baking every transform in this adapter introduces resampling and UV semantics owned
  by consumers; preserve canonical bindings and test explicit renderer refusal instead.
- Implementing full canonical editing/export here would skip the Feature's animation
  → exporter sequence. Reuse existing bounded normalization for this material scope.
- Changing renderer physics, loaders or rollout is separately tracked consumer work.

## Consequences and verification

The existing remotely evaluated `gpu.model.conversion.enabled` gate remains mandatory;
disabled rejects before I/O, and rollback keeps the prior loader and a compatible
package set. No capability, flag setting, backend/ACA or site deployment changes.
Canonical transform/UV data survives to the bridge; renderer0.2.53 explicitly refuses
nonidentity/nonzero forms. Existing alpha/unlit/advanced shading limits remain and
are documented, rather than treating canonical retention as visual conformance.

Requirement-derived regressions fail on the old importer, then pass with the new
mapping. Verify extension factors/defaults and every slot, malformed/unknown/no-I/O,
PNG/JPEG source round trips and hashes, flag/cancel/budget/diagnostic controls,
real glTF → runtime → bridge → renderer atlas/BVH data, existing showcase fixtures,
ESM/CJS and browser execution. Run coverage80%+ with all changed source in LCOV,
lint/types/build/privacy/artifacts/pack/audit and frozen install. Full NFR evidence
and measured portability/performance limits are in TDR0004 and final issue evidence.

Release through focused PR/exact-head CI and existing main/production cd.yml minor
preparation and hosted npm OIDC publication. Verify exact-main CI, tag, registry
integrity/provenance, installed consumer and browser probes before Project Done.
No local publish, consumer cutover, site release or canonical exporter claim.
