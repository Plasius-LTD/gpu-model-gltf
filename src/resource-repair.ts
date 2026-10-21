import {
  evaluateGpuModelDiagnostics,
  type GpuModelConversionViolation,
  type GpuModelDiagnosticMode,
  type GpuModelDiagnosticReport,
} from "@plasius/gpu-model-core";
import type { ModelConverterDiagnostic } from "@plasius/asset-contracts";
import type { ImportBudget } from "./resource-resolution.js";
import { gltfFormatInternals as format } from "./glb-adapter.js";
import {
  array,
  record,
  integer,
  fail,
  type JsonRecord,
} from "./resource-values.js";

/** @internal Only the core-approved finite non-negative skin-weight rule is applied. */
export async function repairSkinWeights(
  document: JsonRecord,
  binary: Uint8Array,
  budget: ImportBudget,
  mode: GpuModelDiagnosticMode,
  sourceContentHash: string,
): Promise<GpuModelDiagnosticReport> {
  const accessors = array(document.accessors),
    views = array(document.bufferViews);
  const candidates = new Set<number>(),
    otherRoles = new Set<number>();
  for (const mesh of array(document.meshes))
    for (const value of array(record(mesh).primitives)) {
      budget.check();
      const p = record(value);
      if (mode !== "strict" && record(p.attributes).WEIGHTS_1 !== undefined)
        fail(
          "unsupported-gltf-feature",
          "Weight repair requires one four-influence weight set; additional sets are outside this repair profile.",
        );
      for (const [semantic, index] of Object.entries(record(p.attributes))) {
        (semantic === "WEIGHTS_0" ? candidates : otherRoles).add(
          integer(index, 0, accessors.length - 1),
        );
      }
      if (p.indices !== undefined) otherRoles.add(integer(p.indices));
      for (const target of array(p.targets))
        for (const index of Object.values(record(target)))
          otherRoles.add(integer(index));
    }
  for (const skin of array(document.skins)) {
    const s = record(skin);
    if (s.inverseBindMatrices !== undefined)
      otherRoles.add(integer(s.inverseBindMatrices));
  }
  for (const animation of array(document.animations))
    for (const sampler of array(record(animation).samplers)) {
      const s = record(sampler);
      otherRoles.add(integer(s.input));
      otherRoles.add(integer(s.output));
    }
  const data = new DataView(
    binary.buffer,
    binary.byteOffset,
    binary.byteLength,
  );
  const issues: GpuModelConversionViolation[] = [];
  const writes: { offset: number; values: number[] }[] = [];
  for (const index of candidates) {
    budget.check();
    const a = record(accessors[index]);
    // A strict operation never repairs; Khronos retains responsibility for source validity.
    if (mode === "strict") continue;
    if (
      a.componentType !== 5126 ||
      a.type !== "VEC4" ||
      a.normalized === true ||
      a.sparse !== undefined ||
      a.bufferView === undefined
    )
      fail(
        "unsupported-gltf-feature",
        "Skin-weight repair is limited to dense unnormalized float32 vectors.",
      );
    const v = record(views[integer(a.bufferView, 0, views.length - 1)]);
    const offset = integer(v.byteOffset ?? 0) + integer(a.byteOffset ?? 0),
      stride = integer(v.byteStride ?? 16, 16),
      count = integer(a.count, 1);
    let modified = false;
    for (let row = 0; row < count; row++) {
      if ((row & 1023) === 0) budget.check();
      const start = offset + row * stride;
      const original = Array.from({ length: 4 }, (_, c) =>
        data.getFloat32(start + c * 4, true),
      );
      const sum = original.reduce((n, w) => n + w, 0);
      if (
        original.some((w) => !Number.isFinite(w) || w < 0) ||
        !Number.isFinite(sum) ||
        sum <= 0
      )
        fail(
          "unsupported-gltf-feature",
          "Non-finite, negative or zero-total skin weights cannot be repaired.",
        );
      if (Math.abs(sum - 1) <= 1e-6) continue;
      if (issues.length >= budget.limits.maxDiagnostics)
        fail(
          "document-resource-limit",
          "Required repairs exceed the complete repair-ledger budget.",
        );
      const path = `/accessors/${index}/values/${row}`;
      const normalized = original.map((w) => Math.fround(w / sum));
      if (normalized.some((w, c) => w === 0 && original[c]! > 0))
        fail(
          "unsupported-gltf-feature",
          "Skin-weight normalization would discard a positive influence.",
        );
      issues.push({
        kind: "violation",
        code: "gltf-skin-weights-normalized",
        ruleId: "non-normalized-weights",
        path,
        message:
          "Finite non-negative skin weights were normalized without discarding influences.",
        originalValue: original,
        repairApplied: true,
      });
      writes.push({ offset: start, values: normalized });
      modified = true;
    }
    if (!modified) continue;
    // In-place changes must not affect another semantic, including unused overlapping accessors.
    if (otherRoles.has(index))
      fail(
        "unsupported-gltf-feature",
        "Aliased skin-weight semantics cannot be repaired.",
      );
    const end = offset + (count - 1) * stride + 16;
    for (let j = 0; j < accessors.length; j++) {
      if ((j & 1023) === 0) budget.check();
      if (j === index) continue;
      const other = record(accessors[j]);
      if (other.bufferView === undefined) continue;
      const bv = record(views[integer(other.bufferView, 0, views.length - 1)]);
      const first = integer(bv.byteOffset ?? 0),
        last = first + integer(bv.byteLength, 1);
      if (first < end && last > offset)
        fail(
          "unsupported-gltf-feature",
          "Overlapping skin-weight buffer views cannot be repaired.",
        );
    }
  }
  const rawSource =
    mode === "forensic"
      ? {
          sourceContentHash,
          sourceBinaryContentHash: await budget.wait(format.sha256(binary)),
          // Retain raw damaged numerical fields, never source JSON, URI/name strings or provider text.
          weightRows: issues.map((i) => ({
            path: i.path,
            originalValue: i.originalValue,
          })),
        }
      : undefined;
  let report: GpuModelDiagnosticReport;
  try {
    report = evaluateGpuModelDiagnostics({
      standard: "gltf-glb",
      mode,
      issues,
      ...(rawSource === undefined ? {} : { rawSource }),
      maxEvidenceBytes: 65536,
    });
  } catch {
    fail(
      "document-resource-limit",
      "The core repair evidence exceeds its bounded policy.",
    );
  }
  if (!report.accepted)
    fail(
      "unsupported-gltf-feature",
      "The core repair policy refused the operation.",
    );
  budget.check();
  for (const write of writes)
    for (let c = 0; c < 4; c++)
      data.setFloat32(write.offset + c * 4, write.values[c]!, true);
  return report;
}

/** @internal Bounded safe shared findings; the core repair ledger remains complete. */
export function importDiagnostics(
  report: GpuModelDiagnosticReport,
  findings: readonly ModelConverterDiagnostic[],
  maximum: number,
): readonly ModelConverterDiagnostic[] {
  const diagnostics: ModelConverterDiagnostic[] = report.diagnostics.map((d) =>
    Object.freeze({
      severity: d.severity === "error" ? "blocking" : d.severity,
      code: d.code,
      message: d.message,
    }),
  );
  diagnostics.push(...findings);
  if (diagnostics.length > maximum) {
    diagnostics.length = maximum;
    diagnostics[maximum - 1] = Object.freeze({
      severity: "warning",
      code: "gltf-import-diagnostics-truncated",
      message:
        "Additional completed-validation findings were omitted; the separate core repair ledger is complete.",
    });
  }
  return Object.freeze(diagnostics);
}
