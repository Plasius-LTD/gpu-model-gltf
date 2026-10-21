# @plasius/gpu-model-gltf

Strict, browser-safe admission, deterministic export, and bounded canonical
import for self-contained glTF 2.0 binary (`.glb`) assets, plus an explicit
bounded JSON/GLB resource-import profile. This repository is
the dedicated format boundary defined by site ADR 0094; runtime discovery stays
in `@plasius/gpu-model-runtime`, while `@plasius/gpu-model-core` owns and
privately verifies the canonical scene document returned by the demo importer.

## Strict, tolerant and forensic resource import

Resource import defaults to `mode: "strict"`. The opt-in tolerant and forensic
modes reuse `@plasius/gpu-model-core`'s published diagnostic evaluator and
`GpuModelRepairRecord` contract, not a format-local repair policy:

```ts
const imported = await importGltfToGpuModelDocument(sourceBytes, {
  conversionEnabled: remotelyEvaluatedConversionDecision,
  profile: "gltf-deformation-resources-v1",
  mode: "tolerant", // or "forensic" for bounded numeric damaged-source evidence
  resourceResolver,
  signal,
});
// imported.repairs: complete frozen core records, with original numeric values,
// action, severity, affectedPath, confidence and ruleId.
// imported.diagnosticReport: core-owned mode/acceptance/repair/loss ledger.
// imported.diagnostics: bounded shared ModelConverterDiagnostic findings.
```

The sole implemented repair is core rule `non-normalized-weights`: finite,
non-negative dense unnormalized float32 VEC4 `WEIGHTS_0` rows with positive total
are normalized when their sum differs from one by more than 1e-6. No influence
is discarded. This repair profile requires one four-influence weight set;
additional WEIGHTS_1 sets are explicitly refused in tolerant/forensic modes. Source byte/range/entity/finite validation precedes repair; exact
final Khronos validation follows it. Shared weight references are repaired once.
Overlapping accessor/image storage or other-semantic aliases, negative/zero-total/nonfinite rows,
float32 underflow of a positive influence, other representations and other
standard violations are refused. No normals/winding/index/material/URI/transform
repair or missing-bound synthesis is implied. Valid strict/static paths remain.

Forensic mode additionally retains only raw damaged numeric weight fields and
fixed numeric paths, anchored by exact original-entry and assembled pre-repair
binary SHA256. This is bounded partial source evidence in core `rawSource`, not
an archive of source JSON or package files. Names, URIs, metadata, arbitrary
source strings and provider text never enter it. The core snapshot is immutable
and capped at 64KiB (with core depth/value/member limits); no storage or logging
is performed. Unrepairable input returns a controlled error and no partial
canonical/evidence result. Applications needing a full raw archive must use a
separately governed private evidence store. Existing `validateAndExportGlb` and
static demo APIs still refuse tolerant/forensic modes.

`limits.maxDiagnostics` only tightens the 100-entry ceiling for each public
finding list and the complete core repair ledger. Too many repairs fail.
Findings may end with `gltf-import-diagnostics-truncated`; the complete separate
core ledger remains available. Canonical diagnostics contain bounded findings
plus one canonicalization record; forensic raw evidence stays outside canonical
metadata and interchange. Exact canonical exports expose `diagnostics` too.

Validation has an independent hard 100-issue work ceiling. A truncated report
fails with `gltf-validation-incomplete`, including warning-only saturation.
Tightening presentation limits never hides a blocking finding. Raw validator
messages and authored property names are omitted; only known schema pointers or
fixed generic locations appear. Original source hashes identify input bytes;
normalized/output hashes identify repaired bytes. No telemetry is emitted.

Rollback consumers to strict/default mode or disable the inherited remote
`gpu.model.conversion.enabled` decision. No new capability, repair rule, codec,
package or dependency is introduced. See [the conformance matrix](docs/tdrs/tdr-0007-conformance-and-repair.md)
and [ADR0012](docs/adrs/adr-0012-allowlisted-repair-and-conformance.md).

