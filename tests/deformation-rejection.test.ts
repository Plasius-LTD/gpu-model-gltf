import { describe, expect, it, vi } from "vitest";
import type { ResourceResolver } from "@plasius/gpu-model-runtime";
import { importGltfToGpuModelDocument } from "../src/index.js";
import { code, fixture, encoder } from "./material-fixture.js";
import { rig, rigBytes, rigOptions, identity, append, deformationProfile, type RigFixture } from "./deformation-fixture.js";

const rejectBeforeIo = async (mutate: (f: RigFixture) => void, reason = "invalid-gltf-document") => {
  const f = rig(); mutate(f); const options = rigOptions(f);
  await expect(importGltfToGpuModelDocument(rigBytes(f), options)).rejects.toSatisfy(code(reason));
  expect(options.resourceResolver.resolve).not.toHaveBeenCalled();
};
const editSampler = (f: RigFixture) => f.json.animations[0].samplers[0];
describe("deformation grammar and preflight refusal", () => {
  it.each(["missing weights", "gapped sets", "excess sets", "extra weights"])("rejects %s in skin influences before resource acquisition", async kind => {
    await rejectBeforeIo(f => {
      const attrs = f.json.meshes[0].primitives[0].attributes;
      if (kind === "missing weights") delete attrs.WEIGHTS_0;
      if (kind === "gapped sets") { attrs.JOINTS_2 = attrs.JOINTS_0; attrs.WEIGHTS_2 = attrs.WEIGHTS_0; }
      if (kind === "extra weights") attrs.WEIGHTS_1 = attrs.WEIGHTS_0;
      if (kind === "excess sets") for (let i = 1; i < 9; i += 1) { attrs[`JOINTS_${i}`] = attrs.JOINTS_0; attrs[`WEIGHTS_${i}`] = attrs.WEIGHTS_0; }
    });
  });
  it.each([
    ["duplicate joints", (f: RigFixture) => { f.json.skins[0].joints = [1, 1]; }],
    ["empty joints", (f: RigFixture) => { f.json.skins[0].joints = []; }],
    ["joint reference", (f: RigFixture) => { f.json.skins[0].joints[0] = 99; }],
    ["skeleton reference", (f: RigFixture) => { f.json.skins[0].skeleton = 99; }],
    ["node skin", (f: RigFixture) => { f.json.nodes[0].skin = 99; }],
    ["skin without mesh", (f: RigFixture) => { f.json.nodes[1].skin = 0; }],
    ["weights without mesh", (f: RigFixture) => { f.json.nodes[1].weights = [1, 1]; }],
    ["node weights arity", (f: RigFixture) => { f.json.nodes[0].weights = [1]; }],
    ["mesh weights arity", (f: RigFixture) => { f.json.meshes[0].weights = [1]; }],
    ["nonfinite weights", (f: RigFixture) => { f.json.nodes[0].weights = [null, 0]; }],
    ["target names arity", (f: RigFixture) => { f.json.meshes[0].extras.targetNames = ["only one"]; }],
    ["target names type", (f: RigFixture) => { f.json.meshes[0].extras.targetNames = [1, 2]; }],
    ["empty morph targets", (f: RigFixture) => { f.json.meshes[0].primitives[0].targets = []; }],
    ["empty target", (f: RigFixture) => { f.json.meshes[0].primitives[0].targets[0] = {}; }],
    ["unequal primitive targets", (f: RigFixture) => { const p = structuredClone(f.json.meshes[0].primitives[0]); p.targets.pop(); f.json.meshes[0].primitives.push(p); }],
    ["missing base normal", (f: RigFixture) => { delete f.json.meshes[0].primitives[0].attributes.NORMAL; }],
    ["morph vertex count", (f: RigFixture) => { f.json.accessors[f.json.meshes[0].primitives[0].targets[0].POSITION].count = 2; }],
    ["missing skin weights", (f: RigFixture) => { delete f.json.meshes[0].primitives[0].attributes.JOINTS_0; }],
    ["empty animation", (f: RigFixture) => { f.json.animations[0].channels = []; }],
    ["channel sampler reference", (f: RigFixture) => { f.json.animations[0].channels[0].sampler = 99; }],
    ["target node reference", (f: RigFixture) => { f.json.animations[0].channels[0].target.node = 99; }],
    ["missing target node", (f: RigFixture) => { delete f.json.animations[0].channels[0].target.node; }],
    ["duplicate target path", (f: RigFixture) => { f.json.animations[0].channels.push(structuredClone(f.json.animations[0].channels[0])); }],
    ["matrix animated node", (f: RigFixture) => { f.json.nodes[0].matrix = identity; }],
    ["animation key arity", (f: RigFixture) => { f.json.accessors[editSampler(f).output].count = 3; }],
    ["animated non-morph node", (f: RigFixture) => { f.json.meshes[0].primitives[0].targets = undefined; delete f.json.meshes[0].weights; delete f.json.meshes[0].extras; delete f.json.nodes[3].weights; }],
  ] as const)("rejects %s before resource I/O", async (_name, mutate) => rejectBeforeIo(mutate));

  it.each([
    ["matrix joint", (f: RigFixture) => { f.json.nodes[1].matrix = identity; }],
    ["unused skin", (f: RigFixture) => { f.json.skins.push({ joints: [1, 2] }); }],
    ["morph UV", (f: RigFixture) => { f.json.meshes[0].primitives[0].targets[0].TEXCOORD_0 = 1; }],
    ["morph type", (f: RigFixture) => { f.json.accessors[f.json.meshes[0].primitives[0].targets[0].POSITION].type = "VEC4"; }],
    ["morph normalized", (f: RigFixture) => { f.json.accessors[f.json.meshes[0].primitives[0].targets[0].POSITION].normalized = true; }],
    ["inverse bind type", (f: RigFixture) => { f.json.accessors[f.json.skins[0].inverseBindMatrices].type = "VEC4"; }],
    ["extra inverse matrix", (f: RigFixture) => { f.json.skins[0].inverseBindMatrices = append(f, [...identity, ...identity, ...identity], "MAT4"); }],
    ["unknown target", (f: RigFixture) => { f.json.animations[0].channels[0].target.path = "visibility"; }],
    ["shared incompatible sampler", (f: RigFixture) => { f.json.animations[0].channels[1].sampler = 0; }],
    ["unused sampler", (f: RigFixture) => { f.json.animations[0].samplers.push(structuredClone(editSampler(f))); }],
    ["unknown interpolation", (f: RigFixture) => { editSampler(f).interpolation = "BEZIER"; }],
    ["integer time", (f: RigFixture) => { f.json.accessors[editSampler(f).input].componentType = 5123; }],
    ["integer output", (f: RigFixture) => { f.json.accessors[editSampler(f).output].componentType = 5123; }],
  ] as const)("fails closed for unsupported %s", async (_name, mutate) => rejectBeforeIo(mutate, "unsupported-gltf-feature"));

  it.each(["maxJoints", "maxMorphTargets", "maxMorphBindings", "maxAnimationSamplers", "maxAnimationChannels", "maxDeformationElements"] as const)("enforces caller-tightened %s before acquisition", async key => {
    const f = rig(); const options = { ...rigOptions(f), limits: { [key]: 1 } };
    await expect(importGltfToGpuModelDocument(rigBytes(f), options)).rejects.toSatisfy(code("document-resource-limit"));
    expect(options.resourceResolver.resolve).not.toHaveBeenCalled();
  });
  it.each(["skins", "animations"] as const)("caps %s before expanding their content", async collection => {
    const f = rig(); f.json[collection].push(structuredClone(f.json[collection][0]));
    const options = { ...rigOptions(f), limits: collection === "skins" ? { maxSkins: 1 } : { maxAnimations: 1 } };
    await expect(importGltfToGpuModelDocument(rigBytes(f), options)).rejects.toSatisfy(code("document-resource-limit"));
    expect(options.resourceResolver.resolve).not.toHaveBeenCalled();
  });
  it("charges repeated animation references and includes deformation in the geometry budget before I/O", async () => {
    const f = rig(); f.json.animations.push(structuredClone(f.json.animations[0]));
    for (const limits of [{ maxDeformationElements: 160 }, { maxGeometryElements: 218 }]) {
      const options = { ...rigOptions(f), limits };
      await expect(importGltfToGpuModelDocument(rigBytes(f), options)).rejects.toSatisfy(code("document-resource-limit"));
      expect(options.resourceResolver.resolve).not.toHaveBeenCalled();
    }
  });
  it.each([null, "unknown"])("rejects invalid profile %s without I/O", async profile => {
    const f = rig(); const options = { ...rigOptions(f), profile };
    // Runtime validation of an untyped consumer.
    await expect(importGltfToGpuModelDocument(rigBytes(f), options as never)).rejects.toSatisfy(code("invalid-adapter-options"));
    expect(options.resourceResolver.resolve).not.toHaveBeenCalled();
  });
});

