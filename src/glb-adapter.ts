import type {
  ModelConversionLoss,
  ModelConverterDiagnostic,
  ModelConverterEvidence,
} from "@plasius/asset-contracts";
import type {
  AdapterLoadContext,
  AdapterLoadResult,
  ModelAdapter,
  ResolvedModelSource,
  SniffInput,
} from "@plasius/gpu-model-runtime";
import type {
  GpuModelDocument,
  GpuModelStaticDemoCompilerInput,
} from "@plasius/gpu-model-core";

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const JSON_CHUNK_TYPE = 0x4e4f534a;
const BIN_CHUNK_TYPE = 0x004e4942;
const GLB_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_DIAGNOSTIC_CODE = /[^a-z0-9._:-]+/gu;
const DANGEROUS_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Versioned evidence identity emitted by this adapter. */
export const GLB_ADAPTER_VERSION = "2026-08-20.v1" as const;

/** Conservative multiplier derived from the pinned Node 24 32 MiB peak-RSS benchmark. */
export const GLB_WORKING_SET_MULTIPLIER = 7 as const;

/** Measured fixed allowance for validator loading and bounded adapter bookkeeping. */
export const GLB_FIXED_WORKING_SET_BYTES = 32 * 1024 * 1024;

/** Additional measured allowance for decoded, parsed, and canonicalized glTF JSON. */
export const GLB_JSON_WORKING_SET_MULTIPLIER = 32 as const;

/** Hard processing ceilings. Callers may tighten, but never raise, these values. */
export interface GlbResourceLimits {
  readonly maxInputBytes: number;
  readonly maxEstimatedWorkingSetBytes: number;
  readonly maxJsonBytes: number;
  readonly maxBinaryBytes: number;
  readonly maxJsonDepth: number;
  readonly maxJsonValues: number;
  readonly maxJsonStringLength: number;
  readonly maxAccessors: number;
  readonly maxAccessorElements: number;
  readonly maxBufferViews: number;
  readonly maxMeshes: number;
  readonly maxPrimitives: number;
  readonly maxNodes: number;
  readonly maxScenes: number;
  readonly maxMaterials: number;
  readonly maxTextures: number;
  readonly maxImages: number;
  readonly maxImageBytes: number;
  readonly maxAggregateImageBytes: number;
  readonly maxImageDimension: number;
  readonly maxImagePixels: number;
  readonly maxDecodedImageBytes: number;
  readonly maxAggregateDecodedImageBytes: number;
  readonly maxPngChunks: number;
  readonly maxDiagnostics: number;
}

/** `static-world-v1`-compatible GLB admission ceilings. */
export const DEFAULT_GLB_LIMITS: Readonly<GlbResourceLimits> = Object.freeze({
  maxInputBytes: 100 * 1024 * 1024,
  maxEstimatedWorkingSetBytes: 768 * 1024 * 1024,
  maxJsonBytes: 16 * 1024 * 1024,
  maxBinaryBytes: 100 * 1024 * 1024,
  maxJsonDepth: 64,
  maxJsonValues: 1_000_000,
  maxJsonStringLength: 1_048_576,
  maxAccessors: 100_000,
  maxAccessorElements: 32_000_000,
  maxBufferViews: 100_000,
  maxMeshes: 10_000,
  maxPrimitives: 100_000,
  maxNodes: 100_000,
  maxScenes: 1_024,
  maxMaterials: 16_384,
  maxTextures: 16_384,
  maxImages: 4_096,
  maxImageBytes: 64 * 1024 * 1024,
  maxAggregateImageBytes: 64 * 1024 * 1024,
  maxImageDimension: 4_096,
  maxImagePixels: 4_096 * 4_096,
  maxDecodedImageBytes: 64 * 1024 * 1024,
  maxAggregateDecodedImageBytes: 64 * 1024 * 1024,
  maxPngChunks: 65_536,
  maxDiagnostics: 100,
});

/** Stable reason codes safe for orchestration, review, and retry policy. */
export type GlbAdapterErrorCode =
  | "aborted"
  | "accessor-out-of-bounds"
  | "binary-resource-limit"
  | "canonical-model-core-rejected"
  | "canonical-model-core-unavailable"
  | "coordinate-resource-limit"
  | "document-resource-limit"
  | "external-resource-forbidden"
  | "feature-disabled"
  | "gltf-spec-validation-failed"
  | "image-mime-mismatch"
  | "image-dimension-limit"
  | "input-resource-limit"
  | "invalid-adapter-options"
  | "invalid-glb-chunk"
  | "invalid-glb-header"
  | "invalid-gltf-document"
  | "invalid-gltf-json"
  | "invalid-image-resource"
  | "invalid-limits"
  | "json-resource-limit"
  | "missing-gltf-dependency"
  | "non-finite-accessor"
  | "processing-time-limit"
  | "source-type-mismatch"
  | "source-hash-mismatch"
  | "unsupported-adapter-mode"
  | "unsupported-glb-chunk"
  | "unsupported-glb-version"
  | "unsupported-gltf-feature"
  | "unsafe-gltf-json"
  | "validator-unavailable";

/** Controlled failure with stable reason code and bounded public diagnostics. */
export class GlbAdapterError extends Error {
  public readonly code: GlbAdapterErrorCode;
  public readonly diagnostics: readonly ModelConverterDiagnostic[];

  public constructor(code: GlbAdapterErrorCode, message: string, diagnostics?: readonly ModelConverterDiagnostic[]) {
    super(message);
    this.name = "GlbAdapterError";
    this.code = code;
    this.diagnostics = Object.freeze((diagnostics ?? [diagnostic("blocking", code, message)])
      .map((item) => Object.freeze({ ...item })));
  }
}

/** Bounded embedded-resource counts recorded for downstream processing. */
export interface GlbResourceEvidence {
  readonly bufferByteLength: number;
  readonly imageCount: number;
  readonly imageByteLength: number;
  readonly imageDecodedByteLength: number;
}

/** Identity and issue count from the pinned official validator. */
export interface GlbValidatorEvidence {
  readonly id: "KhronosGroup/glTF-Validator";
  readonly version: string;
  readonly issueCount: number;
}

/** Strictly validated, lossless GLB artifact and exact converter evidence. */
export interface ValidatedGlbArtifact {
  readonly format: "glb";
  readonly glbVersion: 2;
  readonly mimeType: "model/gltf-binary";
  readonly sourceByteLength: number;
  readonly estimatedWorkingSetBytes: number;
  readonly outputByteLength: number;
  readonly sourceContentHash: string;
  readonly outputContentHash: string;
  readonly document: Readonly<Record<string, unknown>>;
  readonly output: Blob;
  readonly resources: Readonly<GlbResourceEvidence>;
  readonly validator: Readonly<GlbValidatorEvidence>;
  readonly converterEvidence: Readonly<ModelConverterEvidence>;
}

/** Strict validation context and caller-tightened resource ceilings. */
export interface ValidateGlbOptions {
  readonly signal?: AbortSignal;
  readonly contentType?: string;
  readonly fileName?: string;
  readonly mode?: "strict" | "tolerant" | "forensic";
  readonly limits?: Partial<GlbResourceLimits>;
}

interface ParsedGlb {
  readonly document: Record<string, unknown>;
  readonly binary?: Uint8Array;
  readonly estimatedWorkingSetBytes: number;
}

interface BufferViewRecord {
  readonly offset: number;
  readonly byteLength: number;
  readonly byteStride?: number;
}

interface KhronosIssueMessage {
  readonly code?: unknown;
  readonly severity?: unknown;
  readonly pointer?: unknown;
}

