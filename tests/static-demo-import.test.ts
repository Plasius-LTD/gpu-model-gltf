import { describe, expect, it } from "vitest";
import {
  GPU_MODEL_STATIC_DEMO_MAX_ABSOLUTE_COORDINATE_METRES,
  isGpuModelDocument,
} from "@plasius/gpu-model-core";
import {
  GLB_STATIC_DEMO_CONVERTER_FEATURE_FLAG,
  GLB_STATIC_DEMO_FEATURE_FLAG,
  GLB_STATIC_DEMO_IMPORTER_VERSION,
  GLB_STATIC_DEMO_MAX_ABSOLUTE_COORDINATE_METRES,
  GlbAdapterError,
  glbAdapter,
  importGlbToGpuModelDocument,
} from "../src/index.js";

type JsonRecord = Record<string, unknown>;

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

function align4(value: number): number {
  return (value + 3) & ~3;
}

function encodeChunk(type: number, payload: Uint8Array): Uint8Array {
  const paddedLength = align4(payload.byteLength);
  const output = new Uint8Array(8 + paddedLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, paddedLength, true);
  view.setUint32(4, type, true);
  output.set(payload, 8);
  output.fill(type === JSON_CHUNK ? 0x20 : 0, 8 + payload.byteLength);
  return output;
}

function createGlb(document: JsonRecord, binary: Uint8Array): Uint8Array {
  const chunks = [
    encodeChunk(JSON_CHUNK, new TextEncoder().encode(JSON.stringify(document))),
    encodeChunk(BIN_CHUNK, binary),
  ];
  const byteLength = 12 + chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const output = new Uint8Array(byteLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, byteLength, true);
  let offset = 12;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function triangleGlb(overrides: JsonRecord = {}, indices: readonly number[] = [0, 1, 2]): Uint8Array {
  const bytes = new Uint8Array(78);
  const view = new DataView(bytes.buffer);
  const positions = [0, 0, 1, 2, 0, 1, 0, 2, 1];
  const normals = [0, 0, 1, 0, 0, 1, 0, 0, 1];
  positions.forEach((value, index) => view.setFloat32(index * 4, value, true));
  normals.forEach((value, index) => view.setFloat32(36 + index * 4, value, true));
  indices.forEach((value, index) => view.setUint16(72 + index * 2, value, true));
  const document: JsonRecord = {
    asset: { version: "2.0", generator: "Plasius bounded demo fixture" },
    buffers: [{ byteLength: bytes.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
      { buffer: 0, byteOffset: 36, byteLength: 36, target: 34962 },
      { buffer: 0, byteOffset: 72, byteLength: 6, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 1], max: [2, 2, 1] },
      { bufferView: 1, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 1], max: [0, 0, 1] },
      { bufferView: 2, componentType: 5123, count: 3, type: "SCALAR", min: [0], max: [2] },
    ],
    materials: [{
      name: "Source name is not retained",
      pbrMetallicRoughness: {
        baseColorFactor: [0.25, 0.5, 0.75, 1],
        metallicFactor: 0.2,
        roughnessFactor: 0.8,
      },
      emissiveFactor: [0.1, 0.2, 0.3],
      doubleSided: true,
    }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0, mode: 4 }] }],
    nodes: [{ mesh: 0, translation: [10, 3, 4] }],
    scenes: [{ nodes: [0] }],
    scene: 0,
    ...overrides,
  };
  return createGlb(document, bytes);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

function expectCode(code: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof GlbAdapterError && error.code === code;
}

const ENABLED = Object.freeze({
  pvoxModelsEnabled: true,
  gltfConverterEnabled: true,
});