## Canonical edit export

`exportGpuModelToGltf(document, options)` serializes a privately verified
`@plasius/gpu-model-core` document, including current edits, as deterministic GLB
or a relative glTF package. Existing source-normalized and low-level APIs retain
their profiles.

```ts
import { exportGpuModelToGltf } from "@plasius/gpu-model-gltf";

const output = await exportGpuModelToGltf(verifiedDocument, {
  conversionEnabled: remotelyEvaluatedConversionDecision,
  format: "gltf", // default "glb"
  signal,
});
// model.gltf + model.bin + images/image-N.png|jpg, or one model.glb.
// Persist every member at its generated relative path.
for (const file of output.resources) {
  await saveFile(file.path, file.payload);
  // file.contentHash and file.byteLength identify the exact immutable Blob.
}
// output.entryPoint and output.validator identify the validated package.
```

This explicit profile preserves admitted triangle geometry/winding, materials and
texture transforms, image bytes/samplers, authored TRS, skins, morph defaults and
node bindings, and STEP/LINEAR/CUBICSPLINE animation. It never replays old source
bytes. Generated references are validated with the pinned Khronos validator and
resolve solely from the output map. Metadata/provenance, source paths, IDs and
unused accessor storage are outside this interchange contract. Unsupported or
ambiguous canonical constructs fail explicitly; GLB rejects `forbid-embedding`.
See [the exact fidelity, exclusions and NFR contract](docs/tdrs/tdr-0006-canonical-edit-export.md).

`limits` tightens the existing import-family ceilings, including 16MiB entry,
64MiB aggregate output/resources, 4M repacked components and a 30s deadline.
Cancellation races asynchronous operations; bounded synchronous work cannot be
preempted mid-call. Run conversion in a worker for hard scheduling isolation.
The exporter requires the caller's remote `gpu.model.conversion.enabled` decision;
disabling adoption preserves existing loaders. No discovery or site rollout is
performed by this API.

## Bounded JSON/GLB resource import

`importGltfToGpuModelDocument(bytes, options)` defaults to `gltf-static-resources-v1`.
It admits glTF 2.0 JSON and GLB, multiple external or base64 data-URI buffers,
embedded or relative PNG/JPEG images, dense static triangle geometry, and core
metallic-roughness/unlit materials, common KHR material extensions and texture transforms. External resources pass through
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
// result.normalizedGlb.payload is a self-contained, source-normalized GLB Blob.
// Its contentHash/byteLength identify exact output bytes; it does not serialize
// edits to result.document. Use exportGpuModelToGltf for canonical edits.
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
component limits. Repeated primitive/accessor references and mesh-instance work
are preflighted before resource I/O and Khronos traversal. Original bufferView ranges and BIN padding are checked before
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

The admitted extension grammar is `KHR_materials_clearcoat`, `transmission`,
`sheen`, `ior`, `specular`, `volume`, `iridescence`, `anisotropy`, `dispersion`,
`unlit` (each with the `KHR_materials_` prefix), and `KHR_texture_transform`.
Only material/textureInfo locations are admitted. Unknown required **and optional**
extensions, undeclared payloads, wrong locations, malformed factors, unsupported
properties and incompatible unlit combinations fail explicitly before resource I/O.
Core slots hold texture references; finite extension metadata holds factors/defaults.
Shared images get separate sRGB/linear/normal interpretations, including sheen and
specular color. Texture offsets, scale, rotation in radians, selected UV and normal
scales retain authored semantics; no transform is silently baked or discarded.
See the [exact defaults/channels and consumer limits](docs/tdrs/tdr-0004-material-resource-fidelity.md).

`normalizedGlb` embeds admitted relative/data/embedded resources and retains exact
encoded PNG/JPEG bytes, materials, transforms, samplers and authored image metadata.
It exposes the bounded normalized GLB already checked by Khronos, as an immutable
Blob with a separate output hash. Repeated reimport does not accumulate image views.
It exports the **source**, not a possibly edited canonical model; canonical GLB/glTF
package layouts use exportGpuModelToGltf below. Output can exceed the 16 MiB entry-point ceiling
when external resources are embedded; reimport then fails that existing limit.
No budget is raised to make a round trip succeed.

