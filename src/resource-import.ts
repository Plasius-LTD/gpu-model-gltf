import type { GpuModelDocument } from "@plasius/gpu-model-core";
import type { ResourceResolver } from "@plasius/gpu-model-runtime";
import { GlbAdapterError } from "./glb-adapter.js";
import { canonicalize } from "./resource-canonical.js";
import {
  ImportBudget,
  isByteArray,
  limitsFor,
  resolveImport,
  fail,
  type GltfResourceImportLimits,
} from "./resource-resolution.js";

/** Named additive import profile; existing strict/static demo APIs retain their contracts. */
export const GLTF_RESOURCE_IMPORT_PROFILE = "gltf-static-resources-v1" as const;
/** The caller must supply the remotely evaluated decision for this registered flag. */
export const GLTF_RESOURCE_IMPORT_FEATURE_FLAG =
  "gpu.model.conversion.enabled" as const;
/** Options for bounded JSON/GLB resource import through the runtime resolver. */
export interface ImportGltfToGpuModelDocumentOptions {
  readonly conversionEnabled: boolean;
  readonly resourceResolver?: ResourceResolver;
  readonly signal?: AbortSignal;
  readonly contentType?: string;
  readonly limits?: Partial<GltfResourceImportLimits>;
}
/** Immutable canonical result with exact entry point identity and validator evidence. */
export interface ImportedGltfGpuModelDocument {
  readonly profile: typeof GLTF_RESOURCE_IMPORT_PROFILE;
  readonly sourceContentHash: string;
  readonly document: GpuModelDocument;
  readonly validator: Readonly<{
    id: "KhronosGroup/glTF-Validator";
    version: string;
    issueCount: number;
  }>;
}
/** Import bounded glTF2 JSON or GLB and package-relative/data resources into the canonical core. */
export async function importGltfToGpuModelDocument(
  input: Uint8Array | ArrayBuffer,
  options: ImportGltfToGpuModelDocumentOptions,
): Promise<ImportedGltfGpuModelDocument> {
  if (
    !options ||
    typeof options !== "object" ||
    typeof options.conversionEnabled !== "boolean"
  )
    fail(
      "invalid-adapter-options",
      "A remotely evaluated conversion decision is required.",
    );
  if (!options.conversionEnabled)
    fail("feature-disabled", "GPU model conversion is disabled.");
  const limits = limitsFor(options.limits);
  const budget = new ImportBudget(limits, options.signal);
  try {
    budget.check();
    if (!(input instanceof ArrayBuffer) && !isByteArray(input))
      fail("invalid-gltf-document", "The entry point must contain byte data.");
    if (input.byteLength > limits.maxInputBytes)
      fail(
        "input-resource-limit",
        "The glTF entry point exceeds its byte limit.",
      );
    const bytes =
      input instanceof ArrayBuffer
        ? new Uint8Array(input.slice(0))
        : Uint8Array.from(input);
    const source = await resolveImport(
      bytes,
      options.resourceResolver,
      budget,
      options.contentType,
    );
    const document = await canonicalize(
      source,
      budget,
      GLTF_RESOURCE_IMPORT_PROFILE,
    );
    budget.check();
    return Object.freeze({
      profile: GLTF_RESOURCE_IMPORT_PROFILE,
      sourceContentHash: source.sourceContentHash,
      document,
      validator: source.validator.evidence,
    });
  } catch (error) {
    budget.check();
    if (error instanceof GlbAdapterError) throw error;
    fail("invalid-gltf-document", "The bounded glTF resource import failed.");
  } finally {
    budget.dispose();
  }
}
