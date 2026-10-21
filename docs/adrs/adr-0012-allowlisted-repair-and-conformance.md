# ADR0012 — Core-owned repair and complete conformance

- Status: Accepted for implementation
- Date: 2026-10-21
- Work: gpu-model-gltf#17, parent site#1150; matrix site#1160; policy site#1158
- Flag: `gpu.model.conversion.enabled`, caller supplies the remote decision

## Problem

Successful resource-import and exact-export validator findings were discarded.
A warning-only truncated report cannot prove complete conformance. Generic
format-local repairs could drift from the canonical family policy in site
ADR0094 / Story1158 and duplicate released core contracts. Raw source retention
could expose authored URI, metadata or provider data unnecessarily.

## Decision

Add optional strict(default)/tolerant/forensic modes only to resource import.
Reuse core0.6.0 `evaluateGpuModelDiagnostics`, its allowlist and complete
`GpuModelRepairRecord`/`GpuModelDiagnosticReport`; published runtime/contracts
already fit. Narrow the core `non-normalized-weights` rule to dense unnormalized
float32 VEC4 WEIGHTS_0 rows with finite non-negative values and positive total.
Normalize a row if abs(sum-1)>1e-6, preserving every positive influence. Refuse
float32 underflow, zero/negative/nonfinite totals, other representations,
overlapping storage or shared accessor semantics. Repeated weight references
are processed once. Additional WEIGHTS_1 sets are refused explicitly rather than partially normalized.
Other malformed constructs remain errors; no rule is added.

Apply only after graph/feature/expanded-work/buffer/accessor admission, stage at
most100 bounded rows, obtain an accepted core report, then mutate private copied
binary storage. Exact final Khronos validation must pass. Preserve original
entry identity; normalized/output hashes describe changed bytes. The rule has
no declared loss or discarded influences; unknown/unsafe issues remain blocking.

Forensic mode retains bounded *partial* raw damaged source: the original numeric
weight fields and fixed paths, anchored by entry and assembled pre-repair
binary SHA256. It uses core's immutable owned rawSource snapshot with a stricter
64KiB ceiling. No source JSON/URI/name/metadata strings or provider text enter
this evidence, and no storage/logging occurs. It is deliberately not a full raw
package archive. This implements the relevant forensic recovery expectations
without creating a new evidence store or bypassing the published evaluator.
Failures expose controlled diagnostics, not partial canonical output. Strict
low-level GLB/static APIs retain their existing mode restrictions.

Each public finding list and complete core repair ledger is bounded100, caller
may tighten. More repairs fail. Public finding omission is explicit; the core
ledger remains complete. Canonical core diagnostics include safe findings plus
one canonicalization marker; raw forensic data stays outside canonical metadata
and exported interchange. Exact canonical exports expose shared safe findings.

Validation uses a separate hard100-issue ceiling, independent of presentation
limits. Reject truncated/malformed/inconsistent reports and consider all bounded
findings for adapter blocking overrides before truncating public diagnostics.
Do not mute issues or raise/unbound validator work. Locations allow only fixed
schema segments/numeric indices; raw messages and authored property names are
omitted.

## Alternatives

- A new missing-POSITION-bounds rule would require an owning-policy/contract
  extension. Reuse an already approved rule for this work instead.
- Generic normalization, dropping references or silently losing influences
  violates fidelity and core policy; rejected.
- Full raw source archive requires privacy, retention and acquisition governance
  beyond this package; only safe damaged numerical evidence is retained here.
- Unlimited validator findings violate bounded work; partial reports are not
  complete conformance evidence. Both rejected.

## Impact, tests and release

Minor package release through approved cd.yml main/production npm OIDC,
exact-SHA CI and public registry/provenance/consumer qualification. No dependency,
new package, feature flag or repair-rule change. Retain private core verification,
resolver ownership, lazy validator/JPEG loading and no-network/no-retry rules.
Saturated validation deliberately refuses even benign excessive findings.

Tests cover strict rejection versus actual repair, complete core fields, safe
forensic originals/hashes, unchanged caller buffers, alias/underflow refusals,
shared rows, findings/repair budgets, flags/deadline/cancellation and both export
layouts with material/deformation semantics. Removing incomplete-report guards
reproduces acceptance of warning-only incomplete validation; restoring them
rejects it. TDR0007 maps existing fixtures and NFRs. UI/SEO/backend deployment
are N/A. Rollback consumers to strict/default or disable remote conversion.
