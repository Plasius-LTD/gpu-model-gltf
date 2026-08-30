# @plasius/gpu-model-gltf

Strict, browser-safe admission, deterministic export, and bounded canonical
import for self-contained glTF 2.0 binary (`.glb`) assets. This repository is
the dedicated format boundary defined by site ADR 0094; runtime discovery stays
in `@plasius/gpu-model-runtime`, while `@plasius/gpu-model-core` owns and
privately verifies the canonical scene document returned by the demo importer.

## Supported strict validation slice

Version `2026-08-20.v1` admits rights-clear, static-world GLBs that use:

- the exact GLB v2 header, one first JSON chunk, and at most one BIN chunk;
- extension-free core glTF 2.0 triangle-list meshes;
- finite, in-bounds dense accessors and one embedded buffer;
- embedded non-interlaced, non-indexed PNG images referenced by `bufferView`, with
  MIME/magic, bounded chunk count, per-chunk CRC, required IHDR/IDAT/IEND
  ordering, bounded zlib decompression, scanline, dimension, pixel, and
  decoded-byte agreement;
- no URI resolution, network access, or package-relative dependency loading.

The adapter canonicalizes JSON object-key order and chunk padding, preserves
array order and binary payload bytes, validates the final output with the pinned
Khronos glTF Validator, and returns exact SHA-256 hashes for both source and
output. `ModelConverterEvidence` diagnostics use the shared
`@plasius/asset-contracts` vocabulary.

The following inputs fail closed in this release:

- `.gltf` JSON bundles and all external or data URIs;
- JPEG images until a bounded, reviewed full decoder is released;
- indexed PNG images until palette indices are fully decoded and validated;
- glTF extensions, including Draco, meshopt, Basis Universal, and WebP paths;
- animation, skinning, morph targets, sparse accessors, lines, points, strips,
  and fans;
- tolerant repair and forensic evidence modes.

These exclusions are deliberate. They are not silently downgraded, resolved,
or removed. `validateAndExportGlb` remains the lossless low-level boundary.

## ChatGPT PVOX demonstration profile

`importGlbToGpuModelDocument` adds a narrower, additive profile for Story
`plasius-ltd-site#2094`. It accepts at most 16 MiB and 200,000 instantiated
triangles, requires one explicitly selected static scene, and permits only:

- one embedded GLB buffer, dense `f32` `POSITION`/optional `NORMAL` accessors,
  explicit unsigned integer indices, and `TRIANGLES` primitives;
- fixed opaque metallic/roughness material factors with no images, textures,
  samplers, or model-owned runtime decoders;
- a reachable tree whose nodes and meshes are all represented in the canonical
  result, with every packed vertex referenced by explicit triangle indices.

The importer converts local positions, normals, node transforms, and triangle
winding into metres, Y-up, `-Z` forward, right-handed counter-clockwise space.
It retains the source hierarchy and instancing, adds a deterministic
floor-centering root, repacks only used geometry, independently hashes and
verifies that buffer through `@plasius/gpu-model-core`, then creates the bounded
static compiler projection. Source and provider strings are not copied into the
runtime document. World and local coordinates cannot exceed the shared
1,048,576-metre PVOX ceiling. The source GLB is not returned by this high-level
API.

The profile fails closed unless the caller supplies positive remote evaluations
of both `asset.pipeline.pvox-models.enabled` and
`asset.pipeline.converter.gltf.enabled`. This does not implement the full
partner acquisition pipeline, texture baking, animation, deformable models, or
native PVOX traversal.

## API

```ts
import { validateAndExportGlb } from "@plasius/gpu-model-gltf";

const admitted = await validateAndExportGlb(sourceBytes, {
  contentType: "model/gltf-binary",
  fileName: "chair.glb",
  limits: { maxInputBytes: 50 * 1024 * 1024 },
});

const canonicalBytes = new Uint8Array(await admitted.output.arrayBuffer());
console.log(admitted.outputContentHash, canonicalBytes.byteLength);
```

For the bounded ChatGPT demo, request the verified canonical document and PVOX
compiler projection together:

