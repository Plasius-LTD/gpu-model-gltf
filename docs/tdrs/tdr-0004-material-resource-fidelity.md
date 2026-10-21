# TDR0004: Material and image resource fidelity

Date: 2026-10-21. Project gpu-model-gltf#14; Feature site#1150;
consumer cutover gpu-shared#55; final conformance site#1160 / glTF#17;
full canonical export glTF#16. Decision: [ADR0009](../adrs/adr-0009-material-resource-preservation.md).

## Admitted source contract

Record made on the linked issue before implementation. Existing consumers inspected:
`gpu-shared/src/gltf-loader.js`, `gpu-renderer/src/canonical-wavefront-meshes.js` and
`wavefront-materials.js`; existing loader is retained. Format rules use the official
[Khronos material extension specifications](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos)
and their schemas, inspected 2026-10-21. All extension names below carry the
`KHR_materials_` prefix. Every factor must be finite; unknown properties fail closed.

| Extension | Defaults/ranges | Texture channels / transfer function |
| --- | --- | --- |
| clearcoat | factor0 and roughness0 in[0,1]; normal scale1 finite | intensity R, roughness G linear; normal RGB normal-map |
| transmission | factor0 in[0,1] | R linear |
| sheen | color[0,0,0] in[0,1], roughness0 in[0,1] | color RGB sRGB, roughness A linear |
| ior | 1.5; zero or >=1 | none |
| specular | factor1 in[0,1], color[1,1,1] >=0 (HDR allowed) | factor A linear, color RGB sRGB |
| volume | thickness0 >=0, attenuation color[1,1,1] in[0,1]; optional distance>0 | thickness G linear; omitted distance represents infinity without storing nonfinite metadata |
| iridescence | factor0 in[0,1], IOR1.3 >=1, thickness min100/max400 >=0 ordered | intensity R, thickness G linear |
| anisotropy | strength0 in[0,1], rotation0 finite radians | direction RG, strength B linear |
| dispersion | 0 >=0 | none |
| unlit | empty payload selects workflow=unlit | core base-color interpretation; combination with other material extensions explicitly unsupported |

Core PBR base RGBA[1,1,1,1], metallic1/roughness1, emissive[0,0,0], normal
scale1, occlusion strength1, alpha and double-sided remain canonical fields.
MASK defaults cutoff0.5. Extension factors with corresponding core fields are
also projected there; other factors remain under original KHR-keyed metadata.

The bounded resource importer applies this same complete mapping when
`primitive.material` is omitted. It appends one canonical `material-N` after the
N authored materials only if needed, shares it across all omitted primitives,
and preserves every authored reference. An explicit empty material and an omitted
reference therefore produce equivalent canonical/renderer defaults. Source-normalized
GLB retains the original omission; edited canonical GLB/glTF exports the explicit
default material and preserves its semantics on reimport. Neither path changes
the source or the format-neutral renderer's defaults. Task #14 regression coverage
uses both JSON and GLB, mixed references, actual registry bridge/renderer projection
and deterministic validated exports in both layouts. One additional material is
the complete allocation overhead; there is no extra primitive scan or resource I/O.

Clearcoat normal scale is retained as `clearcoatNormalScale` in its extension.
Only validated canonical slots hold extension texture references; no raw source
texture index is passed as a renderer sample. Authored extension extras remain
bounded `sourceExtras`, and JSON extras is opaque metadata rather than extension
grammar. Unknown optional and required extensions both fail explicitly.

[KHR_texture_transform](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_texture_transform)
adds offset[0,0], scale[1,1], rotation0 → `rotationRadians`; an authored `texCoord`
overrides textureInfo's UV selection. Preserve exact values and sampler state.
UV range0..7 matches released core; required attributes are core-verified.
Texture usage/color-space nodes share one image resource, hash and immutable Blob.

## Export and source identity

`result.normalizedGlb` exposes source-normalized self-contained GLB bytes as a Blob,
exact SHA-256 and length. Material/texture/transform/sampler source semantics remain;
external/data images become embedded with exact encoded PNG/JPEG bytes. Existing
embedded bufferViews are reused and image name/extras are preserved. No JSON URI
is copied to diagnostic output. The artifact intentionally contains authored source
content; it is not sanitized logging data.

Tests cover relative PNG/JPEG → embedded GLB → reimport, exact image hashes/bytes,
material/transform/sampler equivalence, deterministic normalization of one source
and repeated-normalization hash stability. Packed canonical geometry may reorder
with normalized object keys; its references preserve semantics. Source-entry hash,
normalized-artifact hash and canonical-resource hashes are distinct identities.
No whole-package cache key is inferred from the entry-point hash.

This exports the admitted source, not changes made to the returned canonical model.
Full canonical editing/GLB/glTF relative-package export remains #16, animation#15
and final repair/round-trip conformance#17 remain incomplete. An embedded output
larger than the16MiB entry ceiling cannot reimport through this profile; limits are
not raised or bypassed to make round trips succeed.

