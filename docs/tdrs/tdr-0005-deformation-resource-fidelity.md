# TDR0005: Skin, morph and animation resource fidelity

Date: 2026-10-21. Project gpu-model-gltf#15; Feature site#1150.
Decision: [ADR0010](../adrs/adr-0010-opt-in-deformation-preservation.md).

## Format semantics and profile selection

Use `importGltfToGpuModelDocument(bytes, { conversionEnabled, profile:
GLTF_DEFORMATION_IMPORT_PROFILE, resourceResolver, signal, limits })`.
Default/explicit `gltf-static-resources-v1` and strict/demo APIs still refuse rigs.
The public result carries the selected profile; default result literal types remain
source compatible. An invalid profile fails before I/O. No fallback or evaluation
is performed. `normalizedGlb` remains an immutable admitted-source artifact and
cannot export edits to the canonical document;#16 owns canonical/package export.

The [Khronos glTF2 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html),
sections3.5.3,3.7.2.2,3.7.3,3.7.4,3.11 and appendixC, was inspected2026-10-21.
TRS is T*R*S. Reflection conjugates matrices, reflects translation/delta Z and
maps quaternion XY signs. It preserves authored quaternion sign and signed/zero
scales without decomposition. Cubic input/value/output tangents remain in their
original key order and use the same coordinate map; never normalize tangents.
Morph tangent displacement is VEC3, without base tangent handedness W.

Each glTF skin produces skin-i, skeleton-i and joint-i-j in original skin.joints
order. Absent inverse matrices become identity; present non-normalized f32 MAT4
accessors must have exactly one per joint, preserving core's bounded contract.
The optional glTF skeleton node reference is retained in sourceMetadata as
`gltfSkeletonNodeId`; it is not substituted for joint order or nearest parent links.
One node can occur in different skin-local skeletons. Intermediary non-joint nodes
and local transforms stay in the canonical scene. Joint rest data is node-local,
not a baked transform relative to its nearest parent joint. Skin name maps to
skeleton name; authored extras remain bounded source metadata.

Every linked mesh primitive has a skin weight set. JOINTS_n/WEIGHTS_n must pair
contiguously from0, at most8 sets (32 influences). Joint payload indices must address
the ordered skin list, finite weights lie in[0,1], and per-vertex sums must be1 within
the released core/validator tolerance. No repair/renormalization. Normalized unsigned
weights are decoded to canonical float32; joints use unsigned16 and retain values.
The core compares authored rows with verified bytes. Duplicate mesh use within one
skin shares its weight set; different skins receive their own bounded rows.

Each ordered mesh target is one canonical blend shape with primitive deltas.
Only POSITION/NORMAL/TANGENT f32 VEC3 deltas with matching base attributes/counts
are admitted. All primitives have the same target count/order. Target names, when
present in mesh.extras.targetNames, must match and map to canonical names. Defaults
are mesh.weights or zero. Each node receives a complete effective ordered binding
vector from node.weights, mesh.weights or zero, independent of other mesh instances.
Finite signed defaults and animated weights are retained without clamping.

Animation input is non-normalized f32 scalar, nonnegative strictly increasing time;
outputs are f32 VEC3 translation/scale, VEC4 rotation, or SCALAR node weights. Key
rotation values must satisfy Khronos quaternion requirements; cubic tangents are
retained verbatim after basis conversion. STEP/LINEAR output arity is K for TRS
or K*N scalars for weights; CUBICSPLINE uses3*K or3*K*N respectively, and at least2
keys. One shared sampler must use the same path and morph arity. Clips retain names,
duration, sampler/channel metadata, accessor references and flattened verified values.
Duplicate node/path channels, unknown/missing references and incompatible buffers fail.
Bounds describe normalized base geometry, including mesh-node transforms; they do
not certify skin/morph deformation or motion envelopes. Renderer preparation passes
data onward; it does not establish physical GPU animation rendering.

## Explicit exclusions

Retain inherited sparse/compression/topology/camera/multiple-scene/orphan-node
refusals. Matrix-authored joint rest poses are unsupported rather than guessed.
Extra inverse matrices, unbound skins and unused samplers cannot be silently dropped
into the core's narrower contract. Non-float animation outputs, other target paths,
interpolations and UV/color/custom morph attributes fail explicitly. This qualified
profile is not a claim of complete glTF conformance, tolerant repair, animated
renderer support, export of canonical edits or production showcase cutover.

## Limits, ownership and rollback

Existing limits remain:16MiB entry,64MiB per/aggregate acquired/assembled/canonical
resources,1024 buffers/images,64MiB decoded images,4096px,4M aggregate expanded
components,1M world vertices,4095 source nodes,30s and format JSON/working-set ceilings.
Additional tightening-only limits:

| Limit | Hard ceiling |
| --- | ---: |
| maxSkins |256 |
| maxJoints (summed skin lists) |4096 |
| maxMorphTargets (summed mesh targets) |1024 |
| maxMorphBindings (summed node target vectors) |65,536 |
| maxAnimations |256 |
| maxAnimationSamplers |4096 |
| maxAnimationChannels |8192 |
| maxDeformationElements |1,000,000 |

