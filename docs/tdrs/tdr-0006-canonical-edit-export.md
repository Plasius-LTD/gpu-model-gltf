# TDR0006 — Canonical edit export profile

## Contract and fidelity

`gltf-canonical-export-v1` emits current core0.6.0 canonical triangle scenes as
GLB or relative glTF packages. Both layouts preserve world placement (including
the import normalization root), supported attributes/material factors and texture
interpretations, exact PNG/JPEG bytes, sampler filters/wraps, UV transforms,
ordered skin joints and inverse binds, morph POSITION/NORMAL/TANGENT deltas,
mesh defaults, per-node effective weights, and STEP/LINEAR/CUBICSPLINE TRS and
node-weight samplers. Cubic tangents are reflected without normalization or
resampling. Joint indices remain u16; weights are never repaired. Shared image
interpretations may become distinct glTF texture indices; references are remapped
and verified. Interchange preserves meaning rather than canonical IDs or storage
layout. Importing exported content adds its normal normalization root; repeated
export of the same document is deterministic, not an ID-preserving canonical save.

Accessor bytes are the core-verified representation. Authored animation/skin
numeric tables must agree under core's validation rules. Edits to resources must
be reverified and accompanied by correct bounds, min/max and related tables before
creating a new core document. Top-level material factors override their mirrored
extension-factor values. Other admitted extension factors are explicit metadata
owned by the canonical material, not a replay of adapter source JSON.

Deliberate unsupported cases return stable controlled errors: other topology or
vertex semantics; analytic geometry or blocking document diagnostics; nonstandard
material workflows/extensions/filters/texture transfer functions; sparse, matrix
attribute or compressed representations; blend-shape-only animation channels
without node binding; incomplete primitive morph coverage or partially named
targets; node-weight animation ordered differently from mesh shapes; unused or
partial skeleton bindings; joint names/rest TRS/nearest-joint ancestry conflicting
with scene nodes; matrix-only joints; clip durations extending beyond the final
key; and GLB for textures forbidding embedding. No fallback silently drops these
constructs. Unsupported source acquisition is still governed by import.

Canonical provenance, sourceMetadata, arbitrary metadata/extras, diagnostics,
resource IDs, source paths and unused buffer/accessor storage are excluded from
interchange. They are not executable scene semantics. Authored node/mesh/material,
skeleton and morph names remain content. Output bytes are authored model content,
not sanitized log data. No automatic telemetry logs content.

## Resource and failure controls

Reuse tightening-only `DEFAULT_GLTF_RESOURCE_IMPORT_LIMITS`: 16MiB entry output,
64MiB per resource/source aggregate/assembled binary/final package, 1024 input and
output resources, 4095 canonical nodes (including normalization root), 4M decoded
or repacked components, 256 skins, 4096 joints, 1024 morph targets, 65536 bindings,
256 clips, 4096 samplers, 8192 channels, 1M expanded deformation elements, and 30s.
Images retain 4096px and 64MiB per/aggregate decoded ceilings. Graph validation
retains 64 levels, 1M JSON values and 16MiB JSON. A conservative 768MiB working-set
estimate charges resource copies/serialization/validation plus decoded arrays and
images before resource I/O. Generated per-accessor allocation is checked against
remaining binary/component budgets before allocation. Source resources are read
sequentially; there is one deadline and no retries or network acquisition.

Both layouts run the same grammar, buffer/accessor and deformation preflight, and
the exact entry plus relative resources run pinned `gltf-validator`2.0.0-dev.3.10.
Unsupported extension warnings from that pinned validator do not override the
adapter's stricter admitted extension grammar. The public validator evidence
reports its identity/version and issue count; failures expose no raw provider
exception or authored diagnostic strings. Hashes identify every returned member.

Cancellation/deadline races asynchronous Blob reads, image work, validator calls
and hashing, including uncooperative payload reads. Synchronous bounded loops
check periodically; JS parser/decoder/core/validator work cannot be interrupted
mid-call. Use a worker/terminate the worker when hard scheduling isolation is
required. Cancellation returns no partial package; previously returned packages
remain immutable. Tightened entry/aggregate limits can intentionally reject a
model admitted under larger import limits. No ceiling is raised for round trips.

## Verification and NFR evidence

- Security/privacy: branded-document rejection, fixed relative paths, no network
  resolver, source/provider omission, explicit workflow/extension refusals, pinned
  image validation, exact output hashes and public-package/privacy gates.
- Reliability/build reproducibility: both exact layouts pass pinned Khronos;
  repeated byte identity; Node24 `npm ci`, ESM/CJS and strict types; cancellation
  and deadlines race hung reads; no retries/global per-operation state.
- Performance/scalability: sequential reads, per-operation state, byte/component/
  entity/expanded-work ceilings before I/O and binary allocation; fixture timings
  and browser/registry qualification are recorded in Task16's delivery evidence.
- Maintainability/testability: geometry, material inverse grammar and orchestration
  separated; existing released core/runtime/contracts reused; tests began red for
  the absent API; edited verified geometry/animation/morph/bind resources round
  trip; all three interpolation modes and rollback/disabled controls covered.
- Observability: stable sanitized errors, bounded validator identity/issue count,
  exact per-file hashes/lengths; no content logging or external service.
- Portability/compatibility: little endian serialization, WebCrypto/Blob, lazy
  validator/JPEG imports, ES2022 browser target build and actual browser evidence
  recorded on Task16. Physical GPU animation evaluation is outside interchange.
- Accessibility/SEO: N/A, no UI/routes/navigation/markup changes.
- Backend secretRef validation: N/A, package publication only, no backend deploy.
- Dependencies: unchanged. Runtime core0.6.0/runtime0.3.0/contracts and pinned
  Khronos/JPEG are already public and compatible; no file/workspace substitution.

## Rollout, rollback and release

Caller evaluates `gpu.model.conversion.enabled`; false rejects before bytes are
read. Existing registry/discovery remains the responsible remote consumer gate.
Tests cover disabled, enabled and clean re-enable. No flag mutation or new
capability. Rollback disables adoption and retains previous consumers/loaders.
Source PR + exact-SHA CI + approved `cd.yml` preparation/publication on
main/production/npm OIDC are required. Verify public npm availability, matching
tag/provenance/tarball integrity and installed ESM/CJS/types/browser consumers
before closing Task16. Task17 owns broader conformance/repair; gpu-shared55 owns
loader migration. Do not mark Feature1150 complete from this package release.

References: [glTF2 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html),
[Khronos validator](https://github.com/KhronosGroup/glTF-Validator), ADR0011.
