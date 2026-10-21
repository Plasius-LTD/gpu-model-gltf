import { describe, expect, it } from "vitest";
import { ModelRuntime } from "@plasius/gpu-model-runtime";
import type { GpuModelDocument } from "@plasius/gpu-model-core";
import { prepareGpuModelRendererInput } from "@plasius/gpu-model-renderer";
import { createCanonicalWavefrontMeshInputs, normalizeWavefrontMesh, normalizeWavefrontMaterialExtensions } from "@plasius/gpu-renderer";
import { exportGpuModelToGltf, importGltfToGpuModelDocument } from "../src/index.js";
import { encoder, glb, resolver } from "./material-fixture.js";

// glTF2 §3.9.6: no material reference is equivalent to a material with no properties.
// Keep this independent of the production material mapper and renderer defaults.
function triangle(materials?: Record<string, unknown>[], references: (number | undefined)[] = [undefined]) {
  const bytes = new Uint8Array(36);
  const view = new DataView(bytes.buffer);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((n, i) => view.setFloat32(i * 4, n, true));
  const json = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: 36, uri: "mesh.bin" }],
    bufferViews: [{ buffer: 0, byteLength: 36, target: 34962 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }],
    ...(materials ? { materials } : {}),
    meshes: references.map(material => ({ primitives: [{ attributes: { POSITION: 0 }, ...(material === undefined ? {} : { material }) }] })),
    nodes: references.map((_, mesh) => ({ mesh })),
    scenes: [{ nodes: references.map((_, i) => i) }], scene: 0,
  };
  return { bytes, json };
}
function source(f: ReturnType<typeof triangle>, format: "json" | "glb") {
  if (format === "json") return encoder.encode(JSON.stringify(f.json));
  const json = structuredClone(f.json);
  Reflect.deleteProperty(json.buffers[0]!, "uri");
  return glb(json, f.bytes);
}
const load = (f: ReturnType<typeof triangle>, format: "json" | "glb") =>
  importGltfToGpuModelDocument(source(f, format), { conversionEnabled: true, resourceResolver: resolver({ "mesh.bin": f.bytes }) });
const ids = (d: GpuModelDocument) => d.meshes.flatMap(m => m.primitives.map(p => p.materialId));
const authored = [{ name: "authored", pbrMetallicRoughness: { baseColorFactor: [0.2, 0.3, 0.4, 1], metallicFactor: 0.25, roughnessFactor: 0.5 } }, {}];

async function projected(f: ReturnType<typeof triangle>, format: "json" | "glb") {
  const runtime = new ModelRuntime();
  runtime.adapters.register({ formatId: "fixture", load: async () => ({
    formatId: "fixture", sniff: () => true,
    load: async (input, context) => ({ canonicalModel: (await importGltfToGpuModelDocument(input.bytes, { conversionEnabled: true, signal: context.signal, resourceResolver: input.resourceResolver })).document }),
  }) });
  const result = await runtime.loadModel<GpuModelDocument>({kind:"uint8-array", bytes:source(f, format), package:{resources:{"mesh.bin":{bytes:f.bytes}}}}, {formatId:"fixture",useCache:false});
  const prepared = await prepareGpuModelRendererInput(result.canonicalModel, {conversionEnabled:true});
  const input = createCanonicalWavefrontMeshInputs({document:prepared.document,geometry:prepared.geometry,textures:new Map()})[0]!;
  return { input, normalized: normalizeWavefrontMesh(input), extensions: normalizeWavefrontMaterialExtensions({...input}) };
}

