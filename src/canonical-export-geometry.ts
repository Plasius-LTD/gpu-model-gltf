import type {
  GpuModelDocument,
  GpuModelAccessor,
  GpuModelMatrix4,
} from "@plasius/gpu-model-core";
import { fail, type JsonRecord } from "./resource-values.js";
import type { ImportBudget } from "./resource-resolution.js";
import { staticGeometryInternals as geometry } from "./static-demo-import.js";

const sizes = {
  scalar: 1,
  vec2: 2,
  vec3: 3,
  vec4: 4,
  mat2: 4,
  mat3: 9,
  mat4: 16,
} as const;
const components = {
  i8: [5120, 1],
  u8: [5121, 1],
  i16: [5122, 2],
  u16: [5123, 2],
  u32: [5125, 4],
  f32: [5126, 4],
} as const;
type Basis = "plain" | "vector" | "tangent" | "rotation" | "indices";

/** @internal One bounded binary packer; every generated view is four-byte aligned. */
export class ExportGeometry {
  readonly accessors: JsonRecord[] = [];
  readonly views: JsonRecord[] = [];
  readonly parts: { offset: number; bytes: Uint8Array }[] = [];
  readonly accessorById: Map<string, GpuModelAccessor>;
  readonly cache = new Map<string, number>();
  length = 0;
  elements = 0;
  constructor(
    readonly document: GpuModelDocument,
    readonly buffers: ReadonlyMap<string, Uint8Array>,
    readonly budget: ImportBudget,
  ) {
    this.accessorById = new Map(document.accessors.map((a) => [a.id, a]));
  }
  view(bytes: Uint8Array, target?: number): number {
    this.budget.check();
    const offset = Math.ceil(this.length / 4) * 4;
    if (bytes.length > this.budget.limits.maxAggregateBytes - offset)
      fail(
        "document-resource-limit",
        "Canonical export binary exceeds its byte budget.",
      );
    this.parts.push({ offset, bytes });
    this.length = offset + bytes.length;
    return (
      this.views.push({
        buffer: 0,
        byteOffset: offset,
        byteLength: bytes.length,
        ...(target ? { target } : {}),
      }) - 1
    );
  }
  consume(count: number) {
    if (
      !Number.isSafeInteger(count) ||
      count > this.budget.limits.maxGeometryElements - this.elements
    )
      fail(
        "document-resource-limit",
        "Canonical export exceeds its expanded element budget.",
      );
    this.elements += count;
  }
  values(a: GpuModelAccessor): number[] {
    const bytes = this.buffers.get(a.resourceId);
    if (!bytes)
      fail(
        "canonical-model-core-rejected",
        "A canonical accessor requires verified buffer data.",
      );
    const [, width] = components[a.componentType],
      size = sizes[a.elementType];
    if (a.elementType.startsWith("mat"))
      fail(
        "unsupported-gltf-feature",
        "Matrix accessors outside skin inverse binds are unsupported.",
      );
    this.consume(a.count * size);
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      stride = a.byteStride ?? size * width;
    const result = new Array<number>(a.count * size);
    for (let i = 0; i < a.count; i++) {
      if ((i & 1023) === 0) this.budget.check();
      for (let c = 0; c < size; c++) {
        const offset = a.byteOffset + i * stride + c * width;
        let v =
          a.componentType === "f32"
            ? data.getFloat32(offset, true)
            : a.componentType === "u32"
              ? data.getUint32(offset, true)
              : a.componentType === "u16"
                ? data.getUint16(offset, true)
                : a.componentType === "i16"
                  ? data.getInt16(offset, true)
                  : a.componentType === "u8"
                    ? data.getUint8(offset)
                    : data.getInt8(offset);
        if (a.normalized)
          v =
            a.componentType === "u8"
              ? v / 255
              : a.componentType === "u16"
                ? v / 65535
                : a.componentType === "i8"
                  ? Math.max(-1, v / 127)
                  : a.componentType === "i16"
                    ? Math.max(-1, v / 32767)
                    : v;
        if (!Number.isFinite(v))
          fail(
            "non-finite-accessor",
            "Canonical accessor contains non-finite data.",
          );
        result[i * size + c] = v;
      }
    }
    return result;
  }
  add(
    values: readonly number[],
    size: number,
    type: "float" | "index" | "joint" = "float",
    target?: number,
  ): number {
    this.budget.check();
    if (!values.length || values.length % size !== 0)
      fail(
        "unsupported-gltf-feature",
        "Canonical accessor shape cannot be exported.",
      );
    const width = type === "joint" ? 2 : 4;
    if (
      values.length * width >
      this.budget.limits.maxAggregateBytes - Math.ceil(this.length / 4) * 4
    )
      fail(
        "document-resource-limit",
        "Canonical export accessor exceeds its byte budget.",
      );
    const bytes = new Uint8Array(values.length * width),
      data = new DataView(bytes.buffer);
    const min = new Array<number>(size).fill(Infinity),
      max = new Array<number>(size).fill(-Infinity);
    for (let i = 0; i < values.length; i++) {
      if ((i & 4095) === 0) this.budget.check();
      const n = values[i]!;
      if (
        type !== "float" &&
        (!Number.isSafeInteger(n) ||
          n < 0 ||
          n > (type === "joint" ? 65535 : 4294967294))
      )
        fail(
          "unsupported-gltf-feature",
          "Canonical integer accessor cannot be represented.",
        );
      if (type === "joint") data.setUint16(i * 2, n, true);
      else if (type === "index") data.setUint32(i * 4, n, true);
      else data.setFloat32(i * 4, n, true);
      const stored = type === "float" ? data.getFloat32(i * 4, true) : n;
      if (!Number.isFinite(stored))
        fail(
          "non-finite-accessor",
          "Canonical export exceeds finite float representation.",
        );
      min[i % size] = Math.min(min[i % size]!, stored);
      max[i % size] = Math.max(max[i % size]!, stored);
    }
    const view = this.view(bytes, target);
    return (
      this.accessors.push({
        bufferView: view,
        componentType: type === "joint" ? 5123 : type === "index" ? 5125 : 5126,
        count: values.length / size,
        type: size === 1 ? "SCALAR" : size === 16 ? "MAT4" : `VEC${size}`,
        ...(size <= 4 ? { min, max } : {}),
      }) - 1
    );
  }
  accessor(
    id: string,
    basis: Basis = "plain",
    target?: number,
    joint = false,
  ): number {
    const key = JSON.stringify([id, basis, target, joint]);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const a = this.accessorById.get(id);
    if (!a)
      fail(
        "canonical-model-core-rejected",
        "Canonical accessor reference is missing.",
      );
    const values = this.values(a),
      size = sizes[a.elementType];
    if (
      (basis === "vector" && size !== 3) ||
      (basis === "tangent" && size !== 4) ||
      (basis === "rotation" && size !== 4) ||
      (basis === "indices" && (size !== 1 || values.length % 3 !== 0))
    )
      fail(
        "unsupported-gltf-feature",
        "Canonical accessor shape conflicts with its export semantic.",
      );
    if (basis === "indices")
      for (let i = 0; i < values.length; i += 3) {
        const swap = values[i + 1]!;
        values[i + 1] = values[i + 2]!;
        values[i + 2] = swap;
      }
    else
      for (let i = 0; i < values.length; i += size) {
        if ((i & 4095) === 0) this.budget.check();
        if (basis === "vector" || basis === "tangent")
          values[i + 2] = -values[i + 2]!;
        if (basis === "tangent") values[i + 3] = -values[i + 3]!;
        if (basis === "rotation") {
          values[i] = -values[i]!;
          values[i + 1] = -values[i + 1]!;
        }
      }
    const index = this.add(
      values,
      size,
      basis === "indices" ? "index" : joint ? "joint" : "float",
      target,
    );
    this.cache.set(key, index);
    return index;
  }
  binary(): Uint8Array {
    const out = new Uint8Array(this.length);
    for (const part of this.parts) {
      this.budget.check();
      out.set(part.bytes, part.offset);
    }
    return out;
  }
}
const name = (v: { readonly name?: string }) =>
  v.name === undefined ? {} : { name: v.name };
