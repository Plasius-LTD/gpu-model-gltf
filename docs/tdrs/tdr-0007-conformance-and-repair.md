# TDR0007 — Conformance, repair and round-trip fixture matrix

## Ownership and fidelity vocabulary

This package matrix supplies the glTF part of site#1160 under Feature1150. It
reuses the existing synthetic triangle/material/deformation and approved
showcase fixture rather than invent cross-format standards. site#1160 retains
ownership of CAD/other-format/renderer-wide qualification; this task does not
complete those criteria or gpu-shared#55 consumer migration.

| Fixture / test | Input and operation | Required result |
| --- | --- | --- |
| minimal-triangle.fixture.json / glb-adapter | strict GLB validate/export | Exact geometry; deterministic bytes for repeated export; original/final SHA256 |
| material-fixture / resource-import | JSON/external/data/embedded/GLB | Semantic world-space geometry, coordinate conversion and normalization root; exact resource identity |
| material-fixture extended / material-roundtrip, canonical-export | common KHR factors/maps/UV transforms/samplers | Semantic material/texture interpretation; exact PNG/JPEG hashes, not canonical IDs/storage |
| deformation-fixture rig / deformation-import, canonical-export, conformance-repair | skins, two morphs, node weights; STEP/LINEAR/CUBICSPLINE | Semantic ordered joints/inverse binds, morphs/defaults/bindings and animation times/values/tangents; no resampling |
| conformance-repair | JSON/GLB nonunit skin-weight rows | Strict refuses; tolerant normalizes finite non-negative rows with positive total using the core-approved rule; original hash/complete core records |
| conformance-repair | shared references, unsafe overlaps/aliases, positive influence underflow | Normalize once or refuse ambiguous/lossy storage; no discarded influence |
| conformance-repair | forensic damaged numeric fields | Complete core repair records and safe partial raw numeric source, entry/pre-repair binary hashes; no authored strings |
| conformance-repair | repaired rig -> GLB and relative glTF package -> strict import | Pinned validator on exact bytes; repeated output hashes exact; material/animation/morph semantics equivalent |
| showcase-brigantine.gltf / resource-import | approved existing external showcase | Same admitted geometry/material meaning and stable resource handling |
| resource-import, material-resources, deformation-rejection, canonical-export-rejection | malformed/unsafe resources, unsupported extensions, sparse/codec/lossy/ambiguous constructs | Controlled rejection, no silent semantic loss or provider/URI exposure |
| conformance-repair | bad bounds/quaternions, negative/zero/nonfinite weights and other repairs | Refuse; tolerant mode never repairs unrelated metadata or invents animation semantics |
| conformance-repair | >100 nonblocking validator findings, malformed report, hidden image blocker | Incomplete/inconsistent evidence refuses in import and both exact export layouts |
| conformance-repair + existing limit tests | bytes/entities/repeated references, diagnostics/repairs, deadline/cancel | Tightening-only ceilings; complete repair ledger or failure; no partial output; hung providers raced |
| flags / existing strict/static tests | disabled conversion, default/strict/tolerant/forensic | Disabled rejects before I/O; strict default and old APIs unchanged; forensic retains safe bounded numerical source; old low-level APIs still refuse |

Canonical IDs, storage layout, source paths/metadata, provenance and diagnostic
history are outside glTF interchange. Reimport adds the normal canonicalization
root; it does not preserve original canonical document identity. Unsupported
scene semantics are refused, not accepted as documented loss. Weight normalization is recorded by the published core rule, preserving all
positive influences. Other rules are not implicitly implemented.

## Bounded processing and safe observability

All existing 16MiB entry/64MiB resource+aggregate, 4M geometry, 1M deformation,
4095 node and image/skin/morph/channel ceilings remain. Repair scans each
WEIGHTS_0 candidate once after accessor/repeated-reference admission. Work is
bounded by admitted geometry/deformation components. At most100 row writes are
staged, and overlaps are conservatively rejected against admitted accessor
buffer views. No source array aliases are mutated; binary acquisition already
owns a private copy. The complete ledger has at most100 entries, and each core
record includes four original finite numbers, action/severity/path/confidence.
Core's evaluator snapshots and freezes evidence; forensic report construction
has a stricter64KiB bound plus core depth12/value16384/member1024 limits.