interface KhronosReport {
  readonly issues?: {
    readonly numErrors?: unknown;
    readonly numWarnings?: unknown;
    readonly numInfos?: unknown;
    readonly numHints?: unknown;
    readonly messages?: unknown;
  };
}

interface ValidatorModule {
  readonly version: () => string;
  readonly validateBytes: (bytes: Uint8Array, options: Readonly<{
    uri: string;
    format: "glb";
    maxIssues: number;
    writeTimestamp: boolean;
    externalResourceFunction: (uri: string) => Promise<Uint8Array>;
  }>) => Promise<KhronosReport>;
}

let validatorModulePromise: Promise<ValidatorModule> | undefined;

function diagnostic(
  severity: ModelConverterDiagnostic["severity"],
  code: string,
  message: string,
): ModelConverterDiagnostic {
  return Object.freeze({ severity, code, message: message.slice(0, 1_024) });
}

function fail(code: GlbAdapterErrorCode, message: string): never {
  throw new GlbAdapterError(code, message);
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) fail("aborted", "GLB processing was cancelled.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) fail("invalid-gltf-document", `${field} must be an object.`);
  return value;
}

function asArray(value: unknown, field: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail("invalid-gltf-document", `${field} must be an array.`);
  return value;
}

function integer(value: unknown, field: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    fail("invalid-gltf-document", `${field} must be a safe integer greater than or equal to ${minimum}.`);
  }
  return value as number;
}

function checkedAdd(left: number, right: number, code: GlbAdapterErrorCode, message: string): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) fail(code, message);
  return sum;
}

function checkedMultiply(left: number, right: number, code: GlbAdapterErrorCode, message: string): number {
  const product = left * right;
  if (!Number.isSafeInteger(product)) fail(code, message);
  return product;
}

function resolveLimits(value: unknown): Readonly<GlbResourceLimits> {
  if (value === undefined) return DEFAULT_GLB_LIMITS;
  if (!isRecord(value)) fail("invalid-limits", "GLB resource limits must be an object.");
  const resolved = { ...DEFAULT_GLB_LIMITS };
  const keys = Object.keys(DEFAULT_GLB_LIMITS) as (keyof GlbResourceLimits)[];
  const known = new Set<string>(keys);
  for (const key of Object.keys(value)) {
    if (!known.has(key)) fail("invalid-limits", "GLB resource limits contain an unknown field.");
  }
  for (const key of keys) {
    const candidate = value[key];
    if (candidate === undefined) continue;
    const minimum = key === "maxInputBytes"
      ? GLB_HEADER_BYTES
      : key === "maxJsonBytes" ? 4
        : key === "maxPngChunks" ? 3
          : key === "maxJsonDepth" || key === "maxJsonValues" || key === "maxDiagnostics" ? 1 : 0;
    if (!Number.isSafeInteger(candidate) || (candidate as number) < minimum || (candidate as number) > DEFAULT_GLB_LIMITS[key]) {
      fail("invalid-limits", `GLB resource limit ${key} must tighten the published hard ceiling.`);
    }
    resolved[key] = candidate as number;
  }
  return Object.freeze(resolved);
}

function assertNoDuplicateJsonKeys(
  json: string,
  limits: GlbResourceLimits,
  signal?: AbortSignal,
): void {
  const stack: Array<{ kind: "array" } | { kind: "object"; expectingKey: boolean; keys: Set<string> }> = [];
  for (let index = 0; index < json.length; index += 1) {
    if ((index & 0xfff) === 0) assertNotAborted(signal);
    const character = json[index];
    if (character === "{") {
      if (stack.length + 1 > limits.maxJsonDepth) fail("json-resource-limit", "glTF JSON nesting exceeds the configured depth.");
      stack.push({ kind: "object", expectingKey: true, keys: new Set() });
      continue;
    }
    if (character === "[") {
      if (stack.length + 1 > limits.maxJsonDepth) fail("json-resource-limit", "glTF JSON nesting exceeds the configured depth.");
      stack.push({ kind: "array" });
      continue;
    }
    if (character === "}" || character === "]") {
      stack.pop();
      continue;
    }
    if (character === ",") {
      const context = stack[stack.length - 1];
      if (context?.kind === "object") context.expectingKey = true;
      continue;
    }
    if (character !== '"') continue;
    const start = index;
    let escaped = false;
    for (index += 1; index < json.length; index += 1) {
      const stringCharacter = json[index];
      if (escaped) {
        escaped = false;
      } else if (stringCharacter === "\\") {
        escaped = true;
      } else if (stringCharacter === '"') {
        break;
      }
    }
    const context = stack[stack.length - 1];
    if (context?.kind !== "object" || !context.expectingKey) continue;
    let lookahead = index + 1;
    while (/\s/u.test(json[lookahead] ?? "")) lookahead += 1;
    if (json[lookahead] !== ":") continue;
    let key: unknown;
    try {
      key = JSON.parse(json.slice(start, index + 1));
    } catch {
      continue;
    }
    if (typeof key !== "string") continue;
    if (context.keys.has(key)) fail("unsafe-gltf-json", "glTF JSON contains a duplicate object key.");
    context.keys.add(key);
    context.expectingKey = false;
  }
}

function validateSourceHints(options: ValidateGlbOptions): void {
  if (options.contentType !== undefined) {
    if (typeof options.contentType !== "string" || options.contentType.length > 128) {
      fail("source-type-mismatch", "The source content type is invalid.");
    }
    const mime = options.contentType.split(";", 1)[0]?.trim().toLowerCase();
    if (mime !== "model/gltf-binary" && mime !== "application/octet-stream") {
      fail("source-type-mismatch", "The source content type does not identify a GLB payload.");
    }
  }
  if (options.fileName !== undefined) {
    if (typeof options.fileName !== "string" || options.fileName.length > 512 || !/\.glb$/iu.test(options.fileName)) {
      fail("source-type-mismatch", "The source filename does not identify a .glb payload.");
    }
  }
}

function estimateWorkingSet(inputByteLength: number, jsonByteLength: number): number {
  const inputBytes = checkedMultiply(
    inputByteLength,
    GLB_WORKING_SET_MULTIPLIER,
    "input-resource-limit",
    "The GLB adapter working-set estimate overflowed.",
  );
  const jsonBytes = checkedMultiply(
    jsonByteLength,
    GLB_JSON_WORKING_SET_MULTIPLIER,
    "input-resource-limit",
    "The GLB JSON working-set estimate overflowed.",
  );
  return checkedAdd(
    GLB_FIXED_WORKING_SET_BYTES,
    checkedAdd(inputBytes, jsonBytes, "input-resource-limit", "The GLB adapter working-set estimate overflowed."),
    "input-resource-limit",
    "The GLB adapter working-set estimate overflowed.",
  );
}

function firstJsonChunkLengthHint(input: Uint8Array | ArrayBuffer): number {
  try {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.byteLength < GLB_HEADER_BYTES + CHUNK_HEADER_BYTES) return 0;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== GLB_MAGIC
      || view.getUint32(4, true) !== GLB_VERSION
      || view.getUint32(8, true) !== bytes.byteLength
      || view.getUint32(GLB_HEADER_BYTES + 4, true) !== JSON_CHUNK_TYPE) return 0;
    const length = view.getUint32(GLB_HEADER_BYTES, true);
    if (length === 0 || length % 4 !== 0 || GLB_HEADER_BYTES + CHUNK_HEADER_BYTES + length > bytes.byteLength) return 0;
    return length;
  } catch {
    return 0;
  }
}

