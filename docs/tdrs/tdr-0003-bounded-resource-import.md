# TDR0003: Bounded Resource Import and Showcase Migration Map

Date: 2026-10-20. Project gpu-model-gltf#13; parent Feature site#1150;
consumer migration gpu-shared#55; conformance coordinator site#1160.
Decision: [ADR0008](../adrs/adr-0008-bounded-json-glb-resource-import.md).

## Scope and implementation

Use `importGltfToGpuModelDocument` with profile `gltf-static-resources-v1`.
The default runtime GLB adapter and strict/static demo entry points keep their
existing behavior. This task introduces an explicit function through the runtime
resolver boundary, without consumer cutover or broad runtime registration.

The remotely evaluated `gpu.model.conversion.enabled` decision is mandatory.
Live readback during implementation: registered, default/target enabled,100%.
Disabled fails before resource I/O; rollback disables discovery/consumer use and
retains the old loader. No new capability applies to this package-only layer.

Reference acquisition is sequential and bounded by the remaining per-resource
and aggregate budget. Data URI types/encoding, original buffer ranges, BIN
padding, MIME/magic, full image decoding, JSON complexity, canonical geometry
expansion, instancing work, and a conservative working-set estimate are checked.
Repeated accessor/primitive expansion and instanced world vertices are counted
before any resource acquisition or Khronos traversal, so a small source with
many repeated references cannot postpone its work limit until canonicalization.
No input URI/provider string is copied into diagnostics. The final normalized
resource set passes the pinned official Khronos validator; canonical payloads
must also pass the released core's private verification boundary. The source
hash identifies exact entry point bytes; resource hashes identify each actual
canonical buffer/image payload. It is not a whole-package cache key.

## Existing loader behavior mapped before removal

The inspected gpu-shared source is commit
`8b20b0fa43fb9d866178ec1cdf353b7cfb34c881`; the ten tracked `assets/*.gltf`
files were unchanged from that checkout's HEAD. The loader remains in place.

| gpu-shared loader behavior | Additive canonical boundary | Remaining consumer owner |
| --- | --- | --- |
| JSON/GLB, data/external buffers and relative images | Bounded original-range-checked resource resolution; PNG/JPEG verified payloads | #55 chooses acquisition/base URL/integrity policy |
| Accessor component types, normalized/interleaved data | Dense static vertex semantics become f32; indices become u32, with expansion budgets | #55 projects canonical buffers to renderer data |
| Node TRS/matrices, hierarchy, world geometry | Canonical reflected basis, winding and floor-centred normalization root; byte-verified bounds | #55 must account for new canonical origin/basis in scene placement |
| POSITION/NORMAL/TANGENT/UV/COLOR and indexed/unindexed triangles | Preserved attributes and explicit indices; normals/tangent handedness reflected | #55 preserves renderer vertex layouts |
| Core PBR factors, five texture slots and samplers | Canonical materials/textures; shared image resource with distinct color-space interpretations | #14 extends KHR materials/texture transforms and extension fidelity |
| Authored node/mesh/material names | Bounded canonical names | #55 preserves primitive naming/identity in renderer projection |
| Node `extras.physics` | Bounded `node.metadata.sourceExtras.physics` | #55 maps physics data back to showcase integration |
| WebP, compressed resources, extensions, animation/skin/morph | Explicit unsupported-feature failure | #14/#15/#17; no permissive fallback |
| Fetch integrity manifest and local inline brigantine fallback | Runtime owns acquisition/integrity; profile is only invoked after remote flag decision | #55 retains authorized legacy fallback during rollout |
| Entry-point-only runtime cache | No broad runtime adapter or cache in this importer | #55 / runtime owner must define resource revision identity before adoption |
| glTF export, repair and final round-trip fidelity | Existing strict export unchanged | #16/#17 and site#1160 |

This map and representative fixture establish adapter readiness for this scoped
task, not completion of #55 or Feature1150. Keep the old loader until those
remaining contracts, renderer/physics projection and rollout tests are satisfied.

## Showcase evidence

The checked-in `tests/fixtures/showcase-brigantine.gltf` is the existing generated
organisation-owned inline brigantine, serialized without insignificant spaces.
The test checks three meshes/eight materials, the named hull and physics metadata.
No remote fixture or runtime dependency is needed for the test. Synthetic tests
cover external/multi-buffer/relative image, full PNG/JPEG, data URI, normalized
and interleaved geometry, core texture slots, sampler and color-space cases.

A separate built-ESM probe imported every current tracked showcase file without
modifying gpu-shared. Node24.18.0 observations (not a general performance SLA):

