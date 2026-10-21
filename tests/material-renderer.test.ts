import { describe, it, expect } from "vitest";
import { ModelRuntime, type ResourceResolver } from "@plasius/gpu-model-runtime";
import { prepareGpuModelRendererInput } from "@plasius/gpu-model-renderer";
import { createCanonicalWavefrontMeshInputs, createWavefrontGpuMaterialSource, createWavefrontMeshAcceleration, normalizeWavefrontMesh, normalizeWavefrontMaterialExtensions } from "@plasius/gpu-renderer";
import type { GpuModelDocument } from "@plasius/gpu-model-core";
import { importGltfToGpuModelDocument } from "../src/index.js";
import { extended, options, encoder, fixture, png } from "./material-fixture.js";
import { inflateSync } from "node:zlib";

// Decode the actual admitted fixture payload. This helper handles only this
// synthetic 1x1 RGBA/filter0 PNG; production decoder ownership stays outside this package.
async function pixels(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer()); const view=new DataView(bytes.buffer);
  for(let i=8;i<bytes.length;){const size=view.getUint32(i,false);if(new TextDecoder().decode(bytes.slice(i+4,i+8))==="IDAT"){
    const row=inflateSync(bytes.slice(i+8,i+8+size)); expect(row[0]).toBe(0); return Uint8Array.from(row.slice(1));
  } i+=size+12;}
  throw new Error("Fixture PNG requires IDAT.");
}
async function throughRuntime(f = extended()) {
  const runtime = new ModelRuntime();
  runtime.adapters.register({ formatId:"gltf-material-fixture", extensions:["gltf"], load:async()=>({
    formatId:"gltf-material-fixture", sniff:()=>true,
    load:async(input, context)=>({canonicalModel:(await importGltfToGpuModelDocument(input.bytes,{conversionEnabled:true, resourceResolver:input.resourceResolver,signal:context.signal})).document}),
  }) });
  const loaded=await runtime.loadModel<GpuModelDocument>({kind:"uint8-array",bytes:encoder.encode(JSON.stringify(f.json)),fileNameHint:"fixture.gltf",package:{resources:{"mesh.bin":{bytes:f.bytes},"textures/pixel.png":{bytes:png,contentType:"image/png"}}}},{formatId:"gltf-material-fixture",useCache:false});
  return prepareGpuModelRendererInput(loaded.canonicalModel,{conversionEnabled:true});
}
async function samples(prepared: Awaited<ReturnType<typeof throughRuntime>>) {
  return new Map(await Promise.all(prepared.textures.map(async ({texture, resource})=>[texture.id,{width:1,height:1,data:await pixels(resource.payload)}] as const)));
}
describe("actual glTF through released runtime bridge and renderer",()=>{
  it("retains all extension resources, normalizes factors and builds actual renderer atlas and acceleration data",async()=>{
    const prepared=await throughRuntime(); const textures=await samples(prepared);
    const meshes=createCanonicalWavefrontMeshInputs({document:prepared.document,geometry:prepared.geometry,textures});
    expect(prepared.materials).toBe(prepared.document.materials);
    expect(prepared.textures.every(t=>t.resource===prepared.document.resources.find(r=>r.id==="image-0"))).toBe(true);
    const normalized=normalizeWavefrontMesh(meshes[0]!);
    expect(normalized.ior).toBe(1.7); expect(normalizeWavefrontMaterialExtensions({ ...meshes[0]! })).toMatchObject({clearcoat:0.8,clearcoatRoughness:0.2,transmission:0.7,sheenRoughness:0.6,specular:0.9,iridescence:0.4,anisotropy:0.5,dispersion:0.3});
    const packed=createWavefrontGpuMaterialSource(meshes);
    for(const slot of ["clearcoat","clearcoatRoughness","clearcoatNormal","transmission","sheenColor","sheenRoughness","thickness","specular","specularColor","iridescence","iridescenceThickness","anisotropy"] as const){
      expect(packed.extensionAtlases[slot]!.data.length).toBeGreaterThan(0);
      expect(packed.extensionAtlases[slot]!.data.some((n:number)=>n===255)).toBe(true);
    }
    expect(createWavefrontMeshAcceleration(meshes).triangles).toHaveLength(1);
    await expect(prepareGpuModelRendererInput(prepared.document,{conversionEnabled:false})).rejects.toMatchObject({code:"feature-disabled"});
  });
  it.each(["transform","UV"])("retains authored %s and refuses unsupported renderer projection for safe legacy fallback",async kind=>{
    const f=extended(); const info=f.json.materials[0].extensions.KHR_materials_volume.thicknessTexture;
    if(kind==="transform"){f.json.extensionsUsed.push("KHR_texture_transform");info.extensions={KHR_texture_transform:{offset:[0.25,-0.5]}};}
    else{info.texCoord=1;f.json.meshes[0].primitives[0].attributes.TEXCOORD_1=1;}
    const p=await throughRuntime(f);const textures=await samples(p);
    if(kind==="transform")expect(p.materials[0]!.textures.thickness!.transform!.offset).toEqual([0.25,-0.5]);else expect(p.materials[0]!.textures.thickness!.texCoordSet).toBe(1);
    expect(()=>createCanonicalWavefrontMeshInputs({document:p.document,geometry:p.geometry,textures})).toThrow(kind==="transform"?"require upstream application":"supports only UV set 0");
  });
  it("applies glTF IOR/clearcoat defaults and missing-normal fallback without changing legacy consumer code",async()=>{
    const p=await throughRuntime(fixture());const meshes=createCanonicalWavefrontMeshInputs({document:p.document,geometry:p.geometry,textures:await samples(p)});
    const m=normalizeWavefrontMesh(meshes[0]!); expect(m.ior).toBe(1.5);expect(normalizeWavefrontMaterialExtensions({ ...meshes[0]! }).clearcoatRoughness).toBe(0);expect(m.normals).toBeNull();
  });
});
