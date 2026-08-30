# ADR-0006: Bounded GLB to Canonical Demo Import

## Status

- Accepted
- Date: 2026-08-24
- Version: 1.0
- Story: `plasius-ltd-site#2094`
- Task: `gpu-model-gltf#5`
- Parent feature: `plasius-ltd-site#2012`
- Parent flag: `asset.pipeline.pvox-models.enabled`
- Converter flag: `asset.pipeline.converter.gltf.enabled`

## Context

Predecessor Task `gpu-model-gltf#1` / Feature `plasius-ltd-site#1148` owns the
broad hostile-GLB validation and deterministic export foundation in ADR-0005.
The ChatGPT PVOX demonstration now needs one honest hand-off from an uploaded
model into the separately owned canonical document and PVOX compiler. It must
not imply that provider acquisition, texture baking, animated conversion, or
the full production pipeline is complete.

The uploaded GLB remains hostile even after transport checks. A format-specific
object, unverified mutable buffer, source-rendered preview, or permissive
feature drop would not be a safe compiler input.

## Decision

1. Add `importGlbToGpuModelDocument` after ADR-0005 validation. The low-level
   `validateAndExportGlb` API remains unchanged.
2. Require positive caller-supplied remote evaluations of both
   `asset.pipeline.pvox-models.enabled` and
   `asset.pipeline.converter.gltf.enabled`; absence and false both fail closed.
3. Bound input and packed canonical geometry to 16 MiB, instantiated geometry
   to 200,000 triangles, coordinates to the shared absolute 1,048,576-metre
   PVOX ceiling, and expose only caller-tightenable ceilings.
4. Admit exactly one explicitly selected, fully reachable static scene using an
   embedded buffer, dense `f32` positions/optional normals, explicit unsigned
   indices, triangle lists, and fixed opaque metallic/roughness factors.
5. Reject images, textures, samplers, URI resolution, extensions, animation,
   skins, morphs, sparse accessors, cameras, node/mesh weights, implicit
   indices, unused nodes/meshes/accessors/bufferViews, and unsupported vertex
   attributes. Require every admitted POSITION element to be referenced by its
   primitive indices. No source content is silently promoted.
6. Convert vertex data from glTF's local basis by reflecting Z, conjugate each
   node matrix into the same basis, and reverse every explicit triangle. This
   retains hierarchy and instancing while yielding Y-up, `-Z` forward,
   right-handed counter-clockwise world geometry.
7. Add one deterministic translation-only root that floor-centres the complete
   instanced bounds at Y=0 and centres X/Z at the origin.
8. Repack only admitted accessors into one URI-free buffer, hash it with
   SHA-256, and submit it through `createAndVerifyGpuModelDocument` using an
   injected bounded verification port. The package does not create its own
   canonical document brand.
9. Call `createGpuModelStaticDemoCompilerInput` and return that projection with
   the verified document and exact source/output GLB hashes. Do not return the
   source GLB from the high-level API.
10. Make `glbAdapter.load` use the identical path and return the document as
    `canonicalModel` and projection as `rendererReady`. Independently compare
    the runtime source hash and never call the resource resolver.
11. Index primitive plans by mesh, cache one source decoder per accessor, and
    count instantiated triangles before allocation. Decode, repacking, bounds,
    hashing, and verification share a fixed 30-second deadline with bounded
    cancellation checks.

## Consequences

- The ChatGPT demo has a real GLB-to-core compiler boundary with deterministic
  normalization and source identity.
- Model-owned textures and arbitrary glTF features remain unsupported in this
  intentionally small slice.
- Names and provider metadata are not copied into runtime artifacts; rights and
  human confirmation remain service responsibilities.
- The dependency on `@plasius/gpu-model-core` is additive and that package
  remains the sole owner of canonical validation and compiler projection.
- Native PVOX compilation, rendering, promotion, and GPU traversal remain owned
  by their respective repositories and tracked Tasks.

## Rollback

Disable `asset.pipeline.pvox-models.enabled`,
`asset.pipeline.converter.gltf.enabled`, or the broader
`gpu.model.conversion.enabled` discovery flag. The low-level strict validation
API remains available, and no catalog artifact is mutated by this package.
