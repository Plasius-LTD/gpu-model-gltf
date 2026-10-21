import { describe, expect, it, vi } from "vitest";
import {
  importGltfToGpuModelDocument,
  exportGpuModelToGltf,
  validateAndExportGlb,
} from "../src/index.js";
import {
  fixture,
  extended,
  options,
  encoder,
  glb,
  resolver,
  code,
} from "./material-fixture.js";
import { rig, rigBytes, rigOptions } from "./deformation-fixture.js";
import { createGpuModelDocument } from "@plasius/gpu-model-core";
import {
  gltfFormatInternals as internals,
  DEFAULT_GLB_LIMITS,
} from "../src/glb-adapter.js";
const bytes = (f: ReturnType<typeof fixture>) =>
  encoder.encode(JSON.stringify(f.json));
function damaged(interpolation = "LINEAR") {
  const f = rig(interpolation),
    index = f.json.meshes[0].primitives[0].attributes.WEIGHTS_0;
  const a = f.json.accessors[index],
    v = f.json.bufferViews[a.bufferView],
    offset = v.byteOffset ?? 0;
  new DataView(f.bytes.buffer).setFloat32(offset, 1.5, true);
  new DataView(f.bytes.buffer).setFloat32(offset + 4, 0.5, true);
  return { f, index, offset };
}
describe("core-owned allowlisted skin-weight repair", () => {
  it.each([undefined, "strict"] as const)(
    "keeps %s import strict",
    async (mode) => {
      const { f } = damaged();
      await expect(
        importGltfToGpuModelDocument(rigBytes(f), { ...rigOptions(f), mode }),
      ).rejects.toSatisfy(code("gltf-spec-validation-failed"));
    },
  );
  it.each(["gltf", "glb"])(
    "repairs %s finite weights with complete core records and exact original identity",
    async (layout) => {
      const { f, index } = damaged(),
        input =
          layout === "gltf"
            ? rigBytes(f)
            : glb(
                { ...f.json, buffers: [{ byteLength: f.bytes.length }] },
                f.bytes,
              ),
        saved = input.slice(),
        binary = f.bytes.slice();
      const out = await importGltfToGpuModelDocument(input, {
        ...rigOptions(f),
        mode: "tolerant",
      });
      expect(input).toEqual(saved);
      expect(f.bytes).toEqual(binary);
      expect(out.mode).toBe("tolerant");
      expect(out.repairs).toEqual([
        {
          ruleId: "non-normalized-weights",
          originalValue: [1.5, 0.5, 0, 0],
          action: "Normalize finite non-negative skin weights.",
          severity: "warning",
          affectedPath: `/accessors/${index}/values/0`,
          confidence: "high",
        },
      ]);
      expect(out.diagnosticReport.accepted).toBe(true);
      expect(out.document.skins[0]!.weightSets[0]!.weights[0]).toEqual([
        0.75, 0.25, 0, 0,
      ]);
      expect(out.diagnosticReport.losses).toEqual([]);
      expect(Object.isFrozen(out.repairs)).toBe(true);
      expect(Object.isFrozen(out.repairs[0]?.originalValue)).toBe(true);
      expect(out.sourceContentHash).toBe(
        Buffer.from(await crypto.subtle.digest("SHA-256", saved)).toString(
          "hex",
        ),
      );
      expect(
        out.diagnostics.some((d) => d.code === "gltf-skin-weights-normalized"),
      ).toBe(true);
      expect(
        out.document.diagnostics.some(
          (d) => d.code === "gltf-skin-weights-normalized",
        ),
      ).toBe(true);
      expect(Object.hasOwn(out.diagnosticReport, "rawSource")).toBe(false);
    },
  );
  it("retains only bounded original numeric damaged fields in forensic mode", async () => {
    const { f, index } = damaged();
    f.json.nodes[0].name = "private-content-canary";
    const out = await importGltfToGpuModelDocument(rigBytes(f), {
      ...rigOptions(f),
      mode: "forensic",
    });
    expect(out.mode).toBe("forensic");
    expect(out.diagnosticReport.rawSource).toEqual({
      sourceContentHash: out.sourceContentHash,
      sourceBinaryContentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      weightRows: [
        {
          path: `/accessors/${index}/values/0`,
          originalValue: [1.5, 0.5, 0, 0],
        },
      ],
    });
    expect(JSON.stringify(out.diagnosticReport)).not.toMatch(
      /private-content-canary|mesh.bin|pixel.png/,
    );
    expect(Object.isFrozen(out.diagnosticReport.rawSource)).toBe(true);
  });
  it.each(["tolerant", "forensic"] as const)(
    "records no invented repairs for valid %s input",
    async (mode) => {
      const f = rig();
      const out = await importGltfToGpuModelDocument(rigBytes(f), {
        ...rigOptions(f),
        mode,
      });
      expect(out.repairs).toEqual([]);
      expect(out.diagnosticReport.accepted).toBe(true);
    },
  );
  it("does not double repair weights referenced by multiple nodes or primitives", async () => {
    const { f } = damaged();
    f.json.meshes[0].primitives.push(
      structuredClone(f.json.meshes[0].primitives[0]),
    );
    const out = await importGltfToGpuModelDocument(rigBytes(f), {
      ...rigOptions(f),
      mode: "tolerant",
    });
    expect(out.repairs).toHaveLength(1);
  });
  it("reads strided and offset weight rows without changing padding", async () => {
    const { f, index, offset } = damaged();
    const start = Math.ceil(f.bytes.length / 4) * 4;
    const data = new Uint8Array(start + 64);
    data.set(f.bytes);
    for (let row = 0; row < 3; row++)
      data.set(
        f.bytes.subarray(offset + row * 16, offset + row * 16 + 16),
        start + 4 + row * 20,
      );
    f.bytes = data;
    f.json.buffers[0].byteLength = data.length;
    f.json.bufferViews[f.json.accessors[index].bufferView] = {
      buffer: 0,
      byteOffset: start,
      byteLength: 60,
      byteStride: 20,
      target: 34962,
    };
    f.json.accessors[index].byteOffset = 4;
    const out = await importGltfToGpuModelDocument(rigBytes(f), {
      ...rigOptions(f),
      mode: "tolerant",
    });
    expect(out.document.skins[0]!.weightSets[0]!.weights[0]).toEqual([
      0.75, 0.25, 0, 0,
    ]);
    expect(out.repairs).toHaveLength(1);
  });
  it.each([
    "negative",
    "zero",
    "nonfinite",
    "integer",
    "overlap",
    "alias",
    "missing-bounds",
    "quaternion",
    "underflow",
  ])("refuses %s rather than inventing a repair", async (kind) => {
    const { f, index, offset } = damaged(),
      data = new DataView(f.bytes.buffer);
    if (kind === "negative") data.setFloat32(offset, -1, true);
    if (kind === "zero")
      for (let c = 0; c < 4; c++) data.setFloat32(offset + c * 4, 0, true);
    if (kind === "nonfinite") data.setFloat32(offset, Infinity, true);
    if (kind === "integer") f.json.accessors[index].componentType = 5123;
    if (kind === "overlap")
      f.json.accessors.push(structuredClone(f.json.accessors[index]));
    if (kind === "alias") f.json.animations[0].samplers[1].output = index;
    if (kind === "missing-bounds") delete f.json.accessors[0].min;
    if (kind === "quaternion") f.json.nodes[0].rotation = [0, 0, 0, 2];
    if (kind === "underflow") {
      data.setFloat32(offset, 1e-45, true);
      data.setFloat32(offset + 4, 3e38, true);
    }
    await expect(
      importGltfToGpuModelDocument(rigBytes(f), {
        ...rigOptions(f),
        mode: "tolerant",
      }),
    ).rejects.toBeDefined();
  });
  it("preserves low-level tolerant/forensic refusals and rejects unknown resource mode before I/O", async () => {
    const f = fixture();
    const input = glb(
      { ...f.json, buffers: [{ byteLength: f.bytes.length }] },
      f.bytes,
    );
    for (const mode of ["tolerant", "forensic"] as const)
      await expect(validateAndExportGlb(input, { mode })).rejects.toSatisfy(
        code("unsupported-adapter-mode"),
      );
    const o = options(f);
    await expect(
      importGltfToGpuModelDocument(bytes(f), {
        ...o,
        mode: "unknown" as "strict",
      }),
    ).rejects.toSatisfy(code("unsupported-adapter-mode"));
    expect(o.resourceResolver.resolve).not.toHaveBeenCalled();
  });
  it("bounds complete repair records and public diagnostics separately", async () => {
    const { f, offset } = damaged(),
      data = new DataView(f.bytes.buffer);
    data.setFloat32(offset + 16, 1.5, true);
    data.setFloat32(offset + 20, 0.5, true);
    await expect(
      importGltfToGpuModelDocument(rigBytes(f), {
        ...rigOptions(f),
        mode: "tolerant",
        limits: { maxDiagnostics: 1 },
      }),
    ).rejects.toSatisfy(code("document-resource-limit"));
    const one = damaged();
    one.f.json.accessors.push(structuredClone(one.f.json.accessors[0]));
    const out = await importGltfToGpuModelDocument(rigBytes(one.f), {
      ...rigOptions(one.f),
      mode: "tolerant",
      limits: { maxDiagnostics: 1 },
    });
    expect(out.repairs).toHaveLength(1);
    expect(out.diagnostics).toHaveLength(1);
    expect(out.diagnostics[0]?.code).toBe("gltf-import-diagnostics-truncated");
    await expect(
      importGltfToGpuModelDocument(rigBytes(one.f), {
        ...rigOptions(one.f),
        limits: { maxDiagnostics: 101 },
      }),
    ).rejects.toSatisfy(code("invalid-limits"));
  });
  it("checks disabled, byte/entity budgets, cancellation and a hung provider deadline", async () => {
    for (const limits of [
      { maxInputBytes: 1 },
      { maxGeometryElements: 1 },
      { maxNodes: 1 },
    ]) {
      const { f } = damaged(),
        o = rigOptions(f);
      await expect(
        importGltfToGpuModelDocument(rigBytes(f), {
          ...o,
          mode: "tolerant",
          limits,
        }),
      ).rejects.toBeDefined();
      expect(o.resourceResolver.resolve).not.toHaveBeenCalled();
    }
    const { f } = damaged(),
      o = rigOptions(f),
      c = new AbortController();
    c.abort();
    await expect(
      importGltfToGpuModelDocument(rigBytes(f), {
        ...o,
        mode: "tolerant",
        signal: c.signal,
      }),
    ).rejects.toSatisfy(code("aborted"));
    await expect(
      importGltfToGpuModelDocument(rigBytes(f), {
        ...o,
        mode: "tolerant",
        conversionEnabled: false,
      }),
    ).rejects.toSatisfy(code("feature-disabled"));
    const hung = { resolve: vi.fn(() => new Promise<never>(() => {})) };
    await expect(
      importGltfToGpuModelDocument(rigBytes(f), {
        ...o,
        mode: "tolerant",
        resourceResolver: hung,
        limits: { timeoutMs: 20 },
      }),
    ).rejects.toSatisfy(code("processing-time-limit"));
    const a = new AbortController(),
      work = importGltfToGpuModelDocument(rigBytes(f), {
        ...o,
        mode: "forensic",
        resourceResolver: hung,
        signal: a.signal,
      });
    a.abort();
    await expect(work).rejects.toSatisfy(code("aborted"));
  });
  it("never echoes source/provider strings on repair failure", async () => {
    const { f } = damaged();
    f.json.buffers[0].uri = "private-canary.bin";
    const e = await importGltfToGpuModelDocument(rigBytes(f), {
      ...rigOptions(f),
      mode: "forensic",
    }).catch((e) => e);
    expect(JSON.stringify(e)).not.toMatch(/private-canary|PRIVATE provider/);
  });
});
describe("complete bounded Khronos evidence", () => {
  it("refuses actual incomplete validation even when all reported issues are nonblocking", async () => {
    const f = fixture();
    for (let i = 0; i < 105; i++)
      f.json.accessors.push(structuredClone(f.json.accessors[0]));
    const e = await importGltfToGpuModelDocument(bytes(f), options(f)).catch(
      (e) => e,
    );
    expect(e.code).toBe("gltf-spec-validation-failed");
    expect(e.diagnostics).toEqual([
      expect.objectContaining({
        code: "gltf-validation-incomplete",
        severity: "blocking",
      }),
    ]);
  });
  it.each(["glb", "gltf"] as const)(
    "refuses incomplete exact %s package validation",
    async (format) => {
      const f = fixture();
      const original = (
        await importGltfToGpuModelDocument(bytes(f), options(f))
      ).document;
      const document = createGpuModelDocument({
        ...original,
        materials: Array.from({ length: 110 }, (_, i) => ({
          ...original.materials[0]!,
          id: i === 0 ? original.materials[0]!.id : `unused-material-${i}`,
        })),
      });
      const e = await exportGpuModelToGltf(document, {
        conversionEnabled: true,
        format,
      }).catch((e) => e);
      expect(e.code).toBe("gltf-spec-validation-failed");
      expect(e.diagnostics[0].code).toBe("gltf-validation-incomplete");
    },
  );
  const complete = () => ({
    issues: {
      numErrors: 0,
      numWarnings: 0,
      numInfos: 0,
      numHints: 0,
      messages: [] as unknown[],
      truncated: false,
    },
  });
  it.each(["missing", "negative", "messages", "count", "overbound"])(
    "rejects %s report evidence",
    (kind) => {
      const r = complete();
      if (kind === "missing")
        delete (r.issues as Partial<typeof r.issues>).truncated;
      if (kind === "negative") r.issues.numErrors = -1;
      if (kind === "messages")
        (r.issues as { messages: unknown }).messages = null;
      if (kind === "count") r.issues.numErrors = 1;
      if (kind === "overbound") {
        r.issues.numInfos = 101;
        r.issues.messages = Array.from({ length: 101 }, () => ({
          severity: 2,
          code: "TEST",
        }));
      }
      expect(() =>
        internals.validateKhronosReport(r, DEFAULT_GLB_LIMITS, "test"),
      ).toThrow();
    },
  );
  it("does not let a tightened reporting limit hide an adapter-blocking validator finding", () => {
    const r = complete();
    r.issues.numInfos = 2;
    r.issues.messages = [
      { severity: 2, code: "UNUSED_OBJECT" },
      { severity: 2, code: "IMAGE_UNRECOGNIZED_FORMAT" },
    ];
    let failure: unknown;
    try {
      internals.validateKhronosReport(
        r,
        { ...DEFAULT_GLB_LIMITS, maxDiagnostics: 1 },
        "test",
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: "gltf-spec-validation-failed",
      diagnostics: [
        {
          severity: "blocking",
          code: "gltf-image-unrecognized-format",
          message: expect.any(String),
        },
      ],
    });
  });
  it.each(["/PRIVATE token", "/materials/0/private-canary"])(
    "omits raw validator text and authored pointer %s",
    (pointer) => {
      const r = complete();
      r.issues.numWarnings = 1;
      r.issues.messages = [
        {
          severity: 1,
          code: "SAFE_CODE",
          pointer,
          message: "PRIVATE provider token URL",
        },
      ];
      const out = internals.validateKhronosReport(
        r,
        DEFAULT_GLB_LIMITS,
        "test",
      );
      expect(JSON.stringify(out)).not.toMatch(
        /PRIVATE|provider|token|private-canary/,
      );
      expect(out.diagnostics[0]?.message).toContain("the document");
    },
  );
});

