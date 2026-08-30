# Architecture decisions

Package boundary: @plasius/gpu-model-gltf.

The package family boundary and ownership decision is recorded in ADR 0094. Future package-specific architecture decisions belong in this directory and must preserve the canonical model conversion boundary.

The first implementation decision is
[ADR-0005: Strict self-contained GLB admission](./adr-0005-strict-self-contained-glb-admission.md).

The bounded canonical demonstration hand-off is recorded in
[ADR-0006: Bounded GLB to canonical demo import](./adr-0006-bounded-glb-to-canonical-demo-import.md).
