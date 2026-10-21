import { extended, encoder, options } from "./material-fixture.js";

export const deformationProfile = "gltf-deformation-resources-v1" as const;
export type RigFixture = ReturnType<typeof extended>;
export const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Append aligned, dense synthetic data; source indices stay explicit in tests. */
export function append(f: RigFixture, values: number[], type: string, componentType = 5126, target?: number) {
  const sizes: Record<string, number> = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 };
  const width = componentType === 5121 ? 1 : componentType === 5123 ? 2 : 4;
  const offset = Math.ceil(f.bytes.length / 4) * 4;
  const bytes = new Uint8Array(offset + values.length * width); bytes.set(f.bytes);
  const view = new DataView(bytes.buffer);
  values.forEach((v, i) => {
    if (width === 1) view.setUint8(offset + i, v);
    else if (width === 2) view.setUint16(offset + i * 2, v, true);
    else view.setFloat32(offset + i * 4, v, true);
  });
  const bufferView = f.json.bufferViews.length;
  f.json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: values.length * width, ...(target ? { target } : {}) });
  const index = f.json.accessors.length;
  const size = sizes[type]!;
  const min = Array.from({ length: size }, (_, c) => Math.min(...values.filter((_, i) => i % size === c)));
  const max = Array.from({ length: size }, (_, c) => Math.max(...values.filter((_, i) => i % size === c)));
  f.json.accessors.push({ bufferView, componentType, type, count: values.length / size, min, max });
  f.bytes = bytes; f.json.buffers[0].byteLength = bytes.length;
  return index;
}

export function rig(interpolation = "LINEAR") {
  const f = extended();
  const p = f.json.meshes[0].primitives[0];
  p.attributes.JOINTS_0 = append(f, [0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0], "VEC4", 5121, 34962);
  p.attributes.WEIGHTS_0 = append(f, [0.75, 0.25, 0, 0, 0.75, 0.25, 0, 0, 0.75, 0.25, 0, 0], "VEC4", 5126, 34962);
  p.targets = [0, 1].map(i => ({
    POSITION: append(f, [0, 0, i + 1, 0, 0, i + 1, 0, 0, i + 1], "VEC3", 5126, 34962),
    NORMAL: append(f, [0.25, 0, 0, 0.25, 0, 0, 0.25, 0, 0], "VEC3", 5126, 34962),
    TANGENT: append(f, [0, 0, 0.5, 0, 0, 0.5, 0, 0, 0.5], "VEC3", 5126, 34962),
  }));
  f.json.meshes[0].weights = [-0.25, 1.5];
  f.json.meshes[0].extras = { targetNames: ["bend", "stretch"] };
  f.json.nodes = [{ mesh: 0, skin: 0 }, { children: [2] }, { translation: [0, 1, 0] }, { mesh: 0, skin: 0, weights: [0.75, -0.5] }];
  f.json.scenes[0].nodes = [0, 1, 3];
  const inverse = [...identity]; inverse[14] = -2;
  f.json.skins = [{ name: "rig", joints: [1, 2], skeleton: 1, inverseBindMatrices: append(f, [...identity, ...inverse], "MAT4") }];
  const input = append(f, [0, 1], "SCALAR");
  const tracks = [
    { node: 0, path: "translation", type: "VEC3", keys: [[1, 2, 3], [-2, 4, -6]], tangent: [0.1, -0.2, 0.3] },
    { node: 0, path: "rotation", type: "VEC4", keys: [[0, 0, 0, -1], [0.6, 0, 0, -0.8]], tangent: [0.1, -0.2, 0.3, -0.4] },
    { node: 0, path: "scale", type: "VEC3", keys: [[1, 1, 1], [-1, 2, 0]], tangent: [0.1, -0.2, 0.3] },
    { node: 0, path: "weights", type: "SCALAR", keys: [[-0.25, 1.5], [2, -1]], tangent: [-0.1, 0.2] },
    { node: 3, path: "weights", type: "SCALAR", keys: [[0.75, -0.5], [-2, 3]], tangent: [0.3, -0.4] },
  ];
  f.json.animations = [{ name: "move", extras: { purpose: "synthetic" },
    samplers: tracks.map(t => ({ input, output: append(f, t.keys.flatMap(k => interpolation === "CUBICSPLINE" ? [...t.tangent, ...k, ...t.tangent] : k), t.type), interpolation })),
    channels: tracks.map((t, sampler) => ({ sampler, target: { node: t.node, path: t.path } })),
  }];
  return f;
}
export const rigBytes = (f: RigFixture) => encoder.encode(JSON.stringify(f.json));
export const rigOptions = (f: RigFixture) => ({ ...options(f), profile: deformationProfile });