| Fixture | Source SHA-256 | Meshes / primitives / materials | Node time |
| --- | --- | --- | --- |
| brigantine.gltf | `631acf1acccde0302a0823ba6db3166c2a63689a23f5cdf0d9500db8d1f63696` | 3 / 8 / 8 | 108 ms |
| coaster.gltf | `d5187a13d477e7c8e4b9f266c66448674eb6d299112b2a7455aba26b8035dadd` | 3 / 8 / 7 | 52 ms |
| cutter.gltf | `848d74d640c299984ede03c5d2cbc2e447bea1466f973bdd9eebbb2a606b3c52` | 2 / 6 / 6 | 34 ms |
| fishing-boat.gltf | `4068c0bda9b4df385f4cb98112f1d90d6c205c5fd215b9d262944b3f732c5064` | 3 / 8 / 7 | 36 ms |
| harbor-dock.gltf | `b16ed649324b3b13562a9c734620535c95ccfb448e5b2477fcbbf1ce6617dc94` | 8 / 19 / 15 | 190 ms |
| harbour-berths.gltf | `86608dd34bce1dd0cea8cef6618d38e5befceb08fff276d92d2c5811013a9f3a` | 2 / 6 / 6 | 50 ms |
| lighthouse.gltf | `4c393cd32678af83ba99d79def349f3dc9b82878cbe7628c2d9f525ba35888b6` | 3 / 8 / 7 | 18 ms |
| pilot-launch.gltf | `9ab5aef0d986dac0ed6ba0cc5eb772dffc76603ab7653c5fe95f183ada9721a2` | 3 / 8 / 7 | 28 ms |
| shoreline.gltf | `47d456c131783e9fbe8d36bf5e0702c7211cef2adf3df31fc3ba1443ae71435d` | 5 / 7 / 7 | 36 ms |
| tug.gltf | `088b1f3c12ced5d5e6eef43f69105bc271d130f0b04e7da922d812c86a4cbdf9` | 3 / 7 / 6 | 32 ms |

Chrome154 (macOS) ran an esbuild browser ESM bundle targeting Chrome120,
Firefox122 and Safari17 against brigantine plus PNG/JPEG resources: three meshes,
both image types, disabled flag rejection, `typeof Buffer === "undefined"`,102ms.
The first browser probe exposed dynamic CJS namespace interop in jpeg-js;
normalizing its default/namespace export fixed the actual browser regression.
Only Chrome was executed; other targets were compilation checks. No claim of
Firefox/Safari runtime execution or full browser matrix conformance is made.

## NFR evidence and test plan

- Security: checked with unsafe references, duplicate/prototype JSON keys,
  cross-realm byte arrays and spoofed wrong-type view rejection,
  original buffer overruns, byte/MIME mismatch, malformed image/geometry and
  over-budget tests. External credentials/base URL/redirect policy remain the
  trusted runtime provider's responsibility. No secret configuration changed.
- Privacy: checked with hostile provider errors; messages/diagnostics are bounded
  and omit provider tokens/URLs. Authored names/extras remain owned model content,
  subject to the core's metadata limits, not diagnostic output.
- Reliability: checked with pre-abort, cancellation propagated to an ignoring
  provider, hard async deadline, stream cancellation and deterministic failures.
  No retry layer is added. Synchronous CPU calls use finite budgets/checkpoints;
  they cannot be interrupted mid-call in the same thread. Use a worker for UI use.
- Performance/scalability: checked with geometry expansion, instance work,
  acquired/assembled/canonical byte, image pixel/decode and count limits; all ten
  existing showcase inputs import locally. Sequential resource work has concurrency1.
  The working-set estimate is a conservative admission bound, not measured RSS.
- Maintainability/testability: requirements-derived positive/negative fixtures,
  an existing showcase regression, shared format/basis helpers, no copied runtime
  acquisition or core schema ownership. All changed source must appear in LCOV.
- Observability: stable `GlbAdapterError` codes and bounded shared converter
  diagnostics; canonical resources carry verified SHA-256, byte count and MIME.
- Reproducibility/dependencies: frozen npm install, lint/typecheck/build,
  audit, public-artifact/pack checks, ESM/CJS smoke and browser bundle/probe.
  Coverage gates remain80%+; final command/commit evidence belongs to the issue.
- Portability: modern WebCrypto, Blob, TextDecoder, AbortController, atob and
  DecompressionStream; Node24 and actual Chrome checks. Codec lazy-load preserves
  PNG-only first use; no native Node dependency added.
- Accessibility/SEO: N/A, no UI or page output changes. Compliance: no PII or
  secrets in fixtures; distributed third-party decoder notices retained through
  the dependency package. Browser/device rendering fidelity remains #55 scope.
- Deployment safety: minor package release only through existing exact-source
  identity checks in main/cd.yml/production hosted npm OIDC, with exact-main CI,
  registry/provenance and installed probes. No local publication, site deployment
  or ACA backend environment update is needed for this package-only delivery.

## Dependency and release review

Runtime ^0.2.4 -> ^0.3.0 consumes the prerequisite's corrected acquisition byte,
integrity and cross-realm contracts from npm. New exact jpeg-js0.4.4 is a browser-
compatible76,029-byte pure-JS dependency with zero transitive runtime packages.
Use typed arrays, strict decoding, pixel and decoder-memory bounds; import it
only on the JPEG path. Registry metadata is BSD-3-Clause; its decoder and encoder
notices are preserved in the installed package. Runtime audit reports zero known
vulnerabilities. The existing lazy exact gltf-validator dependency is unchanged.
There are no local references or opportunistic dependency upgrades.

After final verification: focused PR and exact-head CI, squash merge, existing
CD prepare/minor and publish on exact main, production npm OIDC, package registry
and provenance/installed probes. Pipeline-generated release metadata is reviewed
separately. Record exact results in #13 and link this mapping in gpu-shared#55;
leave the parent Feature and subsequent tasks incomplete.
