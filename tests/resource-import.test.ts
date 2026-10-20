import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { isGpuModelDocument } from "@plasius/gpu-model-core";
import { PackageResourceResolver, sha256Hex } from "@plasius/gpu-model-runtime";
import {
  importGltfToGpuModelDocument,
  GLTF_RESOURCE_IMPORT_PROFILE,
  validateAndExportGlb,
} from "../src/index.js";
import type { ResourceResolver } from "@plasius/gpu-model-runtime";

type Json = Record<string, any>;
const encoder = new TextEncoder();
const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==",
    "base64",
  ),
);
function fixture(): { json: Json; bytes: Uint8Array } {
  const bytes = new Uint8Array(66);
  const v = new DataView(bytes.buffer);
  [0, 0, 1, 2, 0, 1, 0, 2, 1].forEach((n, i) => v.setFloat32(i * 4, n, true));
  [0, 0, 1, 0, 0, 1].forEach((n, i) => v.setFloat32(36 + i * 4, n, true));
  [0, 1, 2].forEach((n, i) => v.setUint16(60 + i * 2, n, true));
  return {
    bytes,
    json: {
      asset: { version: "2.0" },
      buffers: [{ uri: "mesh.bin", byteLength: 66 }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
        { buffer: 0, byteOffset: 36, byteLength: 24, target: 34962 },
        { buffer: 0, byteOffset: 60, byteLength: 6, target: 34963 },
      ],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: "VEC3",
          min: [0, 0, 1],
          max: [2, 2, 1],
        },
        { bufferView: 1, componentType: 5126, count: 3, type: "VEC2" },
        { bufferView: 2, componentType: 5123, count: 3, type: "SCALAR" },
      ],
      images: [{ uri: "textures/pixel.png" }],
      textures: [{ source: 0 }],
      materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
      meshes: [
        {
          primitives: [
            {
              attributes: { POSITION: 0, TEXCOORD_0: 1 },
              indices: 2,
              material: 0,
            },
          ],
        },
      ],
      nodes: [{ mesh: 0, translation: [10, 3, 4] }],
      scenes: [{ nodes: [0] }],
      scene: 0,
    },
  };
}
function resolver(
  resources: Record<string, Uint8Array>,
  contentType?: string,
): ResourceResolver {
  return {
    resolve: vi.fn(async (ref, options) => {
      const path = typeof ref === "string" ? ref : ref.path;
      if (!resources[path]) throw new Error("PRIVATE provider token URL");
      expect(options?.maxBytes).toBeGreaterThan(0);
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      return {
        path,
        bytes: resources[path]!,
        contentHash: "0".repeat(64),
        rangeSupported: false,
        contentType,
      };
    }),
  };
}
function options(f = fixture()) {
  return {
    conversionEnabled: true,
    resourceResolver: resolver({
      "mesh.bin": f.bytes,
      "textures/pixel.png": png,
    }),
  };
}
function glb(json: Json, binary?: Uint8Array) {
  const text = encoder.encode(JSON.stringify(json));
  const j = Math.ceil(text.length / 4) * 4;
  const b = binary ? Math.ceil(binary.length / 4) * 4 : 0;
  const out = new Uint8Array(20 + j + (binary ? 8 + b : 0));
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, out.length, true);
  v.setUint32(12, j, true);
  v.setUint32(16, 0x4e4f534a, true);
  out.fill(32, 20, 20 + j);
  out.set(text, 20);
  if (binary) {
    v.setUint32(20 + j, b, true);
    v.setUint32(24 + j, 0x004e4942, true);
    out.set(binary, 28 + j);
  }
  return out;
}
const code = (value: string) => (error: unknown) =>
  !!error &&
  typeof error === "object" &&
  "code" in error &&
  error.code === value;