describe.each(["json", "glb"] as const)("implicit default material from %s", format => {
  it("materializes the exact explicit-empty defaults without mutating input bytes", async () => {
    const f = triangle(); const input = source(f, format); const before = input.slice();
    const implicit = await importGltfToGpuModelDocument(input, {conversionEnabled:true,resourceResolver:resolver({"mesh.bin":f.bytes})});
    const explicit = await load(triangle([{}], [0]), format);
    expect(implicit.document.materials).toHaveLength(1);
    expect(implicit.document.materials).toEqual(explicit.document.materials);
    expect(ids(implicit.document)).toEqual(["material-0"]);
    expect(implicit.document.materials[0]).toMatchObject({workflow:"metallic-roughness",baseColorFactor:[1,1,1,1],metallicFactor:1,roughnessFactor:1,emissiveFactor:[0,0,0],alphaMode:"opaque",doubleSided:false,extensions:{KHR_materials_ior:{ior:1.5}},textures:{}});
    expect(input).toEqual(before);
    expect((await load(f,format)).normalizedGlb.contentHash).toBe(implicit.normalizedGlb.contentHash);
  });
  it("shares one deterministic default across omitted primitives and meshes", async () => {
    const result = await load(triangle(undefined,[undefined,undefined,undefined]),format);
    expect(result.document.materials).toHaveLength(1);
    expect(ids(result.document)).toEqual(["material-0","material-0","material-0"]);
  });
  it("preserves all authored mappings and appends one default only for omissions", async () => {
    const explicit = await load(triangle(authored,[0,1]),format);
    const f = triangle(authored,[0,undefined,1,undefined]);
    const before = structuredClone(f.json);
    const mixed = await load(f,format);
    expect(mixed.document.materials).toHaveLength(3);
    expect(mixed.document.materials.slice(0,2)).toEqual(explicit.document.materials);
    expect(ids(mixed.document)).toEqual(["material-0","material-2","material-1","material-2"]);
    const {id: _id, ...fallback} = mixed.document.materials[2]!;
    const {id: _control, ...empty} = explicit.document.materials[1]!;
    expect(fallback).toEqual(empty);
    expect(f.json).toEqual(before);
  });
  it("matches actual published runtime/core/bridge/renderer defaults", async () => {
    const implicit = await projected(triangle(),format);
    const explicit = await projected(triangle([{}],[0]),format);
    expect(implicit.input).toEqual(explicit.input);
    expect(implicit.normalized).toEqual(explicit.normalized);
    expect(implicit.normalized).toMatchObject({color:[1,1,1,1],roughness:1,metallic:1,ior:1.5});
    expect(implicit.input).toMatchObject({baseColor:[1,1,1,1],emission:[0,0,0,1],opacity:1});
    expect(implicit.extensions).toEqual(explicit.extensions);
  });
  it.each(["glb","gltf"] as const)("preserves mixed/default semantics through deterministic validated %s export and reimport", async outputFormat => {
    const first = await load(triangle(authored,[undefined,0,undefined,1]),format);
    const a = await exportGpuModelToGltf(first.document,{conversionEnabled:true,format:outputFormat});
    const b = await exportGpuModelToGltf(first.document,{conversionEnabled:true,format:outputFormat});
    expect(a.validator.id).toBe("KhronosGroup/glTF-Validator");
    expect(a.diagnostics.some(d=>d.severity==="blocking")).toBe(false);
    expect(a.resources.map(r=>[r.path,r.contentHash])).toEqual(b.resources.map(r=>[r.path,r.contentHash]));
    const files = Object.fromEntries(await Promise.all(a.resources.map(async r=>[r.path,new Uint8Array(await r.payload.arrayBuffer())])));
    const round = await importGltfToGpuModelDocument(files[a.entryPoint]!,{conversionEnabled:true,resourceResolver:resolver(files)});
    const semantic = (d:GpuModelDocument) => d.meshes.flatMap(m=>m.primitives.map(p=>{
      const material=d.materials.find(v=>v.id===p.materialId);expect(material).toBeDefined();
      const {id: _id, ...properties}=material!;return properties;
    }));
    expect(first.document.materials).toHaveLength(3);
    expect(semantic(round.document)).toEqual(semantic(first.document));
    expect(round.document.materials).toHaveLength(3);
  });
});
