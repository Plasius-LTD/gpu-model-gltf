import { expect, vi } from "vitest";
import type { ResourceResolver } from "@plasius/gpu-model-runtime";
type Json = Record<string, any>;
export const encoder = new TextEncoder();
export const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==",
    "base64",
  ),
);
export function fixture(): { json: Json; bytes: Uint8Array } {
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
export function resolver(
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
export function options(f = fixture()) {
  return {
    conversionEnabled: true,
    resourceResolver: resolver({
      "mesh.bin": f.bytes,
      "textures/pixel.png": png,
    }),
  };
}
export function glb(json: Json, binary?: Uint8Array) {
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
export const code = (value: string) => (error: unknown) =>
  !!error &&
  typeof error === "object" &&
  "code" in error &&
  error.code === value;


const extensions = {
  KHR_materials_clearcoat: { clearcoatFactor: 0.8, clearcoatRoughnessFactor: 0.2, clearcoatTexture: { index: 0 }, clearcoatRoughnessTexture: { index: 0 }, clearcoatNormalTexture: { index: 0, scale: 0.4 } },
  KHR_materials_transmission: { transmissionFactor: 0.7, transmissionTexture: { index: 0 } },
  KHR_materials_sheen: { sheenColorFactor: [0.1, 0.2, 0.3], sheenRoughnessFactor: 0.6, sheenColorTexture: { index: 0 }, sheenRoughnessTexture: { index: 0 } },
  KHR_materials_ior: { ior: 1.7 },
  KHR_materials_specular: { specularFactor: 0.9, specularColorFactor: [1.2, 0.7, 0.6], specularTexture: { index: 0 }, specularColorTexture: { index: 0 } },
  KHR_materials_volume: { thicknessFactor: 2, thicknessTexture: { index: 0 }, attenuationDistance: 5, attenuationColor: [0.9, 0.8, 0.7] },
  KHR_materials_iridescence: { iridescenceFactor: 0.4, iridescenceIor: 1.4, iridescenceThicknessMinimum: 120, iridescenceThicknessMaximum: 450, iridescenceTexture: { index: 0 }, iridescenceThicknessTexture: { index: 0 } },
  KHR_materials_anisotropy: { anisotropyStrength: 0.5, anisotropyRotation: -0.2, anisotropyTexture: { index: 0 } },
  KHR_materials_dispersion: { dispersion: 0.3 },
};
export function extended() {
  const f = fixture();
  const bytes = new Uint8Array(152); bytes.set(f.bytes); const v = new DataView(bytes.buffer);
  for (let i=0; i<3; i++) { v.setFloat32(68+i*12+8, 1, true); v.setFloat32(104+i*16, 1, true); v.setFloat32(104+i*16+12, 1, true); }
  f.bytes = bytes; f.json.buffers[0].byteLength = bytes.length;
  f.json.bufferViews.push({buffer:0,byteOffset:68,byteLength:36,target:34962},{buffer:0,byteOffset:104,byteLength:48,target:34962});
  f.json.accessors.push({bufferView:3,componentType:5126,count:3,type:"VEC3"},{bufferView:4,componentType:5126,count:3,type:"VEC4"});
  f.json.meshes[0].primitives[0].attributes.NORMAL = 3; f.json.meshes[0].primitives[0].attributes.TANGENT = 4;
  f.json.extensionsUsed = Object.keys(extensions);
  f.json.materials[0].extensions = structuredClone(extensions);
  return f;
}