describe("bounded static glTF resource import", () => {
  it("maps JSON external geometry and relative PNG textures into privately verified canonical resources", async () => {
    const f = fixture();
    const o = options(f);
    const result = await importGltfToGpuModelDocument(
      encoder.encode(JSON.stringify(f.json)),
      o,
    );
    expect(result.profile).toBe(GLTF_RESOURCE_IMPORT_PROFILE);
    expect(isGpuModelDocument(result.document)).toBe(true);
    expect(result.document.textures[0]?.imageResourceId).toBe("image-0");
    expect(result.document.materials[0]?.textures.baseColor?.textureId).toBe(
      "texture-0",
    );
    expect(result.document.bounds).toEqual({ min: [-1, 0, 0], max: [1, 2, 0] });
    expect(result.document.provenance.sourceFormat).toBe("gltf");
    expect(result.sourceContentHash).toMatch(/^[a-f0-9]{64}$/u);
    const a = result.document.accessors.find(
      (a) =>
        a.id === result.document.meshes[0]!.primitives[0]!.indicesAccessorId,
    )!;
    const r = result.document.resources.find((r) => r.id === a.resourceId)!;
    expect(
      Array.from(
        new Uint32Array(await r.payload.arrayBuffer(), a.byteOffset, a.count),
      ),
    ).toEqual([0, 2, 1]);
    expect(o.resourceResolver.resolve).toHaveBeenCalledTimes(2);
  });
  it("supports data URI buffers and images without invoking an external provider", async () => {
    const f = fixture();
    f.json.buffers[0].uri = `data:application/octet-stream;base64,${Buffer.from(f.bytes).toString("base64")}`;
    f.json.images[0].uri = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
    const o = { conversionEnabled: true, resourceResolver: resolver({}) };
    expect(
      isGpuModelDocument(
        (
          await importGltfToGpuModelDocument(
            encoder.encode(JSON.stringify(f.json)),
            o,
          )
        ).document,
      ),
    ).toBe(true);
    expect(o.resourceResolver.resolve).not.toHaveBeenCalled();
  });
  it("supports GLB BIN geometry and embedded images while preserving the old strict URI rejection", async () => {
    const f = fixture();
    delete f.json.buffers[0].uri;
    f.json.buffers[0].byteLength = 68 + png.length;
    f.json.bufferViews.push({
      buffer: 0,
      byteOffset: 68,
      byteLength: png.length,
    });
    f.json.images = [{ bufferView: 3, mimeType: "image/png" }];
    const b = new Uint8Array(68 + png.length);
    b.set(f.bytes);
    b.set(png, 68);
    expect(
      (
        await importGltfToGpuModelDocument(glb(f.json, b), {
          conversionEnabled: true,
        })
      ).document.textures,
    ).toHaveLength(1);
    const ext = fixture();
    await expect(validateAndExportGlb(glb(ext.json))).rejects.toSatisfy(
      code("external-resource-forbidden"),
    );
  });
  it("supports GLB external buffers and resources and multiple independently aligned buffers", async () => {
    const f = fixture();
    const indices = f.bytes.slice(60);
    f.json.buffers[0].byteLength = 60;
    f.json.buffers.push({ uri: "indices.bin", byteLength: 6 });
    f.json.bufferViews[2].buffer = 1;
    f.json.bufferViews[2].byteOffset = 0;
    const o = {
      conversionEnabled: true,
      resourceResolver: resolver({
        "mesh.bin": f.bytes.slice(0, 60),
        "indices.bin": indices,
        "textures/pixel.png": png,
      }),
    };
    expect(
      (await importGltfToGpuModelDocument(glb(f.json), o)).document.meshes,
    ).toHaveLength(1);
  });
  it("fails closed before resource acquisition when the remote conversion decision is disabled", async () => {
    const f = fixture();
    const o = options(f);
    await expect(
      importGltfToGpuModelDocument(encoder.encode(JSON.stringify(f.json)), {
        ...o,
        conversionEnabled: false,
      }),
    ).rejects.toSatisfy(code("feature-disabled"));
    expect(o.resourceResolver.resolve).not.toHaveBeenCalled();
  });
  it.each([
    "../secret.bin",
    "/root.bin",
    "https://example.test/secret",
    "//host/path",
    "a\\b",
    "a/%2e%2e/b",
    "file:secret",
    "a?token=secret",
    "a#secret",
    "%252e%252e/secret",
    "./../secret",
    "a/%2fb",
  ])("rejects reference %s before provider I/O", async (path) => {
    const f = fixture();
    f.json.buffers[0].uri = path;
    const o = options(f);
    await expect(
      importGltfToGpuModelDocument(encoder.encode(JSON.stringify(f.json)), o),
    ).rejects.toSatisfy(code("external-resource-forbidden"));
    expect(o.resourceResolver.resolve).not.toHaveBeenCalled();
  });
  it.each([
    ["missing", "missing-gltf-dependency"],
    ["truncated", "missing-gltf-dependency"],
    ["oversize", "input-resource-limit"],
    ["mime", "image-mime-mismatch"],
  ])("redacts %s provider failures", async (kind, expected) => {
    const f = fixture();
    let o = options(f);
    if (kind === "missing")
      o = { conversionEnabled: true, resourceResolver: resolver({}) };
    if (kind === "truncated")
      o = {
        conversionEnabled: true,
        resourceResolver: resolver({ "mesh.bin": f.bytes.slice(0, 60) }),
      };
    if (kind === "oversize")
      o = {
        conversionEnabled: true,
        resourceResolver: resolver({ "mesh.bin": new Uint8Array(67) }),
      };
    if (kind === "mime")
      o = {
        conversionEnabled: true,
        resourceResolver: resolver(
          { "mesh.bin": f.bytes, "textures/pixel.png": png },
          "image/jpeg",
        ),
      };
    try {
      await importGltfToGpuModelDocument(
        encoder.encode(JSON.stringify(f.json)),
        o,
      );
      throw new Error("unexpected success");
    } catch (e) {
      expect(e).toSatisfy(code(expected as string));
      expect(String(e)).not.toContain("PRIVATE");
    }
  });
  it("enforces input, aggregate, count, decoded-image and monotonic limit options", async () => {
    const f = fixture();
    const bytes = encoder.encode(JSON.stringify(f.json));
    for (const limits of [
      { maxInputBytes: 1 },
      { maxAggregateBytes: 65 },
      { maxResources: 1 },
      { maxDecodedImageBytes: 3 },
    ]) {
      await expect(
        importGltfToGpuModelDocument(bytes, { ...options(f), limits }),
      ).rejects.toBeInstanceOf(Error);
    }
    await expect(
      importGltfToGpuModelDocument(bytes, {
        ...options(f),
        limits: { maxResources: 10000000 },
      }),
    ).rejects.toSatisfy(code("invalid-limits"));
  });
  it("cancels an uncooperative provider and propagates abort to provider I/O", async () => {
    const f = fixture();
    const c = new AbortController();
    let signal: AbortSignal | undefined;
    const o = {
      conversionEnabled: true,
      signal: c.signal,
      resourceResolver: {
        resolve: vi.fn((_ref, opts) => {
          signal = opts?.signal;
          return new Promise<never>(() => {});
        }),
      } satisfies ResourceResolver,
    };
    const pending = importGltfToGpuModelDocument(
      encoder.encode(JSON.stringify(f.json)),
      o,
    );
    await vi.waitFor(() => expect(signal).toBeDefined());
    c.abort();
    await expect(pending).rejects.toSatisfy(code("aborted"));
    expect(signal?.aborted).toBe(true);
  });
  it("bounds deadlines even when the resolver ignores cancellation", async () => {
    const f = fixture();
    await expect(
      importGltfToGpuModelDocument(encoder.encode(JSON.stringify(f.json)), {
        conversionEnabled: true,
        limits: { timeoutMs: 5 },
        resourceResolver: { resolve: () => new Promise<never>(() => {}) },
      }),
    ).rejects.toSatisfy(code("processing-time-limit"));
  });
  it.each([
    "duplicate",
    "unsafe",
    "malformed",
    "unsupported",
    "view",
    "buffer",
  ])(
    "rejects %s input before masking malformed source declarations",
    async (kind) => {
      const f = fixture();
      let bytes = encoder.encode(JSON.stringify(f.json));
      if (kind === "duplicate")
        bytes = encoder.encode('{"asset":{"version":"2.0","version":"2.0"}}');
      if (kind === "unsafe")
        bytes = encoder.encode('{"asset":{"version":"2.0"},"__proto__":{}}');
      if (kind === "malformed") bytes = Uint8Array.of(0xff);
      if (kind === "unsupported") {
        f.json.extensionsUsed = ["KHR_materials_unlit"];
        bytes = encoder.encode(JSON.stringify(f.json));
      }
      if (kind === "view") {
        f.json.bufferViews[0].byteLength = 100;
        bytes = encoder.encode(JSON.stringify(f.json));
      }
      if (kind === "buffer") {
        delete f.json.buffers[0].uri;
        bytes = encoder.encode(JSON.stringify(f.json));
      }
      await expect(
        importGltfToGpuModelDocument(bytes, options(f)),
      ).rejects.toBeInstanceOf(Error);
    },
  );
  it("uses the published runtime package resolver with enabled and disabled decisions", async () => {
    const f = fixture();
    const resourceResolver = new PackageResourceResolver({
      sourceKind: "uint8-array",
      fetch: async () => {
        throw new Error("unexpected network");
      },
      hashBytes: sha256Hex,
      sleep: async () => {},
      package: {
        resources: {
          "mesh.bin": { bytes: f.bytes },
          "textures/pixel.png": { bytes: png, contentType: "image/png" },
        },
      },
    });
    const bytes = encoder.encode(JSON.stringify(f.json));
    expect(
      isGpuModelDocument(
        (
          await importGltfToGpuModelDocument(bytes, {
            resourceResolver,
            conversionEnabled: true,
          })
        ).document,
      ),
    ).toBe(true);
    await expect(
      importGltfToGpuModelDocument(bytes, {
        resourceResolver,
        conversionEnabled: false,
      }),
    ).rejects.toSatisfy(code("feature-disabled"));
  });
});