describe("deformation bytes, reliability and rollback", () => {
  it.each(["joint payload", "weight sum", "time ordering", "quaternion", "nonfinite", "truncated"])("rejects malformed %s without a static downgrade", async kind => {
    const f = rig(); const p = f.json.meshes[0].primitives[0];
    const byteOffset = (a: number) => f.json.bufferViews[f.json.accessors[a].bufferView].byteOffset;
    const view = new DataView(f.bytes.buffer);
    if (kind === "joint payload") view.setUint8(byteOffset(p.attributes.JOINTS_0), 255);
    if (kind === "weight sum") view.setFloat32(byteOffset(p.attributes.WEIGHTS_0), 0.1, true);
    if (kind === "time ordering") view.setFloat32(byteOffset(editSampler(f).input) + 4, 0, true);
    if (kind === "quaternion") view.setFloat32(byteOffset(f.json.animations[0].samplers[1].output) + 12, -2, true);
    if (kind === "nonfinite") view.setFloat32(byteOffset(editSampler(f).output), Infinity, true);
    if (kind === "truncated") f.json.bufferViews[f.json.accessors[editSampler(f).output].bufferView].byteLength = 1;
    try { await importGltfToGpuModelDocument(rigBytes(f), rigOptions(f)); throw new Error("Expected refusal"); }
    catch (error) {
      expect(error).toHaveProperty("code"); expect(String(error)).not.toContain("mesh.bin"); expect(String(error)).not.toContain("PRIVATE");
    }
  });
  it("gates disabled/pre-aborted imports before I/O and permits clean re-enable", async () => {
    const f = rig(); const options = rigOptions(f); const c = new AbortController(); c.abort();
    await expect(importGltfToGpuModelDocument(rigBytes(f), { ...options, conversionEnabled: false })).rejects.toSatisfy(code("feature-disabled"));
    await expect(importGltfToGpuModelDocument(rigBytes(f), { ...options, signal: c.signal })).rejects.toSatisfy(code("aborted"));
    expect(options.resourceResolver.resolve).not.toHaveBeenCalled();
    expect((await importGltfToGpuModelDocument(rigBytes(f), options)).document.animations).toHaveLength(1);
  });
  it.each(["cancel", "deadline"])("races uncooperative deformation providers on %s", async kind => {
    const f = rig(), c = new AbortController();
    const resolve = vi.fn<ResourceResolver["resolve"]>(() => new Promise<never>(() => {}));
    const operation = importGltfToGpuModelDocument(rigBytes(f), { profile: deformationProfile, conversionEnabled: true, resourceResolver: { resolve }, signal: c.signal, limits: { timeoutMs: 20 } });
    const check = expect(operation).rejects.toSatisfy(code(kind === "cancel" ? "aborted" : "processing-time-limit"));
    if (kind === "cancel") setTimeout(() => c.abort(), 1);
    await check; expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });
  it("permits static assets with the explicit profile and opaque extras", async () => {
    const f = fixture(); f.json.meshes[0].extras = "opaque";
    const options = rigOptions(f);
    expect((await importGltfToGpuModelDocument(encoder.encode(JSON.stringify(f.json)), options)).document.animations).toHaveLength(0);
  });
});
