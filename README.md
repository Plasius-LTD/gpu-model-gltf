# @plasius/gpu-model-gltf

Strict, browser-safe admission, deterministic export, and bounded canonical
import for self-contained glTF 2.0 binary (`.glb`) assets, plus an explicit
bounded JSON/GLB resource-import profile. This repository is
the dedicated format boundary defined by site ADR 0094; runtime discovery stays
in `@plasius/gpu-model-runtime`, while `@plasius/gpu-model-core` owns and
privately verifies the canonical scene document returned by the demo importer.

## Bounded JSON/GLB resource import

`importGltfToGpuModelDocument(bytes, options)` selects `gltf-static-resources-v1`.
It admits glTF 2.0 JSON and GLB, multiple external or base64 data-URI buffers,
embedded or relative PNG/JPEG images, dense static triangle geometry, and core
metallic-roughness materials and texture slots. External resources pass through
the released `@plasius/gpu-model-runtime` resolver; this package owns reference
admission, buffer layout, image validation and canonical mapping. The default
`glbAdapter` and the strict/static demo APIs retain their narrower profiles below.

```ts
import { PackageResourceResolver, sha256Hex } from "@plasius/gpu-model-runtime";
import { importGltfToGpuModelDocument } from "@plasius/gpu-model-gltf";

const resourceResolver = new PackageResourceResolver({
  sourceKind: "uint8-array",
  package: { resources: { "mesh.bin": { bytes: meshBytes } } },
  fetch: globalThis.fetch.bind(globalThis),
  hashBytes: sha256Hex,
  sleep: async () => {}, // memory-only package; no retry sleep is used
  fetchPolicy: { maxAttempts: 1, timeoutMs: 30_000, maxBytes: 64 * 1024 * 1024 },
});
const result = await importGltfToGpuModelDocument(gltfBytes, {
  // Evaluate gpu.model.conversion.enabled in the responsible remote flag client.
  conversionEnabled: remotelyEvaluatedConversionDecision,
  resourceResolver,
  signal,
});
// result.document contains privately verified immutable canonical resources.
```

For URL acquisition, supply the runtime resolver's trusted `baseUrl` and normal
fetch policy. A resolver is unnecessary for fully embedded/data-URI inputs.
Only package-relative references are admitted: no parent traversal, absolute
URLs, authorities, file schemes, query/fragment tokens, backslashes, controls,
encoded separators or double encoding. Relative URI paths decode once before
runtime resolution. Data URIs require a declared buffer/PNG/JPEG MIME type and
strict padded base64. The trusted resolver controls its base URL, credentials,
redirect policy and any deployment-specific network allowlist. Provider paths,
errors and URIs never appear in importer diagnostics.

Limits only tighten `DEFAULT_GLTF_RESOURCE_IMPORT_LIMITS`: 16 MiB entry point,
64 MiB per resource and aggregate acquired/assembled/canonical bytes, 1,024
buffer/image declarations, 64 MiB per/aggregate decoded image bytes, 4,096-pixel
image dimensions, 4 million decoded geometry components (including generated
indices), 1 million instanced world vertices, 4,095 source nodes and 30 seconds.
JSON retains the 64-level / 1-million-value format limits; the broad profile
allows a string up to the entry point byte limit so embedded showcase buffers
remain usable. The original strict profile retains its 1 MiB string ceiling. Geometry is repacked as little-endian f32
attributes/u32 indices; that expansion is included in the canonical byte and
component limits. Original bufferView ranges and BIN padding are checked before
merging, and a conservative 768 MiB working-set estimate bounds assembly.
PNG uses the existing full bounded decoder; JPEG lazily loads pinned `jpeg-js`
0.4.4 with strict decoding, pixel ceilings and a 128 MiB decoder memory ceiling.

The importer reflects the source +Z-forward basis, reverses triangle winding,
conjugates node transforms and adds a floor-centred normalization root. It
preserves vertex semantics, normalized/interleaved values, core material slots,
image bytes and samplers. A texture used in different color spaces receives
separate canonical texture nodes sharing one verified image resource. Authored
node/mesh/material names and bounded extras remain content in the returned
model (`metadata.sourceExtras` / material `sourceMetadata.sourceExtras`), never
logging or diagnostics. Source URI/provider strings are not copied into it.

This profile rejects extensions, skins, morphs, animation, sparse accessors,
non-triangle topology, cameras, multiple scenes and orphan nodes explicitly.
Indexed/interlaced PNG remains unsupported. Those broader fidelity/repair paths
belong to Tasks #14–#17. A strict final Khronos validation and canonical-core
verification must both succeed; unknown failures return bounded reason codes.
Cancellation/deadlines race uncooperative asynchronous providers and propagate
an abort signal. Synchronous parsing, JPEG decoding and canonical validation
cannot be preempted mid-call; bounded inputs/work and deadline checkpoints limit
them. Run large imports in a consumer-owned worker to keep UI responsive.

The additive function performs no caching and does not register a broad runtime
adapter. The runtime's existing entry-point cache does not identify external
resource revisions; migration must define resource identity/invalidation before
using that cache. Disabling `gpu.model.conversion.enabled` fails before resource
I/O. Rollback: disable that remote flag at discovery/consumer boundary, retain the
existing loader, and return to the prior package version. Never route a rejected
broad asset into the narrower demo path as a permissive fallback. See
[showcase mapping and NFR evidence](docs/tdrs/tdr-0003-bounded-resource-import.md)
and [ADR-0008](docs/adrs/adr-0008-bounded-json-glb-resource-import.md).

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

The following inputs fail closed in the original strict validation profile:

- `.gltf` JSON bundles and all external or data URIs;
- JPEG images (use the explicit resource-import profile for bounded JPEG admission);
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
through npm OIDC with a pinned npm 11.6.2 client. The completed `0.1.0`
bootstrap credential path has been removed; all subsequent releases require
trusted publishing.
<!-- END PLASIUS RELEASE INTEGRITY -->
