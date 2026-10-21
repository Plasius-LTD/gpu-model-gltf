import { materialExtensions, textureInfo, colorSpace } from "./resource-materials.js";
import {
  CANONICAL_GPU_MODEL_COORDINATE_SYSTEM,
  GPU_MODEL_DOCUMENT_SCHEMA_VERSION,
  createAndVerifyGpuModelDocument,
  type GpuModelAccessor,
  type GpuModelDocument,
  type GpuModelMaterial,
  type GpuModelMesh,
  type GpuModelNode,
  type GpuModelResourceInspection,
  type GpuModelResourceVerificationContext,
  type GpuModelTexture,
  type GpuModelTextureUsage,
  type GpuModelVec3,
} from "@plasius/gpu-model-core";
import { gltfFormatInternals as format } from "./glb-adapter.js";
import { staticGeometryInternals as geometry } from "./static-demo-import.js";
import {
  array,
  record,
  integer,
  fail,
  type ImportBudget,
  type JsonRecord,
  type ResolvedImport,
} from "./resource-resolution.js";

const COMPONENTS: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
};
const COMPONENT_BYTES: Record<number, number> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};
function read(
  view: DataView,
  offset: number,
  type: number,
  normalized: boolean,
): number {
  switch (type) {
    case 5120: {
      const n = view.getInt8(offset);
      return normalized ? Math.max(-1, n / 127) : n;
    }
    case 5121: {
      const n = view.getUint8(offset);
      return normalized ? n / 255 : n;
    }
    case 5122: {
      const n = view.getInt16(offset, true);
      return normalized ? Math.max(-1, n / 32767) : n;
    }
    case 5123: {
      const n = view.getUint16(offset, true);
      return normalized ? n / 65535 : n;
    }
    case 5125:
      return view.getUint32(offset, true);
    case 5126:
      return view.getFloat32(offset, true);
    default:
      fail(
        "unsupported-gltf-feature",
        "An accessor component representation is unsupported.",
      );
  }
}
interface DecodedAccessor {
  readonly count: number;
  readonly size: number;
  readonly values: Float32Array | Uint32Array;
}
function accessor(
  source: ResolvedImport,
  index: number,
  indices: boolean,
  budget: ImportBudget,
): DecodedAccessor {
  const accessors = array(source.document.accessors);
  const a = record(accessors[integer(index, 0, accessors.length - 1)]);
  const size = COMPONENTS[String(a.type)];
  if (!size)
    fail(
      "unsupported-gltf-feature",
      "Only scalar and vector static geometry accessors are admitted.",
    );
  const count = integer(a.count, 1);
  const componentType = integer(a.componentType);
  if (
    indices &&
    (a.type !== "SCALAR" ||
      ![5121, 5123, 5125].includes(componentType) ||
      a.normalized === true)
  )
    fail(
      "invalid-gltf-document",
      "Triangle indices must be unsigned integer scalar data.",
    );
  const length = count * size;
  if (length > budget.limits.maxGeometryElements)
    fail(
      "document-resource-limit",
      "Decoded geometry exceeds the element budget.",
    );
  const values = indices ? new Uint32Array(length) : new Float32Array(length);
  if (a.bufferView === undefined) return { count, size, values };
  const views = array(source.document.bufferViews);
  const v = record(views[integer(a.bufferView, 0, views.length - 1)]);
  const width = COMPONENT_BYTES[componentType];
  if (!width)
    fail("invalid-gltf-document", "Accessor component type is invalid.");
  const stride = integer(v.byteStride ?? size * width, size * width);
  const start = integer(v.byteOffset ?? 0) + integer(a.byteOffset ?? 0);
  const bytes = new DataView(
    source.binary.buffer,
    source.binary.byteOffset,
    source.binary.byteLength,
  );
  for (let i = 0; i < count; i += 1) {
    if ((i & 1023) === 0) budget.check();
    for (let j = 0; j < size; j += 1) {
      const value = read(
        bytes,
        start + i * stride + j * width,
        componentType,
        a.normalized === true,
      );
      if (!Number.isFinite(value))
        fail("non-finite-accessor", "An accessor contains non-finite data.");
      values[i * size + j] = value;
    }
  }
  return { count, size, values };
}
function tuple(value: unknown, fallback: readonly number[]) {
  return value === undefined
    ? [...fallback]
    : array(value).map((v) => {
        if (typeof v !== "number" || !Number.isFinite(v))
          fail("invalid-gltf-document", "A material factor is invalid.");
        return v;
      });
}
function mapMaterials(source: ResolvedImport): {
  materials: GpuModelMaterial[];
  textures: GpuModelTexture[];
} {
  const usages = new Map<number, Set<GpuModelTextureUsage>>();
  const bind = (value: unknown, usage: GpuModelTextureUsage) => {
    if (value === undefined) return undefined;
    const { index, ...interpretation } = textureInfo(value, source.document, usage === "normal" || usage === "clearcoat-normal", usage === "occlusion");
    const set = usages.get(index) ?? new Set<GpuModelTextureUsage>();
    set.add(usage); usages.set(index, set);
    return { textureId: `texture-${index}`, ...interpretation, colorSpace: colorSpace(usage), intendedUsage: usage };
  };
  const materials = array(source.document.materials).map((value, i) => {
    const m = record(value);
    const pbr =
      m.pbrMetallicRoughness === undefined
        ? {}
        : record(m.pbrMetallicRoughness);
    const textureEntries = [
      ["baseColor", bind(pbr.baseColorTexture, "base-color")],
      [
        "metallicRoughness",
        bind(pbr.metallicRoughnessTexture, "metallic-roughness"),
      ],
      ["normal", bind(m.normalTexture, "normal")],
      ["occlusion", bind(m.occlusionTexture, "occlusion")],
      ["emissive", bind(m.emissiveTexture, "emissive")],
    ].filter(([, v]) => v !== undefined);
    const extension = materialExtensions(m, bind);
    return {
      ...extension,
      id: `material-${i}`,
      ...(m.name === undefined ? {} : { name: m.name }),
      alphaMode: String(m.alphaMode ?? "OPAQUE").toLowerCase(),
      ...(m.alphaMode === "MASK" ? { alphaCutoff: m.alphaCutoff ?? 0.5 } : {}),
      doubleSided: m.doubleSided ?? false,
      baseColorFactor: tuple(pbr.baseColorFactor, [1, 1, 1, 1]),
      metallicFactor: pbr.metallicFactor ?? 1,
      roughnessFactor: pbr.roughnessFactor ?? 1,
      emissiveFactor: tuple(m.emissiveFactor, [0, 0, 0]),
      ...(m.normalTexture === undefined
        ? {}
        : { normalScale: record(m.normalTexture).scale ?? 1 }),
      ...(m.occlusionTexture === undefined
        ? {}
        : { occlusionStrength: record(m.occlusionTexture).strength ?? 1 }),
      textures: { ...Object.fromEntries(textureEntries), ...extension.textures },
      sourceMetadata: m.extras === undefined ? {} : { sourceExtras: m.extras },
    } as unknown as GpuModelMaterial;
  });
  const spaces = new Map<number, Set<string>>();
  for (const m of materials)
    for (const binding of Object.values(m.textures)) {
      const index = Number(binding.textureId.slice(8));
      const set = spaces.get(index) ?? new Set<string>();
      set.add(binding.colorSpace);
      spaces.set(index, set);
    }
  for (const m of materials)
    for (const binding of Object.values(m.textures)) {
      const index = Number(binding.textureId.slice(8));
      if (spaces.get(index)!.size > 1)
        (binding as { textureId: string }).textureId +=
          `-${binding.colorSpace}`;
    }
  const wraps: Record<number, "repeat" | "mirrored-repeat" | "clamp-to-edge"> =
    { 10497: "repeat", 33648: "mirrored-repeat", 33071: "clamp-to-edge" };
  const textures = array(source.document.textures).flatMap((value, i) => {
    const t = record(value);
    const imageIndex = integer(t.source, 0, source.images.length - 1);
    const image = source.images[imageIndex]!;
    const rawSamplers = array(source.document.samplers);
    const s =
      t.sampler === undefined
        ? {}
        : record(rawSamplers[integer(t.sampler, 0, rawSamplers.length - 1)]);
    const min = integer(s.minFilter ?? 9987);
    const usage = [...(usages.get(i) ?? [])].sort();
    const admittedSpaces = [...(spaces.get(i) ?? new Set(["linear"]))].sort();
    return admittedSpaces.map(
      (space) =>
        ({
          id: `texture-${i}${admittedSpaces.length > 1 ? `-${space}` : ""}`,
          imageResourceId: `image-${imageIndex}`,
          mimeType: image.mime,
          contentHash: "",
          byteLength: image.bytes.length,
          intendedUsage: usage.filter(
            (u) =>
              colorSpace(u) === space,
          ),
          colorSpace: space,
          sampler: {
            id: `sampler-${i}`,
            wrapS: wraps[integer(s.wrapS ?? 10497)]!,
            wrapT: wraps[integer(s.wrapT ?? 10497)]!,
            minFilter: [9728, 9984, 9986].includes(min) ? "nearest" : "linear",
            magFilter: s.magFilter === 9728 ? "nearest" : "linear",
            ...([9984, 9985, 9986, 9987].includes(min)
              ? { mipFilter: min < 9986 ? "nearest" : "linear" }
              : {}),
          },
          exportEmbeddingPolicy: "inherit-source",
          sourceMetadata: {},
        }) as GpuModelTexture,
    );
  });
  return { materials, textures };
}
/** @internal Map format-owned dense static triangles to the released core contract. */
export async function canonicalize(
  source: ResolvedImport,
  budget: ImportBudget,
  profile: string,
): Promise<GpuModelDocument> {
  const accessors: GpuModelAccessor[] = [];
  const packedParts: Uint8Array[] = [];
  let packedLength = 0;
  let elements = 0;
  const add = (
    decoded: DecodedAccessor,
    semantic: string,
  ): GpuModelAccessor => {
    elements += decoded.values.length;
    if (
      elements > budget.limits.maxGeometryElements ||
      decoded.values.byteLength > budget.limits.maxAggregateBytes - packedLength
    )
      fail(
        "document-resource-limit",
        "Canonical geometry exceeds its decoded budget.",
      );
    const id = `accessor-${accessors.length}`;
    if (["POSITION", "NORMAL", "TANGENT"].includes(semantic)) {
      for (let i = 0; i < decoded.count; i += 1) {
        if ((i & 1023) === 0) budget.check();
        decoded.values[i * decoded.size + 2] =
          -decoded.values[i * decoded.size + 2]!;
        if (semantic === "TANGENT")
          decoded.values[i * decoded.size + 3] =
            -decoded.values[i * decoded.size + 3]!;
      }
    }
    // Serialize little endian explicitly, independent of the host's typed-array basis.
    const bytes = new Uint8Array(decoded.values.byteLength);
    const view = new DataView(bytes.buffer);
    const isIndex = semantic === "INDICES";
    for (let i = 0; i < decoded.values.length; i += 1) {
      if ((i & 4095) === 0) budget.check();
      if (isIndex) view.setUint32(i * 4, decoded.values[i]!, true);
      else view.setFloat32(i * 4, decoded.values[i]!, true);
    }
    const minima = new Array(decoded.size).fill(Infinity) as number[];
    const maxima = new Array(decoded.size).fill(-Infinity) as number[];
    for (let i = 0; i < decoded.count; i += 1) {
      if ((i & 1023) === 0) budget.check();
      for (let c = 0; c < decoded.size; c += 1) {
        const n = decoded.values[i * decoded.size + c]!;
        minima[c] = Math.min(minima[c]!, n);
        maxima[c] = Math.max(maxima[c]!, n);
      }
    }
    const a: GpuModelAccessor = {
      id,
      resourceId: "geometry",
      byteOffset: packedLength,
      count: decoded.count,
      componentType: isIndex ? "u32" : "f32",
      elementType:
        decoded.size === 1
          ? "scalar"
          : (`vec${decoded.size}` as GpuModelAccessor["elementType"]),
      min: minima,
      max: maxima,
    };
    accessors.push(a);
    packedParts.push(bytes);
    packedLength += bytes.length;
    return a;
  };
  const positionsByMesh = new Map<number, readonly Float32Array[]>();
  const meshes = array(source.document.meshes).map(
    (value, meshIndex): GpuModelMesh => {
      const mesh = record(value);
      const positions: Float32Array[] = [];
      const primitives = array(mesh.primitives).map((v, primitiveIndex) => {
        budget.check();
        const primitive = record(v);
        const attrs = record(primitive.attributes);
        const attributes: { semantic: string; accessorId: string }[] = [];
        let positionCount = 0;
        for (const [semantic, index] of Object.entries(attrs)) {
          if (/^(?:JOINTS|WEIGHTS)_/u.test(semantic))
            fail(
              "unsupported-gltf-feature",
              "Joint and weight attributes require the skinning profile.",
            );
          const decoded = accessor(source, integer(index), false, budget);
          if (
            ((semantic === "POSITION" || semantic === "NORMAL") &&
              decoded.size !== 3) ||
            (semantic === "TANGENT" && decoded.size !== 4)
          )
            fail(
              "invalid-gltf-document",
              "A geometry semantic has the wrong vector representation.",
            );
          const a = add(decoded, semantic);
          attributes.push({ semantic, accessorId: a.id });
          if (semantic === "POSITION") {
            positions.push(decoded.values as Float32Array);
            positionCount = decoded.count;
          }
        }
        const indices =
          primitive.indices === undefined
            ? {
                count: positionCount,
                size: 1,
                values: Uint32Array.from(
                  { length: positionCount },
                  (_, i) => i,
                ),
              }
            : accessor(source, integer(primitive.indices), true, budget);
        if (indices.count % 3 !== 0)
          fail(
            "invalid-gltf-document",
            "Triangle-list index counts must be divisible by three.",
          );
        for (let i = 0; i < indices.count; i += 3) {
          if ((i & 4095) === 0) budget.check();
          if (
            indices.values[i]! >= positionCount ||
            indices.values[i + 1]! >= positionCount ||
            indices.values[i + 2]! >= positionCount
          )
            fail(
              "accessor-out-of-bounds",
              "A triangle index exceeds its POSITION accessor.",
            );
          const swap = indices.values[i + 1]!;
          indices.values[i + 1] = indices.values[i + 2]!;
          indices.values[i + 2] = swap;
        }
        const indexAccessor = add(indices, "INDICES");
        return {
          id: `primitive-${meshIndex}-${primitiveIndex}`,
          topology: "triangles" as const,
          attributes,
          indicesAccessorId: indexAccessor.id,
          ...(primitive.material === undefined
            ? {}
            : { materialId: `material-${integer(primitive.material)}` }),
        };
      });
      positionsByMesh.set(meshIndex, positions);
      return {
        id: `mesh-${meshIndex}`,
        ...(mesh.name === undefined ? {} : { name: mesh.name as string }),
        ...(mesh.extras === undefined
          ? {}
          : {
              metadata: {
                sourceExtras: mesh.extras,
              } as GpuModelMesh["metadata"],
            }),
        primitives,
      };
    },
  );
  const sourceNodes = array(source.document.nodes).map(record);
  const scenes = array(source.document.scenes);
  if (scenes.length > 1)
    fail(
      "unsupported-gltf-feature",
      "Multiple scene selection requires a separate profile; no scene is silently discarded.",
    );
  const childSet = new Set(
    sourceNodes.flatMap((n) =>
      array(n.children).map((v) => integer(v, 0, sourceNodes.length - 1)),
    ),
  );
  const roots = scenes.length
    ? array(
        record(
          scenes[integer(source.document.scene ?? 0, 0, scenes.length - 1)],
        ).nodes,
      ).map((v) => integer(v, 0, sourceNodes.length - 1))
    : sourceNodes.map((_, i) => i).filter((i) => !childSet.has(i));
  const nodes: GpuModelNode[] = sourceNodes.map((n, i) => ({
    id: `node-${i}`,
    ...(n.name === undefined ? {} : { name: n.name as string }),
    ...(n.extras === undefined
      ? {}
      : { metadata: { sourceExtras: n.extras } as GpuModelNode["metadata"] }),
    children: array(n.children).map(
      (c) => `node-${integer(c, 0, sourceNodes.length - 1)}`,
    ),
    ...(n.mesh === undefined
      ? {}
      : { meshId: `mesh-${integer(n.mesh, 0, meshes.length - 1)}` }),
    localMatrix: geometry.conjugateBasis(geometry.matrixFromNode(n, i)),
  }));
  const seen = new Set<number>();
  const worldPositions: {
    matrix: GpuModelNode["localMatrix"];
    positions: readonly Float32Array[];
  }[] = [];
  const queue = roots.map((i) => ({ index: i, matrix: nodes[i]!.localMatrix }));
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    budget.check();
    const { index, matrix } = queue[cursor]!;
    if (seen.has(index))
      fail(
        "invalid-gltf-document",
        "The scene hierarchy repeats a node or contains a cycle.",
      );
    seen.add(index);
    const n = sourceNodes[index]!;
    if (n.mesh !== undefined)
      worldPositions.push({
        matrix,
        positions: positionsByMesh.get(n.mesh as number)!,
      });
    for (const child of array(n.children)) {
      const c = integer(child, 0, nodes.length - 1);
      queue.push({
        index: c,
        matrix: geometry.multiplyMatrices(matrix, nodes[c]!.localMatrix),
      });
    }
    if (queue.length > budget.limits.maxNodes)
      fail(
        "document-resource-limit",
        "The scene graph exceeds its traversal budget.",
      );
  }
  if (seen.size !== nodes.length)
    fail(
      "unsupported-gltf-feature",
      "The selected scene must own every source node.",
    );
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let vertices = 0;
  for (const world of worldPositions)
    for (const positions of world.positions)
      for (let i = 0; i < positions.length; i += 3) {
        if ((vertices & 1023) === 0) budget.check();
        vertices += 1;
        if (vertices > budget.limits.maxWorldVertices)
          fail(
            "document-resource-limit",
            "Instanced world geometry exceeds its work budget.",
          );
        const position = geometry.transformPosition(world.matrix, [
          positions[i]!,
          positions[i + 1]!,
          positions[i + 2]!,
        ]);
        for (let c = 0; c < 3; c += 1) {
          min[c] = Math.min(min[c]!, position[c]!);
          max[c] = Math.max(max[c]!, position[c]!);
        }
      }
  if (!vertices)
    fail(
      "invalid-gltf-document",
      "A canonical import requires scene-referenced geometry.",
    );
  const centerX = (min[0]! + max[0]!) / 2;
  const centerZ = (min[2]! + max[2]!) / 2;
  const normalization = [
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    -centerX,
    -min[1]!,
    -centerZ,
    1,
  ] as unknown as GpuModelNode["localMatrix"];
  const packed = new Uint8Array(packedLength);
  let offset = 0;
  for (const bytes of packedParts) {
    packed.set(bytes, offset);
    offset += bytes.length;
  }
  const imageBytes = source.images.reduce(
    (n, image) => n + image.bytes.length,
    0,
  );
  if (packed.length + imageBytes > budget.limits.maxAggregateBytes)
    fail(
      "document-resource-limit",
      "Canonical resource bytes exceed their aggregate limit.",
    );
  const resources = [
    {
      id: "geometry",
      kind: "buffer",
      contentHash: await budget.wait(format.sha256(packed)),
      byteLength: packed.length,
      mimeType: "application/octet-stream",
      payload: new Blob([packed.buffer]),
    },
  ];
  for (const [i, image] of source.images.entries())
    resources.push({
      id: `image-${i}`,
      kind: "image",
      contentHash: await budget.wait(format.sha256(image.bytes)),
      byteLength: image.bytes.length,
      mimeType: image.mime,
      payload: new Blob([image.bytes as Uint8Array<ArrayBuffer>], {
        type: image.mime,
      }),
    });
  const { materials, textures } = mapMaterials(source);
  for (const t of textures)
    (t as { contentHash: string }).contentHash = resources.find(
      (r) => r.id === t.imageResourceId,
    )!.contentHash;
  const collect = async (
    chunks: AsyncIterable<Uint8Array>,
    context: GpuModelResourceVerificationContext,
  ) => {
    const result = new Uint8Array(context.byteLength);
    let cursor = 0;
    for await (const chunk of chunks) {
      budget.check();
      if (chunk.length > result.length - cursor)
        fail(
          "document-resource-limit",
          "Canonical verification exceeded its bound.",
        );
      result.set(chunk, cursor);
      cursor += chunk.length;
    }
    if (cursor !== result.length)
      fail(
        "canonical-model-core-rejected",
        "Canonical verification bytes are truncated.",
      );
    return result;
  };
  budget.check();
  try {
    return await budget.wait(
      createAndVerifyGpuModelDocument(
        {
          schemaVersion: GPU_MODEL_DOCUMENT_SCHEMA_VERSION,
          coordinateSystem: CANONICAL_GPU_MODEL_COORDINATE_SYSTEM,
          roots: ["normalization-root"],
          nodes: [
            {
              id: "normalization-root",
              children: roots.map((i) => `node-${i}`),
              localMatrix: normalization,
            },
            ...nodes,
          ],
          resources,
          accessors,
          meshes,
          materials,
          textures,
          skeletons: [],
          joints: [],
          skins: [],
          blendShapes: [],
          animations: [],
          analyticGeometry: [],
          bounds: {
            min: [min[0]! - centerX, 0, min[2]! - centerZ] as GpuModelVec3,
            max: [
              max[0]! - centerX,
              max[1]! - min[1]!,
              max[2]! - centerZ,
            ] as GpuModelVec3,
          },
          provenance: {
            sourceFormat: source.sourceFormat,
            sourceContentHash: source.sourceContentHash,
            converterId: "gltf-resource-importer",
            converterVersion: "2026-10-21.v2",
          },
          diagnostics: [
            {
              severity: "info",
              code: "gltf-resource-canonicalized",
              message:
                "Bounded static geometry and image resources were verified in the canonical basis.",
            },
          ],
          metadata: { profile },
        },
        {
          digestSha256: async (chunks, context) =>
            format.sha256(await collect(chunks, context)),
          inspectResource: async (
            chunks,
            context,
          ): Promise<GpuModelResourceInspection> => {
            await collect(chunks, context);
            if (context.kind === "buffer")
              return {
                valid: true,
                detectedMimeType: "application/octet-stream",
              };
            // Payloads are owned immutable Blobs; format admission already fully decoded these exact image bytes.
            const image = source.images[Number(context.resourceId.slice(6))]!;
            return {
              valid: true,
              detectedMimeType: image.mime,
              width: image.width,
              height: image.height,
            };
          },
        },
        {
          signal: budget.signal,
          limits: {
            maxResourceBytes: budget.limits.maxResourceBytes,
            maxAggregateBytes: budget.limits.maxAggregateBytes,
            maxImageBytes: budget.limits.maxResourceBytes,
            maxAggregateImageBytes: budget.limits.maxAggregateBytes,
            maxImageDimension: budget.limits.maxImageDimension,
          },
        },
      ),
    );
  } catch {
    budget.check();
    fail(
      "canonical-model-core-rejected",
      "The canonical model core rejected the admitted resource import.",
    );
  }
}