function withoutTexture(f = fixture()) {
  delete f.json.images;
  delete f.json.textures;
  delete f.json.materials;
  delete f.json.meshes[0].primitives[0].material;
  return f;
}
function addAttribute(
  f: ReturnType<typeof fixture>,
  semantic: string,
  values: readonly number[],
  componentType = 5126,
  size = 3,
  normalized = false,
  stride?: number,
) {
  const width =
    componentType === 5120 || componentType === 5121
      ? 1
      : componentType === 5122 || componentType === 5123
        ? 2
        : 4;
  const offset = Math.ceil(f.bytes.length / 4) * 4;
  const data = new Uint8Array(offset + (stride ?? size * width) * 3);
  data.set(f.bytes);
  const view = new DataView(data.buffer);
  values.forEach((v, i) => {
    const o =
      offset +
      Math.floor(i / size) * (stride ?? size * width) +
      (i % size) * width;
    if (componentType === 5120) view.setInt8(o, v);
    else if (componentType === 5121) view.setUint8(o, v);
    else if (componentType === 5122) view.setInt16(o, v, true);
    else if (componentType === 5123) view.setUint16(o, v, true);
    else if (componentType === 5125) view.setUint32(o, v, true);
    else view.setFloat32(o, v, true);
  });
  const b = f.json.bufferViews.length;
  f.json.bufferViews.push({
    buffer: 0,
    byteOffset: offset,
    byteLength: data.length - offset,
    target: 34962,
    ...(stride ? { byteStride: stride } : {}),
  });
  const a = f.json.accessors.length;
  f.json.accessors.push({
    bufferView: b,
    componentType,
    count: 3,
    type: `VEC${size}`,
    ...(normalized ? { normalized: true } : {}),
  });
  f.json.meshes[0].primitives[0].attributes[semantic] = a;
  f.json.buffers[0].byteLength = data.length;
  f.bytes = data;
}
describe("resource import fidelity and defensive limits", () => {
  it("fully decodes JPEG resources under byte, pixel and decoder memory ceilings", async () => {
    const { encode } = await import("jpeg-js");
    const jpeg = Uint8Array.from(
      encode({ width: 1, height: 1, data: Uint8Array.of(255, 0, 0, 255) }, 80)
        .data,
    );
    const f = fixture();
    f.json.images[0] = {
      uri: `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}`,
      mimeType: "image/jpeg",
    };
    const output = await importGltfToGpuModelDocument(
      encoder.encode(JSON.stringify(f.json)),
      options(f),
    );
    expect(
      output.document.resources.find((r) => r.kind === "image")?.mimeType,
    ).toBe("image/jpeg");
    await expect(
      importGltfToGpuModelDocument(encoder.encode(JSON.stringify(f.json)), {
        ...options(f),
        limits: { maxDecodedImageBytes: 3 },
      }),
    ).rejects.toBeInstanceOf(Error);
    f.json.images[0].uri = `data:image/jpeg;base64,${Buffer.from(Uint8Array.of(255, 216, 255, 1, 255, 217)).toString("base64")}`;
    await expect(
      importGltfToGpuModelDocument(
        encoder.encode(JSON.stringify(f.json)),
        options(f),
      ),
    ).rejects.toSatisfy(code("invalid-image-resource"));
  });
  it("preserves core material slots, factors, sampler wrapping/filtering and separate color-space interpretations", async () => {
    const f = fixture();
    f.json.materials[0] = {
      alphaMode: "MASK",
      alphaCutoff: 0.25,
      doubleSided: true,
      pbrMetallicRoughness: {
        baseColorFactor: [0.2, 0.4, 0.6, 0.8],
        metallicFactor: 0.3,
        roughnessFactor: 0.7,
        baseColorTexture: { index: 0 },
        metallicRoughnessTexture: { index: 0 },
      },
      emissiveFactor: [0.1, 0.2, 0.3],
      normalTexture: { index: 0, scale: 0.5 },
      occlusionTexture: { index: 0, strength: 0.2 },
      emissiveTexture: { index: 0 },
    };
    f.json.samplers = [
      { wrapS: 33071, wrapT: 33648, minFilter: 9984, magFilter: 9728 },
    ];
    f.json.textures[0].sampler = 0;
    const document = (
      await importGltfToGpuModelDocument(
        encoder.encode(JSON.stringify(f.json)),
        options(f),
      )
    ).document;
    expect(document.materials[0]).toMatchObject({
      alphaMode: "mask",
      alphaCutoff: 0.25,
      doubleSided: true,
      normalScale: 0.5,
      occlusionStrength: 0.2,
    });
    expect(document.textures).toHaveLength(3);
    expect(document.textures.map((t) => t.colorSpace).sort()).toEqual([
      "linear",
      "normal-map",
      "srgb",
    ]);
    expect(document.textures[0]?.sampler).toMatchObject({
      wrapS: "clamp-to-edge",
      wrapT: "mirrored-repeat",
      minFilter: "nearest",
      magFilter: "nearest",
      mipFilter: "nearest",
    });
  });
  it.each([9728, 9729, 9985, 9986, 9987])(
    "maps sampler filter %s without losing mip selection",
    async (minFilter) => {
      const f = fixture();
      f.json.samplers = [{ minFilter }];
      f.json.textures[0].sampler = 0;
      expect(
        (
          await importGltfToGpuModelDocument(
            encoder.encode(JSON.stringify(f.json)),
            options(f),
          )
        ).document.textures[0]?.sampler,
      ).toBeDefined();
    },
  );
  it("maps interleaved normals, tangent handedness and non-indexed triangles", async () => {
    const f = withoutTexture();
    addAttribute(f, "NORMAL", [0, 0, 1, 0, 0, 1, 0, 0, 1], 5126, 3, false, 16);
    addAttribute(f, "TANGENT", [1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1], 5126, 4);
    delete f.json.meshes[0].primitives[0].indices;
    const document = (
      await importGltfToGpuModelDocument(
        encoder.encode(JSON.stringify(f.json)),
        options(f),
      )
    ).document;
    const p = document.meshes[0]!.primitives[0]!;
    const tangent = document.accessors.find(
      (a) =>
        a.id === p.attributes.find((a) => a.semantic === "TANGENT")!.accessorId,
    )!;
    const bytes = await document.resources[0]!.payload.arrayBuffer();
    expect(new DataView(bytes).getFloat32(tangent.byteOffset + 12, true)).toBe(
      -1,
    );
    expect(document.materials).toEqual([]);
  });
  it.each([5120, 5121, 5122, 5123])(
    "preserves normalized custom component type %s as canonical f32",
    async (componentType) => {
      const f = withoutTexture();
      addAttribute(
        f,
        "_CUSTOM",
        [0, 1, 0, 1, 0, 1],
        componentType,
        2,
        true,
        componentType < 5122 ? 4 : undefined,
      );
      const output = await importGltfToGpuModelDocument(
        encoder.encode(JSON.stringify(f.json)),
        options(f),
      );
      expect(
        output.document.meshes[0]!.primitives[0]!.attributes.some(
          (a) => a.semantic === "_CUSTOM",
        ),
      ).toBe(true);
    },
  );
  it("preserves unsigned custom values and supports ArrayBuffer input without caller mutation", async () => {
    const f = withoutTexture();
    const data = new Uint8Array(72);
    data.set(f.bytes.subarray(0, 60));
    [0, 1, 2].forEach((n, i) =>
      new DataView(data.buffer).setUint32(60 + i * 4, n, true),
    );
    f.bytes = data;
    f.json.buffers[0].byteLength = 72;
    f.json.bufferViews[2].byteLength = 12;
    f.json.accessors[2].componentType = 5125;
    const bytes = encoder.encode(JSON.stringify(f.json));
    const copy = Uint8Array.from(bytes);
    expect(
      (
        await importGltfToGpuModelDocument(
          bytes.buffer as ArrayBuffer,
          options(f),
        )
      ).document.meshes,
    ).toHaveLength(1);
    expect(bytes).toEqual(copy);
  });
  it("normalizes nested matrix/TRS transforms and infers roots when scenes are absent", async () => {
    const f = withoutTexture();
    delete f.json.scenes;
    delete f.json.scene;
    f.json.nodes = [
      {
        children: [1],
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1],
      },
      { mesh: 0, translation: [1, 2, 3], scale: [2, 2, 2] },
    ];
    const output = await importGltfToGpuModelDocument(
      encoder.encode(JSON.stringify(f.json)),
      options(f),
    );
    expect(output.document.bounds).toEqual({ min: [-2, 0, 0], max: [2, 4, 0] });
  });
  it("supports zero-initialized accessors without a bufferView", async () => {
    const f = withoutTexture();
    delete f.json.accessors[0].bufferView;
    f.json.accessors[0].min = [0, 0, 0];
    f.json.accessors[0].max = [0, 0, 0];
    expect(
      (
        await importGltfToGpuModelDocument(
          encoder.encode(JSON.stringify(f.json)),
          options(f),
        )
      ).document.bounds.min,
    ).toEqual([0, 0, 0]);
  });
  it("enforces exact entrypoint and canonical byte limits and refuses raised/invalid/unknown limits", async () => {
    const f = withoutTexture();
    const bytes = encoder.encode(JSON.stringify(f.json));
    expect(
      (
        await importGltfToGpuModelDocument(bytes, {
          ...options(f),
          limits: {
            maxInputBytes: bytes.length,
            maxAggregateBytes: 72,
            maxResourceBytes: 72,
          },
        })
      ).document,
    ).toBeDefined();
    for (const limits of [
      { maxGeometryElements: 8 },
      { maxWorldVertices: 2 },
      { maxResourceBytes: 65 },
      { timeoutMs: 0 },
      { maxResources: Number.NaN },
      { mystery: 1 },
    ]) {
      await expect(
        importGltfToGpuModelDocument(bytes, { ...options(f), limits }),
      ).rejects.toBeInstanceOf(Error);
    }
  });
  it.each([
    ".",
    "a%2fb",
    "data:text/plain;base64,AAAA",
    "data:application/octet-stream,AAAA",
    "data:application/octet-stream;base64,AA!A",
    "%zz",
  ])("rejects non-admitted URI %s", async (uri) => {
    const f = withoutTexture();
    f.json.buffers[0].uri = uri;
    await expect(
      importGltfToGpuModelDocument(
        encoder.encode(JSON.stringify(f.json)),
        options(f),
      ),
    ).rejects.toBeInstanceOf(Error);
  });
  it.each([
    "both-image-locations",
    "missing-image",
    "wrong-mime",
    "camera",
    "multiple-scenes",
    "orphan",
    "cycle",
    "bad-index",
    "bad-hash-bounds",
    "no-geometry",
  ])("rejects %s without silent feature loss", async (kind) => {
    const f = fixture();
    if (kind === "both-image-locations") f.json.images[0].bufferView = 0;
    if (kind === "missing-image") f.json.images[0] = {};
    if (kind === "wrong-mime") f.json.images[0].mimeType = "image/jpeg";
    if (kind === "camera") f.json.cameras = [{}];
    if (kind === "multiple-scenes") f.json.scenes.push({ nodes: [0] });
    if (kind === "orphan") f.json.nodes.push({});
    if (kind === "cycle") f.json.nodes[0].children = [0];
    if (kind === "bad-index")
      new DataView(f.bytes.buffer).setUint16(60, 4, true);
    if (kind === "bad-hash-bounds") f.json.accessors[0].max = [1, 1, 1];
    if (kind === "no-geometry") {
      f.json.nodes = [];
      f.json.scenes[0].nodes = [];
    }
    await expect(
      importGltfToGpuModelDocument(
        encoder.encode(JSON.stringify(f.json)),
        options(f),
      ),
    ).rejects.toBeInstanceOf(Error);
  });
  it("aborts before entry point parsing and rejects invalid options and MIME hints", async () => {
    const f = fixture();
    const bytes = encoder.encode(JSON.stringify(f.json));
    const controller = new AbortController();
    controller.abort();
    await expect(
      importGltfToGpuModelDocument(bytes, {
        ...options(f),
        signal: controller.signal,
      }),
    ).rejects.toSatisfy(code("aborted"));
    await expect(
      importGltfToGpuModelDocument(bytes, undefined as never),
    ).rejects.toSatisfy(code("invalid-adapter-options"));
    await expect(
      importGltfToGpuModelDocument(bytes, {
        ...options(f),
        contentType: "image/jpeg",
      }),
    ).rejects.toSatisfy(code("source-type-mismatch"));
    await expect(
      importGltfToGpuModelDocument(new Uint16Array(1) as never, options(f)),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      importGltfToGpuModelDocument(bytes, { conversionEnabled: true }),
    ).rejects.toSatisfy(code("missing-gltf-dependency"));
  });
  it("passes tightening limits into actual streamed runtime resolution and redacts oversize failures", async () => {
    const f = withoutTexture();
    let cancelled = false;
    const resourceResolver = new PackageResourceResolver({
      sourceKind: "url",
      baseUrl: "https://example.invalid/models/",
      fetchPolicy: { maxAttempts: 1 },
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array(67));
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
      hashBytes: sha256Hex,
      sleep: async () => {},
    });
    await expect(
      importGltfToGpuModelDocument(encoder.encode(JSON.stringify(f.json)), {
        conversionEnabled: true,
        resourceResolver,
      }),
    ).rejects.toSatisfy(code("input-resource-limit"));
    expect(cancelled).toBe(true);
  });
});

