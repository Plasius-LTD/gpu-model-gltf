import {
  CANONICAL_GPU_MODEL_COORDINATE_SYSTEM,
  GPU_MODEL_DOCUMENT_SCHEMA_VERSION,
  GPU_MODEL_STATIC_DEMO_MAX_ABSOLUTE_COORDINATE_METRES,
  GpuModelDocumentError,
  createAndVerifyGpuModelDocument,
  createGpuModelStaticDemoCompilerInput,
  type GpuModelAccessor,
  type GpuModelDocument,
  type GpuModelMaterial,
  type GpuModelMatrix4,
  type GpuModelMesh,
  type GpuModelNode,
  type GpuModelResourceInspection,
  type GpuModelResourceVerificationContext,
  type GpuModelResourceVerificationPort,
  type GpuModelStaticDemoCompilerInput,
  type GpuModelVec3,
} from "@plasius/gpu-model-core";
import {
  DEFAULT_GLB_LIMITS,
  GLB_ADAPTER_VERSION,
  GlbAdapterError,
  validateAndExportGlb,
  type GlbAdapterErrorCode,
  type GlbResourceLimits,
  type ValidateGlbOptions,
  type ValidatedGlbArtifact,
} from "./glb-adapter.js";

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const JSON_CHUNK_TYPE = 0x4e4f534a;
const BIN_CHUNK_TYPE = 0x004e4942;
const GLB_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const MAX_STATIC_DEMO_BYTES = 16 * 1024 * 1024;
const MAX_STATIC_DEMO_TRIANGLES = 200_000;
const MAX_STATIC_DEMO_NODES = 4_095;
const MAX_STATIC_DEMO_MESHES = 4_096;
const MAX_STATIC_DEMO_PRIMITIVES = 16_384;
const MAX_STATIC_DEMO_MATERIALS = 4_096;
const MAX_STATIC_DEMO_ACCESSORS = 32_768;
const MAX_STATIC_DEMO_BUFFER_VIEWS = 32_768;
const STATIC_DEMO_PROCESSING_TIMEOUT_MS = 30_000;
const STATIC_DEMO_BLOB_CHUNK_BYTES = 64 * 1024;
const intrinsicBlobArrayBuffer = Blob.prototype.arrayBuffer;
const intrinsicBlobSlice = Blob.prototype.slice;
const intrinsicBlobSize = Object.getOwnPropertyDescriptor(Blob.prototype, "size")?.get;
const monotonicNow = performance.now.bind(performance);
const IDENTITY_MATRIX: GpuModelMatrix4 = Object.freeze([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);
const Z_BASIS_REFLECTION: GpuModelMatrix4 = Object.freeze([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, -1, 0,
  0, 0, 0, 1,
]);

/** Versioned conversion identity for the bounded ChatGPT-to-PVOX demo path. */
export const GLB_STATIC_DEMO_IMPORTER_VERSION = "2026-08-24.v1" as const;

/** Remotely evaluated parent gate required by this package's demo import. */
export const GLB_STATIC_DEMO_FEATURE_FLAG = "asset.pipeline.pvox-models.enabled" as const;

/** Independently controlled converter gate required by the bounded GLB path. */
export const GLB_STATIC_DEMO_CONVERTER_FEATURE_FLAG = "asset.pipeline.converter.gltf.enabled" as const;

/** Exact closed profile admitted by the temporary ChatGPT PVOX demonstration. */
export const GLB_STATIC_DEMO_PROFILE = "chatgpt-pvox-static-demo-v1" as const;

/** Exact compatibility ceiling shared with the PVOX contract and core projection. */
export const GLB_STATIC_DEMO_MAX_ABSOLUTE_COORDINATE_METRES = GPU_MODEL_STATIC_DEMO_MAX_ABSOLUTE_COORDINATE_METRES;

/** Caller options for the bounded, texture-free static demonstration path. */
export interface ImportGlbToGpuModelDocumentOptions extends ValidateGlbOptions {
  /** Positive result from the remote parent feature-flag evaluator. */
  readonly pvoxModelsEnabled: boolean;
  /** Positive result from the remote GLB converter feature-flag evaluator. */
  readonly gltfConverterEnabled: boolean;
  /** Optional caller-tightened triangle ceiling. */
  readonly maxTriangles?: number;
}

/** Verified source, canonical document, and compiler-safe projection. */
export interface ImportedGlbGpuModelDocument {
  readonly profile: typeof GLB_STATIC_DEMO_PROFILE;
  readonly sourceContentHash: string;
  readonly outputContentHash: string;
  readonly document: GpuModelDocument;
  readonly compilerInput: GpuModelStaticDemoCompilerInput;
}

type JsonRecord = Record<string, unknown>;
type Matrix4 = readonly number[];
type AccessorRole = "position" | "normal" | "indices";

interface SourceBufferView {
  readonly offset: number;
  readonly byteLength: number;
  readonly byteStride?: number;
}

interface SourceAccessor {
  readonly sourceIndex: number;
  readonly bufferViewIndex: number;
  readonly componentType: 5121 | 5123 | 5125 | 5126;
  readonly componentBytes: number;
  readonly componentCount: number;
  readonly count: number;
  readonly byteOffset: number;
  readonly byteStride: number;
  readonly read: (index: number) => readonly number[];
}

interface PrimitivePlan {
  readonly meshIndex: number;
  readonly primitiveIndex: number;
  readonly positionAccessorIndex: number;
  readonly normalAccessorIndex?: number;
  readonly indicesAccessorIndex: number;
  readonly materialIndex?: number;
  readonly triangleCount: number;
}

interface PackedAccessor {
  readonly accessor: GpuModelAccessor;
  readonly bytes: Uint8Array;
}

class StaticDemoWorkBudget {
  readonly #callerSignal?: AbortSignal;
  readonly #deadline: number;
  readonly #deadlineSignal: AbortSignal;
  public readonly signal: AbortSignal;

  public constructor(signal?: AbortSignal) {
    this.#callerSignal = signal;
    this.#deadline = monotonicNow() + STATIC_DEMO_PROCESSING_TIMEOUT_MS;
    this.#deadlineSignal = AbortSignal.timeout(STATIC_DEMO_PROCESSING_TIMEOUT_MS);
    this.signal = signal === undefined
      ? this.#deadlineSignal
      : AbortSignal.any([signal, this.#deadlineSignal]);
  }

  public check(iteration = 0): void {
    if ((iteration & 0xfff) !== 0) return;
    if (this.#callerSignal?.aborted) fail("aborted", "Static demo GLB processing was cancelled.");
    if (this.#deadlineSignal.aborted || monotonicNow() > this.#deadline) {
      fail("processing-time-limit", "Static demo GLB processing exceeded its fixed deadline.");
    }
  }

  public remainingMilliseconds(): number {
    this.check();
    return Math.max(1, Math.floor(this.#deadline - monotonicNow()));
  }
}

function fail(code: GlbAdapterErrorCode, message: string): never {
  throw new GlbAdapterError(code, message);
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown, field: string): JsonRecord {
  if (!isRecord(value)) fail("invalid-gltf-document", `${field} must be an object.`);
  return value;
}

function array(value: unknown, field: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail("invalid-gltf-document", `${field} must be an array.`);
  return value;
}

function integer(value: unknown, field: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail("invalid-gltf-document", `${field} is outside the bounded integer profile.`);
  }
  return value as number;
}

function finite(value: unknown, field: string, minimum = -Number.MAX_VALUE, maximum = Number.MAX_VALUE): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail("invalid-gltf-document", `${field} is outside the finite numeric profile.`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function tuple(value: unknown, field: string, length: number, defaults?: readonly number[]): number[] {
  if (value === undefined && defaults) return [...defaults];
  const values = array(value, field);
  if (values.length !== length) fail("invalid-gltf-document", `${field} must contain exactly ${length} values.`);
  return values.map((entry, index) => finite(entry, `${field}[${index}]`));
}

function checkedAdd(left: number, right: number, message: string): number {
  const output = left + right;
  if (!Number.isSafeInteger(output)) fail("document-resource-limit", message);
  return output;
}

function checkedMultiply(left: number, right: number, message: string): number {
  const output = left * right;
  if (!Number.isSafeInteger(output)) fail("document-resource-limit", message);
  return output;
}

function multiplyMatrices(left: Matrix4, right: Matrix4): GpuModelMatrix4 {
  const output = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let inner = 0; inner < 4; inner += 1) {
        value += left[inner * 4 + row]! * right[column * 4 + inner]!;
      }
      if (!Number.isFinite(value)) fail("invalid-gltf-document", "A node transform produced a non-finite matrix.");
      output[column * 4 + row] = Object.is(value, -0) ? 0 : value;
    }
  }
  return Object.freeze(output) as unknown as GpuModelMatrix4;
}

function matrixFromNode(node: JsonRecord, nodeIndex: number): GpuModelMatrix4 {
  const path = `nodes[${nodeIndex}]`;
  const hasMatrix = node.matrix !== undefined;
  const hasTrs = node.translation !== undefined || node.rotation !== undefined || node.scale !== undefined;
  if (hasMatrix && hasTrs) fail("invalid-gltf-document", `${path} cannot combine matrix and TRS transforms.`);
  if (hasMatrix) {
    const values = tuple(node.matrix, `${path}.matrix`, 16);
    if (values[3] !== 0 || values[7] !== 0 || values[11] !== 0 || values[15] !== 1) {
      fail("invalid-gltf-document", `${path}.matrix must be affine.`);
    }
    return Object.freeze(values) as unknown as GpuModelMatrix4;
  }
  const translation = tuple(node.translation, `${path}.translation`, 3, [0, 0, 0]);
  const rotation = tuple(node.rotation, `${path}.rotation`, 4, [0, 0, 0, 1]);
  const scale = tuple(node.scale, `${path}.scale`, 3, [1, 1, 1]);
  const magnitude = Math.hypot(...rotation);
  if (!Number.isFinite(magnitude) || Math.abs(magnitude - 1) > 1e-5) {
    fail("invalid-gltf-document", `${path}.rotation must be a normalized quaternion.`);
  }
  const [x, y, z, w] = rotation as [number, number, number, number];
  const [sx, sy, sz] = scale as [number, number, number];
  const matrix: number[] = [
    (1 - 2 * y * y - 2 * z * z) * sx,
    (2 * x * y + 2 * z * w) * sx,
    (2 * x * z - 2 * y * w) * sx,
    0,
    (2 * x * y - 2 * z * w) * sy,
    (1 - 2 * x * x - 2 * z * z) * sy,
    (2 * y * z + 2 * x * w) * sy,
    0,
    (2 * x * z + 2 * y * w) * sz,
    (2 * y * z - 2 * x * w) * sz,
    (1 - 2 * x * x - 2 * y * y) * sz,
    0,
    translation[0]!, translation[1]!, translation[2]!, 1,
  ];
  if (matrix.some((entry) => !Number.isFinite(entry))) {
    fail("invalid-gltf-document", `${path} produces a non-finite affine transform.`);
  }
  return Object.freeze(matrix.map((entry) => Object.is(entry, -0) ? 0 : entry)) as unknown as GpuModelMatrix4;
}

function transformPosition(matrix: Matrix4, position: readonly number[]): GpuModelVec3 {
  const [x, y, z] = position;
  const output = [
    matrix[0]! * x! + matrix[4]! * y! + matrix[8]! * z! + matrix[12]!,
    matrix[1]! * x! + matrix[5]! * y! + matrix[9]! * z! + matrix[13]!,
    matrix[2]! * x! + matrix[6]! * y! + matrix[10]! * z! + matrix[14]!,
  ];
  if (output.some((entry) => !Number.isFinite(entry))) {
    fail("non-finite-accessor", "A transformed POSITION value is non-finite.");
  }
  return output.map((entry) => Object.is(entry, -0) ? 0 : entry) as unknown as GpuModelVec3;
}

function demoLimits(value: unknown): Readonly<GlbResourceLimits> {
  const requested = value === undefined ? {} : record(value, "limits");
  const ceilings: Partial<GlbResourceLimits> = {
    maxInputBytes: MAX_STATIC_DEMO_BYTES,
    maxEstimatedWorkingSetBytes: 320 * 1024 * 1024,
    maxJsonBytes: 4 * 1024 * 1024,
    maxBinaryBytes: MAX_STATIC_DEMO_BYTES,
    maxJsonValues: 500_000,
    maxAccessors: MAX_STATIC_DEMO_ACCESSORS,
    maxAccessorElements: 5_000_000,
    maxBufferViews: MAX_STATIC_DEMO_BUFFER_VIEWS,
    maxMeshes: MAX_STATIC_DEMO_MESHES,
    maxPrimitives: MAX_STATIC_DEMO_PRIMITIVES,
    maxNodes: MAX_STATIC_DEMO_NODES,
    maxScenes: 1,
    maxMaterials: MAX_STATIC_DEMO_MATERIALS,
    maxTextures: 0,
    maxImages: 0,
    maxImageBytes: 0,
    maxAggregateImageBytes: 0,
    maxImageDimension: 0,
    maxImagePixels: 0,
    maxDecodedImageBytes: 0,
    maxAggregateDecodedImageBytes: 0,
  };
  const known = new Set(Object.keys(DEFAULT_GLB_LIMITS));
  for (const key of Object.keys(requested)) {
    if (!known.has(key)) fail("invalid-limits", "GLB resource limits contain an unknown field.");
  }
  const output = { ...DEFAULT_GLB_LIMITS } as Record<keyof GlbResourceLimits, number>;
  for (const key of Object.keys(DEFAULT_GLB_LIMITS) as (keyof GlbResourceLimits)[]) {
    const ceiling = ceilings[key] ?? DEFAULT_GLB_LIMITS[key];
    const candidate = requested[key];
    if (candidate !== undefined) {
      if (!Number.isSafeInteger(candidate) || (candidate as number) < 0 || (candidate as number) > ceiling) {
        fail("invalid-limits", `GLB resource limit ${key} cannot raise the static demo ceiling.`);
      }
      output[key] = candidate as number;
    } else {
      output[key] = ceiling;
    }
  }
  return Object.freeze(output);
}

function maxTriangles(value: unknown): number {
  if (value === undefined) return MAX_STATIC_DEMO_TRIANGLES;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_STATIC_DEMO_TRIANGLES) {
    fail("invalid-adapter-options", "maxTriangles must tighten the 200,000-triangle static demo ceiling.");
  }
  return value as number;
}

function parseOptions(value: unknown): ImportGlbToGpuModelDocumentOptions {
  const options = record(value, "options");
  const allowed = new Set(["pvoxModelsEnabled", "gltfConverterEnabled", "maxTriangles", "signal", "contentType", "fileName", "mode", "limits"]);
  if (Object.keys(options).some((key) => !allowed.has(key))) {
    fail("invalid-adapter-options", "Static demo import options contain an unknown field.");
  }
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) {
    fail("invalid-adapter-options", "signal must be an AbortSignal.");
  }
  if (options.pvoxModelsEnabled !== true) {
    fail("feature-disabled", `${GLB_STATIC_DEMO_FEATURE_FLAG} is disabled.`);
  }
  if (options.gltfConverterEnabled !== true) {
    fail("feature-disabled", `${GLB_STATIC_DEMO_CONVERTER_FEATURE_FLAG} is disabled.`);
  }
  if (options.mode !== undefined && options.mode !== "strict") {
    fail("unsupported-adapter-mode", "The static demo importer supports strict mode only.");
  }
  maxTriangles(options.maxTriangles);
  demoLimits(options.limits);
  return options as unknown as ImportGlbToGpuModelDocumentOptions;
}

async function readBinary(artifact: ValidatedGlbArtifact, budget: StaticDemoWorkBudget): Promise<Uint8Array> {
  budget.check();
  if (intrinsicBlobSize === undefined
    || Reflect.apply(intrinsicBlobSize, artifact.output, []) !== artifact.outputByteLength) {
    fail("invalid-glb-header", "Validated GLB output no longer has its verified byte length.");
  }
  const bytes = new Uint8Array(artifact.outputByteLength);
  for (let offset = 0; offset < bytes.byteLength; offset += STATIC_DEMO_BLOB_CHUNK_BYTES) {
    budget.check();
    const end = Math.min(bytes.byteLength, offset + STATIC_DEMO_BLOB_CHUNK_BYTES);
    const slice = Reflect.apply(intrinsicBlobSlice, artifact.output, [offset, end]) as Blob;
    const chunk = new Uint8Array(await Reflect.apply(intrinsicBlobArrayBuffer, slice, []) as ArrayBuffer);
    budget.check();
    if (chunk.byteLength !== end - offset) fail("invalid-glb-header", "Validated GLB output changed while being read.");
    bytes.set(chunk, offset);
  }
  if (bytes.byteLength < GLB_HEADER_BYTES + CHUNK_HEADER_BYTES) {
    fail("invalid-glb-header", "Validated GLB output is truncated.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== GLB_VERSION || view.getUint32(8, true) !== bytes.byteLength) {
    fail("invalid-glb-header", "Validated GLB output no longer has an exact GLB v2 header.");
  }
  const jsonLength = view.getUint32(GLB_HEADER_BYTES, true);
  if (view.getUint32(GLB_HEADER_BYTES + 4, true) !== JSON_CHUNK_TYPE) {
    fail("invalid-glb-chunk", "Validated GLB output no longer starts with JSON.");
  }
  const binaryHeader = checkedAdd(GLB_HEADER_BYTES + CHUNK_HEADER_BYTES, jsonLength, "Validated GLB chunk offsets overflowed.");
  if (binaryHeader + CHUNK_HEADER_BYTES > bytes.byteLength || view.getUint32(binaryHeader + 4, true) !== BIN_CHUNK_TYPE) {
    fail("missing-gltf-dependency", "The static demo GLB requires one embedded binary chunk.");
  }
  const binaryLength = view.getUint32(binaryHeader, true);
  const binaryOffset = binaryHeader + CHUNK_HEADER_BYTES;
  if (binaryOffset + binaryLength !== bytes.byteLength) {
    fail("invalid-glb-chunk", "Validated GLB binary boundaries are inconsistent.");
  }
  const buffers = array(artifact.document.buffers, "buffers");
  if (buffers.length !== 1) fail("missing-gltf-dependency", "The static demo requires exactly one embedded buffer.");
  const declaredLength = integer(record(buffers[0], "buffers[0]").byteLength, "buffers[0].byteLength", 1, binaryLength);
  return bytes.subarray(binaryOffset, binaryOffset + declaredLength);
}

function sourceViews(document: JsonRecord, binary: Uint8Array): readonly SourceBufferView[] {
  return Object.freeze(array(document.bufferViews, "bufferViews").map((value, index) => {
    const item = record(value, `bufferViews[${index}]`);
    if (integer(item.buffer, `bufferViews[${index}].buffer`) !== 0) {
      fail("missing-gltf-dependency", "A static demo bufferView references a missing buffer.");
    }
    const offset = item.byteOffset === undefined ? 0 : integer(item.byteOffset, `bufferViews[${index}].byteOffset`);
    const byteLength = integer(item.byteLength, `bufferViews[${index}].byteLength`, 1);
    if (offset + byteLength > binary.byteLength) {
      fail("accessor-out-of-bounds", "A static demo bufferView exceeds the verified binary buffer.");
    }
    const byteStride = item.byteStride === undefined ? undefined : integer(item.byteStride, `bufferViews[${index}].byteStride`, 1, 252);
    return { offset, byteLength, ...(byteStride === undefined ? {} : { byteStride }) };
  }));
}

function sourceAccessor(
  document: JsonRecord,
  views: readonly SourceBufferView[],
  binary: Uint8Array,
  sourceIndex: number,
  role: AccessorRole,
): SourceAccessor {
  const accessors = array(document.accessors, "accessors");
  const value = accessors[sourceIndex];
  if (value === undefined) fail("missing-gltf-dependency", `A ${role} accessor is missing.`);
  const item = record(value, `accessors[${sourceIndex}]`);
  if (item.sparse !== undefined) fail("unsupported-gltf-feature", "Sparse accessors are outside the static demo profile.");
  if (item.normalized === true) fail("unsupported-gltf-feature", `Normalized ${role} accessors are outside the static demo profile.`);
  const componentType = integer(item.componentType, `accessors[${sourceIndex}].componentType`) as SourceAccessor["componentType"];
  const type = item.type;
  const valid = role === "position" || role === "normal"
    ? componentType === 5126 && type === "VEC3"
    : (componentType === 5121 || componentType === 5123 || componentType === 5125) && type === "SCALAR";
  if (!valid) fail("unsupported-gltf-feature", `The static demo ${role} accessor representation is unsupported.`);
  const componentBytes = componentType === 5121 ? 1 : componentType === 5123 ? 2 : 4;
  const componentCount = role === "indices" ? 1 : 3;
  const count = integer(item.count, `accessors[${sourceIndex}].count`, 1);
  const bufferViewIndex = integer(item.bufferView, `accessors[${sourceIndex}].bufferView`);
  const sourceView = views[bufferViewIndex];
  if (!sourceView) fail("missing-gltf-dependency", `The static demo ${role} accessor has no bufferView.`);
  const accessorOffset = item.byteOffset === undefined ? 0 : integer(item.byteOffset, `accessors[${sourceIndex}].byteOffset`);
  const elementBytes = componentBytes * componentCount;
  const stride = sourceView.byteStride ?? elementBytes;
  if (stride < elementBytes || stride % componentBytes !== 0 || accessorOffset % componentBytes !== 0) {
    fail("accessor-out-of-bounds", `The static demo ${role} accessor has invalid alignment.`);
  }
  const extent = accessorOffset + stride * (count - 1) + elementBytes;
  if (!Number.isSafeInteger(extent) || extent > sourceView.byteLength) {
    fail("accessor-out-of-bounds", `The static demo ${role} accessor exceeds its bufferView.`);
  }
  const data = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const read = (index: number): readonly number[] => {
    if (!Number.isSafeInteger(index) || index < 0 || index >= count) {
      fail("accessor-out-of-bounds", `The static demo ${role} accessor index is invalid.`);
    }
    const offset = sourceView.offset + accessorOffset + stride * index;
    const values: number[] = [];
    for (let component = 0; component < componentCount; component += 1) {
      const componentOffset = offset + component * componentBytes;
      const decoded = componentType === 5121
        ? data.getUint8(componentOffset)
        : componentType === 5123
          ? data.getUint16(componentOffset, true)
          : componentType === 5125
            ? data.getUint32(componentOffset, true)
            : data.getFloat32(componentOffset, true);
      if (!Number.isFinite(decoded)) fail("non-finite-accessor", `The static demo ${role} accessor contains a non-finite value.`);
      values.push(decoded);
    }
    return values;
  };
  return { sourceIndex, bufferViewIndex, componentType, componentBytes, componentCount, count, byteOffset: sourceView.offset + accessorOffset, byteStride: stride, read };
}

function material(value: unknown, index: number): GpuModelMaterial {
  const item = record(value, `materials[${index}]`);
  if (item.alphaMode !== undefined && item.alphaMode !== "OPAQUE") {
    fail("unsupported-gltf-feature", "The static demo supports opaque materials only.");
  }
  if (item.alphaCutoff !== undefined || item.normalTexture !== undefined || item.occlusionTexture !== undefined || item.emissiveTexture !== undefined) {
    fail("unsupported-gltf-feature", "The static demo supports fixed material factors without texture bindings.");
  }
  const pbr = item.pbrMetallicRoughness === undefined ? {} : record(item.pbrMetallicRoughness, `materials[${index}].pbrMetallicRoughness`);
  if (pbr.baseColorTexture !== undefined || pbr.metallicRoughnessTexture !== undefined) {
    fail("unsupported-gltf-feature", "The static demo supports fixed PBR factors without texture bindings.");
  }
  const baseColorFactor = tuple(pbr.baseColorFactor, `materials[${index}].pbrMetallicRoughness.baseColorFactor`, 4, [1, 1, 1, 1]);
  if (baseColorFactor.some((entry) => entry < 0 || entry > 1) || baseColorFactor[3] !== 1) {
    fail("unsupported-gltf-feature", "The static demo requires an opaque base-colour factor.");
  }
  const emissiveFactor = tuple(item.emissiveFactor, `materials[${index}].emissiveFactor`, 3, [0, 0, 0]);
  if (emissiveFactor.some((entry) => entry < 0)) fail("invalid-gltf-document", "Material emissive factors cannot be negative.");
  const metallicFactor = pbr.metallicFactor === undefined ? 1 : finite(pbr.metallicFactor, `materials[${index}].metallicFactor`, 0, 1);
  const roughnessFactor = pbr.roughnessFactor === undefined ? 1 : finite(pbr.roughnessFactor, `materials[${index}].roughnessFactor`, 0, 1);
  const doubleSided = item.doubleSided === undefined ? false : item.doubleSided;
  if (typeof doubleSided !== "boolean") fail("invalid-gltf-document", "Material doubleSided must be boolean.");
  return {
    id: `material-${index}`,
    workflow: "metallic-roughness",
    alphaMode: "opaque",
    doubleSided,
    baseColorFactor: Object.freeze(baseColorFactor) as GpuModelMaterial["baseColorFactor"],
    metallicFactor,
    roughnessFactor,
    emissiveFactor: Object.freeze(emissiveFactor) as GpuModelMaterial["emissiveFactor"],
    textures: Object.freeze({}),
    extensions: Object.freeze({}),
    sourceMetadata: Object.freeze({}),
  };
}

function align4(value: number): number {
  return (value + 3) & ~3;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) fail("validator-unavailable", "Web Crypto SHA-256 is unavailable.");
  const snapshot = Uint8Array.from(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", snapshot.buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function collect(
  chunks: AsyncIterable<Uint8Array>,
  maximum: number,
  budget: StaticDemoWorkBudget,
): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of chunks) {
    budget.check();
    length = checkedAdd(length, chunk.byteLength, "Verified resource bytes overflowed.");
    if (length > maximum) fail("document-resource-limit", "Verified resource bytes exceed the static demo limit.");
    parts.push(Uint8Array.from(chunk));
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

class StaticDemoVerificationPort implements GpuModelResourceVerificationPort {
  readonly #budget: StaticDemoWorkBudget;

  public constructor(budget: StaticDemoWorkBudget) {
    this.#budget = budget;
  }

  public async digestSha256(
    chunks: AsyncIterable<Uint8Array>,
    _context: GpuModelResourceVerificationContext,
  ): Promise<string> {
    const bytes = await collect(chunks, MAX_STATIC_DEMO_BYTES, this.#budget);
    this.#budget.check();
    const digest = await sha256(bytes);
    this.#budget.check();
    return digest;
  }

  public async inspectResource(
    chunks: AsyncIterable<Uint8Array>,
    context: GpuModelResourceVerificationContext,
  ): Promise<GpuModelResourceInspection> {
    let length = 0;
    for await (const chunk of chunks) {
      this.#budget.check();
      length = checkedAdd(length, chunk.byteLength, "Verified resource bytes overflowed.");
      if (length > MAX_STATIC_DEMO_BYTES) fail("document-resource-limit", "Verified resource bytes exceed the static demo limit.");
    }
    return {
      valid: context.kind === "buffer" && context.declaredMimeType === "application/octet-stream" && length === context.byteLength,
      detectedMimeType: "application/octet-stream",
    };
  }
}

function deepFreeze<T>(root: T): T {
  const stack: object[] = [];
  if (root !== null && typeof root === "object") stack.push(root as object);
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || Object.isFrozen(current) || current instanceof Blob) continue;
    for (const child of Object.values(current)) {
      if (child !== null && typeof child === "object" && !(child instanceof Blob)) stack.push(child);
    }
    Object.freeze(current);
  }
  return root;
}

function conjugateBasis(matrix: GpuModelMatrix4): GpuModelMatrix4 {
  return multiplyMatrices(Z_BASIS_REFLECTION, multiplyMatrices(matrix, Z_BASIS_REFLECTION));
}

function inspectClosedProfile(document: JsonRecord, budget: StaticDemoWorkBudget): {
  readonly nodes: readonly JsonRecord[];
  readonly meshes: readonly JsonRecord[];
  readonly primitivePlans: readonly PrimitivePlan[];
  readonly nodeMatrices: readonly GpuModelMatrix4[];
  readonly sourceRoots: readonly number[];
  readonly materialRecords: readonly GpuModelMaterial[];
  readonly accessorRoles: ReadonlyMap<number, ReadonlySet<AccessorRole>>;
  readonly plansByMesh: ReadonlyMap<number, readonly PrimitivePlan[]>;
} {
  for (const key of ["images", "textures", "samplers", "animations", "skins", "cameras"] as const) {
    if (array(document[key], key).length > 0) fail("unsupported-gltf-feature", `${key} are outside the static demo profile.`);
  }
  const scenes = array(document.scenes, "scenes");
  if (scenes.length !== 1 || document.scene !== 0) {
    fail("unsupported-gltf-feature", "The static demo requires exactly one explicitly selected scene.");
  }
  const nodes = array(document.nodes, "nodes").map((entry, index) => record(entry, `nodes[${index}]`));
  const meshes = array(document.meshes, "meshes").map((entry, index) => record(entry, `meshes[${index}]`));
  if (nodes.length === 0 || nodes.length > MAX_STATIC_DEMO_NODES || meshes.length === 0 || meshes.length > MAX_STATIC_DEMO_MESHES) {
    fail("document-resource-limit", "The static demo scene is empty or exceeds its node/mesh ceiling.");
  }
  const scene = record(scenes[0], "scenes[0]");
  const sourceRoots = array(scene.nodes, "scenes[0].nodes").map((entry, index) => integer(entry, `scenes[0].nodes[${index}]`, 0, nodes.length - 1));
  if (sourceRoots.length === 0 || new Set(sourceRoots).size !== sourceRoots.length) {
    fail("invalid-gltf-document", "The static demo scene requires unique root nodes.");
  }
  const nodeMatrices = nodes.map((node, index) => conjugateBasis(matrixFromNode(node, index)));
  const usedMeshes = new Set<number>();
  const childrenByNode: number[][] = [];
  const parentCounts = new Uint16Array(nodes.length);
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    budget.check(nodeIndex);
    const node = nodes[nodeIndex]!;
    if (node.skin !== undefined || node.camera !== undefined || node.weights !== undefined) {
      fail("unsupported-gltf-feature", "Skins, cameras, and node weights are outside the static demo profile.");
    }
    if (node.mesh !== undefined) usedMeshes.add(integer(node.mesh, `nodes[${nodeIndex}].mesh`, 0, meshes.length - 1));
    const children = array(node.children, `nodes[${nodeIndex}].children`).map((child, childIndex) => {
      const index = integer(child, `nodes[${nodeIndex}].children[${childIndex}]`, 0, nodes.length - 1);
      parentCounts[index] = (parentCounts[index] ?? 0) + 1;
      if (parentCounts[index]! > 1) fail("unsupported-gltf-feature", "The static demo scene graph cannot instance one node through multiple parents.");
      return index;
    });
    if (new Set(children).size !== children.length) fail("invalid-gltf-document", "A static demo node contains a duplicate child.");
    childrenByNode.push(children);
  }
  const rootSet = new Set(sourceRoots);
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    const isRoot = rootSet.has(nodeIndex);
    if ((parentCounts[nodeIndex] === 0) !== isRoot) {
      fail("unsupported-gltf-feature", "The selected scene must identify every parentless node exactly once.");
    }
  }
  const visited = new Set<number>();
  const queue = [...sourceRoots];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    budget.check(cursor);
    const nodeIndex = queue[cursor]!;
    if (visited.has(nodeIndex)) fail("invalid-gltf-document", "The static demo scene graph contains a cycle.");
    visited.add(nodeIndex);
    queue.push(...childrenByNode[nodeIndex]!);
  }
  if (visited.size !== nodes.length || usedMeshes.size !== meshes.length) {
    fail("unsupported-gltf-feature", "The static demo does not silently discard unreachable nodes or meshes.");
  }

  const accessorRoles = new Map<number, Set<AccessorRole>>();
  const primitivePlans: PrimitivePlan[] = [];
  let primitiveCount = 0;
  for (let meshIndex = 0; meshIndex < meshes.length; meshIndex += 1) {
    budget.check(meshIndex);
    const mesh = meshes[meshIndex]!;
    if (mesh.weights !== undefined) fail("unsupported-gltf-feature", "Mesh weights are outside the static demo profile.");
    const primitives = array(mesh.primitives, `meshes[${meshIndex}].primitives`);
    if (primitives.length === 0) fail("invalid-gltf-document", "Static demo meshes require at least one primitive.");
    primitiveCount = checkedAdd(primitiveCount, primitives.length, "Static demo primitive count overflowed.");
    if (primitiveCount > MAX_STATIC_DEMO_PRIMITIVES) fail("document-resource-limit", "The static demo primitive ceiling was exceeded.");
    for (let primitiveIndex = 0; primitiveIndex < primitives.length; primitiveIndex += 1) {
      budget.check(primitiveCount);
      const primitive = record(primitives[primitiveIndex], `meshes[${meshIndex}].primitives[${primitiveIndex}]`);
      if (primitive.mode !== undefined && primitive.mode !== 4) fail("unsupported-gltf-feature", "The static demo supports TRIANGLES primitives only.");
      if (primitive.targets !== undefined) fail("unsupported-gltf-feature", "Morph targets are outside the static demo profile.");
      const attributes = record(primitive.attributes, `meshes[${meshIndex}].primitives[${primitiveIndex}].attributes`);
      if (Object.keys(attributes).some((key) => key !== "POSITION" && key !== "NORMAL")) {
        fail("unsupported-gltf-feature", "The static demo consumes POSITION and NORMAL attributes only.");
      }
      const positionAccessorIndex = integer(attributes.POSITION, "primitive POSITION accessor", 0, MAX_STATIC_DEMO_ACCESSORS - 1);
      const normalAccessorIndex = attributes.NORMAL === undefined
        ? undefined
        : integer(attributes.NORMAL, "primitive NORMAL accessor", 0, MAX_STATIC_DEMO_ACCESSORS - 1);
      if (primitive.indices === undefined) {
        fail("unsupported-gltf-feature", "The static demo requires explicit integer indices so winding conversion is lossless.");
      }
      const indicesAccessorIndex = integer(primitive.indices, "primitive indices accessor", 0, MAX_STATIC_DEMO_ACCESSORS - 1);
      const materialIndex = primitive.material === undefined
        ? undefined
        : integer(primitive.material, "primitive material", 0, MAX_STATIC_DEMO_MATERIALS - 1);
      const sourceAccessors = array(document.accessors, "accessors");
      const indexAccessor = record(sourceAccessors[indicesAccessorIndex], `accessors[${indicesAccessorIndex}]`);
      const indexCount = integer(indexAccessor.count, `accessors[${indicesAccessorIndex}].count`, 3);
      if (indexCount % 3 !== 0) fail("invalid-gltf-document", "Triangle index counts must be divisible by three.");
      const addRole = (index: number, role: AccessorRole): void => {
        const roles = accessorRoles.get(index) ?? new Set<AccessorRole>();
        roles.add(role);
        accessorRoles.set(index, roles);
      };
      addRole(positionAccessorIndex, "position");
      if (normalAccessorIndex !== undefined) addRole(normalAccessorIndex, "normal");
      addRole(indicesAccessorIndex, "indices");
      primitivePlans.push({
        meshIndex,
        primitiveIndex,
        positionAccessorIndex,
        ...(normalAccessorIndex === undefined ? {} : { normalAccessorIndex }),
        indicesAccessorIndex,
        ...(materialIndex === undefined ? {} : { materialIndex }),
        triangleCount: indexCount / 3,
      });
    }
  }
  const sourceAccessors = array(document.accessors, "accessors");
  if (sourceAccessors.length !== accessorRoles.size) {
    fail("unsupported-gltf-feature", "The static demo does not silently discard unused accessors.");
  }
  const sourceMaterials = array(document.materials, "materials");
  if (sourceMaterials.length > MAX_STATIC_DEMO_MATERIALS) fail("document-resource-limit", "The static demo material ceiling was exceeded.");
  const materialRecords = sourceMaterials.map(material);
  for (const [sourceIndex, roles] of accessorRoles) {
    if (roles.size !== 1) fail("unsupported-gltf-feature", `Accessor ${sourceIndex} cannot mix static demo semantic roles.`);
  }
  for (const plan of primitivePlans) {
    if (plan.materialIndex !== undefined && !materialRecords[plan.materialIndex]) {
      fail("missing-gltf-dependency", "A static demo primitive references a missing material.");
    }
  }
  const mutablePlansByMesh = new Map<number, PrimitivePlan[]>(meshes.map((_mesh, index) => [index, []]));
  for (const plan of primitivePlans) mutablePlansByMesh.get(plan.meshIndex)!.push(plan);
  const plansByMesh = new Map<number, readonly PrimitivePlan[]>(
    [...mutablePlansByMesh].map(([meshIndex, plans]) => [meshIndex, Object.freeze(plans)]),
  );
  return {
    nodes,
    meshes,
    primitivePlans: Object.freeze(primitivePlans),
    nodeMatrices: Object.freeze(nodeMatrices),
    sourceRoots: Object.freeze(sourceRoots),
    materialRecords: Object.freeze(materialRecords),
    accessorRoles,
    plansByMesh,
  };
}

