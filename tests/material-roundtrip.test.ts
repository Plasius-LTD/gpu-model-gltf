import { describe, it, expect } from "vitest";
import jpeg from "jpeg-js";
import { sha256Hex } from "@plasius/gpu-model-runtime";
import { importGltfToGpuModelDocument } from "../src/index.js";
import { extended, fixture, options, resolver, encoder, png, glb, code } from "./material-fixture.js";

const load = (f = extended()) => importGltfToGpuModelDocument(encoder.encode(JSON.stringify(f.json)), options(f));
describe("material resource source round trips", () => {
  it("exports relative resources into a self-contained GLB with exact material, transform, sampler and encoded image semantics", async () => {
    const f = extended(); f.json.extensionsUsed.push("KHR_texture_transform");
    f.json.materials[0].extensions.KHR_materials_iridescence.iridescenceThicknessTexture.extensions = { KHR_texture_transform: { offset:[0.1,0.2],scale:[2,3],rotation:0.3 } };
    f.json.samplers = [{ wrapS: 33071, wrapT: 33648, magFilter: 9728, minFilter: 9984 }]; f.json.textures[0].sampler = 0;
    const first = await load(f); const second = await load(f);
    expect(first.normalizedGlb.contentHash).toBe(second.normalizedGlb.contentHash);
    const bytes = new Uint8Array(await first.normalizedGlb.payload.arrayBuffer());
    expect(first.normalizedGlb.byteLength).toBe(bytes.length); expect(first.normalizedGlb.contentHash).toBe(await sha256Hex(bytes));
    expect(first.normalizedGlb.payload.type).toBe("model/gltf-binary"); expect(Object.isFrozen(first.normalizedGlb)).toBe(true);
    const noNetwork = resolver({});
    const round = await importGltfToGpuModelDocument(bytes, { conversionEnabled: true, resourceResolver: noNetwork });
    expect(noNetwork.resolve).not.toHaveBeenCalled();
    expect(round.document.materials).toEqual(first.document.materials); expect(round.document.textures).toEqual(first.document.textures);
    expect(round.document.resources.filter(r=>r.kind==="image").map(r => r.contentHash)).toEqual(first.document.resources.filter(r=>r.kind==="image").map(r => r.contentHash));
    expect(new Uint8Array(await round.document.resources[1]!.payload.arrayBuffer())).toEqual(png);
    expect(round.sourceContentHash).toBe(first.normalizedGlb.contentHash);
    expect(round.normalizedGlb.contentHash).toBe(first.normalizedGlb.contentHash);
    const jsonLength = new DataView(bytes.buffer).getUint32(12,true);
    const json = JSON.parse(new TextDecoder().decode(bytes.slice(20,20+jsonLength)));
    expect(json.materials).toEqual(f.json.materials); expect(json.images[0]).toMatchObject({ mimeType: "image/png" });
    expect(json.images[0].uri).toBeUndefined(); expect(json.buffers[0].uri).toBeUndefined();
    // Mutating an acquired array never alters the immutable artifact.
    bytes.fill(0); expect(await sha256Hex(new Uint8Array(await first.normalizedGlb.payload.arrayBuffer()))).toBe(first.normalizedGlb.contentHash);
  });
  it("preserves exact relative JPEG bytes through embedded GLB reimport", async () => {
    const f = extended(); const image = Uint8Array.from(jpeg.encode({width:1,height:1,data:new Uint8Array([32,64,128,255])},90).data);
    f.json.images[0].uri = "textures/pixel.jpg";
    const first = await importGltfToGpuModelDocument(encoder.encode(JSON.stringify(f.json)), {conversionEnabled:true, resourceResolver: resolver({"mesh.bin":f.bytes,"textures/pixel.jpg":image})});
    const second = await importGltfToGpuModelDocument(await first.normalizedGlb.payload.arrayBuffer(),{conversionEnabled:true});
    expect(second.document.materials).toEqual(first.document.materials);
    expect(new Uint8Array(await second.document.resources[1]!.payload.arrayBuffer())).toEqual(image);
    expect(second.document.textures.every(t => t.mimeType === "image/jpeg")).toBe(true);
  });
  it.each(["required", "optional", "wrong location", "nested", "unknown property", "unlit mix"])("fails closed for %s extensions before I/O", async kind => {
    const f=extended();
    if(kind==="required") { f.json.extensionsUsed.push("VENDOR_private"); f.json.extensionsRequired=["VENDOR_private"]; }
    if(kind==="optional") f.json.extensionsUsed.push("VENDOR_private");
    if(kind==="wrong location") f.json.nodes[0].extensions={KHR_materials_ior:{ior:1.5}};
    if(kind==="nested") f.json.materials[0].extensions.KHR_materials_ior.extensions={KHR_materials_ior:{ior:1.5}};
    if(kind==="unknown property") f.json.materials[0].extensions.KHR_materials_ior.privateFactor=1;
    if(kind==="unlit mix") {f.json.extensionsUsed.push("KHR_materials_unlit"); f.json.materials[0].extensions.KHR_materials_unlit={};}
    const o=options(f); await expect(importGltfToGpuModelDocument(encoder.encode(JSON.stringify(f.json)),o)).rejects.toSatisfy(code("unsupported-gltf-feature")); expect(o.resourceResolver.resolve).not.toHaveBeenCalled();
  });
  it.each(["undeclared", "required not used", "duplicate", "nonstring", "null factor", "wrong texture scalar", "null UV", "empty transform property", "null offset", "UV range", "null transform", "wrong extension value"])("rejects malformed %s before I/O", async kind => {
    const f = fixture(); f.json.extensionsUsed=["KHR_texture_transform"];
    const t=f.json.materials[0].pbrMetallicRoughness.baseColorTexture;
    t.extensions={KHR_texture_transform:{}};
    if(kind==="undeclared") delete f.json.extensionsUsed;
    if(kind==="required not used") f.json.extensionsRequired=["KHR_materials_ior"];
    if(kind==="duplicate") f.json.extensionsUsed.push("KHR_texture_transform");
    if(kind==="nonstring") f.json.extensionsUsed=[5];
    if(kind==="null factor") {f.json.extensionsUsed.push("KHR_materials_ior");f.json.materials[0].extensions={KHR_materials_ior:{ior:null}};}
    if(kind==="wrong texture scalar") f.json.materials[0].pbrMetallicRoughness.baseColorTexture=5;
    if(kind==="null UV") t.texCoord=null;
    if(kind==="empty transform property") t.extensions.KHR_texture_transform.offset=[];
    if(kind==="null offset") t.extensions.KHR_texture_transform.offset=null;
    if(kind==="UV range") t.extensions.KHR_texture_transform.texCoord=8;
    if(kind==="null transform") t.extensions.KHR_texture_transform=null;
    if(kind==="wrong extension value") f.json.materials[0].extensions=[];
    const o=options(f); await expect(importGltfToGpuModelDocument(encoder.encode(JSON.stringify(f.json)),o)).rejects.toSatisfy(code("invalid-gltf-document")); expect(o.resourceResolver.resolve).not.toHaveBeenCalled();
  });
  it("keeps extras opaque and defaults an empty transform to identity", async () => {
    const f=fixture(); f.json.extensionsUsed=["KHR_texture_transform"]; f.json.materials[0].extras={extensions:{authored:"opaque"}};
    f.json.materials[0].pbrMetallicRoughness.baseColorTexture.extensions={KHR_texture_transform:{}};
    const d=(await load(f)).document;
    expect(d.materials[0]!.textures.baseColor!.transform).toEqual({offset:[0,0],scale:[1,1],rotationRadians:0});
    expect(d.materials[0]!.sourceMetadata.sourceExtras).toEqual(f.json.materials[0].extras);
  });
  it("propagates disabled, abort, resource budgets, unsupported image and provider failures with bounded diagnostics", async () => {
    const f=extended(); const bytes=encoder.encode(JSON.stringify(f.json)); const o=options(f);
    await expect(importGltfToGpuModelDocument(bytes,{...o,conversionEnabled:false})).rejects.toSatisfy(code("feature-disabled"));
    await expect(importGltfToGpuModelDocument(bytes,{...o,signal:AbortSignal.abort()})).rejects.toSatisfy(code("aborted"));
    expect(o.resourceResolver.resolve).not.toHaveBeenCalled();
    await expect(importGltfToGpuModelDocument(bytes,{...o,limits:{maxResourceBytes:1}})).rejects.toBeInstanceOf(Error);
    f.json.images[0].uri="textures/private.webp";
    await expect(importGltfToGpuModelDocument(encoder.encode(JSON.stringify(f.json)),{conversionEnabled:true,resourceResolver:resolver({"mesh.bin":f.bytes,"textures/private.webp":new Uint8Array([1,2,3])})})).rejects.toBeInstanceOf(Error);
    await expect(importGltfToGpuModelDocument(bytes,{conversionEnabled:true,resourceResolver:resolver({})})).rejects.toSatisfy((e: unknown)=>!String(e).includes("PRIVATE"));
  });
});
