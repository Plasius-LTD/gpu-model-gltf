import type {
  GpuModelMaterial,
  GpuModelTextureBinding,
  GpuModelTextureUsage,
} from "@plasius/gpu-model-core";
import {
  materialExtensionRules as RULES,
  colorSpace,
} from "./resource-materials.js";
import { fail, record, type JsonRecord } from "./resource-values.js";

/** @internal Invert the admitted material grammar; canonical fields own edits. */
export function exportMaterials(
  materials: readonly GpuModelMaterial[],
  textures: readonly import("@plasius/gpu-model-core").GpuModelTexture[],
): JsonRecord[] {
  const byId = new Map(textures.map((t, i) => [t.id, i]));
  return materials.map((m) => {
    if (!["metallic-roughness", "unlit"].includes(m.workflow))
      fail(
        "unsupported-gltf-feature",
        "The canonical material workflow cannot be exported losslessly.",
      );
    const bind = (
      binding: GpuModelTextureBinding | undefined,
      usage: GpuModelTextureUsage,
    ): JsonRecord | undefined => {
      if (!binding) return undefined;
      const index = byId.get(binding.textureId);
      const texture = index === undefined ? undefined : textures[index];
      if (
        !texture ||
        binding.intendedUsage !== usage ||
        binding.colorSpace !== colorSpace(usage) ||
        texture.colorSpace !== binding.colorSpace ||
        (binding.samplerId !== undefined &&
          binding.samplerId !== texture.sampler?.id)
      )
        fail(
          "unsupported-gltf-feature",
          "A canonical texture interpretation cannot be exported losslessly.",
        );
      return {
        index,
        texCoord: binding.texCoordSet ?? 0,
        ...(binding.transform
          ? {
              extensions: {
                KHR_texture_transform: {
                  ...(binding.transform.offset
                    ? { offset: [...binding.transform.offset] }
                    : {}),
                  ...(binding.transform.scale
                    ? { scale: [...binding.transform.scale] }
                    : {}),
                  ...(binding.transform.rotationRadians === undefined
                    ? {}
                    : { rotation: binding.transform.rotationRadians }),
                },
              },
            }
          : {}),
      };
    };
    const ext: JsonRecord = {};
    for (const [key, value] of Object.entries(m.extensions)) {
      if (!Object.hasOwn(RULES, key))
        fail(
          "unsupported-gltf-feature",
          "A canonical material extension is unsupported.",
        );
      const factors = record(value),
        rule = RULES[key]!;
      if (
        Object.keys(factors).some(
          (k) =>
            ![
              ...rule.factors.map(([k]) => k),
              "sourceExtras",
              ...(key === "KHR_materials_volume"
                ? ["attenuationDistance"]
                : []),
              ...(key === "KHR_materials_clearcoat"
                ? ["clearcoatNormalScale"]
                : []),
            ].includes(k),
        )
      )
        fail(
          "unsupported-gltf-feature",
          "A canonical extension field is unsupported.",
        );
      ext[key] = Object.fromEntries(
        Object.entries(factors).filter(
          ([k]) => k !== "sourceExtras" && k !== "clearcoatNormalScale",
        ),
      );
    }
    const shared = [
      [
        "KHR_materials_transmission",
        "transmissionFactor",
        m.transmissionFactor,
      ],
      ["KHR_materials_clearcoat", "clearcoatFactor", m.clearcoatFactor],
      [
        "KHR_materials_clearcoat",
        "clearcoatRoughnessFactor",
        m.clearcoatRoughnessFactor,
      ],
      ["KHR_materials_sheen", "sheenColorFactor", m.sheenColorFactor],
      ["KHR_materials_sheen", "sheenRoughnessFactor", m.sheenRoughnessFactor],
    ] as const;
    for (const [name, key, value] of shared)
      if (
        value !== undefined &&
        (ext[name] !== undefined ||
          (Array.isArray(value) ? value.some((n) => n !== 0) : value !== 0))
      ) {
        ext[name] ??= {};
        record(ext[name])[key] = value;
      }
    for (const [name, rule] of Object.entries(RULES))
      for (const [slot, key, usage] of rule.textures ?? []) {
        const value = bind(m.textures[slot], usage);
        if (!value) continue;
        if (slot === "clearcoatNormal")
          value.scale =
            record(m.extensions.KHR_materials_clearcoat ?? {})
              .clearcoatNormalScale ?? 1;
        ext[name] ??= {};
        record(ext[name])[key] = value;
      }
    if (m.workflow === "unlit") ext.KHR_materials_unlit = {};
    else if (ext.KHR_materials_unlit !== undefined)
      fail(
        "unsupported-gltf-feature",
        "Canonical workflow and extension interpretation conflict.",
      );
    const normal = bind(m.textures.normal, "normal"),
      occlusion = bind(m.textures.occlusion, "occlusion");
    const base = bind(m.textures.baseColor, "base-color"),
      metal = bind(m.textures.metallicRoughness, "metallic-roughness"),
      emissive = bind(m.textures.emissive, "emissive");
    return {
      ...(m.name === undefined ? {} : { name: m.name }),
      alphaMode: m.alphaMode.toUpperCase(),
      ...(m.alphaCutoff === undefined ? {} : { alphaCutoff: m.alphaCutoff }),
      doubleSided: m.doubleSided ?? false,
      pbrMetallicRoughness: {
        baseColorFactor: [...m.baseColorFactor],
        metallicFactor: m.metallicFactor ?? 1,
        roughnessFactor: m.roughnessFactor ?? 1,
        ...(base ? { baseColorTexture: base } : {}),
        ...(metal ? { metallicRoughnessTexture: metal } : {}),
      },
      emissiveFactor: [...(m.emissiveFactor ?? [0, 0, 0])],
      ...(normal
        ? { normalTexture: { ...normal, scale: m.normalScale ?? 1 } }
        : {}),
      ...(occlusion
        ? {
            occlusionTexture: {
              ...occlusion,
              strength: m.occlusionStrength ?? 1,
            },
          }
        : {}),
      ...(emissive ? { emissiveTexture: emissive } : {}),
      ...(Object.keys(ext).length ? { extensions: ext } : {}),
    };
  });
}
