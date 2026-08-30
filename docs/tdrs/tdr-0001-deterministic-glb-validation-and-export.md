# TDR-0001: Deterministic GLB Validation and Export

- Status: Implemented for low-level validation; runtime adapter disabled
- Date: 2026-08-20
- Architecture: ADR-0005 and site ADR 0094

## Processing sequence

1. Copy the `Uint8Array` or `ArrayBuffer`; validate strict mode, source hints,
   cancellation, and caller-tightened limits.
2. Parse the 12-byte GLB header and bounded aligned chunks without resolving any
   resource.
3. Decode JSON with fatal UTF-8 handling; walk it depth-first without retaining
   width-sized stacks while enforcing depth, value, string, key, and
   finite-number limits.
4. Enforce the closed static-world feature profile and all entity ceilings.
5. Verify the single buffer, bufferViews, dense accessors, finite float payloads,
   image ranges, and non-indexed PNG structure, bounded chunk count, CRCs,
   bounded zlib output, scanlines, dimensions, and decoded/runtime texture
   size. JPEG and indexed PNG are not admitted by this strict slice.
6. Sort JSON object keys recursively, preserve arrays, strip source BIN padding,
   and rebuild exact GLB v2 chunks with deterministic padding in one output
   allocation.
7. Dynamically load the pinned Khronos validator and validate only the rebuilt
   final bytes. URI resolution remains a rejecting callback.
8. Hash exact source and output bytes sequentially with Web Crypto SHA-256,
   prioritize bounded validator findings, and return an
   immutable evidence object containing an immutable `Blob` output.

## Resource ceilings

Defaults align with the `static-world-v1` 100 MiB GLB and 64 MiB aggregate
texture budgets. JSON, traversal, entities, accessors, image count/size, and
diagnostics have additional ceilings. A 4K dimension and 64 MiB decoded runtime
texture ceiling apply before image decode. API callers can only reduce these
values; policy-profile increases require a future versioned adapter release.

The working-set estimate is the larger source/output value produced by a
32 MiB fixed allowance plus seven times the complete GLB size and 32 times the
aligned JSON-chunk size. The source estimate is checked before the private copy
and again from that snapshot; deterministic output growth is checked before
validator evidence is emitted.

## Error and observability contract

`GlbAdapterError` exposes a stable reason code and at most the configured number
of shared converter diagnostics. Messages contain no source URI or raw provider
text. The pipeline owns correlation IDs, timing, metrics, retries, and deadline
propagation; this pure adapter performs no network operation or retry.

## Unsupported paths

The implementation intentionally has no repair ledger, raw damaged-evidence
retention, URI resolver, decompressor, animation path, or JSON `.gltf` bundle
assembler. Those calls are rejected with stable codes rather than silently
being treated as strict GLB input.

Runtime adapter loading is also rejected until the released
`@plasius/gpu-model-core` contract can be returned. `ValidatedGlbArtifact` is a
format-boundary validation result, not a canonical model document.