describe("shared conformance matrix", () => {
  it.each(["STEP", "LINEAR", "CUBICSPLINE"])(
    "preserves repaired %s material/animation meaning in both exact layouts",
    async (interpolation) => {
      const { f } = damaged(interpolation),
        imported = await importGltfToGpuModelDocument(rigBytes(f), {
          ...rigOptions(f),
          mode: "tolerant",
        });
      for (const format of ["glb", "gltf"] as const) {
        const out = await exportGpuModelToGltf(imported.document, {
            conversionEnabled: true,
            format,
          }),
          again = await exportGpuModelToGltf(imported.document, {
            conversionEnabled: true,
            format,
          });
        expect(out.resources.map((r) => r.contentHash)).toEqual(
          again.resources.map((r) => r.contentHash),
        );
        const files = Object.fromEntries(
          await Promise.all(
            out.resources.map(async (r) => [
              r.path,
              new Uint8Array(await r.payload.arrayBuffer()),
            ]),
          ),
        );
        const back = await importGltfToGpuModelDocument(
          files[out.entryPoint]!,
          {
            conversionEnabled: true,
            profile: "gltf-deformation-resources-v1",
            resourceResolver: resolver(files),
          },
        );
        expect(back.mode).toBe("strict");
        expect(back.repairs).toEqual([]);
        expect(back.validator.version).toBe("2.0.0-dev.3.10");
        expect(
          back.document.materials.map((m) => [m.baseColorFactor, m.extensions]),
        ).toEqual(
          imported.document.materials.map((m) => [
            m.baseColorFactor,
            m.extensions,
          ]),
        );
        expect(back.document.textures.map((t) => t.contentHash)).toEqual(
          imported.document.textures.map((t) => t.contentHash),
        );
        const tracks = (d: typeof back.document) =>
          d.animations.map((a) =>
            a.samplers.map((s) => [
              s.interpolation,
              s.inputTimesSeconds,
              s.outputValues,
            ]),
          );
        expect(tracks(back.document)).toEqual(tracks(imported.document));
        expect(back.document.blendShapes.map((b) => b.defaultWeight)).toEqual(
          imported.document.blendShapes.map((b) => b.defaultWeight),
        );
      }
    },
  );
  it("surfaces safe successful validator findings", async () => {
    const f = extended();
    f.json.accessors.push(structuredClone(f.json.accessors[0]));
    const out = await importGltfToGpuModelDocument(bytes(f), options(f));
    expect(out.diagnostics.length).toBeGreaterThan(0);
    expect(out.document.diagnostics.length).toBeGreaterThan(1);
  });
});
