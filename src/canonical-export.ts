import {
  isGpuModelDocument,
  type GpuModelDocument,
} from "@plasius/gpu-model-core";
import {
  DEFAULT_GLB_LIMITS,
  GlbAdapterError,
  gltfFormatInternals as format,
  type GlbValidatorEvidence,
} from "./glb-adapter.js";
import type { ModelConverterDiagnostic } from "@plasius/asset-contracts";
import {
  ImportBudget,
  limitsFor,
  formatLimits,
  type GltfResourceImportLimits,
  inspectImage,
} from "./resource-resolution.js";
import { admitMaterialExtensions } from "./resource-materials.js";
import { exportMaterials } from "./canonical-export-materials.js";
import { preflightDeformation } from "./resource-deformation.js";
import { ExportGeometry, exportScene } from "./canonical-export-geometry.js";
import { fail, type JsonRecord } from "./resource-values.js";

/** Remote decision required by this package-only exporter. */
export const GLTF_CANONICAL_EXPORT_FEATURE_FLAG =
  "gpu.model.conversion.enabled" as const;
/** Deterministic canonical edit serialization profile; source artifacts are never replayed. */
export const GLTF_CANONICAL_EXPORT_PROFILE =
  "gltf-canonical-export-v1" as const;
/** Options for exporting a privately verified core document. Limits only tighten import-family ceilings. */
export interface ExportGpuModelToGltfOptions {
  readonly conversionEnabled: boolean;
  readonly format?: "glb" | "gltf";
  readonly signal?: AbortSignal;
  readonly limits?: Partial<GltfResourceImportLimits>;
}
/** One immutable exact-byte package member. Paths are generated, never copied from source URIs. */
export interface GltfExportResource {
  readonly path: string;
  readonly contentHash: string;
  readonly byteLength: number;
  readonly mimeType: string;
  readonly payload: Blob;
}
/** Complete deterministic output, including entry point and all relative dependencies. */
export interface GltfExportPackage {
  readonly profile: typeof GLTF_CANONICAL_EXPORT_PROFILE;
  readonly format: "glb" | "gltf";
  readonly entryPoint: "model.glb" | "model.gltf";
  readonly resources: readonly GltfExportResource[];
  readonly validator: GlbValidatorEvidence;
  /** Bounded sanitized findings from validation of these exact package bytes. */
  readonly diagnostics: readonly ModelConverterDiagnostic[];
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, stable(v)]),
    );
  return value;
}
function samplers(document: GpuModelDocument): JsonRecord[] {
  const wraps = {
    repeat: 10497,
    "mirrored-repeat": 33648,
    "clamp-to-edge": 33071,
  } as const;
  return document.textures.map((t) => {
    const s = t.sampler;
    if (
      s &&
      ((s.minFilter !== undefined &&
        !["nearest", "linear"].includes(s.minFilter)) ||
        (s.magFilter !== undefined &&
          !["nearest", "linear"].includes(s.magFilter)))
    )
      fail(
        "unsupported-gltf-feature",
        "A canonical sampler filter cannot be exported losslessly.",
      );
    const nearest = s?.minFilter === "nearest";
    return {
      wrapS: wraps[s?.wrapS ?? "repeat"],
      wrapT: wraps[s?.wrapT ?? "repeat"],
      magFilter: s?.magFilter === "nearest" ? 9728 : 9729,
      minFilter:
        s?.mipFilter === undefined
          ? nearest
            ? 9728
            : 9729
          : s.mipFilter === "nearest"
            ? nearest
              ? 9984
              : 9985
            : nearest
              ? 9986
              : 9987,
    };
  });
}
function preflight(document: GpuModelDocument, budget: ImportBudget) {
  const l = budget.limits;
  const cap = (value: number, limit: number) => {
    if (value > limit)
      fail(
        "document-resource-limit",
        "Canonical export exceeds its declared entity budget.",
      );
  };
  cap(document.nodes.length, l.maxNodes);
  cap(document.resources.length, l.maxResources);
  cap(document.skins.length, l.maxSkins);
  cap(document.joints.length, l.maxJoints);
  cap(document.blendShapes.length, l.maxMorphTargets);
  cap(document.animations.length, l.maxAnimations);
  cap(
    document.animations.reduce((n, a) => n + a.samplers.length, 0),
    l.maxAnimationSamplers,
  );
  cap(
    document.animations.reduce((n, a) => n + a.channels.length, 0),
    l.maxAnimationChannels,
  );
  cap(
    document.nodes.reduce((n, v) => n + (v.morphWeights?.length ?? 0), 0),
    l.maxMorphBindings,
  );
  const nodeById = new Map(document.nodes.map((n) => [n.id, n]));
  const parent = new Map(
    document.nodes.flatMap((n) => n.children.map((id) => [id, n.id] as const)),
  );
  const jointById = new Map(document.joints.map((j) => [j.id, j]));
  const usedSkeletons = new Set(document.skins.map((s) => s.skeletonId));
  for (const skeleton of document.skeletons) {
    budget.check();
    if (!usedSkeletons.has(skeleton.id))
      fail(
        "unsupported-gltf-feature",
        "Unbound canonical skeletons cannot be exported losslessly.",
      );
    const byNode = new Map(
      skeleton.jointIds.map((id) => [jointById.get(id)!.nodeId, id]),
    );
    const nearest = new Map<string, string | undefined>();
    for (const id of skeleton.jointIds) {
      const joint = jointById.get(id)!,
        node = nodeById.get(joint.nodeId)!;
      if (
        !node.restLocalTransform ||
        JSON.stringify(node.restLocalTransform) !==
          JSON.stringify(joint.restLocalTransform) ||
        (joint.name !== undefined && joint.name !== node.name)
      )
        fail(
          "unsupported-gltf-feature",
          "Canonical joint rest poses and names must match their scene nodes.",
        );
      let cursor = parent.get(node.id);
      const path: string[] = [];
      while (
        cursor !== undefined &&
        !byNode.has(cursor) &&
        !nearest.has(cursor)
      ) {
        budget.check();
        path.push(cursor);
        cursor = parent.get(cursor);
      }
      const found =
        cursor === undefined
          ? undefined
          : (byNode.get(cursor) ?? nearest.get(cursor));
      for (const p of path) nearest.set(p, found);
      if (found !== joint.parentJointId)
        fail(
          "unsupported-gltf-feature",
          "Canonical joint ancestry must match the nearest scene joint.",
        );
    }
    for (const skin of document.skins.filter(
      (s) => s.skeletonId === skeleton.id,
    ))
      if (
        skin.jointIds.length !== skeleton.jointIds.length ||
        skin.jointIds.some((id) => !skeleton.jointIds.includes(id))
      )
        fail(
          "unsupported-gltf-feature",
          "Partial canonical skeleton bindings cannot be exported losslessly.",
        );
  }
  for (const a of document.animations) {
    budget.check();
    if (
      a.durationSeconds !==
      Math.max(...a.samplers.map((s) => s.inputTimesSeconds.at(-1)!))
    )
      fail(
        "unsupported-gltf-feature",
        "Clip tail durations require an explicit glTF key.",
      );
    for (const c of a.channels)
      if (c.targetType === "node-weights") {
        const node = nodeById.get(c.targetId)!;
        const shapes = document.blendShapes.filter(
          (s) => s.meshId === node.meshId,
        );
        if (node.morphWeights!.some((w, i) => w.blendShapeId !== shapes[i]?.id))
          fail(
            "unsupported-gltf-feature",
            "Node weight animation order must match mesh morph target order.",
          );
      }
  }
  let bytes = 0,
    elements = 0,
    deformationElements = document.nodes.reduce(
      (n, v) => n + (v.morphWeights?.length ?? 0),
      0,
    );
  for (const r of document.resources) {
    budget.check();
    cap(r.byteLength, l.maxResourceBytes);
    bytes += r.byteLength;
    cap(bytes, l.maxAggregateBytes);
  }
  const sizes = {
    scalar: 1,
    vec2: 2,
    vec3: 3,
    vec4: 4,
    mat2: 4,
    mat3: 9,
    mat4: 16,
  };
  for (const a of document.accessors) {
    budget.check();
    elements += a.count * sizes[a.elementType];
    cap(elements, l.maxGeometryElements);
  }
  for (const skin of document.skins) {
    deformationElements += skin.jointIds.length * 16 + document.nodes.length;
    for (const set of skin.weightSets)
      deformationElements += set.joints.length * set.influencesPerVertex * 2;
  }
  const accessorById = new Map(document.accessors.map((a) => [a.id, a]));
  for (const shape of document.blendShapes)
    for (const delta of shape.deltas) {
      budget.check();
      for (const id of [
        delta.positionAccessorId,
        delta.normalAccessorId,
        delta.tangentAccessorId,
      ])
        if (id) {
          const accessor = accessorById.get(id)!;
          deformationElements += accessor.count * sizes[accessor.elementType];
          cap(deformationElements, l.maxDeformationElements);
        }
    }
  for (const animation of document.animations)
    for (const sampler of animation.samplers)
      deformationElements +=
        sampler.inputTimesSeconds.length + sampler.outputValues.length;
  cap(deformationElements, l.maxDeformationElements);
  // Conservative bounded allocation estimate: copies/packed output/validator plus decoded geometry and images.
  cap(
    Math.max(bytes, elements * 4) * 7 +
      elements * 16 +
      l.maxAggregateDecodedImageBytes +
      32 * 1024 * 1024,
    768 * 1024 * 1024,
  );
  if (
    document.analyticGeometry.length ||
    !document.meshes.length ||
    document.diagnostics.some((d) => d.severity === "error")
  )
    fail(
      "unsupported-gltf-feature",
      "Canonical analytic, empty or blocked documents cannot be exported by this profile.",
    );
}
/** Serialize current canonical edits into a verified no-network GLB or relative glTF package. */
export async function exportGpuModelToGltf(
  document: GpuModelDocument,
  options: ExportGpuModelToGltfOptions,
): Promise<GltfExportPackage> {
  if (
    !options ||
    typeof options.conversionEnabled !== "boolean" ||
    (options.format !== undefined &&
      options.format !== "glb" &&
      options.format !== "gltf")
  )
    fail(
      "invalid-adapter-options",
      "Canonical export requires a remote decision and a supported layout.",
    );
  if (!options.conversionEnabled)
    fail("feature-disabled", "GPU model conversion is disabled.");
  const budget = new ImportBudget(limitsFor(options.limits), options.signal);
  try {
    budget.check();
    if (!isGpuModelDocument(document))
      fail(
        "canonical-model-core-rejected",
        "Canonical export requires a privately verified core document.",
      );
    preflight(document, budget);
    const layout = options.format ?? "glb";
    if (
      layout === "glb" &&
      document.textures.some(
        (t) => t.exportEmbeddingPolicy === "forbid-embedding",
      )
    )
      fail(
        "unsupported-gltf-feature",
        "The requested GLB layout conflicts with a texture embedding prohibition.",
      );
    const buffers = new Map<string, Uint8Array>();
    const images = document.resources.filter((r) => r.kind === "image");
    let decoded = 0;
    for (const r of document.resources) {
      budget.check();
      const bytes = new Uint8Array(await budget.wait(r.payload.arrayBuffer()));
      buffers.set(r.id, bytes);
      // Recheck format-owned image admission; core resource trust does not imply glTF MIME support.
      if (r.kind === "image") {
        const dimensions = await inspectImage(
          bytes,
          r.mimeType,
          {
            ...formatLimits(budget.limits),
            maxDecodedImageBytes: Math.min(
              budget.limits.maxDecodedImageBytes,
              budget.limits.maxAggregateDecodedImageBytes - decoded,
            ),
          },
          budget,
        );
        decoded += dimensions.decodedByteLength;
        if (decoded > budget.limits.maxAggregateDecodedImageBytes)
          fail(
            "document-resource-limit",
            "Canonical export images exceed decoded-byte budget.",
          );
      }
    }
    const pack = new ExportGeometry(document, buffers, budget);
    const json = exportScene(document, pack);
    if (document.materials.length)
      json.materials = exportMaterials(document.materials, document.textures);
    const imageIndices = new Map(images.map((r, i) => [r.id, i]));
    if (document.textures.length) {
      json.samplers = samplers(document);
      json.textures = document.textures.map((t, i) => ({
        source: imageIndices.get(t.imageResourceId),
        sampler: i,
      }));
    }
    const outputFiles: { path: string; bytes: Uint8Array; mime: string }[] = [];
    if (images.length)
      json.images = images.map((r, i) => {
        const bytes = buffers.get(r.id)!;
        if (layout === "glb")
          return { bufferView: pack.view(bytes), mimeType: r.mimeType };
        const path = `images/image-${i}.${r.mimeType === "image/png" ? "png" : "jpg"}`;
        outputFiles.push({ path, bytes, mime: r.mimeType });
        return { uri: path, mimeType: r.mimeType };
      });
    const used = new Set<string>();
    const stack: unknown[] = [json];
    while (stack.length) {
      budget.check();
      const value = stack.pop();
      if (value && typeof value === "object")
        for (const [k, v] of Object.entries(value)) {
          if (k === "extensions")
            for (const key of Object.keys(v as object)) used.add(key);
          if (k !== "extras") stack.push(v);
        }
    }
    if (used.size) json.extensionsUsed = [...used].sort();
    const binary = pack.binary();
    json.buffers = [
      {
        byteLength: binary.length,
        ...(layout === "gltf" ? { uri: "model.bin" } : {}),
      },
    ];
    const limits = formatLimits(budget.limits);
    // The same closed grammar as import, before Khronos work and final artifact creation.
    format.validateJsonGraph(json, limits, budget.signal);
    format.validateClosedFeatureSet(
      json,
      limits,
      budget.signal,
      (value) => admitMaterialExtensions(value, budget),
      (value) => {
        preflightDeformation(value, budget);
      },
    );
    const info = format.validateBuffers(
      { ...json, buffers: [{ byteLength: binary.length }] },
      binary,
      limits,
    );
    format.validateAccessors(json, binary, info.views, limits);
    const encodedJson = new TextEncoder().encode(JSON.stringify(stable(json)));
    if (encodedJson.length > limits.maxJsonBytes)
      fail(
        "json-resource-limit",
        "Canonical export JSON exceeds its byte budget.",
      );
    const sourceBytes = document.resources.reduce(
      (n, r) => n + r.byteLength,
      0,
    );
    if (
      Math.max(sourceBytes, binary.length) * 7 +
        pack.elements * 16 +
        encodedJson.length * 32 +
        decoded +
        32 * 1024 * 1024 >
      limits.maxEstimatedWorkingSetBytes
    )
      fail(
        "document-resource-limit",
        "Canonical export exceeds its conservative working-set budget.",
      );
    let entry: Uint8Array;
    if (layout === "glb")
      entry = format.exportGlb(
        json,
        binary,
        binary.length,
        limits.maxJsonBytes,
      );
    else entry = encodedJson;
    if (entry.length > budget.limits.maxInputBytes)
      fail(
        "input-resource-limit",
        "Canonical export entry point exceeds its byte budget.",
      );
    if (layout === "gltf")
      outputFiles.unshift({
        path: "model.bin",
        bytes: binary,
        mime: "application/octet-stream",
      });
    const entryPoint = layout === "glb" ? "model.glb" : "model.gltf";
    outputFiles.unshift({
      path: entryPoint,
      bytes: entry,
      mime: layout === "glb" ? "model/gltf-binary" : "model/gltf+json",
    });
    if (
      outputFiles.reduce((n, f) => n + f.bytes.length, 0) >
        budget.limits.maxAggregateBytes ||
      outputFiles.length > budget.limits.maxResources ||
      outputFiles.some((f) => f.bytes.length > budget.limits.maxResourceBytes)
    )
      fail(
        "document-resource-limit",
        "Canonical export package exceeds its aggregate budget.",
      );
    // Validate the exact external package too, resolving exclusively from generated immutable bytes.
    const validator = await budget.wait(import("gltf-validator"));
    const files = new Map(outputFiles.map((f) => [f.path, f.bytes]));
    const report = await budget.wait(
      validator.validateBytes(entry, {
        uri: entryPoint,
        format: layout,
        maxIssues: DEFAULT_GLB_LIMITS.maxDiagnostics,
        writeTimestamp: false,
        externalResourceFunction: async (uri: string) => {
          budget.check();
          const bytes = files.get(uri);
          if (!bytes)
            throw new Error("Generated package resource is unavailable.");
          return Uint8Array.from(bytes);
        },
      }),
    );
    const validation = format.validateKhronosReport(
      report,
      limits,
      validator.version(),
    );
    const resources: GltfExportResource[] = [];
    for (const f of outputFiles)
      resources.push(
        Object.freeze({
          path: f.path,
          contentHash: await budget.wait(format.sha256(f.bytes)),
          byteLength: f.bytes.length,
          mimeType: f.mime,
          payload: new Blob([f.bytes as Uint8Array<ArrayBuffer>], {
            type: f.mime,
          }),
        }),
      );
    budget.check();
    return Object.freeze({
      profile: GLTF_CANONICAL_EXPORT_PROFILE,
      format: layout,
      entryPoint,
      resources: Object.freeze(resources),
      validator: validation.evidence,
      diagnostics: validation.diagnostics,
    });
  } catch (error) {
    budget.check();
    if (error instanceof GlbAdapterError) throw error;
    fail(
      "canonical-model-core-rejected",
      "The bounded canonical export failed.",
    );
  } finally {
    budget.dispose();
  }
}