describe("bounded ChatGPT PVOX demo import", () => {
  it("uses the non-raiseable coordinate ceiling owned by canonical model core", () => {
    expect(GLB_STATIC_DEMO_MAX_ABSOLUTE_COORDINATE_METRES).toBe(1_048_576);
    expect(GLB_STATIC_DEMO_MAX_ABSOLUTE_COORDINATE_METRES)
      .toBe(GPU_MODEL_STATIC_DEMO_MAX_ABSOLUTE_COORDINATE_METRES);
  });

  it("creates a verified floor-centred core document and compiler input from one GLB scene", async () => {
    const source = triangleGlb();
    const result = await importGlbToGpuModelDocument(source, {
      ...ENABLED,
      contentType: "model/gltf-binary",
      fileName: "demo.glb",
    });

    expect(isGpuModelDocument(result.document)).toBe(true);
    expect(result).toMatchObject({
      profile: "chatgpt-pvox-static-demo-v1",
      sourceContentHash: await sha256(source),
      outputContentHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(result.document).toMatchObject({
      bounds: { min: [-1, 0, 0], max: [1, 2, 0] },
      textures: [],
      animations: [],
      provenance: {
        sourceFormat: "glb",
        sourceContentHash: result.sourceContentHash,
        converterId: "gltf-static-demo-importer",
        converterVersion: GLB_STATIC_DEMO_IMPORTER_VERSION,
      },
      metadata: { profile: "chatgpt-pvox-static-demo-v1" },
    });
    expect(result.document.materials[0]).toMatchObject({
      baseColorFactor: [0.25, 0.5, 0.75, 1],
      metallicFactor: 0.2,
      roughnessFactor: 0.8,
      emissiveFactor: [0.1, 0.2, 0.3],
      doubleSided: true,
      textures: {},
    });
    expect(result.document.materials[0]).not.toHaveProperty("name");
    expect(result.compilerInput.worldTriangles).toHaveLength(1);
    expect(result.compilerInput.worldTriangles[0]).toMatchObject({
      positions: [[-1, 0, 0], [-1, 2, 0], [1, 0, 0]],
      normals: [[0, 0, -1], [0, 0, -1], [0, 0, -1]],
      materialIndex: 0,
    });
    expect(result.compilerInput.sourceEvidence.sourceContentHash).toBe(result.sourceContentHash);
  });

  it("keeps the profile fail-closed behind the remotely evaluated parent flag", async () => {
    await expect(importGlbToGpuModelDocument(triangleGlb(), { ...ENABLED, pvoxModelsEnabled: false }))
      .rejects.toSatisfy(expectCode("feature-disabled"));
    await expect(importGlbToGpuModelDocument(triangleGlb(), {} as never))
      .rejects.toSatisfy(expectCode("feature-disabled"));
    expect(GLB_STATIC_DEMO_FEATURE_FLAG).toBe("asset.pipeline.pvox-models.enabled");
  });

  it("fails closed behind the independently controlled GLB converter flag", async () => {
    await expect(importGlbToGpuModelDocument(triangleGlb(), {
      ...ENABLED,
      gltfConverterEnabled: false,
    })).rejects.toSatisfy(expectCode("feature-disabled"));
    expect(GLB_STATIC_DEMO_CONVERTER_FEATURE_FLAG).toBe("asset.pipeline.converter.gltf.enabled");
  });

  it("uses glTF material defaults and generates face normals when NORMAL is absent", async () => {
    const result = await importGlbToGpuModelDocument(triangleGlb({
      materials: [{}],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
        { buffer: 0, byteOffset: 72, byteLength: 6, target: 34963 },
      ],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 1], max: [2, 2, 1] },
        { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR", min: [0], max: [2] },
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    }), ENABLED);

    expect(result.document.materials[0]).toMatchObject({
      baseColorFactor: [1, 1, 1, 1],
      metallicFactor: 1,
      roughnessFactor: 1,
      emissiveFactor: [0, 0, 0],
      doubleSided: false,
    });
    expect(result.compilerInput.worldTriangles[0]?.normals).toEqual([
      [0, 0, -1], [0, 0, -1], [0, 0, -1],
    ]);
  });

  it("retains the local scene hierarchy in the canonical basis", async () => {
    const matrix = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      2, 3, 4, 1,
    ];
    const result = await importGlbToGpuModelDocument(triangleGlb({
      nodes: [{ children: [1] }, { mesh: 0, matrix }],
      scenes: [{ nodes: [0] }],
    }), ENABLED);

    expect(result.document.nodes).toHaveLength(3);
    expect(result.document.nodes[0]).toMatchObject({ id: "normalization-root", children: ["node-0"] });
    expect(result.document.nodes[1]).toMatchObject({ id: "node-0", children: ["node-1"] });
    expect(result.document.nodes[2]).toMatchObject({ id: "node-1", meshId: "mesh-0" });
    expect(result.document.nodes[2]?.localMatrix[14]).toBe(-4);
    expect(result.compilerInput.worldTriangles).toHaveLength(1);
  });

  it("enforces a caller-tightened world-triangle ceiling after instancing", async () => {
    await expect(importGlbToGpuModelDocument(triangleGlb({
      nodes: [{ mesh: 0 }, { mesh: 0 }],
      scenes: [{ nodes: [0, 1] }],
    }), { ...ENABLED, maxTriangles: 1 }))
      .rejects.toSatisfy(expectCode("document-resource-limit"));
    await expect(importGlbToGpuModelDocument(triangleGlb(), {
      ...ENABLED,
      maxTriangles: 200_001,
    })).rejects.toSatisfy(expectCode("invalid-adapter-options"));
  });

  it("trips the primitive-instance budget before enumerating the full fan-out", async () => {
    const primitive = { attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0, mode: 4 };
    const nodes = Array.from({ length: 64 }, () => ({ mesh: 0 }));
    await expect(importGlbToGpuModelDocument(triangleGlb({
      meshes: [{ primitives: Array.from({ length: 64 }, () => ({ ...primitive })) }],
      nodes,
      scenes: [{ nodes: nodes.map((_node, index) => index) }],
    }), { ...ENABLED, maxTriangles: 8 }))
      .rejects.toSatisfy(expectCode("document-resource-limit"));
  });

  it("rejects unreferenced vertex payload instead of multiplying validation work", async () => {
    const accessors = [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 1], max: [2, 2, 1] },
      { bufferView: 1, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 1], max: [0, 0, 1] },
      { bufferView: 2, componentType: 5123, count: 3, type: "SCALAR", min: [0], max: [1] },
    ];
    await expect(importGlbToGpuModelDocument(triangleGlb({ accessors }, [0, 1, 1]), ENABLED))
      .rejects.toSatisfy(expectCode("unsupported-gltf-feature"));
  });

  it("enforces a tight absolute PVOX coordinate ceiling on computed world positions", async () => {
    const boundary = await importGlbToGpuModelDocument(triangleGlb({
      nodes: [{ mesh: 0, translation: [1_048_574, 0, 0] }],
    }), ENABLED);
    expect(boundary.compilerInput.worldTriangles[0]?.positions)
      .toContainEqual([1, 0, 0]);

    await expect(importGlbToGpuModelDocument(triangleGlb({
      nodes: [{ mesh: 0, translation: [1_048_574.25, 0, 0] }],
    }), ENABLED))
      .rejects.toSatisfy(expectCode("coordinate-resource-limit"));
  });

  it("rejects rig and morph fan-out from shallow metadata before semantic expansion", async () => {
    const fanOut = 10_000;
    const shallowOnly = { ...ENABLED, limits: { maxJsonValues: 1 } };
    await expect(importGlbToGpuModelDocument(triangleGlb({
      skins: [{ joints: Array.from({ length: fanOut }, () => 0) }],
    }), shallowOnly)).rejects.toSatisfy(expectCode("unsupported-gltf-feature"));
    await expect(importGlbToGpuModelDocument(triangleGlb({
      meshes: [{
        weights: Array.from({ length: fanOut }, () => 0),
        primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }],
      }],
    }), shallowOnly)).rejects.toSatisfy(expectCode("unsupported-gltf-feature"));
    await expect(importGlbToGpuModelDocument(triangleGlb({
      meshes: [{ primitives: [{
        attributes: { POSITION: 0, NORMAL: 1 },
        indices: 2,
        material: 0,
        targets: Array.from({ length: fanOut }, () => ({ POSITION: 0 })),
      }] }],
    }), shallowOnly)).rejects.toSatisfy(expectCode("unsupported-gltf-feature"));
  });

  it("binds provenance to the synchronous private source snapshot", async () => {
    const source = triangleGlb();
    const expectedHash = await sha256(source);
    const pending = importGlbToGpuModelDocument(source, ENABLED);
    source.fill(0);

    const imported = await pending;
    expect(imported.sourceContentHash).toBe(expectedHash);
    expect(imported.document.provenance.sourceContentHash).toBe(expectedHash);
    expect(imported.compilerInput.sourceEvidence.sourceContentHash).toBe(expectedHash);
  });

  it("observes cancellation and uses captured native Blob methods for internal snapshots", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(importGlbToGpuModelDocument(triangleGlb(), {
      ...ENABLED,
      signal: controller.signal,
    })).rejects.toSatisfy(expectCode("aborted"));

    const original = Blob.prototype.arrayBuffer;
    const originalSlice = Blob.prototype.slice;
    const originalSize = Object.getOwnPropertyDescriptor(Blob.prototype, "size");
    Blob.prototype.arrayBuffer = async () => { throw new Error("caller override must not run"); };
    Blob.prototype.slice = () => { throw new Error("caller slice override must not run"); };
    Object.defineProperty(Blob.prototype, "size", { configurable: true, get: () => { throw new Error("caller size override must not run"); } });
    try {
      const imported = await importGlbToGpuModelDocument(triangleGlb(), ENABLED);
      expect(imported.compilerInput.worldTriangles).toHaveLength(1);
    } finally {
      Blob.prototype.arrayBuffer = original;
      Blob.prototype.slice = originalSlice;
      if (originalSize) Object.defineProperty(Blob.prototype, "size", originalSize);
    }
  });

  it.each([
    ["unreachable nodes", { nodes: [{ mesh: 0 }, {}] }],
    ["unused meshes", { meshes: [
      { primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] },
      { primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] },
    ] }],
    ["extra vertex attributes", { meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 1 }, indices: 2, material: 0 }] }] }],
    ["texture coordinates", { meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 1 }, indices: 2, material: 0 }] }] }],
    ["implicit indices", { meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0 }] }] }],
    ["mixed accessor roles", { meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 0 }, indices: 2, material: 0 }] }] }],
    ["transparent materials", { materials: [{ alphaMode: "BLEND" }] }],
    ["material texture bindings", { materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }] }],
    ["node weights", { nodes: [{ mesh: 0, weights: [0] }] }],
  ])("rejects %s from the closed compiler profile", async (_label, overrides) => {
    await expect(importGlbToGpuModelDocument(triangleGlb(overrides as JsonRecord), ENABLED))
      .rejects.toBeInstanceOf(GlbAdapterError);
  });

  it.each([
    ["more than one scene", { scenes: [{ nodes: [0] }, { nodes: [0] }] }],
    ["an unselected scene", { scene: undefined }],
    ["samplers", { samplers: [{}] }],
    ["textures", { textures: [{}] }],
    ["animation", { animations: [{ samplers: [], channels: [] }] }],
    ["camera data", { cameras: [{ type: "perspective", perspective: { yfov: 1, znear: 0.1 } }] }],
  ])("rejects %s instead of silently dropping it", async (_label, overrides) => {
    await expect(importGlbToGpuModelDocument(triangleGlb(overrides as JsonRecord), ENABLED))
      .rejects.toBeInstanceOf(GlbAdapterError);
  });

  it("rejects unknown demo options and caller attempts to raise the 16 MiB profile", async () => {
    await expect(importGlbToGpuModelDocument(triangleGlb(), {
      ...ENABLED,
      unexpected: true,
    } as never)).rejects.toSatisfy(expectCode("invalid-adapter-options"));
    await expect(importGlbToGpuModelDocument(triangleGlb(), {
      ...ENABLED,
      signal: { aborted: false },
    } as never)).rejects.toSatisfy(expectCode("invalid-adapter-options"));
    await expect(importGlbToGpuModelDocument(triangleGlb(), {
      ...ENABLED,
      limits: { maxInputBytes: 16 * 1024 * 1024 + 1 },
    })).rejects.toSatisfy(expectCode("invalid-limits"));
    await expect(importGlbToGpuModelDocument(triangleGlb(), {
      ...ENABLED,
      limits: { maxAccessorElements: 5_000_001 },
    })).rejects.toSatisfy(expectCode("invalid-limits"));
  });

  it("returns the verified document through the runtime adapter without resolving resources", async () => {
    const bytes = triangleGlb();
    let resolverCalls = 0;
    const loaded = await glbAdapter.load({
      source: { kind: "uint8-array", bytes },
      bytes,
      contentType: "model/gltf-binary",
      fileName: "demo.glb",
      contentHash: await sha256(bytes),
      rangeSupported: false,
      resourceResolver: { resolve: async () => {
        resolverCalls += 1;
        throw new Error("must not be called");
      } },
    }, {
      signal: new AbortController().signal,
      mode: "strict",
      execution: "worker",
      adapterOptions: ENABLED,
    });

    expect(isGpuModelDocument(loaded.canonicalModel)).toBe(true);
    expect(loaded.rendererReady?.worldTriangles).toHaveLength(1);
    expect(resolverCalls).toBe(0);
  });

  it("rejects a runtime source whose independently calculated hash disagrees", async () => {
    const bytes = triangleGlb();
    await expect(glbAdapter.load({
      source: { kind: "uint8-array", bytes },
      bytes,
      contentHash: "0".repeat(64),
      rangeSupported: false,
      resourceResolver: { resolve: async () => { throw new Error("unused"); } },
    }, {
      signal: new AbortController().signal,
      mode: "strict",
      execution: "worker",
      adapterOptions: ENABLED,
    })).rejects.toSatisfy(expectCode("source-hash-mismatch"));
  });
});