This profile rejects skins, morphs, animation, sparse accessors,
non-triangle topology, cameras, multiple scenes and orphan nodes explicitly.
Indexed/interlaced PNG remains unsupported. Those broader fidelity/repair paths
belong to Tasks #15–#17. A strict final Khronos validation and canonical-core
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
Material mapping and source-normalized output are recorded in
[ADR-0009](docs/adrs/adr-0009-material-resource-preservation.md).

The canonical producer and bridge must use the same released core0.6.0 instance
and module format. Test consumers use bridge0.4.0 / renderer0.2.53. The renderer
accepts UV0/identity bindings and explicitly refuses other UV/transform forms;
alpha mask is also refused, while advanced shading has existing renderer limits.
Canonical factor/resource retention is not physical appearance certification.
Keep the existing loader and remote rollback; this release does not cut over
`gpu-shared`, register a broad cached runtime adapter, or complete Feature1150.

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

## Opt-in skin, morph and animation preservation

Select the additive profile explicitly; omission keeps the static boundary above:

```ts
import { GLTF_DEFORMATION_IMPORT_PROFILE, importGltfToGpuModelDocument }
  from "@plasius/gpu-model-gltf";
const result = await importGltfToGpuModelDocument(gltfBytes, {
  conversionEnabled: remotelyEvaluatedConversionDecision,
  profile: GLTF_DEFORMATION_IMPORT_PROFILE,
  resourceResolver,
  signal,
});
// result.profile is "gltf-deformation-resources-v1".
// result.document has verified skins/joints, blendShapes, node-instance weights,
// authored rest TRS and STEP/LINEAR/CUBICSPLINE translation/rotation/scale/weights.
```

This profile preserves ordered skin joints/inverse matrices (identity when omitted),
paired vertex joint/weight sets, POSITION/NORMAL/TANGENT morph deltas, independent
node-instance defaults and animation values/tangents. Reflection preserves quaternion
signs and signed scales/weights. It never evaluates animation or normalizes skin
weights. The normalization root moves the scene together; bounds describe **base
geometry**, not deformed or animated motion envelopes. Source-normalized GLB round
trips retain materials and animation deterministically; canonical edit export remains
Task#16. Producer and bridge must share core0.6.0 and module format.

Existing resource/work limits apply to all expanded data, with additional tightening-only
limits:256 skins,4096 summed joints,1024 summed mesh targets,65,536 node morph bindings,
256 animations,4096 samplers,8192 channels and1M expanded deformation elements.
Repeated morph/animation references and duplicated skin rows are checked before I/O.
Matrix-authored joint rest poses, extra inverse matrices, unbound skins, unused
samplers, non-float animation data and morph UV/color/custom semantics fail explicitly.
Inherited sparse/topology/camera/scene restrictions still apply. No rejected asset
falls back to a static profile. Default strict/static APIs remain unchanged.

Use the remotely evaluated `gpu.model.conversion.enabled` decision; disabling consumer
adoption and retaining the prior compatible package set/loader is the rollback path.
No capability or UI is added. See [ADR0010](docs/adrs/adr-0010-opt-in-deformation-preservation.md)
and [the exact profile, limits, tests and NFRs](docs/tdrs/tdr-0005-deformation-resource-fidelity.md).

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

### Interrupted release recovery

Use the ordinary `cd.yml` prepare phase with the required patch/minor/major bump.
Preparation resumes an existing version only when neither npm nor GitHub has
published it. If npm publication finished before a cancelled workflow could
publish its GitHub draft, the requested bump selects a fresh immutable version.
The pipeline owns version/changelog promotion and new tags; do not move existing
tags, overwrite npm versions or publish locally. `bump=none` retains its explicit
resume behavior and exact-main/tag identity checks.
