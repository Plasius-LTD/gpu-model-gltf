import type { GpuModelDocument } from "@plasius/gpu-model-core";
import type { ResourceResolver } from "@plasius/gpu-model-runtime";
import { gltfFormatInternals as format, GlbAdapterError } from "./glb-adapter.js";
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
/** Opt-in dense skin, morph and TRS animation preservation; no animation evaluation. */
export const GLTF_DEFORMATION_IMPORT_PROFILE = "gltf-deformation-resources-v1" as const;
/** The closed set of explicit resource import profiles. */
export type GltfResourceImportProfile = typeof GLTF_RESOURCE_IMPORT_PROFILE | typeof GLTF_DEFORMATION_IMPORT_PROFILE;
/** The caller must supply the remotely evaluated decision for this registered flag. */
export const GLTF_RESOURCE_IMPORT_FEATURE_FLAG =
  "gpu.model.conversion.enabled" as const;
/** Options for bounded JSON/GLB resource import through the runtime resolver. */
export interface ImportGltfToGpuModelDocumentOptions<Profile extends GltfResourceImportProfile = typeof GLTF_RESOURCE_IMPORT_PROFILE> {
  readonly conversionEnabled: boolean;
  /** Omission retains the existing static resource profile and its rejection rules. */
  readonly profile?: Profile;
  readonly resourceResolver?: ResourceResolver;
  readonly signal?: AbortSignal;
  readonly contentType?: string;
  readonly limits?: Partial<GltfResourceImportLimits>;
}
/** Source-normalized self-contained GLB. It does not serialize edits to the canonical document. */
export interface NormalizedGltfSourceArtifact {
  readonly contentHash: string;
  readonly byteLength: number;
  readonly payload: Blob;
}
/** Immutable canonical result with exact entry point identity and validator evidence. */
export interface ImportedGltfGpuModelDocument<Profile extends GltfResourceImportProfile = typeof GLTF_RESOURCE_IMPORT_PROFILE> {
  readonly profile: Profile;
  readonly sourceContentHash: string;
  readonly document: GpuModelDocument;
  readonly normalizedGlb: NormalizedGltfSourceArtifact;
  readonly validator: Readonly<{
    id: "KhronosGroup/glTF-Validator";
    version: string;
    issueCount: number;
  }>;
}
/** Import bounded glTF2 JSON or GLB and package-relative/data resources into the canonical core. */
export function importGltfToGpuModelDocument(
  input: Uint8Array | ArrayBuffer,
  options: ImportGltfToGpuModelDocumentOptions<typeof GLTF_DEFORMATION_IMPORT_PROFILE> & { readonly profile: typeof GLTF_DEFORMATION_IMPORT_PROFILE },
): Promise<ImportedGltfGpuModelDocument<typeof GLTF_DEFORMATION_IMPORT_PROFILE>>;
// eslint-disable-next-line no-redeclare -- TypeScript overload, not a second implementation.
export function importGltfToGpuModelDocument(
  input: Uint8Array | ArrayBuffer,
  options: ImportGltfToGpuModelDocumentOptions & { readonly profile?: typeof GLTF_RESOURCE_IMPORT_PROFILE },
): Promise<ImportedGltfGpuModelDocument>;
// eslint-disable-next-line no-redeclare -- TypeScript overload, not a second implementation.
export function importGltfToGpuModelDocument(
  input: Uint8Array | ArrayBuffer,
  options: ImportGltfToGpuModelDocumentOptions<GltfResourceImportProfile>,
): Promise<ImportedGltfGpuModelDocument<GltfResourceImportProfile>>;
// eslint-disable-next-line no-redeclare -- The single implementation of the preceding TypeScript signatures.
export async function importGltfToGpuModelDocument(
  input: Uint8Array | ArrayBuffer,
  options: ImportGltfToGpuModelDocumentOptions<GltfResourceImportProfile>,
): Promise<ImportedGltfGpuModelDocument<GltfResourceImportProfile>> {
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
  const profile = options.profile === undefined ? GLTF_RESOURCE_IMPORT_PROFILE : options.profile;
  if (profile !== GLTF_RESOURCE_IMPORT_PROFILE && profile !== GLTF_DEFORMATION_IMPORT_PROFILE)
    fail("invalid-adapter-options", "The resource import profile is unsupported.");
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
      profile === GLTF_DEFORMATION_IMPORT_PROFILE,
    );
    const document = await canonicalize(
      source,
      budget,
      profile,
    );
    const normalizedContentHash = await budget.wait(format.sha256(source.normalizedBytes));
    budget.check();
    return Object.freeze({
      profile,
      sourceContentHash: source.sourceContentHash,
      document,
      normalizedGlb: Object.freeze({
        contentHash: normalizedContentHash,
        byteLength: source.normalizedBytes.byteLength,
        payload: new Blob([source.normalizedBytes as Uint8Array<ArrayBuffer>], { type: "model/gltf-binary" }),
      }),
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
