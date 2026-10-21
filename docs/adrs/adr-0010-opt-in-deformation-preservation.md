# ADR0010: Opt-in bounded deformation preservation

Date: 2026-10-21. Status: Accepted. Project: gpu-model-gltf#15;
parent Feature site#1150, Epic#1147. Remote flag: `gpu.model.conversion.enabled`.

## Problem

The resource importer deliberately rejected skin, morph and animation data. Core
0.6.0 and bridge0.4.0 now provide released authored rest TRS, ordered node-instance
morph bindings and matching animation scalar arity. Encoding these solely as adapter
metadata would lose the shared canonical contract. Silently widening the existing
static profile would invalidate consumer assumptions and rollback qualification.

## Decision

Add explicit `profile: GLTF_DEFORMATION_IMPORT_PROFILE` to the existing importer.
The new literal is `gltf-deformation-resources-v1`. Omitted profile and the existing
strict/demo APIs retain their static rejection contracts. Public overloads retain
the default static result literal type. Adopt published core0.6.0 exactly and test
against published bridge0.4.0. Keep runtime, validator, codecs and renderer versions.
The renderer's test-only nested core0.5.0 serves its narrow mesh/material projection;
the canonical producer/bridge share the same0.6.0 instance and module format.

Reuse existing resource acquisition, immutable source-normalized GLB serialization,
Khronos validation, canonical packing and private core byte verification. A private
format module owns deformation admission/mapping; it adds no renderer-owned fields,
evaluator, network, resource cache or format/runtime registration.

Coordinate reflection S=diag(1,1,-1,1) maps matrices to S*M*S, translation and morph
VEC3 Z to -Z, and quaternion(x,y,z,w) to(-x,-y,z,w). Scale and scalar weights remain
unchanged. Apply the same linear map to every cubic tangent, preserving authored
quaternion signs. The global floor-centred root moves joint and mesh nodes together.
Bounds remain the base-geometry envelope and are not animated/deformed bounds.

Skins preserve ordered joints and inverse matrices, defaulting absent matrices to
identity. Each skin owns a canonical skeleton/joint set, permitting glTF joint nodes
to be reused by different skins without conflicting core ownership. Parent-joint
links follow nearest ancestors, retaining intermediary scene nodes and node-local
rest TRS. Vertex influences remain paired contiguous JOINTS_n/WEIGHTS_n, verified
against the canonical accessor bytes; never renormalize or drop weights. Canonical
joints use u16, other attributes f32 and indices u32. Morph target order spans all
primitives and supplies complete effective weights independently for each instance.

## Supported boundary and alternatives

Dense triangles; TRS joint rest poses; POSITION/NORMAL/TANGENT morph deltas; finite
signed morph defaults; node translation/rotation/scale/weights animation using
float STEP/LINEAR/CUBICSPLINE are admitted. Shared samplers require identical path
semantics and morph arity. Explicit refusal covers unsupported sparse/compressed
constructs, matrix-authored joint rest poses, extra inverse matrices, unbound skins,
unused samplers, other morph semantics/interpolations/target paths and other inherited
unsupported features. Extra IBMs and unused samplers are legal in wider glTF, but
cannot be silently discarded into core's narrower exactly-bound contract.

Matrix decomposition was rejected because signed/zero scales and authored quaternion
sign cannot be recovered unambiguously. Metadata-only skin/animation storage,
permissive static fallback, local/unpublished packages, core-brand bypasses, renderer
upgrades and an implicit profile expansion were rejected. Canonical edit export is
separately tracked in#16; source normalization here preserves admitted source data.
Final wider conformance/repair remains#17, consumer cutover gpu-shared#55.

## Work and release consequences

Preflight caps expanded morph/animation references and per-skin duplicated weight
arrays before I/O or Khronos. Existing aggregate geometry/byte ceilings also include
this work; new entity/binding/value limits only tighten. Memoized nearest-joint
lookup bounds traversal per skin. Parsing/decoding/core validation are synchronous
bounded calls; consumers should use a worker for large assets. See TDR0005 for exact
limits, fixture/NFR evidence, supported exclusions and release procedure.

Add positive/hostile/source-roundtrip/flag/abort/limit/byte-equivalence fixtures,
retain all static tests, require80%+ coverage and changed sources in LCOV. README
and Unreleased changelog describe selection and rollback. Deliver the additive minor
through PR/exact-SHA CI, workflow-generated version PR and approved main/production
cd.yml npm OIDC. Verify registry provenance and installed consumers before adoption.
No UI, entitlement, site or backend deployment is part of this package task.