function copyInput(
  input: Uint8Array | ArrayBuffer,
  maxInputBytes: number,
  maxEstimatedWorkingSetBytes: number,
): Uint8Array {
  if (!(input instanceof Uint8Array) && !(input instanceof ArrayBuffer)) {
    fail("invalid-glb-header", "GLB input must be a Uint8Array or ArrayBuffer.");
  }
  if (input.byteLength > maxInputBytes) fail("input-resource-limit", "GLB input exceeds the configured byte limit.");
  const estimatedWorkingSetBytes = estimateWorkingSet(input.byteLength, firstJsonChunkLengthHint(input));
  if (estimatedWorkingSetBytes > maxEstimatedWorkingSetBytes) {
    fail("input-resource-limit", "GLB processing exceeds the configured adapter working-set estimate.");
  }
  try {
    return input instanceof Uint8Array ? new Uint8Array(input) : new Uint8Array(input.slice(0));
  } catch {
    fail("invalid-glb-header", "GLB input bytes are detached or inaccessible.");
  }
}

function parseGlb(bytes: Uint8Array, limits: GlbResourceLimits, signal?: AbortSignal): ParsedGlb {
  if (bytes.byteLength > limits.maxInputBytes) fail("input-resource-limit", "GLB input exceeds the configured byte limit.");
  if (bytes.byteLength < GLB_HEADER_BYTES) fail("invalid-glb-header", "GLB header is truncated.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) fail("invalid-glb-header", "GLB magic bytes are invalid.");
  if (view.getUint32(4, true) !== GLB_VERSION) fail("unsupported-glb-version", "Only GLB version 2 is supported.");
  if (view.getUint32(8, true) !== bytes.byteLength) fail("invalid-glb-header", "GLB declared length does not match the exact source bytes.");

  let offset = GLB_HEADER_BYTES;
  let jsonBytes: Uint8Array | undefined;
  let binary: Uint8Array | undefined;
  let chunkIndex = 0;
  while (offset < bytes.byteLength) {
    assertNotAborted(signal);
    if (bytes.byteLength - offset < CHUNK_HEADER_BYTES) fail("invalid-glb-chunk", "GLB chunk header is truncated.");
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (length === 0 || length % 4 !== 0) fail("invalid-glb-chunk", "GLB chunks must be non-empty and four-byte aligned.");
    const payloadOffset = checkedAdd(offset, CHUNK_HEADER_BYTES, "invalid-glb-chunk", "GLB chunk offset overflowed.");
    const nextOffset = checkedAdd(payloadOffset, length, "invalid-glb-chunk", "GLB chunk length overflowed.");
    if (nextOffset > bytes.byteLength) fail("invalid-glb-chunk", "GLB chunk extends beyond the declared container.");
    const payload = bytes.subarray(payloadOffset, nextOffset);
    if (type === JSON_CHUNK_TYPE) {
      if (chunkIndex !== 0 || jsonBytes) fail("invalid-glb-chunk", "GLB must contain exactly one first JSON chunk.");
      if (length > limits.maxJsonBytes) fail("json-resource-limit", "GLB JSON chunk exceeds the configured byte limit.");
      jsonBytes = payload;
    } else if (type === BIN_CHUNK_TYPE) {
      if (!jsonBytes || binary) fail("invalid-glb-chunk", "GLB may contain one BIN chunk after JSON.");
      if (length > limits.maxBinaryBytes) fail("binary-resource-limit", "GLB BIN chunk exceeds the configured byte limit.");
      binary = payload;
    } else {
      fail("unsupported-glb-chunk", "GLB contains an unsupported chunk type.");
    }
    offset = nextOffset;
    chunkIndex += 1;
  }
  if (!jsonBytes) fail("invalid-glb-chunk", "GLB is missing its required JSON chunk.");
  const estimatedWorkingSetBytes = estimateWorkingSet(bytes.byteLength, jsonBytes.byteLength);
  if (estimatedWorkingSetBytes > limits.maxEstimatedWorkingSetBytes) {
    fail("input-resource-limit", "GLB processing exceeds the configured adapter working-set estimate.");
  }

  let jsonPaddingStart = jsonBytes.byteLength;
  while (jsonPaddingStart > 0) {
    const byte = jsonBytes[jsonPaddingStart - 1];
    if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) break;
    jsonPaddingStart -= 1;
  }
  for (let index = jsonPaddingStart; index < jsonBytes.byteLength; index += 1) {
    if (jsonBytes[index] !== 0x20) fail("invalid-glb-chunk", "GLB JSON padding must contain space bytes.");
  }

  let json: string;
  try {
    json = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(jsonBytes);
  } catch {
    fail("invalid-gltf-json", "GLB JSON is not valid UTF-8.");
  }
  if (json.charCodeAt(0) === 0xfeff) fail("invalid-gltf-json", "GLB JSON must not contain a byte-order mark.");
  assertNoDuplicateJsonKeys(json, limits, signal);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    fail("invalid-gltf-json", "GLB JSON cannot be parsed.");
  }
  if (!isRecord(parsed)) fail("invalid-gltf-document", "The glTF root must be an object.");
  return { document: parsed, ...(binary ? { binary } : {}), estimatedWorkingSetBytes };
}

function validateJsonGraph(root: Record<string, unknown>, limits: GlbResourceLimits, signal?: AbortSignal): void {
  let values = 0;
  const visit = (value: unknown, depth: number): void => {
    values += 1;
    if ((values & 0xfff) === 0) assertNotAborted(signal);
    if (values > limits.maxJsonValues) fail("json-resource-limit", "glTF JSON contains too many values.");
    if (depth > limits.maxJsonDepth) fail("json-resource-limit", "glTF JSON nesting exceeds the configured depth.");
    if (typeof value === "number" && !Number.isFinite(value)) {
      fail("unsafe-gltf-json", "glTF JSON contains a non-finite number.");
    }
    if (typeof value === "string" && value.length > limits.maxJsonStringLength) {
      fail("json-resource-limit", "glTF JSON contains an oversized string.");
    }
    if (Array.isArray(value)) {
      if (value.length > limits.maxJsonValues - values) {
        fail("json-resource-limit", "glTF JSON contains too many values.");
      }
      for (const child of value) visit(child, depth + 1);
      return;
    }
    if (!isRecord(value)) return;
    for (const key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      if (DANGEROUS_JSON_KEYS.has(key)) fail("unsafe-gltf-json", "glTF JSON contains a prohibited object key.");
      if (key.length > 256) fail("json-resource-limit", "glTF JSON contains an oversized object key.");
      visit(value[key], depth + 1);
    }
  };
  visit(root, 1);
}

function assertCount(document: Record<string, unknown>, field: string, maximum: number): unknown[] {
  const values = asArray(document[field], field);
  if (values.length > maximum) fail("document-resource-limit", `${field} exceeds the configured item limit.`);
  return values;
}

function hasExtensionPayload(root: unknown, signal?: AbortSignal): boolean {
  const stack = [root];
  let visited = 0;
  while (stack.length > 0) {
    visited += 1;
    if ((visited & 0xfff) === 0) assertNotAborted(signal);
    const value = stack.pop();
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) stack.push(value[index]);
    } else if (isRecord(value)) {
      if (isRecord(value.extensions) && Object.keys(value.extensions).length > 0) return true;
      const children = Object.values(value);
      for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
    }
  }
  return false;
}