Expanded accounting includes morph accessor references, node bindings, skin matrices,
per-skin node traversal, duplicated joint/weight rows and each sampler's times/values.
It is included in the existing4M component/64MiB expansion admission too. No raising
limits to fit normalized output; an embedded output above16MiB cannot reimport.
Cancellation/deadline propagates to providers and races uncooperative promises;
loops checkpoint, synchronous parser/decoder/core calls cannot be preempted mid-call.
Resource concurrency stays1 with no added retries/cache. Use a consumer-owned worker
for large browser imports. Hard ceilings are admission bounds, not measured peak RSS.

Live flag `gpu.model.conversion.enabled` read this run: registered, default/target
enabled,100%, backend source. No setting changed. The caller supplies its current
remote decision. Rollback disables consumer adoption, aborts active work, retains
the existing loader and restores the previous compatible package set. Re-enable
requires a fresh explicit opt-in import. No capability applies to this data-only layer.

## Dependency, test and NFR evidence

Only required dependencies change: runtime core0.5.0→0.6.0 and dev-only
bridge0.3.0→0.4.0. Both are verified public releases from resolved#44/#31 prerequisites.
Validator2.0.0-dev.3.10 remains exact/lazy; jpeg-js0.4.4/runtime0.3.0/renderer0.2.53
stay unchanged. Lockfile adds renderer's test-only nested core0.5.0; producer/bridge
share core0.6.0. No override, local reference, unpublished package or new package.

Tests were defined before implementation. Six new positive cases failed on original
static admission; the seventh initial static-demo fixture used an invalid option key,
which was corrected to the actual documented flags before retaining that regression.
Golden fixtures cover all three interpolation modes, joint ordering/parent/IBM
reflection, normalized integer weights, morph delta bytes, independent instances,
signed defaults/quaternions/scales/tangents, shared samplers and cross-skin joint use.
Material+animation relative-source→embedded-GLB reimport preserves canonical fields
and normalized hash deterministically with no resource I/O. Hostile tests cover
references/arity/duplicates/types/unsupported semantics, limits before I/O, malformed
payloads, cancellation/deadline and disable/re-enable. Default/strict/demo tests remain.

- Security/privacy: external grammar, finite/reference/representation checks,
  verified immutable blobs/bytes and bounded non-payload diagnostic messages;
  hostile provider strings and paths never logged. No credentials or new network.
- Reliability/performance/scalability: pre-I/O expanded work caps, memoized ancestor
  mapping, abort/deadline controls, sequential providers, no added shared mutable cache.
- Maintainability/testability: reuse released core/runtime/bridge, private format helper,
  deterministic fixture requirements, full tests and coverage>=80%/changed-source LCOV.
- Observability: stable GlbAdapterError codes, canonical diagnostic warns bounds are
  base geometry, source/artifact/resource hashes remain distinct. Source metadata and
  normalized artifacts intentionally contain authored content and are not logging data.
- Reproducibility/dependency health: Node24 frozen install, lint/types/build, privacy/
  public pack policy, strict npm graph, runtime/full audits, packed ESM/CJS/types probes.
- Portability: modern WebCrypto/Blob/TextDecoder/AbortController/atob/DecompressionStream,
  ES2022 browser builds; exact executed browser evidence belongs in issue. Compilation
  targets alone do not qualify Safari/Firefox/devices or physical GPU rendering.
- Accessibility/SEO: N/A; no UI/routes/pages. Compliance: synthetic fixtures, no new
  PII/secrets, unchanged third-party dependency licensing.
- Deployment safety: focused PR and exact-head/main CI, workflow-owned minor version
  preparation and approved main/production cd.yml OIDC. Registry artifact/provenance/
  tag/installed consumer verification required before Done. No backend/ACA/site change;
  ACA secretref validation N/A. Consumer cutover remains#55;#16/#17 remain incomplete.

Exact final SHA, command results/timestamps, coverage and release/registry/browser
observations are recorded on the linked Project issue after final changes.

## Local observed qualification

Node24.18.0/npm11.16.0 frozen install and the13-command local verification suite
pass:289 tests (215 baseline plus74 additions),94.69% lines/86.41% branches,
100% lines in the new deformation module; all6 changed source files appear in
LCOV. Runtime and full dependency audits report zero vulnerabilities. Packed
ESM/CJS consumers and strict NodeNext ES2022+DOM type consumers pass with a shared
producer/bridge core0.6.0 instance, including preserved default static result types.

Chrome154/macOS actually executes the browser ESM graph with WebCrypto and no
Node Buffer: STEP35.4ms, LINEAR9.4ms, CUBICSPLINE7.2ms observed for synthetic import,
bridge preparation, material/animation source round trip and disabled/pre-abort
controls. Each retains1 skin,2 blend shapes and5 channels. Initial harness failures
came from its Node-only PNG fixture and key-order-sensitive JSON comparison; the
portable fixture and structural comparison were corrected without package changes.
These are single local observations, not a throughput SLA, RSS measurement or
physical animation rendering qualification. Firefox/Safari targets compile only;
no runtime/device or GPU appearance certification is asserted.

The PR review identified a structural preflight gap for paired skin influence sets.
Four regression cases first failed after external acquisition on the original head:
missing WEIGHTS, gapped sets, more than8 sets and extra WEIGHTS. Preflight now checks
both semantic lists are exactly paired and contiguous0..N-1 with N<=8 before I/O.
All four pass, with the full13-command suite and positive8-influence fixture green.
