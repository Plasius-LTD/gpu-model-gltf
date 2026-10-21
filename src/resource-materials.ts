import type {
  GpuModelMaterial, GpuModelMaterialTextures, GpuModelTextureBinding,
  GpuModelTextureColorSpace, GpuModelTextureUsage, GpuModelVec3,
} from "@plasius/gpu-model-core";
import { array, record, integer, fail, type JsonRecord } from "./resource-values.js";
import type { ImportBudget } from "./resource-resolution.js";

type Slot = keyof GpuModelMaterialTextures;
type Factor = readonly [name: string, fallback: number | readonly number[], min: number, max?: number];
type Texture = readonly [slot: Slot, name: string, usage: GpuModelTextureUsage];
interface ExtensionRule { readonly factors: readonly Factor[]; readonly textures?: readonly Texture[] }
/** Closed, adapter-owned grammar. Defaults are glTF defaults, not renderer defaults. */
const RULES: Readonly<Record<string, ExtensionRule>> = {
  KHR_materials_clearcoat: {
    factors: [["clearcoatFactor", 0, 0, 1], ["clearcoatRoughnessFactor", 0, 0, 1]],
    textures: [["clearcoat", "clearcoatTexture", "clearcoat"], ["clearcoatRoughness", "clearcoatRoughnessTexture", "clearcoat-roughness"], ["clearcoatNormal", "clearcoatNormalTexture", "clearcoat-normal"]],
  },
  KHR_materials_transmission: { factors: [["transmissionFactor", 0, 0, 1]], textures: [["transmission", "transmissionTexture", "transmission"]] },
  KHR_materials_sheen: { factors: [["sheenColorFactor", [0, 0, 0], 0, 1], ["sheenRoughnessFactor", 0, 0, 1]], textures: [["sheenColor", "sheenColorTexture", "sheen-color"], ["sheenRoughness", "sheenRoughnessTexture", "sheen-roughness"]] },
  KHR_materials_ior: { factors: [["ior", 1.5, 0]] },
  KHR_materials_specular: { factors: [["specularFactor", 1, 0, 1], ["specularColorFactor", [1, 1, 1], 0]], textures: [["specular", "specularTexture", "specular"], ["specularColor", "specularColorTexture", "specular-color"]] },
  KHR_materials_volume: { factors: [["thicknessFactor", 0, 0], ["attenuationColor", [1, 1, 1], 0, 1]], textures: [["thickness", "thicknessTexture", "thickness"]] },
  KHR_materials_iridescence: { factors: [["iridescenceFactor", 0, 0, 1], ["iridescenceIor", 1.3, 1], ["iridescenceThicknessMinimum", 100, 0], ["iridescenceThicknessMaximum", 400, 0]], textures: [["iridescence", "iridescenceTexture", "iridescence"], ["iridescenceThickness", "iridescenceThicknessTexture", "iridescence-thickness"]] },
  KHR_materials_anisotropy: { factors: [["anisotropyStrength", 0, 0, 1], ["anisotropyRotation", 0, -Infinity]], textures: [["anisotropy", "anisotropyTexture", "anisotropy"]] },
  KHR_materials_dispersion: { factors: [["dispersion", 0, 0]] },
  KHR_materials_unlit: { factors: [] },
};
const TRANSFORM = "KHR_texture_transform";
/** @internal The exact transfer function for each admitted slot. */
export function colorSpace(usage: GpuModelTextureUsage): GpuModelTextureColorSpace {
  return ["base-color", "emissive", "sheen-color", "specular-color"].includes(usage) ? "srgb"
    : ["normal", "clearcoat-normal"].includes(usage) ? "normal-map" : "linear";
}
function defaulted<T>(value: unknown, fallback: T): unknown { return value === undefined ? fallback : value; }
function number(value: unknown, min = -Infinity, max = Infinity): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    fail("invalid-gltf-document", "A material or texture factor is outside its admitted range.");
  return value;
}
function vector(value: unknown, length: number, min = -Infinity, max = Infinity): number[] {
  const values = array(value);
  if (values.length !== length) fail("invalid-gltf-document", "A material or texture vector has the wrong length.");
  return values.map(v => number(v, min, max));
}
function keys(value: JsonRecord, allowed: readonly string[]) {
  if (Object.keys(value).some(k => !allowed.includes(k) && k !== "extras" && k !== "extensions"))
    fail("unsupported-gltf-feature", "An extension property is outside the admitted material grammar.");
}
/** @internal Validate even extensions the pinned validator does not yet recognize. */
export function textureInfo(value: unknown, document: JsonRecord, normal = false, occlusion = false) {
  const info = record(value);
  keys(info, ["index", "texCoord", ...(normal ? ["scale"] : []), ...(occlusion ? ["strength"] : [])]);
  const index = integer(info.index, 0, array(document.textures).length - 1);
  const uv = integer(defaulted(info.texCoord, 0), 0, 7);
  if (normal && info.scale !== undefined) number(info.scale);
  if (occlusion && info.strength !== undefined) number(info.strength, 0, 1);
  const ext = info.extensions === undefined ? {} : record(info.extensions);
  if (Object.keys(ext).some(k => k !== TRANSFORM)) fail("unsupported-gltf-feature", "A texture extension is unsupported.");
  if (ext[TRANSFORM] === undefined) return { index, texCoordSet: uv };
  const t = record(ext[TRANSFORM]);
  keys(t, ["offset", "scale", "rotation", "texCoord"]);
  return {
    index,
    texCoordSet: integer(defaulted(t.texCoord, uv), 0, 7),
    transform: {
      offset: vector(defaulted(t.offset, [0, 0]), 2) as [number, number],
      scale: vector(defaulted(t.scale, [1, 1]), 2) as [number, number],
      rotationRadians: number(defaulted(t.rotation, 0)),
    },
  };
}
type Bind = (value: unknown, usage: GpuModelTextureUsage) => GpuModelTextureBinding | undefined;
/** @internal Read only admitted extension factors; core slots own all texture references. */
export function materialExtensions(material: JsonRecord, bind: Bind) {
  const input = material.extensions === undefined ? {} : record(material.extensions);
  const extensions: JsonRecord = {};
  const textures: Partial<Record<Slot, GpuModelTextureBinding>> = {};
  for (const [name, value] of Object.entries(input)) {
    const rule = Object.hasOwn(RULES, name) ? RULES[name]! : undefined;
    if (!rule) fail("unsupported-gltf-feature", "A material extension is unsupported.");
    const ext = record(value);
    keys(ext, [...rule.factors.map(([k]) => k), ...(rule.textures ?? []).map(([, k]) => k), ...(name === "KHR_materials_volume" ? ["attenuationDistance"] : [])]);
    const factors: JsonRecord = {};
    for (const [key, fallback, min, max] of rule.factors) {
      const raw = ext[key] ?? fallback;
      // Explicit null never selects the default.
      if (ext[key] === null) fail("invalid-gltf-document", "A material extension factor is invalid.");
      factors[key] = typeof fallback === "number" ? number(raw, min, max) : vector(raw, fallback.length, min, max);
    }
    if (name === "KHR_materials_ior" && factors.ior !== 0 && (factors.ior as number) < 1)
      fail("invalid-gltf-document", "Material IOR must be zero or at least one.");
    if (name === "KHR_materials_volume" && ext.attenuationDistance !== undefined) {
      const distance = number(ext.attenuationDistance, 0);
      if (distance === 0) fail("invalid-gltf-document", "Volume attenuation distance must be positive.");
      factors.attenuationDistance = distance;
    }
    if (name === "KHR_materials_iridescence" && (factors.iridescenceThicknessMinimum as number) > (factors.iridescenceThicknessMaximum as number))
      fail("invalid-gltf-document", "Iridescence thickness bounds are inverted.");
    for (const [slot, key, usage] of rule.textures ?? []) {
      const binding = bind(ext[key], usage);
      if (binding) textures[slot] = binding;
      if (slot === "clearcoatNormal" && ext[key] !== undefined)
        factors.clearcoatNormalScale = number(record(ext[key]).scale ?? 1);
    }
    if (ext.extras !== undefined) factors.sourceExtras = ext.extras;
    extensions[name] = factors;
  }
  const unlit = input.KHR_materials_unlit !== undefined;
  if (unlit && Object.keys(input).some(k => k !== "KHR_materials_unlit"))
    fail("unsupported-gltf-feature", "Unlit material extension combinations are outside the admitted profile.");
  // glTF's default is 1.5 even without the extension; the renderer's default is different.
  if (!unlit && extensions.KHR_materials_ior === undefined) extensions.KHR_materials_ior = { ior: 1.5 };
  const e = (key: string) => (extensions[key] ?? {}) as JsonRecord;
  return {
    workflow: unlit ? "unlit" as const : "metallic-roughness" as const,
    extensions: extensions as GpuModelMaterial["extensions"], textures,
    clearcoatFactor: (e("KHR_materials_clearcoat").clearcoatFactor ?? 0) as number,
    clearcoatRoughnessFactor: (e("KHR_materials_clearcoat").clearcoatRoughnessFactor ?? 0) as number,
    transmissionFactor: (e("KHR_materials_transmission").transmissionFactor ?? 0) as number,
    sheenColorFactor: (e("KHR_materials_sheen").sheenColorFactor ?? [0, 0, 0]) as GpuModelVec3,
    sheenRoughnessFactor: (e("KHR_materials_sheen").sheenRoughnessFactor ?? 0) as number,
  };
}
/** @internal Validate grammar, declarations and every extension location before I/O. */
export function admitMaterialExtensions(document: JsonRecord, budget: ImportBudget): void {
  const used = array(document.extensionsUsed);
  const required = array(document.extensionsRequired);
  for (const names of [used, required]) {
    if (new Set(names).size !== names.length || names.some(n => typeof n !== "string"))
      fail("invalid-gltf-document", "Extension declarations must be unique strings.");
    if (names.some(n => n !== TRANSFORM && !Object.hasOwn(RULES, n as string)))
      fail("unsupported-gltf-feature", "A declared glTF extension is unsupported.");
  }
  if (required.some(n => !used.includes(n))) fail("invalid-gltf-document", "Required extensions must also be declared used.");
  const locations = new WeakMap<object, readonly string[]>();
  const markTexture = (value: unknown, normal = false, occlusion = false) => {
    if (value === undefined) return;
    const info = record(value);
    textureInfo(info, document, normal, occlusion);
    locations.set(info, [TRANSFORM]);
  };
  for (const v of array(document.materials)) {
    budget.check();
    const m = record(v);
    locations.set(m, Object.keys(RULES));
    const pbr = m.pbrMetallicRoughness === undefined ? {} : record(m.pbrMetallicRoughness);
    markTexture(pbr.baseColorTexture); markTexture(pbr.metallicRoughnessTexture);
    markTexture(m.normalTexture, true); markTexture(m.occlusionTexture, false, true); markTexture(m.emissiveTexture);
    materialExtensions(m, (value, usage) => {
      markTexture(value, usage === "clearcoat-normal"); return undefined;
    });
  }
  // JSON graph complexity/depth has already been bounded by the shared format boundary.
  const stack: unknown[] = [document];
  while (stack.length) {
    budget.check();
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) { for (const child of value) stack.push(child); continue; }
    const obj = value as JsonRecord;
    if (obj.extensions !== undefined) {
      const ext = record(obj.extensions);
      for (const [name, payload] of Object.entries(ext)) {
        record(payload);
        if (!locations.get(obj)?.includes(name)) fail("unsupported-gltf-feature", "An extension is unsupported at this glTF location.");
        if (!used.includes(name)) fail("invalid-gltf-document", "An extension payload is not declared used.");
      }
    }
    // extras is opaque authored metadata, not glTF extension grammar.
    for (const [key, child] of Object.entries(obj)) if (key !== "extras") stack.push(child);
  }
}