function rejectShallowRigAndMorphPayloads(
  document: Record<string, unknown>,
  limits: GlbResourceLimits,
  signal?: AbortSignal,
): void {
  if ((Array.isArray(document.animations) && document.animations.length > 0)
    || (Array.isArray(document.skins) && document.skins.length > 0)) {
    fail("unsupported-gltf-feature", "Animation and skinning are outside the static-world GLB slice.");
  }
  if (Array.isArray(document.meshes)) {
    if (document.meshes.length > limits.maxMeshes) fail("document-resource-limit", "meshes exceeds the configured item limit.");
    let primitiveCount = 0;
    for (let meshIndex = 0; meshIndex < document.meshes.length; meshIndex += 1) {
      if ((meshIndex & 0xfff) === 0) assertNotAborted(signal);
      const mesh = document.meshes[meshIndex];
      if (!isRecord(mesh)) continue;
      if (mesh.weights !== undefined) fail("unsupported-gltf-feature", "Mesh morph weights are not supported by this static release.");
      if (!Array.isArray(mesh.primitives)) continue;
      primitiveCount = checkedAdd(primitiveCount, mesh.primitives.length, "document-resource-limit", "Primitive count overflowed.");
      if (primitiveCount > limits.maxPrimitives) fail("document-resource-limit", "meshes contain too many primitives.");
      for (let primitiveIndex = 0; primitiveIndex < mesh.primitives.length; primitiveIndex += 1) {
        if ((primitiveIndex & 0xfff) === 0) assertNotAborted(signal);
        const primitive = mesh.primitives[primitiveIndex];
        if (isRecord(primitive) && primitive.targets !== undefined) {
          fail("unsupported-gltf-feature", "Morph targets are not supported by this release.");
        }
      }
    }
  }
  if (Array.isArray(document.nodes)) {
    if (document.nodes.length > limits.maxNodes) fail("document-resource-limit", "nodes exceeds the configured item limit.");
    for (let nodeIndex = 0; nodeIndex < document.nodes.length; nodeIndex += 1) {
      if ((nodeIndex & 0xfff) === 0) assertNotAborted(signal);
      const node = document.nodes[nodeIndex];
      if (isRecord(node) && (node.weights !== undefined || node.skin !== undefined)) {
        fail("unsupported-gltf-feature", "Node skinning and morph weights are not supported by this static release.");
      }
    }
  }
}

function validateClosedFeatureSet(
  document: Record<string, unknown>,
  limits: GlbResourceLimits,
  signal?: AbortSignal,
): void {
  const asset = asRecord(document.asset, "asset");
  if (asset.version !== "2.0") fail("invalid-gltf-document", "glTF asset.version must be exactly 2.0.");
  const used = asArray(document.extensionsUsed, "extensionsUsed");
  const required = asArray(document.extensionsRequired, "extensionsRequired");
  if (used.length > 0 || required.length > 0) {
    fail("unsupported-gltf-feature", "This release admits only extension-free core glTF 2.0 assets.");
  }
  if (asArray(document.animations, "animations").length > 0 || asArray(document.skins, "skins").length > 0) {
    fail("unsupported-gltf-feature", "Animation and skinning are outside the static-world GLB slice.");
  }

  const accessors = assertCount(document, "accessors", limits.maxAccessors);
  if (accessors.some((item) => isRecord(item) && item.sparse !== undefined)) {
    fail("unsupported-gltf-feature", "Sparse accessors are not supported by this release.");
  }
  const meshes = assertCount(document, "meshes", limits.maxMeshes);
  let primitiveCount = 0;
  for (const [meshIndex, value] of meshes.entries()) {
    const mesh = asRecord(value, `meshes[${meshIndex}]`);
    if (mesh.weights !== undefined) {
      fail("unsupported-gltf-feature", "Mesh morph weights are not supported by this static release.");
    }
    const primitives = asArray(mesh.primitives, `meshes[${meshIndex}].primitives`);
    primitiveCount = checkedAdd(primitiveCount, primitives.length, "document-resource-limit", "Primitive count overflowed.");
    if (primitiveCount > limits.maxPrimitives) fail("document-resource-limit", "meshes contain too many primitives.");
    for (const [primitiveIndex, primitiveValue] of primitives.entries()) {
      const primitive = asRecord(primitiveValue, `meshes[${meshIndex}].primitives[${primitiveIndex}]`);
      if (primitive.mode !== undefined && primitive.mode !== 4) {
        fail("unsupported-gltf-feature", "Only triangle-list primitives are supported.");
      }
      if (primitive.targets !== undefined) fail("unsupported-gltf-feature", "Morph targets are not supported by this release.");
      const attributes = asRecord(primitive.attributes, `meshes[${meshIndex}].primitives[${primitiveIndex}].attributes`);
      if (attributes.POSITION === undefined) fail("missing-gltf-dependency", "Every admitted mesh primitive requires POSITION data.");
    }
  }
  const nodes = assertCount(document, "nodes", limits.maxNodes);
  for (const [nodeIndex, value] of nodes.entries()) {
    const node = asRecord(value, `nodes[${nodeIndex}]`);
    if (node.weights !== undefined || node.skin !== undefined) {
      fail("unsupported-gltf-feature", "Node skinning and morph weights are not supported by this static release.");
    }
  }
  assertCount(document, "scenes", limits.maxScenes);
  assertCount(document, "materials", limits.maxMaterials);
  assertCount(document, "textures", limits.maxTextures);
  assertCount(document, "images", limits.maxImages);
  if (hasExtensionPayload(document, signal)) {
    fail("unsupported-gltf-feature", "This release admits only extension-free core glTF 2.0 assets.");
  }
}

function validateBuffers(
  document: Record<string, unknown>,
  binary: Uint8Array | undefined,
  limits: GlbResourceLimits,
): { declaredByteLength: number; views: readonly BufferViewRecord[] } {
  const buffers = asArray(document.buffers, "buffers");
  if (buffers.length > 1) fail("unsupported-gltf-feature", "A self-contained GLB may contain at most one binary buffer.");
  let declaredByteLength = 0;
  if (buffers.length === 1) {
    const buffer = asRecord(buffers[0], "buffers[0]");
    if (buffer.uri !== undefined) fail("external-resource-forbidden", "External and data-URI buffers are forbidden.");
    declaredByteLength = integer(buffer.byteLength, "buffers[0].byteLength", 1);
    if (!binary) fail("missing-gltf-dependency", "The declared GLB buffer has no BIN chunk.");
  }
  if (binary) {
    if (buffers.length !== 1) fail("missing-gltf-dependency", "A GLB BIN chunk requires one buffer declaration.");
    if (binary.byteLength < declaredByteLength || binary.byteLength > declaredByteLength + 3) {
      fail("invalid-gltf-document", "GLB BIN bytes do not match the declared buffer length and padding allowance.");
    }
    if (declaredByteLength > limits.maxBinaryBytes) fail("binary-resource-limit", "The declared buffer exceeds the binary limit.");
    for (let index = declaredByteLength; index < binary.byteLength; index += 1) {
      if (binary[index] !== 0) fail("invalid-glb-chunk", "GLB BIN padding must contain zero bytes.");
    }
  }

  const rawViews = assertCount(document, "bufferViews", limits.maxBufferViews);
  const views = rawViews.map((value, index): BufferViewRecord => {
    const view = asRecord(value, `bufferViews[${index}]`);
    if (integer(view.buffer, `bufferViews[${index}].buffer`) !== 0 || buffers.length !== 1) {
      fail("missing-gltf-dependency", "A bufferView references a missing GLB buffer.");
    }
    const offset = view.byteOffset === undefined ? 0 : integer(view.byteOffset, `bufferViews[${index}].byteOffset`);
    const byteLength = integer(view.byteLength, `bufferViews[${index}].byteLength`, 1);
    const end = checkedAdd(offset, byteLength, "invalid-gltf-document", "A bufferView range overflowed.");
    if (end > declaredByteLength) fail("invalid-gltf-document", "A bufferView extends beyond the declared GLB buffer.");
    const byteStride = view.byteStride === undefined ? undefined : integer(view.byteStride, `bufferViews[${index}].byteStride`, 1);
    return { offset, byteLength, ...(byteStride === undefined ? {} : { byteStride }) };
  });
  return { declaredByteLength, views: Object.freeze(views) };
}