describe("gpu-shared#55 representative showcase mapping", () => {
  it("imports the existing generated brigantine fixture with named meshes/materials and bounded physics metadata", async () => {
    const input = new Uint8Array(
      readFileSync(
        new URL("./fixtures/showcase-brigantine.gltf", import.meta.url),
      ),
    );
    const result = await importGltfToGpuModelDocument(input, {
      conversionEnabled: true,
    });
    expect(result.document.meshes).toHaveLength(3);
    expect(result.document.materials).toHaveLength(8);
    expect(
      result.document.nodes.find((n) => n.name === "brigantine")?.metadata,
    ).toHaveProperty("sourceExtras.physics.shape", "box");
    expect(result.document.meshes[0]?.name).toBe("brigantine-hull");
    expect(
      result.document.diagnostics.some((d) => d.message.includes("brigantine")),
    ).toBe(false);
  });
});

it("admits showcase-sized base64 resource strings within the entry point budget", async () => {
  const f = withoutTexture();
  const bytes = new Uint8Array(900_000);
  bytes.set(f.bytes);
  f.json.buffers[0] = {
    byteLength: bytes.length,
    uri: `data:application/octet-stream;base64,${Buffer.from(bytes).toString("base64")}`,
  };
  expect(
    (
      await importGltfToGpuModelDocument(
        encoder.encode(JSON.stringify(f.json)),
        { conversionEnabled: true },
      )
    ).document.meshes,
  ).toHaveLength(1);
});

it("rejects tag-spoofed non-byte views while accepting genuine cross-realm byte arrays", async () => {
  const { runInNewContext } = await import("node:vm");
  const f = withoutTexture();
  const bytes = encoder.encode(JSON.stringify(f.json));
  const spoof = Uint16Array.from(bytes);
  Object.defineProperty(spoof, Symbol.toStringTag, { value: "Uint8Array" });
  await expect(
    importGltfToGpuModelDocument(spoof as never, options(f)),
  ).rejects.toBeInstanceOf(Error);
  const crossRealm = runInNewContext("Uint8Array.from(bytes)", {
    bytes,
  }) as Uint8Array;
  expect(
    (await importGltfToGpuModelDocument(crossRealm, options(f))).document
      .meshes,
  ).toHaveLength(1);
});
