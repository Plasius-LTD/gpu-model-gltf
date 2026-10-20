import type { ResourceResolver } from "@plasius/gpu-model-runtime";
import {
  DEFAULT_GLB_LIMITS,
  GlbAdapterError,
  gltfFormatInternals as format,
  type GlbResourceLimits,
} from "./glb-adapter.js";

/** Hard limits for the explicit resource-import profile. Overrides only tighten. */
export const DEFAULT_GLTF_RESOURCE_IMPORT_LIMITS = Object.freeze({
  maxInputBytes: 16 * 1024 * 1024,
  maxResourceBytes: 64 * 1024 * 1024,
  maxAggregateBytes: 64 * 1024 * 1024,
  maxResources: 1024,
  maxDecodedImageBytes: 64 * 1024 * 1024,
  maxAggregateDecodedImageBytes: 64 * 1024 * 1024,
  maxImageDimension: 4096,
  maxGeometryElements: 4_000_000,
  maxWorldVertices: 1_000_000,
  maxNodes: 4095,
  timeoutMs: 30_000,
});
/** Acquisition, image, geometry and work ceilings for one import. */
export type GltfResourceImportLimits = {
  readonly [Key in keyof typeof DEFAULT_GLTF_RESOURCE_IMPORT_LIMITS]: number;
};
export type JsonRecord = Record<string, unknown>;
const typedArrayKind = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  Symbol.toStringTag,
)!.get!;
/** @internal Use the intrinsic element kind rather than caller-controlled tags. */
export function isByteArray(value: unknown): value is Uint8Array {
  return (
    ArrayBuffer.isView(value) && typedArrayKind.call(value) === "Uint8Array"
  );
}
export function fail(
  code: ConstructorParameters<typeof GlbAdapterError>[0],
  message: string,
): never {
  throw new GlbAdapterError(code, message);
}
export function record(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("invalid-gltf-document", "A glTF object is invalid.");
  return value as JsonRecord;
}
export function array(value: unknown): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    fail("invalid-gltf-document", "A glTF array is invalid.");
  return value;
}
export function integer(
  value: unknown,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    fail(
      "invalid-gltf-document",
      "A glTF integer is outside its admitted range.",
    );
  return value;
}
export function limitsFor(value: unknown): GltfResourceImportLimits {
  const input = value === undefined ? {} : record(value);
  const limits: { -readonly [Key in keyof GltfResourceImportLimits]: number } =
    { ...DEFAULT_GLTF_RESOURCE_IMPORT_LIMITS };
  for (const key of Object.keys(input)) {
    if (!(key in limits) || !Object.hasOwn(limits, key))
      fail("invalid-limits", "An import limit is unknown.");
    const k = key as keyof GltfResourceImportLimits;
    const v = input[k];
    if (
      typeof v !== "number" ||
      !Number.isSafeInteger(v) ||
      v < 1 ||
      v > limits[k]
    )
      fail(
        "invalid-limits",
        "Import limits must be positive safe integers that only tighten hard ceilings.",
      );
    limits[k] = v;
  }
  return Object.freeze(limits);
}
/** @internal One cancellation/deadline owner, including uncooperative providers. */
export class ImportBudget {
  readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  readonly #started = performance.now();
  readonly #timer: ReturnType<typeof setTimeout>;
  readonly #abort: () => void;
  #timedOut = false;
  public constructor(
    readonly limits: GltfResourceImportLimits,
    readonly parent?: AbortSignal,
  ) {
    this.#abort = () => this.controller.abort();
    parent?.addEventListener("abort", this.#abort, { once: true });
    if (parent?.aborted) this.#abort();
    this.#timer = setTimeout(() => {
      this.#timedOut = true;
      this.controller.abort();
    }, limits.timeoutMs);
  }
  public check() {
    if (this.parent?.aborted)
      fail("aborted", "glTF resource import was cancelled.");
    if (
      this.#timedOut ||
      performance.now() - this.#started >= this.limits.timeoutMs
    )
      fail(
        "processing-time-limit",
        "glTF resource import exceeded its deadline.",
      );
    if (this.signal.aborted)
      fail("aborted", "glTF resource import was cancelled.");
  }
  public async wait<T>(work: Promise<T>): Promise<T> {
    this.check();
    let abort!: () => void;
    const stopped = new Promise<never>((_resolve, reject) => {
      abort = () => {
        try {
          this.check();
        } catch (error) {
          reject(error);
        }
      };
      this.signal.addEventListener("abort", abort, { once: true });
    });
    try {
      const value = await Promise.race([work, stopped]);
      this.check();
      return value;
    } finally {
      this.signal.removeEventListener("abort", abort);
    }
  }
  public dispose() {
    clearTimeout(this.#timer);
    this.parent?.removeEventListener("abort", this.#abort);
    this.controller.abort();
  }
}
export function formatLimits(
  limits: GltfResourceImportLimits,
): GlbResourceLimits {
  return {
    ...DEFAULT_GLB_LIMITS,
    maxInputBytes: DEFAULT_GLB_LIMITS.maxInputBytes,
    maxJsonStringLength: limits.maxInputBytes,
    maxBinaryBytes: limits.maxAggregateBytes,
    maxAccessorElements: limits.maxGeometryElements,
    maxNodes: limits.maxNodes,
    maxImages: limits.maxResources,
    maxImageBytes: limits.maxResourceBytes,
    maxAggregateImageBytes: limits.maxAggregateBytes,
    maxImageDimension: limits.maxImageDimension,
    maxDecodedImageBytes: limits.maxDecodedImageBytes,
    maxAggregateDecodedImageBytes: limits.maxAggregateDecodedImageBytes,
  };
}
function relativePath(value: string): string {
  // Admit only package-relative paths, decoded once; reject double encoding and traversal.
  if (
    !value ||
    value.length > 2048 ||
    /[\\?#:]/u.test(value) ||
    Array.from(value).some((c) => c.charCodeAt(0) <= 32) ||
    value.startsWith("/")
  )
    fail(
      "external-resource-forbidden",
      "Only bounded package-relative resource references are admitted.",
    );
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    fail(
      "external-resource-forbidden",
      "Resource reference encoding is invalid.",
    );
  }
  if (
    /%(?:2f|5c)/iu.test(value) ||
    /[\\%?#:]/u.test(decoded) ||
    Array.from(decoded).some((c) => c.charCodeAt(0) < 32) ||
    decoded.startsWith("/")
  )
    fail(
      "external-resource-forbidden",
      "Resource reference encoding is not admitted.",
    );
  const parts = decoded.split("/");
  if (parts.some((p) => p === ".." || p === ""))
    fail(
      "external-resource-forbidden",
      "Resource references cannot leave their package.",
    );
  const path = parts.filter((p) => p !== ".").join("/");
  if (!path)
    fail(
      "external-resource-forbidden",
      "A resource reference must name a package member.",
    );
  return path;
}
interface Reference {
  readonly path?: string;
  readonly data?: string;
  readonly mime?: string;
  readonly byteLength?: number;
}
function reference(value: unknown, image: boolean, maximum: number): Reference {
  if (typeof value !== "string")
    fail("invalid-gltf-document", "Resource URI must be a string.");
  if (!value.startsWith("data:")) return { path: relativePath(value) };
  const comma = value.indexOf(",");
  const mime = value.slice(5, comma).replace(/;base64$/u, "");
  if (
    comma < 0 ||
    !value.slice(0, comma).endsWith(";base64") ||
    !(
      image
        ? ["image/png", "image/jpeg"]
        : ["application/octet-stream", "application/gltf-buffer"]
    ).includes(mime)
  )
    fail(
      "source-type-mismatch",
      "The data URI media type or encoding is unsupported.",
    );
  const payload = value.slice(comma + 1);
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      payload,
    )
  )
    fail("invalid-gltf-document", "The data URI base64 encoding is invalid.");
  const length =
    (payload.length / 4) * 3 -
    (payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0);
  if (length > maximum)
    fail(
      "input-resource-limit",
      "A decoded data URI exceeds its acquisition limit.",
    );
  return { data: payload, mime, byteLength: length };
}
function mediaType(value: string | undefined) {
  return value?.split(";", 1)[0]?.trim().toLowerCase();
}
async function acquire(
  ref: Reference,
  image: boolean,
  maximum: number,
  resolver: ResourceResolver | undefined,
  budget: ImportBudget,
): Promise<{ bytes: Uint8Array; mime?: string }> {
  budget.check();
  if (maximum <= 0)
    fail("input-resource-limit", "The aggregate resource budget is exhausted.");
  if (ref.data !== undefined) {
    if (ref.byteLength! > maximum)
      fail(
        "input-resource-limit",
        "A decoded data URI exceeds the aggregate acquisition limit.",
      );
    const text = atob(ref.data);
    const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0));
    return { bytes, mime: ref.mime };
  }
  if (!resolver)
    fail(
      "missing-gltf-dependency",
      "An external resource requires the approved runtime resolver.",
    );
  let result;
  try {
    result = await budget.wait(
      Promise.resolve().then(() =>
        resolver.resolve(ref.path!, {
          signal: budget.signal,
          maxBytes: maximum,
        }),
      ),
    );
  } catch (error) {
    budget.check();
    if (error instanceof Error && error.name === "ModelResourceTooLargeError")
      fail("input-resource-limit", "A resource exceeds its acquisition limit.");
    fail(
      "missing-gltf-dependency",
      "A required package resource could not be acquired.",
    );
  }
  if (!isByteArray(result.bytes))
    fail(
      "missing-gltf-dependency",
      "The resource provider returned invalid bytes.",
    );
  if (result.bytes.byteLength > maximum)
    fail("input-resource-limit", "A resource exceeds its acquisition limit.");
  const mime = mediaType(result.contentType);
  if (
    mime &&
    (image
      ? !["image/png", "image/jpeg", "application/octet-stream"].includes(mime)
      : !["application/octet-stream", "application/gltf-buffer"].includes(mime))
  )
    fail(
      "image-mime-mismatch",
      "A resource response media type is inconsistent with its use.",
    );
  return { bytes: Uint8Array.from(result.bytes), mime };
}
/** @internal Fully inspect admitted image bytes; callers never supply inspection assertions. */
export async function inspectImage(
  bytes: Uint8Array,
  mime: string,
  limits: GlbResourceLimits,
  budget: ImportBudget,
): Promise<{ width: number; height: number; decodedByteLength: number }> {
  budget.check();
  if (format.imageKind(bytes) !== mime)
    fail(
      "image-mime-mismatch",
      "Image media type does not match its encoded bytes.",
    );
  if (mime === "image/png")
    return budget.wait(format.validatePng(bytes, limits, budget.signal));
  if (mime !== "image/jpeg")
    fail(
      "unsupported-gltf-feature",
      "Only PNG and JPEG image resources are admitted.",
    );
  try {
    const jpeg = await budget.wait(import("jpeg-js"));
    const decoded = (jpeg.default ?? jpeg).decode(bytes, {
      useTArray: true,
      formatAsRGBA: true,
      tolerantDecoding: false,
      maxResolutionInMP:
        Math.min(
          limits.maxImagePixels,
          Math.floor(limits.maxDecodedImageBytes / 4),
        ) / 1_000_000,
      maxMemoryUsageInMB: Math.min(
        128,
        limits.maxEstimatedWorkingSetBytes / 1024 / 1024,
      ),
    });
    budget.check();
    return format.validateImageDimensions(
      decoded.width,
      decoded.height,
      decoded.data.byteLength,
      limits,
    );
  } catch (error) {
    budget.check();
    if (error instanceof GlbAdapterError) throw error;
    fail(
      "invalid-image-resource",
      "JPEG image decoding failed within the admitted resource limits.",
    );
  }
}
export interface ResolvedImport {
  readonly sourceFormat: "gltf" | "glb";
  readonly document: JsonRecord;
  readonly binary: Uint8Array;
  readonly images: readonly {
    bytes: Uint8Array;
    mime: string;
    width: number;
    height: number;
  }[];
  readonly sourceContentHash: string;
  readonly validator: Awaited<ReturnType<typeof format.validateWithKhronos>>;
}
/** Bound repeated accessor/mesh references before acquisition or Khronos traversal. */
function preflightGeometryWork(
  document: JsonRecord,
  budget: ImportBudget,
): void {
  const accessors = array(document.accessors);
  const sizes: Record<string, number> = {
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
  };
  let expandedElements = 0;
  const count = (index: unknown) =>
    record(accessors[integer(index, 0, accessors.length - 1)]);
  const consume = (amount: number) => {
    if (amount > budget.limits.maxGeometryElements - expandedElements)
      fail(
        "document-resource-limit",
        "Repeated geometry references exceed the pre-validation work budget.",
      );
    expandedElements += amount;
    if (expandedElements > Math.floor(budget.limits.maxAggregateBytes / 4))
      fail(
        "document-resource-limit",
        "Expanded canonical geometry exceeds its byte budget.",
      );
  };
  const verticesByMesh = array(document.meshes).map((value) => {
    let vertices = 0;
    for (const primitiveValue of array(record(value).primitives)) {
      budget.check();
      const primitive = record(primitiveValue);
      const attributes = record(primitive.attributes);
      const positionCount = integer(count(attributes.POSITION).count, 1);
      for (const index of Object.values(attributes)) {
        const accessor = count(index);
        const components = sizes[String(accessor.type)];
        if (!components)
          fail(
            "unsupported-gltf-feature",
            "Static geometry requires scalar or vector accessors.",
          );
        consume(integer(accessor.count, 1) * components);
      }
      consume(
        primitive.indices === undefined
          ? positionCount
          : integer(count(primitive.indices).count, 1),
      );
      vertices += positionCount;
    }
    return vertices;
  });
  let worldVertices = 0;
  for (const value of array(document.nodes)) {
    budget.check();
    const node = record(value);
    if (node.mesh === undefined) continue;
    const vertices =
      verticesByMesh[integer(node.mesh, 0, verticesByMesh.length - 1)]!;
    if (vertices > budget.limits.maxWorldVertices - worldVertices)
      fail(
        "document-resource-limit",
        "Mesh instances exceed the pre-validation world-vertex budget.",
      );
    worldVertices += vertices;
  }
}

