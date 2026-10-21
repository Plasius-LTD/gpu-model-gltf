# ADR-0011: Deterministic canonical edit export

- Status: Accepted
- Date: 2026-10-21
- Parent: site Feature1150; gpu-model-gltf Task16
- Rollout: `gpu.model.conversion.enabled`

## Context

The source-normalized artifact deliberately preserves admitted source content.
It cannot represent edits to the verified canonical model. Export belongs in the
format adapter; core0.6.0 already owns the required geometry, material, skin,
morph and animation contracts. Runtime0.3.0 owns acquisition/discovery.

## Decision

Add `exportGpuModelToGltf(document, options)` with an explicit remote conversion
decision and `glb` (default) or `gltf` layout. Accept only privately branded core
factory output. Repack current verified accessor bytes into aligned dense
little-endian f32 attributes/u16 joints/u32 indices, reflecting canonical Z,
quaternion XY, tangent handedness and triangle winding. Conjugate scene and
inverse-bind matrices. Preserve authored TRS rather than decomposing matrices.

Emit `model.glb`, or `model.gltf`, `model.bin`, and `images/image-N.png|jpg`.
Generated paths never use IDs, filenames, source URIs or provider metadata.
Indices follow canonical array order. Sorted JSON keys, zero binary padding,
fixed naming and no timestamps make repeated export byte deterministic.
Every returned member is an immutable Blob with exact length and SHA256.

Share the admitted material grammar with import. Top-level canonical material
factors own edits to fields mirrored in extension metadata. Remaining supported
extension factors, texture bindings, transforms and sampler interpretation are
mapped explicitly. Geometry, names, morph defaults, node bindings and animation
values come from current canonical entities/resources, never normalized source.

Validate the complete generated graph, references, deformation/resource budgets,
images and accessors, then run the pinned lazy Khronos validator on the exact
entry bytes. External output validation resolves only from the generated package
map, never the network. A blocking validator error returns no artifact.

Fail explicitly when this profile cannot preserve a canonical construct; see
TDR0006. Do not weaken the existing strict/static APIs or add loader adoption.
No core/runtime/dependency change or additional package is needed.

## Alternatives

Replaying normalized source would silently lose edits. A generic scene serializer
in core would move format semantics across the package boundary. Guessing matrix
TRS, replacing ambiguous channels, or dropping unsupported data would create
unverifiable loss. These alternatives are rejected.

## Consequences, tests and release

Output layout is explicit; `forbid-embedding` rejects GLB and remains valid for
external glTF. Source metadata, diagnostics, unused accessor storage and IDs are
not a glTF interchange contract. Tests cover exact bytes, edits to verified
geometry/animation/binds, all admitted interpolation modes, material semantics,
relative resources, cancellation, budgets and explicit refusals. Keep 80%+
coverage and every changed source file in LCOV. Publish a minor release through
main/production `cd.yml` OIDC after PR and exact-SHA CI, then verify registry
artifact/provenance and installed consumers. Consumers can roll back by disabling
the inherited remote decision and retaining their previous loader; this package
never changes rollout state. UI capabilities are not involved.
