# TDR-0002: ChatGPT Static GLB Import

- Status: Implemented for the bounded demonstration profile
- Date: 2026-08-24
- Architecture: ADR-0006, site Story `plasius-ltd-site#2094`
- Predecessor foundation: Task `gpu-model-gltf#1`, ADR-0005, TDR-0001

## Processing sequence

1. Validate the options object, positive remote parent and GLB-converter flags,
   and non-raiseable 16 MiB/200,000-triangle ceilings.
2. Run the predecessor strict GLB parser, local resource checks, deterministic
   export, and pinned Khronos validation.
3. Re-open only that privately produced deterministic GLB through captured
   native Blob intrinsics in 64-KiB deadline-checked chunks, then locate its
   exact embedded buffer. No URI or resource resolver is consulted.
4. Require one selected scene and validate that every node, mesh, accessor, and
   bufferView is represented by the admitted static geometry.
5. Plan every triangle primitive and count scene instances before allocating
   canonical buffers. Store plans by mesh and stop at the configured ceiling;
   never rescan all primitives for every node.
6. Repack used dense accessors in source-index order. Reflect local Z for
   positions/normals, normalize authored normals, and swap triangle corners 1
   and 2 in every explicit index triplet. Cache each accessor decoder and
   require complete POSITION index coverage so validation work cannot multiply
   over unreferenced payloads.
7. Convert node transforms with `C × M × C`, where `C = diag(1,1,-1,1)`, which
   preserves hierarchy, instancing, and determinant semantics in the canonical
   basis.
8. Measure complete instanced bounds and prepend a translation-only
   floor/centre node.
9. SHA-256 hash the packed buffer and independently stream-consume, inspect,
   and digest it through the core verification port.
10. Create the canonical document, then the static demo compiler projection.
    A core rejection is surfaced as a bounded adapter failure.
11. Runtime loading independently compares its resolved source hash and returns
    the same document/projection pair without using the resolver.

## Resource and failure policy

The parser and canonical output share a 16 MiB ceiling. JSON, entity counts,
working-set estimates, accessor elements, node/mesh/primitive/material counts,
and verification time are separately bounded. Local, world, and normalized
coordinates use the shared 1,048,576-metre absolute PVOX ceiling. Callers can
tighten limits but cannot raise them. Decode, repacking, hierarchy, bounds,
hashing, and core verification share a fixed 30-second deadline and observe the
supplied abort signal between bounded work chunks.

Errors expose stable reason codes and generic bounded messages. Source names,
provider strings, URLs, embedded extras, and raw bytes are not included in the
canonical document or diagnostics. There is no retry or network behavior in
this package. Root rig metadata and mesh/node morph markers fail before their
nested payloads are semantically expanded; primitive-instance accounting stops
at the world-triangle ceiling before full node-by-primitive fan-out.

## Deliberate limitations

This path is a demonstration compiler input, not general-purpose glTF import.
It does not bake textures, repair malformed geometry, infer rights, process
animation, emit PVOX, render confirmation views, promote a catalog asset, or
implement native sparse-field traversal.
