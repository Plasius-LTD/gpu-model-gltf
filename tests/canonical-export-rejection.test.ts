import { describe, expect, it, vi } from "vitest";
import {
  createGpuModelDocument,
  type GpuModelDocument,
} from "@plasius/gpu-model-core";
import {
  exportGpuModelToGltf,
  importGltfToGpuModelDocument,
} from "../src/index.js";
import { rig, rigBytes, rigOptions, identity } from "./deformation-fixture.js";
import { code, encoder, fixture, options } from "./material-fixture.js";
const source = async () => {
  const f = rig();
  return (await importGltfToGpuModelDocument(rigBytes(f), rigOptions(f)))
    .document;
};
const mutateMaterial = (
  d: GpuModelDocument,
  change: Record<string, unknown>,
) => ({ ...d, materials: d.materials.map((m) => ({ ...m, ...change })) });

describe("canonical export refusal and bounded work", () => {
  it.each([
    [
      "workflow",
      (d: GpuModelDocument) => mutateMaterial(d, { workflow: "custom" }),
    ],
    [
      "unknown extension",
      (d: GpuModelDocument) =>
        mutateMaterial(d, { extensions: { UNKNOWN: {} } }),
    ],
    [
      "extension property",
      (d: GpuModelDocument) =>
        mutateMaterial(d, {
          extensions: { KHR_materials_ior: { ior: 1.5, unknown: 2 } },
        }),
    ],
    [
      "workflow conflict",
      (d: GpuModelDocument) =>
        mutateMaterial(d, { extensions: { KHR_materials_unlit: {} } }),
    ],
    [
      "sampler filter",
      (d: GpuModelDocument) => ({
        ...d,
        textures: d.textures.map((t) => ({
          ...t,
          sampler: { ...t.sampler!, minFilter: "invalid" },
        })),
      }),
    ],
    [
      "joint rest mismatch",
      (d: GpuModelDocument) => ({
        ...d,
        joints: d.joints.map((j) => ({
          ...j,
          restLocalTransform: {
            ...j.restLocalTransform,
            translation: [42, 0, 0],
          },
        })),
      }),
    ],
    [
      "joint name mismatch",
      (d: GpuModelDocument) => ({
        ...d,
        joints: d.joints.map((j) => ({ ...j, name: "different" })),
      }),
    ],
    [
      "tail duration",
      (d: GpuModelDocument) => ({
        ...d,
        animations: d.animations.map((a) => ({ ...a, durationSeconds: 2 })),
      }),
    ],
    [
      "morph order ambiguity",
      (d: GpuModelDocument) => ({
        ...d,
        nodes: d.nodes.map((n) => ({
          ...n,
          ...(n.morphWeights
            ? { morphWeights: [...n.morphWeights].reverse() }
            : {}),
        })),
      }),
    ],
    [
      "partial target names",
      (d: GpuModelDocument) => ({
        ...d,
        blendShapes: d.blendShapes.map((s, i) =>
          i
            ? Object.fromEntries(
                Object.entries(s).filter(([k]) => k !== "name"),
              )
            : s,
        ),
      }),
    ],
    [
      "blocked diagnostics",
      (d: GpuModelDocument) => ({
        ...d,
        diagnostics: [
          { severity: "error", code: "synthetic", message: "PRIVATE fixture" },
        ],
      }),
    ],
    [
      "analytic geometry",
      (d: GpuModelDocument) => ({
        ...d,
        analyticGeometry: [
          {
            id: "analytic",
            kind: "brep-placeholder",
            sourceResourceId: d.resources[0]!.id,
            sourceUnit: "metre",
          },
        ],
      }),
    ],
  ] as const)(
    "rejects %s explicitly with sanitized diagnostics",
    async (_name, mutate) => {
      const document = createGpuModelDocument(mutate(await source()));
      const read = vi.spyOn(Blob.prototype, "arrayBuffer");
      try {
        await expect(
          exportGpuModelToGltf(document, { conversionEnabled: true }),
        ).rejects.toSatisfy(code("unsupported-gltf-feature"));
      } finally {
        read.mockRestore();
      }
    },
  );
  it("charges morph accessor components and node bindings before payload reads", async () => {
    const original = await source();
    const document = createGpuModelDocument({
      ...original,
      skeletons: [],
      joints: [],
      skins: [],
      animations: [],
      nodes: original.nodes.map((n) =>
        Object.fromEntries(Object.entries(n).filter(([k]) => k !== "skinId")),
      ),
      meshes: original.meshes.map((m) => ({
        ...m,
        primitives: m.primitives.map((p) => ({
          ...p,
          attributes: p.attributes.filter(
            (a) =>
              !a.semantic.startsWith("JOINTS_") &&
              !a.semantic.startsWith("WEIGHTS_"),
          ),
        })),
      })),
    });
    const read = vi.spyOn(Blob.prototype, "arrayBuffer");
    try {
      await expect(
        exportGpuModelToGltf(document, {
          conversionEnabled: true,
          limits: { maxDeformationElements: 16 },
        }),
      ).rejects.toSatisfy(code("document-resource-limit"));
      expect(read).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  });
  it.each(["cancel", "deadline"])(
    "races an uncooperative immutable-payload read on %s",
    async (kind) => {
      const d = await source(),
        c = new AbortController();
      const spy = vi
        .spyOn(Blob.prototype, "arrayBuffer")
        .mockImplementation(() => new Promise(() => {}));
      try {
        const work = exportGpuModelToGltf(d, {
          conversionEnabled: true,
          signal: c.signal,
          limits: { timeoutMs: 20 },
        });
        const assertion = expect(work).rejects.toSatisfy(
          code(kind === "cancel" ? "aborted" : "processing-time-limit"),
        );
        if (kind === "cancel") setTimeout(() => c.abort(), 1);
        await assertion;
      } finally {
        spy.mockRestore();
      }
    },
  );
  it.each([
    "maxGeometryElements",
    "maxResources",
    "maxNodes",
    "maxDeformationElements",
    "maxJoints",
    "maxMorphTargets",
    "maxMorphBindings",
    "maxAnimationSamplers",
    "maxAnimationChannels",
    "maxAggregateBytes",
    "maxResourceBytes",
  ] as const)(
    "rejects tightened %s before reading payload bytes",
    async (key) => {
      const d = await source();
      const read = vi.spyOn(Blob.prototype, "arrayBuffer");
      try {
        await expect(
          exportGpuModelToGltf(d, {
            conversionEnabled: true,
            limits: { [key]: 1 },
          }),
        ).rejects.toSatisfy(code("document-resource-limit"));
        expect(read).not.toHaveBeenCalled();
      } finally {
        read.mockRestore();
      }
    },
  );
  it("leaves disabled discovery inert and permits subsequent enablement without a fallback rewrite", async () => {
    const d = await source();
    const read = vi.spyOn(Blob.prototype, "arrayBuffer");
    try {
      await expect(
        exportGpuModelToGltf(d, { conversionEnabled: false }),
      ).rejects.toSatisfy(code("feature-disabled"));
      expect(read).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
    expect(
      (await exportGpuModelToGltf(d, { conversionEnabled: true })).entryPoint,
    ).toBe("model.glb");
  });
  it("rejects an untyped missing decision and unknown limits", async () => {
    const d = await source();
    await expect(exportGpuModelToGltf(d, undefined as never)).rejects.toSatisfy(
      code("invalid-adapter-options"),
    );
    await expect(
      exportGpuModelToGltf(d, {
        conversionEnabled: true,
        limits: { unknown: 1 } as never,
      }),
    ).rejects.toSatisfy(code("invalid-limits"));
  });
  it.each([9728, 9729, 9984, 9985, 9986, 9987])(
    "preserves minification filter %s with a default or explicit sampler",
    async (filter) => {
      const f = fixture();
      f.json.samplers = [
        { minFilter: filter, magFilter: 9728, wrapS: 33648, wrapT: 33071 },
      ];
      f.json.textures[0].sampler = 0;
      const d = (
        await importGltfToGpuModelDocument(
          encoder.encode(JSON.stringify(f.json)),
          options(f),
        )
      ).document;
      const out = await exportGpuModelToGltf(d, {
        conversionEnabled: true,
        format: "gltf",
      });
      const json = JSON.parse(await out.resources[0]!.payload.text());
      expect(json.samplers[0]).toEqual(f.json.samplers[0]);
    },
  );
  it("preserves unlit factors, no-texture materials, nonindexed winding and current node transforms", async () => {
    const f = fixture();
    delete f.json.meshes[0].primitives[0].indices;
    f.json.materials = [
      {
        name: "unlit",
        extensions: { KHR_materials_unlit: {} },
        alphaMode: "MASK",
        alphaCutoff: 0.25,
        doubleSided: true,
        pbrMetallicRoughness: { baseColorFactor: [0.2, 0.3, 0.4, 0.5] },
      },
    ];
    f.json.extensionsUsed = ["KHR_materials_unlit"];
    delete f.json.images;
    delete f.json.textures;
    const original = (
      await importGltfToGpuModelDocument(
        encoder.encode(JSON.stringify(f.json)),
        options(f),
      )
    ).document;
    const d = createGpuModelDocument({
      ...original,
      textures: [],
      meshes: original.meshes.map((m) => ({
        ...m,
        primitives: m.primitives.map((p) =>
          Object.fromEntries(
            Object.entries(p).filter(([k]) => k !== "indicesAccessorId"),
          ),
        ),
      })),
      nodes: original.nodes.map((n, i) => (i ? { ...n, name: "edited" } : n)),
    });
    const out = await exportGpuModelToGltf(d, {
      conversionEnabled: true,
      format: "gltf",
    });
    const json = JSON.parse(await out.resources[0]!.payload.text());
    expect(json.nodes[1].name).toBe("edited");
    expect(json.materials[0].extensions).toEqual({ KHR_materials_unlit: {} });
    expect(json.materials[0].alphaCutoff).toBe(0.25);
    expect(json.nodes[0].matrix).toEqual(
      identity.map((n, i) =>
        i === 12 ? -11 : i === 13 ? -3 : i === 14 ? -5 : n,
      ),
    );
  });
});
