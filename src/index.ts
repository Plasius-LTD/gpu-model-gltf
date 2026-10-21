/** Package identity and rollout metadata for the initial repository baseline. */
export const packageName = "@plasius/gpu-model-gltf" as const;

/** @deprecated Retained for compatibility with the repository bootstrap release. */
export const packageBootstrap = Object.freeze({
  packageName,
  featureFlag: "gpu.model.conversion.enabled",
  status: "bootstrap",
} as const);

export {
  DEFAULT_GLB_LIMITS,
  GLB_ADAPTER_VERSION,
  GLB_FIXED_WORKING_SET_BYTES,
  GLB_JSON_WORKING_SET_MULTIPLIER,
  GLB_WORKING_SET_MULTIPLIER,
  GlbAdapterError,
  glbAdapter,
  sniffGlb,
  validateAndExportGlb,
} from "./glb-adapter.js";

export type {
  GlbAdapterErrorCode,
  GlbResourceEvidence,
  GlbResourceLimits,
  GlbValidatorEvidence,
  ValidateGlbOptions,
  ValidatedGlbArtifact,
} from "./glb-adapter.js";

export {
  GLB_STATIC_DEMO_CONVERTER_FEATURE_FLAG,
  GLB_STATIC_DEMO_FEATURE_FLAG,
  GLB_STATIC_DEMO_IMPORTER_VERSION,
  GLB_STATIC_DEMO_MAX_ABSOLUTE_COORDINATE_METRES,
  GLB_STATIC_DEMO_PROFILE,
  importGlbToGpuModelDocument,
} from "./static-demo-import.js";

export type {
  ImportedGlbGpuModelDocument,
  ImportGlbToGpuModelDocumentOptions,
} from "./static-demo-import.js";

export { glbAdapter as default } from "./glb-adapter.js";

export { GLTF_RESOURCE_IMPORT_PROFILE, GLTF_RESOURCE_IMPORT_FEATURE_FLAG, importGltfToGpuModelDocument } from "./resource-import.js";
export type { NormalizedGltfSourceArtifact, ImportedGltfGpuModelDocument, ImportGltfToGpuModelDocumentOptions } from "./resource-import.js";
export { DEFAULT_GLTF_RESOURCE_IMPORT_LIMITS } from "./resource-resolution.js";
export type { GltfResourceImportLimits } from "./resource-resolution.js";