const COMPONENT_BYTE_LENGTH: Readonly<Record<number, number>> = Object.freeze({
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
});

const TYPE_COMPONENTS: Readonly<Record<string, number>> = Object.freeze({
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
});

function accessorElementByteLength(componentType: number, type: string): number {
  const componentBytes = COMPONENT_BYTE_LENGTH[componentType];
  const componentCount = TYPE_COMPONENTS[type];
  if (!componentBytes || !componentCount) fail("invalid-gltf-document", "Accessor componentType or type is unsupported.");
  if ((componentType === 5120 || componentType === 5121) && type === "MAT2") return 8;
  if ((componentType === 5120 || componentType === 5121) && type === "MAT3") return 12;
  if ((componentType === 5122 || componentType === 5123) && type === "MAT3") return 24;
  return componentBytes * componentCount;
}

function validateAccessors(
  document: Record<string, unknown>,
  binary: Uint8Array | undefined,
  views: readonly BufferViewRecord[],
  limits: GlbResourceLimits,
): void {
  const accessors = asArray(document.accessors, "accessors");
  let totalElements = 0;
  const data = binary ? new DataView(binary.buffer, binary.byteOffset, binary.byteLength) : undefined;
  for (const [index, value] of accessors.entries()) {
    const accessor = asRecord(value, `accessors[${index}]`);
    const componentType = integer(accessor.componentType, `accessors[${index}].componentType`);
    const type = typeof accessor.type === "string" ? accessor.type : "";
    const componentCount = TYPE_COMPONENTS[type];
    if (!componentCount) fail("invalid-gltf-document", "Accessor type is unsupported.");
    const count = integer(accessor.count, `accessors[${index}].count`, 1);
    const values = checkedMultiply(count, componentCount, "document-resource-limit", "Accessor element count overflowed.");
    totalElements = checkedAdd(totalElements, values, "document-resource-limit", "Accessor element count overflowed.");
    if (totalElements > limits.maxAccessorElements) fail("document-resource-limit", "Accessors exceed the configured element limit.");
    const elementBytes = accessorElementByteLength(componentType, type);
    if (accessor.bufferView === undefined) continue;
    const viewIndex = integer(accessor.bufferView, `accessors[${index}].bufferView`);
    const view = views[viewIndex];
    if (!view || !data) fail("missing-gltf-dependency", "An accessor references a missing bufferView or BIN chunk.");
    const accessorOffset = accessor.byteOffset === undefined ? 0 : integer(accessor.byteOffset, `accessors[${index}].byteOffset`);
    const stride = view.byteStride ?? elementBytes;
    if (stride < elementBytes) fail("accessor-out-of-bounds", "Accessor stride is smaller than its element representation.");
    const precedingBytes = checkedMultiply(count - 1, stride, "accessor-out-of-bounds", "Accessor range overflowed.");
    const end = checkedAdd(accessorOffset, checkedAdd(precedingBytes, elementBytes, "accessor-out-of-bounds", "Accessor range overflowed."), "accessor-out-of-bounds", "Accessor range overflowed.");
    if (end > view.byteLength) fail("accessor-out-of-bounds", "Accessor data extends beyond its bufferView.");
    if (componentType !== 5126) continue;
    const base = checkedAdd(view.offset, accessorOffset, "accessor-out-of-bounds", "Accessor base offset overflowed.");
    for (let element = 0; element < count; element += 1) {
      const elementOffset = base + element * stride;
      for (let component = 0; component < componentCount; component += 1) {
        if (!Number.isFinite(data.getFloat32(elementOffset + component * 4, true))) {
          fail("non-finite-accessor", "A floating-point accessor contains NaN or Infinity.");
        }
      }
    }
  }
}

function imageKind(bytes: Uint8Array): "image/png" | "image/jpeg" | undefined {
  if (bytes.byteLength >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.byteLength >= 4
    && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    && bytes[bytes.byteLength - 2] === 0xff && bytes[bytes.byteLength - 1] === 0xd9) return "image/jpeg";
  return undefined;
}

interface ImageDimensions {
  readonly width: number;
  readonly height: number;
  readonly decodedByteLength: number;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validateImageDimensions(
  width: number,
  height: number,
  decodedByteLength: number,
  limits: GlbResourceLimits,
): ImageDimensions {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    fail("invalid-image-resource", "An embedded image has invalid dimensions.");
  }
  if (width > limits.maxImageDimension || height > limits.maxImageDimension) {
    fail("image-dimension-limit", "An embedded image exceeds the configured dimension limit.");
  }
  const pixels = checkedMultiply(width, height, "image-dimension-limit", "Embedded image dimensions overflowed.");
  if (pixels > limits.maxImagePixels || decodedByteLength > limits.maxDecodedImageBytes) {
    fail("image-dimension-limit", "An embedded image exceeds the configured decoded-pixel budget.");
  }
  return Object.freeze({ width, height, decodedByteLength });
}