```ts
import { importGlbToGpuModelDocument } from "@plasius/gpu-model-gltf";

const imported = await importGlbToGpuModelDocument(sourceBytes, {
  pvoxModelsEnabled: remotelyEvaluatedPvoxFlag,
  gltfConverterEnabled: remotelyEvaluatedGltfConverterFlag,
  contentType: "model/gltf-binary",
  fileName: "chair.glb",
});

console.log(
  imported.sourceContentHash,
  imported.document.bounds,
  imported.compilerInput.worldTriangles.length,
);
```

The runtime adapter uses the same function and remains lazy-loadable:

```ts
runtime.adapters.register({
  formatId: "gltf",
  extensions: ["glb"],
  mimeTypes: ["model/gltf-binary"],
  load: () => import("@plasius/gpu-model-gltf"),
});
```

Pass both evaluated booleans in the adapter options only after the remote flag
evaluator enables the parent and GLB-converter paths. The adapter returns the
verified `GpuModelDocument` as `canonicalModel` and its compiler projection as
`rendererReady`; it never calls the supplied resource resolver.

## Security and resource policy

All byte, JSON-depth/value, entity, accessor-element, image, diagnostic,
dimension, pixel, compressed-texture, and decoded-texture ceilings are bounded
by `DEFAULT_GLB_LIMITS`. Callers may tighten those ceilings but cannot raise
them. For both the source and deterministic output, the published working-set
estimate combines a 32 MiB fixed allowance, seven times the complete GLB size,
and 32 times the aligned JSON-chunk size; the larger estimate is retained. The
adapter rejects an over-budget well-formed source before copying it, verifies
the private snapshot, and rejects output growth before validation evidence is
emitted. Source bytes are copied before async work, errors expose stable reason
codes and bounded diagnostics, JSON pollution keys are rejected, and no source
URI or provider text is echoed into diagnostics.

The demo importer indexes primitive plans by mesh, caches one decoder per used
accessor, rejects unreferenced position payloads, and stops instanced geometry
accounting as soon as the caller's triangle ceiling is exceeded. Decode,
repacking, hierarchy, bounds, hashing, and core verification share a fixed
30-second deadline and observe cancellation between bounded work chunks. Rig
and morph markers are rejected from shallow metadata before semantic expansion,
and actual computed world coordinates use the exact absolute PVOX ceiling.

The Khronos validator is an exact runtime dependency
(`gltf-validator@2.0.0-dev.3.10`, Apache-2.0) and is dynamically imported only
after local bounded preflight succeeds. See
[ADR-0005](./docs/adrs/adr-0005-strict-self-contained-glb-admission.md) and the
[validation technical direction](./docs/tdrs/tdr-0001-deterministic-glb-validation-and-export.md).
The additive canonical demo path is recorded in
[ADR-0006](./docs/adrs/adr-0006-bounded-glb-to-canonical-demo-import.md) and
[TDR-0002](./docs/tdrs/tdr-0002-chatgpt-static-glb-import.md).

## Rollout

- Broad conversion discovery flag: `gpu.model.conversion.enabled`
- ChatGPT/PVOX parent flag: `asset.pipeline.pvox-models.enabled`
- Bounded GLB converter flag: `asset.pipeline.converter.gltf.enabled`
- Capability: none for this package-only layer
- Rollback: disable any applicable flag and keep the package pinned to the
  last validated release; the low-level validation/export API remains available

## Development

Requires Node.js 24 and npm.

```bash
npm ci
npm run typecheck
npm test
npm run lint
npm run build
npm run pack:check
npm run audit:deps
npm run audit:npm
npm run test:coverage
```

## License

Apache-2.0. See LICENSE, SECURITY.md, and the files under legal/.

<!-- BEGIN PLASIUS RELEASE INTEGRITY -->
## Release integrity

CI keeps the administrative contributor registry outside Git and npm package
artifacts using normalized path checks and sealed-tar revalidation. The
GitHub-hosted Node.js 24.18.0 release path follows the released
`@plasius/schema` v1.4.2 template: release metadata lands through a protected
pull request, exact-main CI must pass, and the immutable tarball is published
through npm OIDC. Version `0.1.0` may use the explicit, time-limited
`bootstrap_first_publish` production gate only while the package is absent;
that credential is removed after the npm trusted publisher binding is active.
<!-- END PLASIUS RELEASE INTEGRITY -->