/** @internal Build glTF references exclusively from current canonical entities. */
export function exportScene(
  document: GpuModelDocument,
  pack: ExportGeometry,
): JsonRecord {
  const index = <T extends { readonly id: string }>(items: readonly T[]) =>
    new Map(items.map((v, i) => [v.id, i]));
  const nodes = index(document.nodes),
    meshes = index(document.meshes),
    materials = index(document.materials),
    skins = index(document.skins);
  const jointById = new Map(document.joints.map((j) => [j.id, j]));
  const shapesByMesh = new Map(
    document.meshes.map((m) => [
      m.id,
      document.blendShapes.filter((s) => s.meshId === m.id),
    ]),
  );
  const meshValues = document.meshes.map((m) => {
    pack.budget.check();
    const shapes = shapesByMesh.get(m.id)!;
    if (
      shapes.some(
        (s) =>
          s.deltas.length !== m.primitives.length ||
          m.primitives.some(
            (p) => !s.deltas.some((d) => d.primitiveId === p.id),
          ),
      )
    )
      fail(
        "unsupported-gltf-feature",
        "Every morph target must cover all mesh primitives.",
      );
    if (
      shapes.some((s) => s.name !== undefined) &&
      shapes.some((s) => s.name === undefined)
    )
      fail(
        "unsupported-gltf-feature",
        "Partial morph target names cannot be exported losslessly.",
      );
    return {
      ...name(m),
      ...(shapes.length
        ? {
            weights: shapes.map((s) => s.defaultWeight ?? 0),
            ...(shapes[0]?.name === undefined
              ? {}
              : { extras: { targetNames: shapes.map((s) => s.name) } }),
          }
        : {}),
      primitives: m.primitives.map((p) => {
        pack.budget.check();
        if (p.topology !== "triangles")
          fail(
            "unsupported-gltf-feature",
            "Only canonical triangle lists are supported by this export profile.",
          );
        const attributes: JsonRecord = {};
        for (const attr of p.attributes) {
          if (
            !/^(?:POSITION|NORMAL|TANGENT|TEXCOORD_[0-7]|COLOR_[0-7]|JOINTS_[0-7]|WEIGHTS_[0-7])$/u.test(
              attr.semantic,
            )
          )
            fail(
              "unsupported-gltf-feature",
              "A canonical vertex semantic is unsupported.",
            );
          attributes[attr.semantic] = pack.accessor(
            attr.accessorId,
            attr.semantic === "TANGENT"
              ? "tangent"
              : ["POSITION", "NORMAL"].includes(attr.semantic)
                ? "vector"
                : "plain",
            34962,
            attr.semantic.startsWith("JOINTS_"),
          );
        }
        let indices: number;
        if (p.indicesAccessorId)
          indices = pack.accessor(p.indicesAccessorId, "indices", 34963);
        else {
          const a = pack.accessorById.get(
            p.attributes.find((a) => a.semantic === "POSITION")!.accessorId,
          )!;
          pack.consume(a.count);
          if (a.count % 3 !== 0)
            fail(
              "unsupported-gltf-feature",
              "Non-indexed triangles require complete triples.",
            );
          const values = Array.from({ length: a.count }, (_, i) => i);
          for (let i = 0; i < values.length; i += 3) {
            values[i + 1] = i + 2;
            values[i + 2] = i + 1;
          }
          indices = pack.add(values, 1, "index", 34963);
        }
        return {
          attributes,
          indices,
          mode: 4,
          ...(p.materialId ? { material: materials.get(p.materialId) } : {}),
          ...(shapes.length
            ? {
                targets: shapes.map((s) => {
                  const d = s.deltas.find((d) => d.primitiveId === p.id)!;
                  const target: JsonRecord = {};
                  for (const [key, id] of [
                    ["POSITION", d.positionAccessorId],
                    ["NORMAL", d.normalAccessorId],
                    ["TANGENT", d.tangentAccessorId],
                  ] as const)
                    if (id) target[key] = pack.accessor(id, "vector", 34962);
                  if (!Object.keys(target).length)
                    fail(
                      "unsupported-gltf-feature",
                      "Empty canonical morph targets are unsupported.",
                    );
                  return target;
                }),
              }
            : {}),
        };
      }),
    };
  });
  const skinValues = document.skins.map((s) => {
    pack.budget.check();
    pack.consume(s.inverseBindMatrices.length * 16);
    const values = s.inverseBindMatrices.flatMap((m) => [
      ...geometry.conjugateBasis(m),
    ]);
    const skel = document.skeletons.find((k) => k.id === s.skeletonId)!;
    // glTF skeleton is optional. No source metadata is used to guess scene ownership.
    return {
      ...name(skel),
      joints: s.jointIds.map((id) => nodes.get(jointById.get(id)!.nodeId)),
      inverseBindMatrices: pack.add(values, 16),
    };
  });
  const animations = document.animations.map((a) => {
    pack.budget.check();
    const samplers = index(a.samplers);
    const paths = new Map<string, string>();
    for (const c of a.channels) {
      if (c.targetType === "weights")
        fail(
          "unsupported-gltf-feature",
          "Blend-shape channels require a node binding for lossless glTF export.",
        );
      const path =
        c.targetType === "node-weights" ? "weights" : c.targetType.slice(5);
      const previous = paths.get(c.samplerId);
      if (previous && previous !== path)
        fail(
          "unsupported-gltf-feature",
          "A shared animation sampler requires matching target semantics.",
        );
      paths.set(c.samplerId, path);
    }
    return {
      ...name(a),
      samplers: a.samplers.map((s) => {
        const path = paths.get(s.id);
        if (!path)
          fail(
            "unsupported-gltf-feature",
            "Unused animation samplers cannot be exported losslessly.",
          );
        return {
          input: pack.accessor(s.inputAccessorId),
          output: pack.accessor(
            s.outputAccessorId,
            path === "translation"
              ? "vector"
              : path === "rotation"
                ? "rotation"
                : "plain",
          ),
          interpolation:
            s.interpolation === "cubic-spline"
              ? "CUBICSPLINE"
              : s.interpolation.toUpperCase(),
        };
      }),
      channels: a.channels.map((c) => ({
        sampler: samplers.get(c.samplerId),
        target: { node: nodes.get(c.targetId), path: paths.get(c.samplerId) },
      })),
    };
  });
  return {
    asset: {
      version: "2.0",
      generator: "@plasius/gpu-model-gltf canonical-v1",
    },
    scene: 0,
    scenes: [{ nodes: document.roots.map((id) => nodes.get(id)) }],
    nodes: document.nodes.map((n) => {
      const trs = n.restLocalTransform;
      return {
        ...name(n),
        ...(n.children.length
          ? { children: n.children.map((id) => nodes.get(id)) }
          : {}),
        ...(n.meshId ? { mesh: meshes.get(n.meshId) } : {}),
        ...(n.skinId ? { skin: skins.get(n.skinId) } : {}),
        ...(trs
          ? {
              translation: [
                trs.translation[0],
                trs.translation[1],
                -trs.translation[2],
              ],
              rotation: [
                -trs.rotation[0],
                -trs.rotation[1],
                trs.rotation[2],
                trs.rotation[3],
              ],
              scale: [...trs.scale],
            }
          : {
              matrix: geometry.conjugateBasis(n.localMatrix as GpuModelMatrix4),
            }),
        ...(n.morphWeights
          ? {
              weights: shapesByMesh
                .get(n.meshId!)!
                .map(
                  (s) =>
                    n.morphWeights!.find((w) => w.blendShapeId === s.id)!
                      .weight,
                ),
            }
          : {}),
      };
    }),
    meshes: meshValues,
    ...(skinValues.length ? { skins: skinValues } : {}),
    ...(animations.length ? { animations } : {}),
    accessors: pack.accessors,
    bufferViews: pack.views,
  };
}
