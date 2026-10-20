# ADR-0008: Bounded JSON/GLB Resource Import

- Status: Accepted
- Date: 2026-10-20
- Project: gpu-model-gltf#13, parent Feature site#1150 / Epic site#1147
- Flag: `gpu.model.conversion.enabled` (remote evaluator in the consumer)

## Context

The existing self-contained GLB and static PVOX demonstration profiles cannot
resolve glTF JSON packages, external buffers or relative textures. Broadening
their admission silently would change security and compatibility expectations.
Published runtime 0.3.0 now supplies corrected bounded resource acquisition.

## Decision

Add `importGltfToGpuModelDocument` and the named `gltf-static-resources-v1`
profile. Reuse format-owned container/JSON/accessor/PNG/Khronos admission and
basis math; do not move parsing to site, gpu-shared or the canonical core.
Use the published runtime resolver for all external acquisition, with tightening
per-resource and aggregate limits, sequential work, abort/deadline ownership and
redacted errors. Decode only admitted base64 data URIs locally as format data.
Validate original buffer ranges and BIN padding before normalization can mask
invalid declarations. Normalize resources for official Khronos validation, then
map dense static triangle geometry and core material/image resources into the
released canonical core, including privately verified immutable payloads.

The entry point preserves basis, winding, node hierarchy, core texture/color-space
semantics and bounded content metadata. Separate canonical texture interpretations
share verified image bytes. Explicit unsupported features remain failures owned
by the later material/animation/export/conformance tasks. The old strict/default
adapter and PVOX demo entry point remain closed and behaviorally unchanged.

No broad runtime adapter is registered yet: its entry-point-only cache key cannot
identify external resource revisions. The additive importer has no cache. The
consumer migration must own resource identity/invalidation; it must not reuse a
stale canonical result merely because JSON bytes are identical.

PNG reuses the existing full decoder. JPEG requires an actual bounded decoder,
not magic-byte assertions. Add exact `jpeg-js` 0.4.4 from npm (76,029 unpacked
bytes, zero transitive dependencies); decode with typed-array output, strict
mode, explicit resolution/128 MiB memory ceilings and existing image/decode
budgets. Load it dynamically only for JPEG. Registry metadata declares BSD-3-Clause;
the distributed license preserves Apache-2.0 decoder and Adobe/BSD encoder
notices. Package dependency installation retains those notices; no vendored codec.
Runtime dependency changes are limited to ^0.2.4 -> ^0.3.0 and this codec. The
pinned lazy Khronos validator remains 2.0.0-dev.3.10.

## Alternatives

- Broadening the default GLB/demo APIs changes established no-network/resource
  contracts and makes rollback ambiguous.
- Duplicating acquisition in the adapter bypasses the owning runtime budgets.
- Browser-only native image decoding is not a portable Node/browser verification
  boundary. Header-only JPEG checks do not prove decodability.
- Immediately replacing gpu-shared's loader would skip material extensions,
  texture transforms, renderer projection and compatibility work in #14–#17/#55.

## Consequences, validation and release

The remote flag decision is mandatory; disabled fails before parsing/acquisition.
No capability is added for a package-only function. Disable the flag and retain
the old consumer loader for rollback. Do not retry rejected assets through the
strict demo profile. Original URI/provider strings are not output diagnostics.
Authored names/extras remain bounded model content where the core permits them.

All CPU work is bounded, with cancellation/deadline checkpoints and raced async
providers. Synchronous decoder/core calls cannot be preempted within the same
thread: consumers should use workers for large models. The fixed working-set
estimate is conservative, not a claim about a JavaScript engine's exact RSS.

Requirements-derived fixtures cover external/multi-buffer/data resources,
PNG/JPEG, texture interpretations, canonical basis, normalized/interleaved
attributes, malformed original references, budgets, abort/deadline, redaction,
flag disable and the existing brigantine showcase. Existing strict/demo tests
remain required. See TDR0003 for mapping/NFR evidence. Run coverage>=80 with all
changed source in LCOV, lint, types, build, dependency/public artifact/pack checks
and browser/installed ESM/CJS probes. Publish a minor release only through the
existing `main`/`cd.yml`/`production` hosted OIDC process, exact-SHA CI and registry
provenance verification. The pipeline owns versioned changelog promotion. This
package-only release has no site deployment or ACA secret mapping change.

References: [glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html),
[jpeg-js decoding and limits](https://github.com/jpeg-js/jpeg-js#decoding-jpegs).
