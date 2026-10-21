import { describe, it, expect } from "vitest";
import { importGltfToGpuModelDocument, validateAndExportGlb } from "../src/index.js";
import { fixture, options, encoder, glb, code } from "./material-fixture.js";

import { extended } from "./material-fixture.js";
const load = (f = extended()) => importGltfToGpuModelDocument(encoder.encode(JSON.stringify(f.json)), options(f));

describe("material and texture preservation", () => {
  it("maps every common extension factor and texture slot with shared image identity and correct interpretations", async () => {
    const { document: d } = await load();
    const m = d.materials[0]!;
    expect(m.clearcoatFactor).toBe(0.8);
    expect(m.clearcoatRoughnessFactor).toBe(0.2);
    expect(m.transmissionFactor).toBe(0.7);
    expect(m.sheenColorFactor).toEqual([0.1, 0.2, 0.3]);
    expect(m.sheenRoughnessFactor).toBe(0.6);
    expect(m.extensions.KHR_materials_volume).toEqual({ thicknessFactor: 2, attenuationDistance: 5, attenuationColor: [0.9, 0.8, 0.7] });
    expect(m.extensions.KHR_materials_clearcoat).toEqual({ clearcoatFactor: 0.8, clearcoatRoughnessFactor: 0.2, clearcoatNormalScale: 0.4 });
    expect(m.extensions.KHR_materials_ior).toEqual({ ior: 1.7 });
    expect(m.extensions.KHR_materials_dispersion).toEqual({ dispersion: 0.3 });
    const expected = { baseColor: ["base-color", "srgb"], clearcoat: ["clearcoat", "linear"], clearcoatRoughness: ["clearcoat-roughness", "linear"], clearcoatNormal: ["clearcoat-normal", "normal-map"], transmission: ["transmission", "linear"], sheenColor: ["sheen-color", "srgb"], sheenRoughness: ["sheen-roughness", "linear"], thickness: ["thickness", "linear"], specular: ["specular", "linear"], specularColor: ["specular-color", "srgb"], iridescence: ["iridescence", "linear"], iridescenceThickness: ["iridescence-thickness", "linear"], anisotropy: ["anisotropy", "linear"] };
    for (const [slot, [usage, space]] of Object.entries(expected)) {
      const b = m.textures[slot as keyof typeof m.textures]!;
      expect(b.intendedUsage).toBe(usage); expect(b.colorSpace).toBe(space);
      const t = d.textures.find(t => t.id === b.textureId)!;
      expect(t.imageResourceId).toBe("image-0"); expect(t.colorSpace).toBe(space); expect(t.intendedUsage).toContain(usage);
    }
    expect(d.textures).toHaveLength(3);
    expect(d.resources.filter(r => r.kind === "image")).toHaveLength(1);
  });
  it("materializes normative defaults instead of renderer-specific defaults", async () => {
    const f = extended(); for (const k of f.json.extensionsUsed) f.json.materials[0].extensions[k] = {};
    const m = (await load(f)).document.materials[0]!;
    expect(m.extensions.KHR_materials_ior).toEqual({ ior: 1.5 });
    expect(m.extensions.KHR_materials_volume).toEqual({ thicknessFactor: 0, attenuationColor: [1,1,1] });
    expect(m.extensions.KHR_materials_iridescence).toEqual({ iridescenceFactor: 0, iridescenceIor: 1.3, iridescenceThicknessMinimum: 100, iridescenceThicknessMaximum: 400 });
    expect(m.extensions.KHR_materials_specular).toEqual({ specularFactor: 1, specularColorFactor: [1,1,1] });
    expect(m.extensions.KHR_materials_anisotropy).toEqual({ anisotropyStrength: 0, anisotropyRotation: 0 });
    expect(m.clearcoatRoughnessFactor).toBe(0);
    const basic = (await load(fixture())).document.materials[0]!;
    expect(basic.extensions.KHR_materials_ior).toEqual({ ior: 1.5 });
  });
  it("retains selected UV override and exact affine transform instead of baking or dropping it", async () => {
    const f = fixture();
    f.json.extensionsUsed = ["KHR_texture_transform"];
    f.json.meshes[0].primitives[0].attributes.TEXCOORD_1 = 1;
    f.json.materials[0].pbrMetallicRoughness.baseColorTexture = { index: 0, texCoord: 0, extensions: { KHR_texture_transform: { texCoord: 1, offset: [-0.2,0.3], scale: [-2,3], rotation: 0.4 } } };
    const b = (await load(f)).document.materials[0]!.textures.baseColor!;
    expect(b.texCoordSet).toBe(1); expect(b.transform).toEqual({ offset: [-0.2,0.3], scale: [-2,3], rotationRadians: 0.4 });
  });
  it("preserves unlit workflow and glTF alpha-mask default", async () => {
    const f = fixture(); f.json.extensionsUsed = ["KHR_materials_unlit"];
    f.json.materials[0].extensions = { KHR_materials_unlit: {} }; f.json.materials[0].alphaMode = "MASK";
    const m = (await load(f)).document.materials[0]!;
    expect(m.workflow).toBe("unlit"); expect(m.alphaCutoff).toBe(0.5);
  });
  it("keeps strict GLB admission extension-free", async () => {
    const f = extended(); delete f.json.buffers[0].uri; delete f.json.images; delete f.json.textures;
    await expect(validateAndExportGlb(glb(f.json, f.bytes))).rejects.toSatisfy(code("unsupported-gltf-feature"));
  });
  it.each([
    ["factor range", (f: ReturnType<typeof extended>) => f.json.materials[0].extensions.KHR_materials_clearcoat.clearcoatFactor = 2],
    ["negative thickness", (f: ReturnType<typeof extended>) => f.json.materials[0].extensions.KHR_materials_volume.thicknessFactor = -1],
    ["zero distance", (f: ReturnType<typeof extended>) => f.json.materials[0].extensions.KHR_materials_volume.attenuationDistance = 0],
    ["wrong vector", (f: ReturnType<typeof extended>) => f.json.materials[0].extensions.KHR_materials_specular.specularColorFactor = [1,2]],
    ["wrong texture", (f: ReturnType<typeof extended>) => f.json.materials[0].extensions.KHR_materials_specular.specularTexture.index = 99],
    ["bad IOR", (f: ReturnType<typeof extended>) => f.json.materials[0].extensions.KHR_materials_ior.ior = 0.5],
    ["inverted thickness", (f: ReturnType<typeof extended>) => f.json.materials[0].extensions.KHR_materials_iridescence.iridescenceThicknessMinimum = 500],
  ])("rejects malformed %s before acquisition", async (_name, mutate) => {
    const f = extended(); mutate(f); const o = options(f);
    await expect(importGltfToGpuModelDocument(encoder.encode(JSON.stringify(f.json)), o)).rejects.toSatisfy(code("invalid-gltf-document"));
    expect(o.resourceResolver.resolve).not.toHaveBeenCalled();
  });
});