/** @internal Normalize only after checking original references and byte ranges. */
export async function resolveImport(
  input: Uint8Array,
  resolver: ResourceResolver | undefined,
  budget: ImportBudget,
  contentType?: string,
): Promise<ResolvedImport> {
  budget.check();
  const limits = formatLimits(budget.limits);
  if (input.byteLength > budget.limits.maxInputBytes)
    fail(
      "input-resource-limit",
      "The glTF entry point exceeds its input limit.",
    );
  const sourceFormat =
    input.length >= 4 &&
    new DataView(input.buffer, input.byteOffset, input.byteLength).getUint32(
      0,
      true,
    ) === 0x46546c67
      ? "glb"
      : "gltf";
  const mime = mediaType(contentType);
  if (
    mime &&
    ![
      sourceFormat === "glb" ? "model/gltf-binary" : "model/gltf+json",
      "application/octet-stream",
      ...(sourceFormat === "gltf" ? ["application/json"] : []),
    ].includes(mime)
  )
    fail(
      "source-type-mismatch",
      "The entry point media type does not match its bytes.",
    );
  let document: JsonRecord;
  let bin: Uint8Array | undefined;
  if (sourceFormat === "glb") {
    const parsed = format.parseGlb(input, limits, budget.signal);
    document = parsed.document;
    bin = parsed.binary;
  } else {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        input,
      );
    } catch {
      fail("invalid-gltf-json", "The glTF JSON is not valid UTF-8.");
    }
    format.assertNoDuplicateJsonKeys(text, limits, budget.signal);
    try {
      document = record(JSON.parse(text));
    } catch (error) {
      if (error instanceof GlbAdapterError) throw error;
      fail("invalid-gltf-json", "The glTF JSON could not be parsed.");
    }
  }
  format.validateJsonGraph(document, limits, budget.signal);
  format.validateClosedFeatureSet(document, limits, budget.signal);
  preflightGeometryWork(document, budget);
  for (const key of [
    "accessors",
    "animations",
    "buffers",
    "bufferViews",
    "cameras",
    "images",
    "materials",
    "meshes",
    "nodes",
    "samplers",
    "scenes",
    "skins",
    "textures",
  ]) {
    if (document[key] !== undefined && array(document[key]).length === 0)
      fail(
        "invalid-gltf-document",
        "Present glTF collection properties must be non-empty.",
      );
  }
  if (
    array(document.cameras).length ||
    array(document.nodes).some((v) => record(v).camera !== undefined)
  )
    fail(
      "unsupported-gltf-feature",
      "Camera import is outside the static resource profile.",
    );
  const rawBuffers = array(document.buffers).map(record);
  const rawImages = array(document.images).map(record);
  if (rawBuffers.length + rawImages.length > budget.limits.maxResources)
    fail(
      "document-resource-limit",
      "The import exceeds its resource count limit.",
    );
  const bufferRefs = rawBuffers.map((b, i) => {
    integer(b.byteLength, 1, budget.limits.maxResourceBytes);
    if (b.uri !== undefined)
      return reference(b.uri, false, budget.limits.maxResourceBytes);
    if (sourceFormat !== "glb" || i !== 0 || !bin)
      fail(
        "missing-gltf-dependency",
        "A buffer has no admitted URI or GLB BIN payload.",
      );
    return undefined;
  });
  if (bin && (rawBuffers.length === 0 || rawBuffers[0]!.uri !== undefined))
    fail(
      "invalid-glb-chunk",
      "The GLB BIN chunk has no corresponding buffer declaration.",
    );
  const imageRefs = rawImages.map((image) => {
    if ((image.uri === undefined) === (image.bufferView === undefined))
      fail(
        "invalid-gltf-document",
        "Images require exactly one URI or bufferView.",
      );
    return image.uri === undefined
      ? undefined
      : reference(image.uri, true, budget.limits.maxResourceBytes);
  });
  // Validate original bufferView ranges before buffer merging can mask overruns.
  const views = array(document.bufferViews).map((v) => {
    const view = record(v);
    const b = integer(view.buffer, 0, rawBuffers.length - 1);
    const offset = integer(view.byteOffset ?? 0);
    const length = integer(view.byteLength, 1);
    if (offset > (rawBuffers[b]!.byteLength as number) - length)
      fail(
        "accessor-out-of-bounds",
        "A bufferView exceeds its original buffer declaration.",
      );
    return { ...view, buffer: b, byteOffset: offset, byteLength: length };
  });
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let total = 0;
  let acquired = 0;
  const append = (bytes: Uint8Array) => {
    const aligned = Math.ceil(total / 4) * 4;
    if (bytes.length > budget.limits.maxAggregateBytes - aligned)
      fail(
        "input-resource-limit",
        "Normalized resource bytes exceed the aggregate budget.",
      );
    if (
      (aligned + bytes.length) * 7 + input.length * 32 + 32 * 1024 * 1024 >
      limits.maxEstimatedWorkingSetBytes
    )
      fail(
        "input-resource-limit",
        "Resource assembly exceeds its estimated working-set budget.",
      );
    parts.push(new Uint8Array(aligned - total), bytes);
    total = aligned + bytes.length;
    return aligned;
  };
  for (let i = 0; i < rawBuffers.length; i += 1) {
    budget.check();
    const declared = rawBuffers[i]!.byteLength as number;
    const maximum = Math.min(
      declared,
      budget.limits.maxResourceBytes,
      budget.limits.maxAggregateBytes - acquired,
    );
    const bytes = bufferRefs[i]
      ? (await acquire(bufferRefs[i]!, false, maximum, resolver, budget)).bytes
      : bin!;
    if (bytes.length < declared)
      fail("missing-gltf-dependency", "A buffer resource is truncated.");
    if (
      !bufferRefs[i] &&
      (bytes.length > declared + 3 ||
        bytes.subarray(declared).some((n) => n !== 0))
    )
      fail("invalid-glb-chunk", "GLB BIN padding is invalid.");
    acquired += declared;
    if (acquired > budget.limits.maxAggregateBytes)
      fail(
        "input-resource-limit",
        "Resource bytes exceed the aggregate budget.",
      );
    offsets.push(append(bytes.subarray(0, declared)));
  }
  const normalizedViews = views.map((v) => ({
    ...v,
    buffer: 0,
    byteOffset: offsets[v.buffer]! + v.byteOffset,
  }));
  const images: ResolvedImport["images"][number][] = [];
  const normalizedImages: JsonRecord[] = [];
  let decodedTotal = 0;
  for (let i = 0; i < rawImages.length; i += 1) {
    budget.check();
    const image = rawImages[i]!;
    const ref = imageRefs[i];
    let bytes: Uint8Array;
    let responseMime: string | undefined;
    if (ref) {
      const got = await acquire(
        ref,
        true,
        Math.min(
          budget.limits.maxResourceBytes,
          budget.limits.maxAggregateBytes - acquired,
        ),
        resolver,
        budget,
      );
      bytes = got.bytes;
      responseMime = got.mime;
      acquired += bytes.length;
    } else {
      const v = views[integer(image.bufferView, 0, views.length - 1)]!;
      // Locate the original buffer bytes in the parts list, excluding padding entries.
      bytes = parts[v.buffer * 2 + 1]!.subarray(
        v.byteOffset,
        v.byteOffset + v.byteLength,
      );
    }
    const detected = format.imageKind(bytes);
    const declared = image.mimeType === undefined ? detected : image.mimeType;
    if (
      declared !== detected ||
      (responseMime &&
        responseMime !== "application/octet-stream" &&
        responseMime !== detected)
    )
      fail(
        "image-mime-mismatch",
        "Image declaration, response and encoded bytes disagree.",
      );
    if (declared !== "image/png" && declared !== "image/jpeg")
      fail(
        "unsupported-gltf-feature",
        "Only PNG and JPEG image resources are admitted.",
      );
    if (decodedTotal >= budget.limits.maxAggregateDecodedImageBytes)
      fail(
        "image-dimension-limit",
        "Images exhaust the aggregate decoded-pixel budget.",
      );
    const dims = await inspectImage(
      bytes,
      declared,
      {
        ...limits,
        maxDecodedImageBytes: Math.min(
          limits.maxDecodedImageBytes,
          budget.limits.maxAggregateDecodedImageBytes - decodedTotal,
        ),
      },
      budget,
    );
    decodedTotal += dims.decodedByteLength;
    if (decodedTotal > budget.limits.maxAggregateDecodedImageBytes)
      fail(
        "image-dimension-limit",
        "Images exceed the aggregate decoded-pixel budget.",
      );
    images.push({
      bytes: Uint8Array.from(bytes),
      mime: declared,
      width: dims.width,
      height: dims.height,
    });
    const viewIndex = normalizedViews.length;
    const offset = ref
      ? append(bytes)
      : normalizedViews[image.bufferView as number]!.byteOffset;
    normalizedViews.push({
      buffer: 0,
      byteOffset: offset,
      byteLength: bytes.length,
    });
    normalizedImages.push({ bufferView: viewIndex, mimeType: declared });
  }
  budget.check();
  const binary = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    binary.set(part, cursor);
    cursor += part.length;
  }
  const normalized = {
    ...document,
    ...(total ? { buffers: [{ byteLength: total }] } : {}),
    ...(normalizedViews.length ? { bufferViews: normalizedViews } : {}),
    ...(normalizedImages.length ? { images: normalizedImages } : {}),
  };
  const bufferInfo = format.validateBuffers(
    normalized,
    total ? binary : undefined,
    limits,
  );
  format.validateAccessors(normalized, binary, bufferInfo.views, limits);
  const normalizedBytes = format.exportGlb(
    normalized,
    total ? binary : undefined,
    total,
    limits.maxJsonBytes,
  );
  if (
    normalizedBytes.length * 7 + input.length * 32 + 32 * 1024 * 1024 >
    limits.maxEstimatedWorkingSetBytes
  )
    fail(
      "input-resource-limit",
      "The import exceeds its estimated working-set budget.",
    );
  const validator = await budget.wait(
    format.validateWithKhronos(normalizedBytes, limits, budget.signal),
  );
  const sourceContentHash = await budget.wait(format.sha256(input));
  return {
    sourceFormat,
    document: normalized,
    binary,
    images,
    sourceContentHash,
    validator,
  };
}