function packAccessor(source: SourceAccessor, roles: ReadonlySet<AccessorRole>, budget: StaticDemoWorkBudget): PackedAccessor {
  if (roles.size !== 1) fail("unsupported-gltf-feature", "One accessor cannot mix static demo semantic roles.");
  const role = roles.has("position") ? "position" : roles.has("normal") ? "normal" : "indices";
  const elementBytes = source.componentBytes * source.componentCount;
  const bytes = new Uint8Array(checkedMultiply(source.count, elementBytes, "Packed accessor size overflowed."));
  const view = new DataView(bytes.buffer);
  const min = new Array<number>(source.componentCount).fill(Number.POSITIVE_INFINITY);
  const max = new Array<number>(source.componentCount).fill(Number.NEGATIVE_INFINITY);
  for (let index = 0; index < source.count; index += 1) {
    budget.check(index);
    const sourceIndex = role === "indices" && index % 3 !== 0
      ? index % 3 === 1 ? index + 1 : index - 1
      : index;
    const values = [...source.read(sourceIndex)];
    if (role === "position" || role === "normal") values[2] = -(values[2] ?? 0);
    if (role === "position" && values.some((value) => Math.abs(value) > GLB_STATIC_DEMO_MAX_ABSOLUTE_COORDINATE_METRES)) {
      fail("coordinate-resource-limit", "A local static demo coordinate exceeds the PVOX absolute ceiling.");
    }
    if (role === "normal") {
      const length = Math.hypot(...values);
      if (!Number.isFinite(length) || length <= 1e-12) fail("non-finite-accessor", "The static demo requires finite non-zero normals.");
      for (let component = 0; component < 3; component += 1) values[component] = values[component]! / length;
    }
    for (let component = 0; component < source.componentCount; component += 1) {
      const value = Object.is(values[component], -0) ? 0 : values[component]!;
      const offset = index * elementBytes + component * source.componentBytes;
      if (source.componentType === 5121) view.setUint8(offset, value);
      else if (source.componentType === 5123) view.setUint16(offset, value, true);
      else if (source.componentType === 5125) view.setUint32(offset, value, true);
      else view.setFloat32(offset, value, true);
      const stored = source.componentType === 5121
        ? view.getUint8(offset)
        : source.componentType === 5123
          ? view.getUint16(offset, true)
          : source.componentType === 5125
            ? view.getUint32(offset, true)
            : view.getFloat32(offset, true);
      if (!Number.isFinite(stored)) fail("non-finite-accessor", "Packed static demo geometry is non-finite.");
      min[component] = Math.min(min[component]!, stored);
      max[component] = Math.max(max[component]!, stored);
    }
  }
  const componentType = source.componentType === 5121 ? "u8" : source.componentType === 5123 ? "u16" : source.componentType === 5125 ? "u32" : "f32";
  const elementType = source.componentCount === 1 ? "scalar" : "vec3";
  const accessor: GpuModelAccessor = {
    id: `accessor-${source.sourceIndex}`,
    resourceId: "buffer-static-demo",
    byteOffset: 0,
    count: source.count,
    componentType,
    elementType,
    ...((role === "position") ? { min: Object.freeze(min), max: Object.freeze(max) } : {}),
  };
  return { accessor, bytes };
}