async function validatePng(
  bytes: Uint8Array,
  limits: GlbResourceLimits,
  signal?: AbortSignal,
): Promise<ImageDimensions> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let dimensions: ImageDimensions | undefined;
  let rowBytes = 0;
  let sawImageData = false;
  let imageDataClosed = false;
  let sawEnd = false;
  let colorType = -1;
  let bitDepth = 0;
  let paletteEntries = 0;
  let chunkIndex = 0;
  const imageData: Uint8Array[] = [];
  while (offset < bytes.byteLength) {
    assertNotAborted(signal);
    chunkIndex += 1;
    if (chunkIndex > limits.maxPngChunks) {
      fail("document-resource-limit", "An embedded PNG contains too many chunks.");
    }
    if (bytes.byteLength - offset < 12) fail("invalid-image-resource", "An embedded PNG chunk is truncated.");
    const length = view.getUint32(offset, false);
    const dataOffset = checkedAdd(offset, 8, "invalid-image-resource", "An embedded PNG chunk offset overflowed.");
    const crcOffset = checkedAdd(dataOffset, length, "invalid-image-resource", "An embedded PNG chunk length overflowed.");
    const nextOffset = checkedAdd(crcOffset, 4, "invalid-image-resource", "An embedded PNG chunk length overflowed.");
    if (nextOffset > bytes.byteLength) fail("invalid-image-resource", "An embedded PNG chunk extends beyond its payload.");
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = String.fromCharCode(...typeBytes);
    if (!/^[A-Za-z]{4}$/u.test(type)) fail("invalid-image-resource", "An embedded PNG chunk type is invalid.");
    const expectedCrc = view.getUint32(crcOffset, false);
    if (crc32(bytes.subarray(offset + 4, crcOffset)) !== expectedCrc) {
      fail("invalid-image-resource", "An embedded PNG chunk has an invalid CRC.");
    }
    if (chunkIndex === 1 && type !== "IHDR") fail("invalid-image-resource", "An embedded PNG must begin with IHDR.");
    if (type === "IHDR") {
      if (dimensions || length !== 13) fail("invalid-image-resource", "An embedded PNG has an invalid IHDR chunk.");
      const width = view.getUint32(dataOffset, false);
      const height = view.getUint32(dataOffset + 4, false);
      bitDepth = bytes[dataOffset + 8] ?? 0;
      colorType = bytes[dataOffset + 9] ?? 255;
      if (colorType === 3) {
        fail("unsupported-gltf-feature", "Indexed PNG textures require a fully decoded palette-validation adapter.");
      }
      const compression = bytes[dataOffset + 10];
      const filter = bytes[dataOffset + 11];
      const interlace = bytes[dataOffset + 12];
      const channels = colorType === 0 || colorType === 3 ? 1
        : colorType === 2 ? 3
          : colorType === 4 ? 2
            : colorType === 6 ? 4 : 0;
      const validDepth = colorType === 0 ? [1, 2, 4, 8, 16].includes(bitDepth)
        : colorType === 3 ? [1, 2, 4, 8].includes(bitDepth)
          : [8, 16].includes(bitDepth);
      if (channels === 0 || !validDepth || compression !== 0 || filter !== 0 || interlace !== 0) {
        fail("invalid-image-resource", "An embedded PNG has an unsupported or invalid IHDR profile.");
      }
      const bitsPerRow = checkedMultiply(
        checkedMultiply(width, channels, "image-dimension-limit", "Embedded PNG row size overflowed."),
        bitDepth,
        "image-dimension-limit",
        "Embedded PNG row size overflowed.",
      );
      rowBytes = Math.ceil(bitsPerRow / 8);
      const sourceDecodedBytes = checkedMultiply(rowBytes, height, "image-dimension-limit", "Embedded PNG decoded size overflowed.");
      const runtimeDecodedBytes = checkedMultiply(
        checkedMultiply(width, height, "image-dimension-limit", "Embedded PNG dimensions overflowed."),
        4,
        "image-dimension-limit",
        "Embedded PNG runtime texture size overflowed.",
      );
      const decodedByteLength = Math.max(sourceDecodedBytes, runtimeDecodedBytes);
      dimensions = validateImageDimensions(width, height, decodedByteLength, limits);
    } else if (type === "PLTE") {
      if (!dimensions || sawImageData || length === 0 || length > 768 || length % 3 !== 0) {
        fail("invalid-image-resource", "An embedded PNG has an invalid palette chunk.");
      }
      paletteEntries = length / 3;
    } else if (type === "IDAT") {
      if (!dimensions || imageDataClosed || sawEnd) fail("invalid-image-resource", "An embedded PNG has invalid image-data ordering.");
      sawImageData = true;
      imageData.push(bytes.subarray(dataOffset, crcOffset));
    } else if (type === "IEND") {
      if (!dimensions || !sawImageData || length !== 0 || nextOffset !== bytes.byteLength) {
        fail("invalid-image-resource", "An embedded PNG has an invalid IEND chunk.");
      }
      sawEnd = true;
    } else {
      if (sawImageData) imageDataClosed = true;
      if (((typeBytes[0] ?? 0) & 0x20) === 0) {
        fail("invalid-image-resource", "An embedded PNG contains an unsupported critical chunk.");
      }
    }
    offset = nextOffset;
  }
  if (!dimensions || !sawImageData || !sawEnd) fail("invalid-image-resource", "An embedded PNG is structurally incomplete.");
  if (colorType === 3 && (paletteEntries < 1 || paletteEntries > 2 ** bitDepth)) {
    fail("invalid-image-resource", "An embedded indexed PNG requires a bounded palette.");
  }
  const expectedInflatedLength = checkedMultiply(
    checkedAdd(rowBytes, 1, "image-dimension-limit", "Embedded PNG scanline size overflowed."),
    dimensions.height,
    "image-dimension-limit",
    "Embedded PNG decoded size overflowed.",
  );
  if (typeof DecompressionStream !== "function") {
    fail("validator-unavailable", "Bounded PNG decompression is unavailable.");
  }
  const compressedLength = imageData.reduce(
    (total, part) => checkedAdd(total, part.byteLength, "invalid-image-resource", "Embedded PNG data length overflowed."),
    0,
  );
  const compressed = new Uint8Array(compressedLength);
  let compressedOffset = 0;
  for (const part of imageData) {
    compressed.set(part, compressedOffset);
    compressedOffset += part.byteLength;
  }
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let inflatedLength = 0;
  try {
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate"));
    reader = stream.getReader();
    while (true) {
      assertNotAborted(signal);
      const next = await reader.read();
      if (next.done) break;
      const chunk = next.value;
      if (inflatedLength + chunk.byteLength > expectedInflatedLength) {
        fail("invalid-image-resource", "Embedded PNG scanline bytes exceed declared dimensions.");
      }
      for (let index = 0; index < chunk.byteLength; index += 1) {
        if ((inflatedLength % (rowBytes + 1)) === 0 && (chunk[index] ?? 255) > 4) {
          fail("invalid-image-resource", "Embedded PNG uses an invalid scanline filter.");
        }
        inflatedLength += 1;
      }
    }
  } catch (error) {
    try {
      await reader?.cancel();
    } catch {
      // Preserve the bounded primary validation error if stream cancellation fails.
    }
    if (error instanceof GlbAdapterError) throw error;
    fail("invalid-image-resource", "Embedded PNG image data cannot be decoded.");
  } finally {
    reader?.releaseLock();
  }
  if (inflatedLength !== expectedInflatedLength) {
    fail("invalid-image-resource", "Embedded PNG scanline bytes do not match declared dimensions.");
  }
  return dimensions;
}

async function validateImages(
  document: Record<string, unknown>,
  binary: Uint8Array | undefined,
  views: readonly BufferViewRecord[],
  limits: GlbResourceLimits,
  signal?: AbortSignal,
): Promise<GlbResourceEvidence> {
  const images = asArray(document.images, "images");
  let aggregate = 0;
  let aggregateDecoded = 0;
  for (const [index, value] of images.entries()) {
    const image = asRecord(value, `images[${index}]`);
    if (image.uri !== undefined) fail("external-resource-forbidden", "External and data-URI images are forbidden.");
    const viewIndex = integer(image.bufferView, `images[${index}].bufferView`);
    const view = views[viewIndex];
    if (!view || !binary) fail("missing-gltf-dependency", "An image references a missing bufferView or BIN chunk.");
    if (view.byteLength > limits.maxImageBytes) fail("document-resource-limit", "An embedded image exceeds the per-image byte limit.");
    aggregate = checkedAdd(aggregate, view.byteLength, "document-resource-limit", "Embedded image bytes overflowed.");
    if (aggregate > limits.maxAggregateImageBytes) fail("document-resource-limit", "Embedded images exceed the aggregate byte limit.");
    if (image.mimeType !== "image/png" && image.mimeType !== "image/jpeg") {
      fail("unsupported-gltf-feature", "Only the closed PNG image profile is supported by this strict release.");
    }
    const payload = binary.subarray(view.offset, view.offset + view.byteLength);
    const detected = imageKind(payload);
    if (!detected) fail("invalid-image-resource", "An embedded image has invalid or unsupported magic bytes.");
    if (detected !== image.mimeType) fail("image-mime-mismatch", "An embedded image MIME declaration does not match its magic bytes.");
    if (detected !== "image/png") {
      fail("unsupported-gltf-feature", "This strict release admits only fully decoded PNG image resources.");
    }
    const dimensions = await validatePng(payload, limits, signal);
    aggregateDecoded = checkedAdd(
      aggregateDecoded,
      dimensions.decodedByteLength,
      "image-dimension-limit",
      "Embedded decoded image bytes overflowed.",
    );
    if (aggregateDecoded > limits.maxAggregateDecodedImageBytes) {
      fail("image-dimension-limit", "Embedded images exceed the aggregate decoded-pixel budget.");
    }
  }
  return Object.freeze({
    bufferByteLength: binary ? integer(asRecord(asArray(document.buffers, "buffers")[0], "buffers[0]").byteLength, "buffers[0].byteLength", 1) : 0,
    imageCount: images.length,
    imageByteLength: aggregate,
    imageDecodedByteLength: aggregateDecoded,
  });
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!isRecord(value)) return value;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) output[key] = canonicalJson(value[key]);
  return output;
}

