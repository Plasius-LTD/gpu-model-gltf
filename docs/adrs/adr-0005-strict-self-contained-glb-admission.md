# ADR-0005: Strict Self-Contained GLB Admission

## Status

- Accepted
- Date: 2026-08-20
- Version: 1.0
- Parent feature flag: `gpu.model.conversion.enabled`

## Context

Site ADR 0094 assigns glTF/GLB parsing and export to this package while keeping
runtime discovery, canonical model ownership, rendering, rights review, and
promotion in their respective package or service boundaries. The canonical
`@plasius/gpu-model-core` document/adapter contracts are not yet published, but
the model-resolution pipeline needs a truthful first conversion slice for
already-binary GLB inputs.

Provider bytes are hostile. Blind URI resolution, permissive repair, parser
resource exhaustion, non-finite geometry, MIME spoofing, or silent extension
loss would make converter evidence unsuitable for catalog promotion.

## Decision

1. Admit only self-contained GLB version 2 in the first strict validation slice.
2. Require one first JSON chunk and at most one BIN chunk; reject unknown,
   duplicate, truncated, misaligned, or incorrectly padded chunks.
3. Bound input, JSON, document entities, accessor work, embedded images, and
   diagnostics before loading the official validator.
4. Reject all buffer/image URIs, glTF extensions, animation, skins, morph
   targets, sparse accessors, and non-triangle primitive modes.
5. Validate exact buffer/accessor ranges, every floating-point accessor value,
   and embedded non-indexed PNG MIME, bounded chunk count, per-chunk CRC,
   required IHDR/IDAT/IEND ordering, bounded zlib output, scanlines,
   dimensions, pixels, and decoded/runtime texture size. JPEG and indexed PNG
   stay fail-closed until bounded full decoders are released.
6. Serialize output in one allocation using recursively sorted JSON object keys,
   preserved array order, exact declared BIN bytes, and deterministic padding.
7. Validate the final output with the pinned Apache-2.0 Khronos glTF Validator,
   dynamically imported after bounded local preflight. Validator findings that
   mean image bytes are unrecognized are blocking even when upstream severity
   is only a warning.
8. Use sequential Web Crypto SHA-256 over private source and output snapshots
   for exact hashes, preserving validator diagnostics before synthetic converter
   messages. Emit shared
   `ModelConverterEvidence`; emit no conversion losses because the admitted path
   is semantically pass-through.
9. Expose `ValidatedGlbArtifact` only from the low-level validation API. Keep
   the `@plasius/gpu-model-runtime` registration seam fail-closed until it can
   return the released canonical `GpuModelDocument`; do not invent a parallel
   canonical object while its owning package is unavailable.
10. Support strict mode only. Tolerant and forensic calls fail closed until
    allowlisted repair and raw-evidence policies are implemented.

## Dependency decision

`gltf-validator@2.0.0-dev.3.10` is pinned exactly. It is the official Khronos
validator, Apache-2.0 licensed, browser-capable, and dynamically loaded so it
does not inflate normal API/runtime startup. Shared diagnostics and runtime
interfaces come from released `@plasius/*` packages rather than duplicate local
contracts.

## Consequences

- Rights-clear uncompressed GLBs can be strictly validated and deterministically
  exported with reproducible converter evidence, but cannot enter the canonical
  runtime/cleanup path until the core document dependency is released.
- Common compressed or extension-bearing provider GLBs remain unsupported until
  dedicated, tested extension capabilities are released.
- `.gltf` bundles remain metadata-only for this slice even though the provider
  matrix may advertise them; acquisition must select a supported GLB rendition.
- The package cannot yet claim canonical scene conversion. That remains blocked
  on the core contract owner.

## Rollback

Disable `gpu.model.conversion.enabled` remotely and pin consumers to the prior
validated package version. No capability is required because this package has no
user-visible entitlement surface.

## Additive amendment

ADR-0006 supersedes only Decision 9's temporary core-availability gate for the
bounded ChatGPT static demo. The strict validation/export work and its
attribution to predecessor Task `gpu-model-gltf#1` / Feature
`plasius-ltd-site#1148` are unchanged. Broad canonical ingestion remains
fail-closed outside ADR-0006's profile.