Forensic rawSource contains original damaged numeric rows and entry/assembled
pre-repair binary SHA256 only. It never copies source names, URI, metadata,
provider messages or arbitrary strings, and it never logs or persists evidence.
This is partial damaged-source evidence, not a raw package archive. Full archive
retention belongs in a separately approved private store. Unsupported/unsafe
input still fails without a partial usable result. No new core rule or contract.

Each public finding list is capped100, messages1024/pointers256; canonical
diagnostics add one fixed marker. The complete core ledger is separate from
shortened shared findings. Existing source/normalized/output work/byte ceilings
remain; no ceiling is raised. No source data is retained outside the explicit
result; each operation has local state and no repair cache.

The validator has its own hard100-issue ceiling. Saturation is a blocking
incomplete-validation error, distinct from deliberately shortened public
reporting after complete validation. Counters/messages/truncation evidence must
be well formed and consistent. All bounded findings are considered for blocking
overrides before presentation limits. No severity overrides or issue muting.
Source/provider strings never become diagnostic messages. Authored content can
still exist in the intentionally returned model/normalized artifact; those are
content artifacts, not logs. No automatic telemetry or retries/network occurs.
The orchestration layer owns metrics, retention and correlation.

One existing ImportBudget spans asynchronous acquisition, validation and hashes,
including uncooperative providers. Synchronous bounded parser/core/validator work
cannot be preempted mid-call; use worker termination for hard isolation.
Operations keep local state; repair has no cache or global cross-request state.

## Dependency, license and compatibility decision

No dependency or lockfile change. Reuse published core0.6.0 private verification,
runtime0.3.x resource boundaries and asset-contracts0.4.x diagnostic types.
`gltf-validator`2.0.0-dev.3.10 (Apache-2.0) remains exact-pinned and dynamically
imported only on admitted conversion. `jpeg-js`0.4.4 (BSD-3-Clause) remains lazy
on actual JPEG decode. No Draco/meshopt/Basis/texture codec is added; unsupported
compressed inputs remain explicit refusals. This avoids new transfer/decode or
license obligations and cold-start cost. Production packaging remains dual
ESM/CJS, browser-safe typed arrays/Blob/Web Crypto, Node24+, existing build targets
Chrome120/Firefox122/Safari17. Qualification records actual browser evidence
separately from target syntax support; no untested device/runtime is claimed.

The normative rules are [Khronos glTF skinned attributes](https://github.com/KhronosGroup/glTF/blob/main/specification/2.0/Specification.adoc#skinned-mesh-attributes) and the published core non-normalized-weights policy. Validator
truncation semantics come from the pinned package validation.schema.json and
[Khronos validator](https://github.com/KhronosGroup/glTF-Validator).

## NFR qualification and release evidence

Acceptance requires the repository's NFR.md: privacy/security admission and
redaction regressions; controlled failure and bounded no-retry work; deterministic
semantic/exact matrix; baseline and final npm-ci/test/coverage/lint/type/build/
privacy/pack/dependency-audit gates; changed runtime files present in combined
LCOV; installed public ESM/CJS/strict type smoke and actual browser validation.
Runtime size/lazy-loading and performance measurements belong in the final issue
and PR evidence, not invented static thresholds. Accessibility/SEO N/A for this
package-only change. Backend sensitive env secretrefs N/A: no backend deployment.

Remote flag `gpu.model.conversion.enabled` is evaluated by the responsible
consumer/runtime. The package requires its boolean decision, rejecting disabled
operations before resource work. No capability is added for this internal layer.
Release through approved main/production cd.yml/npm OIDC, confirm exact-main CI,
public registry bytes/tag/provenance and consumer behavior before adoption.
Rollback via strict/default mode, existing loaders, retained prior release or
remote disabling. Site#1160 and gpu-shared#55 stay incomplete until their own
acceptance and release evidence exist.