function align4(value: number): number {
  return (value + 3) & ~3;
}

function exportGlb(
  document: Record<string, unknown>,
  binary: Uint8Array | undefined,
  declaredLength: number,
  maxJsonBytes: number,
): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(canonicalJson(document)));
  const jsonLength = align4(json.byteLength);
  if (jsonLength > maxJsonBytes) fail("json-resource-limit", "Deterministic glTF JSON exceeds the configured byte limit.");
  const binaryLength = binary ? align4(declaredLength) : 0;
  const totalLength = GLB_HEADER_BYTES
    + CHUNK_HEADER_BYTES + jsonLength
    + (binary ? CHUNK_HEADER_BYTES + binaryLength : 0);
  const output = new Uint8Array(totalLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, GLB_VERSION, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(GLB_HEADER_BYTES, jsonLength, true);
  view.setUint32(GLB_HEADER_BYTES + 4, JSON_CHUNK_TYPE, true);
  const jsonOffset = GLB_HEADER_BYTES + CHUNK_HEADER_BYTES;
  output.set(json, jsonOffset);
  output.fill(0x20, jsonOffset + json.byteLength, jsonOffset + jsonLength);
  if (binary) {
    const chunkOffset = jsonOffset + jsonLength;
    view.setUint32(chunkOffset, binaryLength, true);
    view.setUint32(chunkOffset + 4, BIN_CHUNK_TYPE, true);
    output.set(binary.subarray(0, declaredLength), chunkOffset + CHUNK_HEADER_BYTES);
  }
  return output;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) fail("validator-unavailable", "Web Crypto SHA-256 is unavailable.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function loadValidator(): Promise<ValidatorModule> {
  validatorModulePromise ??= import("gltf-validator") as Promise<ValidatorModule>;
  try {
    return await validatorModulePromise;
  } catch {
    fail("validator-unavailable", "The pinned Khronos glTF validator could not be loaded.");
  }
}

function numberOrZero(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0;
}

function normalizeIssueCode(value: unknown): string {
  const normalized = typeof value === "string"
    ? value.toLowerCase().replaceAll("_", "-").replace(SAFE_DIAGNOSTIC_CODE, "-").replace(/^-+|-+$/gu, "")
    : "unknown";
  return `gltf-${normalized || "unknown"}`.slice(0, 128);
}

function normalizePointer(value: unknown): string {
  if (typeof value !== "string" || !/^\/(?:[A-Za-z0-9_.~-]+\/?)*$/u.test(value) || value.length > 256) return "the document";
  return value;
}

async function validateWithKhronos(
  bytes: Uint8Array,
  limits: GlbResourceLimits,
  signal?: AbortSignal,
): Promise<{ evidence: GlbValidatorEvidence; diagnostics: readonly ModelConverterDiagnostic[] }> {
  assertNotAborted(signal);
  const validator = await loadValidator();
  assertNotAborted(signal);
  let report: KhronosReport;
  try {
    report = await validator.validateBytes(bytes, {
      uri: "asset.glb",
      format: "glb",
      maxIssues: limits.maxDiagnostics,
      writeTimestamp: false,
      externalResourceFunction: async () => {
        throw new Error("External resource resolution is disabled.");
      },
    });
  } catch {
    fail("gltf-spec-validation-failed", "The final GLB failed Khronos glTF validation.");
  }
  assertNotAborted(signal);
  const issues = isRecord(report.issues) ? report.issues : {};
  const errorCount = numberOrZero(issues.numErrors);
  const warningCount = numberOrZero(issues.numWarnings);
  const infoCount = numberOrZero(issues.numInfos) + numberOrZero(issues.numHints);
  const issueCount = errorCount + warningCount + infoCount;
  const rawMessages = Array.isArray(issues.messages) ? issues.messages.slice(0, limits.maxDiagnostics) : [];
  let validatorBlockingOverride = false;
  const diagnostics = rawMessages.map((raw): ModelConverterDiagnostic => {
    const issue = isRecord(raw) ? raw as KhronosIssueMessage : {};
    const severityNumber = typeof issue.severity === "number" ? issue.severity : 2;
    const code = normalizeIssueCode(issue.code);
    const mustBlock = code === "gltf-image-unrecognized-format";
    validatorBlockingOverride ||= mustBlock;
    const severity: ModelConverterDiagnostic["severity"] = severityNumber === 0 || mustBlock
      ? "blocking"
      : severityNumber === 1 ? "warning" : "info";
    return diagnostic(severity, code, `Khronos glTF validation ${severity} at ${normalizePointer(issue.pointer)}.`);
  });
  if (issueCount > rawMessages.length && diagnostics.length < limits.maxDiagnostics) {
    diagnostics.push(diagnostic(errorCount > 0 ? "blocking" : "warning", "gltf-validator-issues-truncated", "Additional Khronos glTF validation issues were omitted by the configured bound."));
  }
  if (errorCount > 0 || validatorBlockingOverride) {
    const publicDiagnostics = diagnostics.length > 0
      ? diagnostics
      : [diagnostic("blocking", "gltf-validation-error", "Khronos glTF validation reported a blocking error.")];
    throw new GlbAdapterError("gltf-spec-validation-failed", "The final GLB failed Khronos glTF validation.", publicDiagnostics);
  }
  return {
    evidence: Object.freeze({ id: "KhronosGroup/glTF-Validator", version: validator.version(), issueCount }),
    diagnostics: Object.freeze(diagnostics),
  };
}

function deepFreeze<T>(root: T): T {
  const stack: object[] = [];
  if (root !== null && typeof root === "object") stack.push(root as object);
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || Object.isFrozen(current)) continue;
    for (const child of Object.values(current)) {
      if (child !== null && typeof child === "object" && !(child instanceof Blob)) stack.push(child);
    }
    Object.freeze(current);
  }
  return root;
}

interface PreparedGlb {
  readonly document: Record<string, unknown>;
  readonly outputBytes: Uint8Array;
  readonly resources: GlbResourceEvidence;
  readonly sourceByteLength: number;
  readonly sourceContentHash: string;
  readonly estimatedWorkingSetBytes: number;
}