async function compileDocument(
  artifact: ValidatedGlbArtifact,
  options: ImportGlbToGpuModelDocumentOptions,
  budget: StaticDemoWorkBudget,
): Promise<{ document: GpuModelDocument; compilerInput: GpuModelStaticDemoCompilerInput }> {
  const sourceDocument = artifact.document as JsonRecord;
  const profile = inspectClosedProfile(sourceDocument, budget);
  const triangleLimit = maxTriangles(options.maxTriangles);
  let instantiatedTriangles = 0;
  for (let nodeIndex = 0; nodeIndex < profile.nodes.length; nodeIndex += 1) {
    budget.check(nodeIndex);
    const node = profile.nodes[nodeIndex]!;
    if (node.mesh === undefined) continue;
    const meshIndex = integer(node.mesh, `nodes[${nodeIndex}].mesh`, 0, profile.meshes.length - 1);
    for (const plan of profile.plansByMesh.get(meshIndex)!) {
      instantiatedTriangles = checkedAdd(instantiatedTriangles, plan.triangleCount, "Static demo instanced triangle count overflowed.");
      if (instantiatedTriangles > triangleLimit) fail("document-resource-limit", "The static demo triangle ceiling was exceeded.");
    }
  }
  const binary = await readBinary(artifact, budget);
  const views = sourceViews(sourceDocument, binary);
  if (views.length > MAX_STATIC_DEMO_BUFFER_VIEWS) fail("document-resource-limit", "The static demo bufferView ceiling was exceeded.");
  const usedViews = new Set<number>();
  const sourceByIndex = new Map<number, SourceAccessor>();
  for (const sourceIndex of [...profile.accessorRoles.keys()].sort((left, right) => left - right)) {
    budget.check(sourceIndex);
    const roles = profile.accessorRoles.get(sourceIndex)!;
    const role = roles.values().next().value as AccessorRole;
    const source = sourceAccessor(sourceDocument, views, binary, sourceIndex, role);
    usedViews.add(source.bufferViewIndex);
    sourceByIndex.set(sourceIndex, source);
  }
  if (usedViews.size !== views.length) fail("unsupported-gltf-feature", "The static demo does not silently discard unused bufferViews.");

  let geometryChecks = 0;
  for (const plan of profile.primitivePlans) {
    const position = sourceByIndex.get(plan.positionAccessorIndex)!;
    const indices = sourceByIndex.get(plan.indicesAccessorIndex)!;
    const normal = plan.normalAccessorIndex === undefined ? undefined : sourceByIndex.get(plan.normalAccessorIndex)!;
    if (normal && normal.count !== position.count) fail("invalid-gltf-document", "NORMAL and POSITION accessor counts must match.");
    if (position.count > indices.count) {
      fail("unsupported-gltf-feature", "The static demo does not retain unreferenced POSITION elements.");
    }
    const referenced = new Uint8Array(position.count);
    for (let index = 0; index < indices.count; index += 1) {
      budget.check(geometryChecks);
      geometryChecks += 1;
      const vertexIndex = indices.read(index)[0]!;
      if (!Number.isSafeInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= position.count) {
        fail("accessor-out-of-bounds", "A static demo index references a missing POSITION element.");
      }
      referenced[vertexIndex] = 1;
    }
    if (referenced.some((value) => value === 0)) {
      fail("unsupported-gltf-feature", "The static demo does not retain unreferenced POSITION elements.");
    }
  }

  const packedBySource = new Map<number, PackedAccessor>();
  for (const [sourceIndex, source] of sourceByIndex) {
    budget.check(sourceIndex);
    const roles = profile.accessorRoles.get(sourceIndex)!;
    packedBySource.set(sourceIndex, packAccessor(source, roles, budget));
  }

  let packedByteLength = 0;
  for (const packed of packedBySource.values()) packedByteLength = checkedAdd(align4(packedByteLength), packed.bytes.byteLength, "Packed static demo buffer size overflowed.");
  if (packedByteLength <= 0 || packedByteLength > MAX_STATIC_DEMO_BYTES) fail("document-resource-limit", "The packed static demo buffer exceeds 16 MiB.");
  const packedBytes = new Uint8Array(packedByteLength);
  const accessors: GpuModelAccessor[] = [];
  let packedOffset = 0;
  for (const [sourceIndex, packed] of packedBySource) {
    budget.check(packedOffset);
    packedOffset = align4(packedOffset);
    packedBytes.set(packed.bytes, packedOffset);
    accessors.push(Object.freeze({ ...packed.accessor, byteOffset: packedOffset }));
    packedBySource.set(sourceIndex, { ...packed, accessor: accessors.at(-1)! });
    packedOffset += packed.bytes.byteLength;
  }

  const primitivesByMesh = new Map<number, GpuModelMesh["primitives"]>();
  for (let meshIndex = 0; meshIndex < profile.meshes.length; meshIndex += 1) {
    budget.check(meshIndex);
    const plans = profile.plansByMesh.get(meshIndex)!;
    primitivesByMesh.set(meshIndex, Object.freeze(plans.map((plan) => ({
      id: `primitive-${meshIndex}-${plan.primitiveIndex}`,
      topology: "triangles" as const,
      attributes: Object.freeze([
        { semantic: "POSITION", accessorId: `accessor-${plan.positionAccessorIndex}` },
        ...(plan.normalAccessorIndex === undefined ? [] : [{ semantic: "NORMAL", accessorId: `accessor-${plan.normalAccessorIndex}` }]),
      ]),
      indicesAccessorId: `accessor-${plan.indicesAccessorIndex}`,
      ...(plan.materialIndex === undefined ? {} : { materialId: `material-${plan.materialIndex}` }),
    }))));
  }
  const meshes: GpuModelMesh[] = profile.meshes.map((_mesh, index) => ({ id: `mesh-${index}`, primitives: primitivesByMesh.get(index)! }));

  const sourceNodes: GpuModelNode[] = profile.nodes.map((node, index) => ({
    id: `node-${index}`,
    children: Object.freeze(array(node.children, `nodes[${index}].children`).map((child, childIndex) => `node-${integer(child, `nodes[${index}].children[${childIndex}]`, 0, profile.nodes.length - 1)}`)),
    ...(node.mesh === undefined ? {} : { meshId: `mesh-${integer(node.mesh, `nodes[${index}].mesh`, 0, profile.meshes.length - 1)}` }),
    localMatrix: profile.nodeMatrices[index]!,
  }));

  const worldByNode = new Map<number, GpuModelMatrix4>();
  const queue = profile.sourceRoots.map((index) => ({ index, world: profile.nodeMatrices[index]! }));
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    budget.check(cursor);
    const { index, world } = queue[cursor]!;
    worldByNode.set(index, world);
    const sourceNode = profile.nodes[index]!;
    for (const child of array(sourceNode.children, `nodes[${index}].children`)) {
      const childIndex = integer(child, `nodes[${index}].children`, 0, profile.nodes.length - 1);
      queue.push({ index: childIndex, world: multiplyMatrices(world, profile.nodeMatrices[childIndex]!) });
    }
  }
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  let transformedVertices = 0;
  for (let nodeIndex = 0; nodeIndex < profile.nodes.length; nodeIndex += 1) {
    budget.check(nodeIndex);
    const sourceNode = profile.nodes[nodeIndex]!;
    if (sourceNode.mesh === undefined) continue;
    const meshIndex = integer(sourceNode.mesh, `nodes[${nodeIndex}].mesh`, 0, profile.meshes.length - 1);
    const world = worldByNode.get(nodeIndex)!;
    for (const plan of profile.plansByMesh.get(meshIndex)!) {
      const packed = packedBySource.get(plan.positionAccessorIndex)!;
      const bytes = packed.bytes;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let vertex = 0; vertex < packed.accessor.count; vertex += 1) {
        budget.check(transformedVertices);
        transformedVertices += 1;
        const position = [view.getFloat32(vertex * 12, true), view.getFloat32(vertex * 12 + 4, true), view.getFloat32(vertex * 12 + 8, true)];
        const transformed = transformPosition(world, position);
        for (let component = 0; component < 3; component += 1) {
          if (Math.abs(transformed[component]!) > GLB_STATIC_DEMO_MAX_ABSOLUTE_COORDINATE_METRES) {
            fail("coordinate-resource-limit", "A world-space static demo coordinate exceeds the PVOX absolute ceiling.");
          }
          min[component] = Math.min(min[component]!, transformed[component]!);
          max[component] = Math.max(max[component]!, transformed[component]!);
        }
      }
    }
  }
  if (min.some((entry) => !Number.isFinite(entry)) || max.some((entry) => !Number.isFinite(entry))) {
    fail("invalid-gltf-document", "The static demo scene contains no finite world geometry.");
  }
  const centreX = (min[0]! + max[0]!) / 2;
  const centreZ = (min[2]! + max[2]!) / 2;
  const normalizationMatrix = Object.freeze([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    -centreX, -min[1]!, -centreZ, 1,
  ]) as unknown as GpuModelMatrix4;
  const bounds = {
    min: Object.freeze([min[0]! - centreX, 0, min[2]! - centreZ]) as GpuModelVec3,
    max: Object.freeze([max[0]! - centreX, max[1]! - min[1]!, max[2]! - centreZ]) as GpuModelVec3,
  };
  if ([...bounds.min, ...bounds.max].some((coordinate) => Math.abs(coordinate) > GLB_STATIC_DEMO_MAX_ABSOLUTE_COORDINATE_METRES)) {
    fail("coordinate-resource-limit", "The normalized static demo extent exceeds the PVOX absolute ceiling.");
  }
  budget.check();
  const contentHash = await sha256(packedBytes);
  budget.check();
  const rawDocument = {
    schemaVersion: GPU_MODEL_DOCUMENT_SCHEMA_VERSION,
    coordinateSystem: CANONICAL_GPU_MODEL_COORDINATE_SYSTEM,
    roots: ["normalization-root"],
    nodes: [
      { id: "normalization-root", children: profile.sourceRoots.map((index) => `node-${index}`), localMatrix: normalizationMatrix },
      ...sourceNodes,
    ],
    resources: [{
      id: "buffer-static-demo",
      kind: "buffer",
      contentHash,
      byteLength: packedBytes.byteLength,
      mimeType: "application/octet-stream",
      payload: new Blob([packedBytes.buffer as ArrayBuffer], { type: "application/octet-stream" }),
    }],
    accessors,
    meshes,
    materials: profile.materialRecords,
    textures: [],
    skeletons: [],
    joints: [],
    skins: [],
    blendShapes: [],
    animations: [],
    analyticGeometry: [],
    bounds,
    provenance: {
      sourceFormat: "glb",
      sourceContentHash: artifact.sourceContentHash,
      converterId: "gltf-static-demo-importer",
      converterVersion: GLB_STATIC_DEMO_IMPORTER_VERSION,
      metadata: { validatedBy: GLB_ADAPTER_VERSION },
    },
    diagnostics: [{
      severity: "info",
      code: "static-demo-canonicalized",
      message: "Static GLB geometry was converted to the canonical metre, Y-up, -Z-forward, floor-centred basis.",
    }],
    metadata: { profile: GLB_STATIC_DEMO_PROFILE },
  };
  try {
    const document = await createAndVerifyGpuModelDocument(rawDocument, new StaticDemoVerificationPort(budget), {
      signal: budget.signal,
      limits: {
        maxResourceBytes: MAX_STATIC_DEMO_BYTES,
        maxAggregateBytes: MAX_STATIC_DEMO_BYTES,
        timeoutMs: budget.remainingMilliseconds(),
      },
    });
    const compilerInput = await createGpuModelStaticDemoCompilerInput(document, {
      pvoxModelsEnabled: true,
      limits: { maxTriangles: triangleLimit, maxResourceBytes: MAX_STATIC_DEMO_BYTES, maxAggregateResourceBytes: MAX_STATIC_DEMO_BYTES },
    });
    budget.check();
    return { document, compilerInput };
  } catch (error) {
    budget.check();
    if (error instanceof GlbAdapterError) throw error;
    if (error instanceof GpuModelDocumentError) {
      fail("canonical-model-core-rejected", "The canonical model core rejected the bounded GLB conversion.");
    }
    fail("canonical-model-core-rejected", "The canonical model core could not verify the bounded GLB conversion.");
  }
}

/**
 * Imports one strict self-contained GLB into the verified canonical model core
 * and creates the immutable compiler input consumed by the PVOX demo.
 */
export async function importGlbToGpuModelDocument(
  input: Uint8Array | ArrayBuffer,
  options: ImportGlbToGpuModelDocumentOptions,
): Promise<ImportedGlbGpuModelDocument> {
  const resolved = parseOptions(options);
  const budget = new StaticDemoWorkBudget(resolved.signal);
  const limits = demoLimits(resolved.limits);
  budget.check();
  let validatedGlb: ValidatedGlbArtifact;
  try {
    validatedGlb = await validateAndExportGlb(input, {
      signal: budget.signal,
      contentType: resolved.contentType,
      fileName: resolved.fileName,
      mode: "strict",
      limits,
    });
  } catch (error) {
    budget.check();
    throw error;
  }
  budget.check();
  const compiled = await compileDocument(validatedGlb, resolved, budget);
  budget.check();
  return deepFreeze({
    profile: GLB_STATIC_DEMO_PROFILE,
    sourceContentHash: validatedGlb.sourceContentHash,
    outputContentHash: validatedGlb.outputContentHash,
    ...compiled,
  });
}