## Compatibility and rollback

Producer/bridge must dedupe exact core0.5.0 and use the same ESM or CJS instance.
Test-only bridge0.3.0 / renderer0.2.53 use public npm releases. Actual format fixtures
run through a test-local runtime registration with cache disabled; production broad
runtime registration and resource revision policy remain #55 responsibility.
Encoded PNG fixture bytes are decoded to samples for real renderer atlas/BVH checks.
These checks establish data integration, not physical GPU appearance certification.

Renderer0.2.53 only admits canonical UV0 and identity transforms, explicitly refusing
others; never erase transform or substitute UV0. Alpha MASK is refused; unlit/alpha
shader qualification remains renderer#238/#237. Advanced material shading is the
existing renderer implementation, including factor clamps (IOR/iridescenceIOR1..3,
dispersion0..2 and some color clamps) and clearcoat-normal-scale limitations.
The canonical adapter retains the exact source values even outside those renderer
ranges; this is not permission to route such assets through an unqualified renderer.
Keep the legacy consumer path until its showcase/visual tests pass. Canonical retention
does not certify every glTF physical material value or shader approximation.

`gpu.model.conversion.enabled` is remotely evaluated by caller; live readback this
run: registered/default enabled/target enabled/100%. No setting change made. Disabled
and cancellation paths are covered; rollback disables consumer discovery and retains
the old loader/compatible package set. No capability applies to this package layer.

## NFR checks and release evidence

- Security/privacy: grammar/type/range/reference/declaration/location tests, hostile
  extension/resource/provider failures, stable payload-free diagnostic codes; no
  secret/PII fixture, URL fetch policy or credentials changed.
- Reliability: inherited hard input/resources/image/geometry/work/deadline/cancel
  budgets; preflight before I/O, sequential resource concurrency1, no retries added.
  Synchronous parser/decoder calls remain non-preemptible; use a consumer worker.
- Performance/scalability: bounded metadata traversal, shared images with separate
  interpretations, deterministic source normalization and no new resource cache.
  Existing working-set admission bounds include normalization; they are not RSS
  measurement or a throughput SLA. Record local showcase/browser timings in issue.
- Maintainability/testability: reuse released core/runtime/bridge/renderer and existing
  decoder/validator seams; leaf value-reader module avoids resolution/material cycle;
  tests first, coverage80%+ and every changed source in LCOV.
- Observability: existing bounded GlbAdapterError/diagnostics, verified source/output/
  resource hashes; no diagnostic source URIs or raw provider messages.
- Reproducibility/dependencies: frozen install, full coverage/lint/types/build,
  privacy/public pack/dependency graph/audit, ESM/CJS and actual browser execution.
  Core0.4.6→0.5.0 is required for the six slots. Bridge/renderer are test-only; new
  transitive test graph is lockfile-owned. No opportunistic existing-package upgrade,
  codec/validator change, local reference or new public package.
- Portability: modern WebCrypto/Blob/TextDecoder/AbortController/atob/
  DecompressionStream. Node24 and browser ESM exercise the path without Node Buffer.
  Record actual browser version; build targets are not runtime coverage claims.
- Accessibility/SEO: N/A, data-only package with no UI/pages. Compliance: no PII/secrets
  introduced; existing third-party notices remain in dependency packages.
- Deployment safety: PR/exact-head and exact-main CI, approved production hosted
  OIDC cd.yml, registry/tag/provenance/installed checks. Package-only release: no
  site/backend/ACA deploy; ACA secretref is N/A. Consumer cutover is separately tracked.

Final command timestamps, SHA, test/coverage totals, browser observations, PR and
production workflow/registry/provenance evidence belong to the final issue comment.

## Local observed qualification

The final local suite has215 tests (177 baseline plus38 new cases),94.02% lines /
84.71% branches. Every changed source appears in combined LCOV. The twelve
recorded commands for frozen install/coverage/lint/types/build/privacy/dependency
graph/runtime audit/public pack/pack dry-run/offline publish dry-run/diff all passed.
The original rejection of KHR_materials_unlit was replaced with an unknown vendor
extension because unlit is now intentionally admitted; the negative case remains.
Eleven new material regressions first failed on the old implementation.

All ten existing organisation showcase glTFs import without modifying gpu-shared;
observed Node24 times range18–192ms (brigantine110ms). Candidate ESM/CJS material
probes take82/84ms. Actual Chrome154/macOS executes the built browser ESM graph
with13 canonical slots /12 extension atlases, PNG/JPEG round trips, stable artifact
hash, disabled/pre-abort controls and transform refusal in49.5ms; Buffer is undefined.
Only Chrome executed: Chrome120/Firefox122/Safari17 are compilation targets, not
full browser/device runtime evidence. No physical GPU image comparison was made.
These are single local observations, not production performance guarantees.