async function prepareGlb(
  source: Uint8Array,
  limits: Readonly<GlbResourceLimits>,
  signal?: AbortSignal,
): Promise<PreparedGlb> {
  const parsed = parseGlb(source, limits, signal);
  rejectShallowRigAndMorphPayloads(parsed.document, limits, signal);
  validateJsonGraph(parsed.document, limits, signal);
  validateClosedFeatureSet(parsed.document, limits, signal);
  const buffers = validateBuffers(parsed.document, parsed.binary, limits);
  validateAccessors(parsed.document, parsed.binary, buffers.views, limits);
  const resources = await validateImages(parsed.document, parsed.binary, buffers.views, limits, signal);
  assertNotAborted(signal);
  const sourceContentHash = await sha256(source);
  assertNotAborted(signal);
  const outputBytes = exportGlb(parsed.document, parsed.binary, buffers.declaredByteLength, limits.maxJsonBytes);
  const estimatedWorkingSetBytes = Math.max(
    parsed.estimatedWorkingSetBytes,
    estimateWorkingSet(outputBytes.byteLength, firstJsonChunkLengthHint(outputBytes)),
  );
  if (estimatedWorkingSetBytes > limits.maxEstimatedWorkingSetBytes) {
    fail("input-resource-limit", "Deterministic GLB output exceeds the configured adapter working-set estimate.");
  }
  return {
    document: parsed.document,
    outputBytes,
    resources,
    sourceByteLength: source.byteLength,
    sourceContentHash,
    estimatedWorkingSetBytes,
  };
}

/**
 * Validate one self-contained core glTF 2.0 GLB and emit a deterministic GLB.
 *
 * This function never resolves a URI or performs a network request. Current
 * support is deliberately strict and lossless: unsupported features fail
 * closed instead of being silently dropped or repaired.
 */
export async function validateAndExportGlb(
  input: Uint8Array | ArrayBuffer,
  options: ValidateGlbOptions = {},
): Promise<ValidatedGlbArtifact> {
  const rawOptions: unknown = options;
  if (!isRecord(rawOptions)) fail("invalid-adapter-options", "GLB validation options must be an object.");
  const validatedOptions = rawOptions as ValidateGlbOptions;
  if (validatedOptions.mode !== undefined && validatedOptions.mode !== "strict") {
    fail("unsupported-adapter-mode", "Tolerant and forensic GLB repair modes are not implemented in this release.");
  }
  assertNotAborted(validatedOptions.signal);
  validateSourceHints(validatedOptions);
  const limits = resolveLimits(validatedOptions.limits);
  const prepared = await prepareGlb(
    copyInput(input, limits.maxInputBytes, limits.maxEstimatedWorkingSetBytes),
    limits,
    validatedOptions.signal,
  );
  const {
    document: parsedDocument,
    outputBytes,
    resources,
    sourceByteLength,
    sourceContentHash,
    estimatedWorkingSetBytes,
  } = prepared;
  if (outputBytes.byteLength > limits.maxInputBytes) fail("input-resource-limit", "Deterministic GLB output exceeds the configured byte limit.");
  const validation = await validateWithKhronos(outputBytes, limits, validatedOptions.signal);
  const outputContentHash = await sha256(outputBytes);
  assertNotAborted(validatedOptions.signal);
  if (!SHA256_PATTERN.test(sourceContentHash) || !SHA256_PATTERN.test(outputContentHash)) {
    fail("validator-unavailable", "SHA-256 evidence could not be produced.");
  }
  const diagnostics = Object.freeze([
    ...validation.diagnostics,
    diagnostic("info", "deterministic-glb-export", "GLB JSON and chunk padding were serialized deterministically."),
  ].slice(0, limits.maxDiagnostics));
  const losses: readonly ModelConversionLoss[] = Object.freeze([]);
  const converterEvidence: ModelConverterEvidence = deepFreeze({
    id: "gltf-glb-adapter",
    version: GLB_ADAPTER_VERSION,
    sourceFormat: "glb",
    targetFormat: "glb",
    sourceContentHash,
    outputContentHash,
    diagnostics,
    losses,
  });
  const document = deepFreeze(parsedDocument);
  return deepFreeze({
    format: "glb",
    glbVersion: 2,
    mimeType: "model/gltf-binary",
    sourceByteLength,
    estimatedWorkingSetBytes,
    outputByteLength: outputBytes.byteLength,
    sourceContentHash,
    outputContentHash,
    document,
    output: new Blob([outputBytes.buffer as ArrayBuffer], { type: "model/gltf-binary" }),
    resources,
    validator: validation.evidence,
    converterEvidence,
  } satisfies ValidatedGlbArtifact);
}

/** Magic-byte sniff used by `@plasius/gpu-model-runtime` registrations. */
export function sniffGlb(input: SniffInput): number {
  if (input.bytes.byteLength < GLB_HEADER_BYTES) return 0;
  const view = new DataView(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength);
  return view.getUint32(0, true) === GLB_MAGIC && view.getUint32(4, true) === GLB_VERSION ? 8 : 0;
}

function parseAdapterOptions(value: unknown): Readonly<{
  limits?: Partial<GlbResourceLimits>;
  pvoxModelsEnabled: boolean;
  gltfConverterEnabled: boolean;
  maxTriangles?: number;
}> {
  if (value === null || value === undefined) return { pvoxModelsEnabled: false, gltfConverterEnabled: false };
  if (!isRecord(value) || Object.keys(value).some((key) => key !== "limits" && key !== "pvoxModelsEnabled" && key !== "gltfConverterEnabled" && key !== "maxTriangles")) {
    fail("invalid-adapter-options", "GLB adapter options contain an unknown field.");
  }
  if (value.pvoxModelsEnabled !== undefined && typeof value.pvoxModelsEnabled !== "boolean") {
    fail("invalid-adapter-options", "pvoxModelsEnabled must be a remotely evaluated boolean.");
  }
  if (value.gltfConverterEnabled !== undefined && typeof value.gltfConverterEnabled !== "boolean") {
    fail("invalid-adapter-options", "gltfConverterEnabled must be a remotely evaluated boolean.");
  }
  if (value.maxTriangles !== undefined && (!Number.isSafeInteger(value.maxTriangles) || (value.maxTriangles as number) < 1)) {
    fail("invalid-adapter-options", "maxTriangles must be a positive safe integer.");
  }
  return {
    pvoxModelsEnabled: value.pvoxModelsEnabled === true,
    gltfConverterEnabled: value.gltfConverterEnabled === true,
    ...(value.limits === undefined ? {} : { limits: value.limits as Partial<GlbResourceLimits> }),
    ...(value.maxTriangles === undefined ? {} : { maxTriangles: value.maxTriangles as number }),
  };
}

async function loadFromRuntime(
  input: ResolvedModelSource,
  context: AdapterLoadContext,
): Promise<AdapterLoadResult<GpuModelDocument, GpuModelStaticDemoCompilerInput>> {
  if (context.mode !== "strict") {
    fail("unsupported-adapter-mode", "Tolerant and forensic GLB repair modes are not implemented in this release.");
  }
  const options = parseAdapterOptions(context.adapterOptions);
  assertNotAborted(context.signal);
  const { importGlbToGpuModelDocument } = await import("./static-demo-import.js");
  const imported = await importGlbToGpuModelDocument(input.bytes, {
    pvoxModelsEnabled: options.pvoxModelsEnabled,
    gltfConverterEnabled: options.gltfConverterEnabled,
    signal: context.signal,
    contentType: input.contentType,
    fileName: input.fileName,
    limits: options.limits,
    maxTriangles: options.maxTriangles,
  });
  if (input.contentHash !== imported.sourceContentHash) {
    fail("source-hash-mismatch", "The runtime source hash does not match the independently verified GLB bytes.");
  }
  return Object.freeze({
    canonicalModel: imported.document,
    rendererReady: imported.compilerInput,
    diagnostics: imported.document.diagnostics,
  });
}

/** Strict runtime registration for the bounded, feature-gated static demo path. */
export const glbAdapter: ModelAdapter<GpuModelDocument, GpuModelStaticDemoCompilerInput> = Object.freeze({
  formatId: "gltf",
  supportsWorker: true,
  sniff: sniffGlb,
  load: loadFromRuntime,
});
