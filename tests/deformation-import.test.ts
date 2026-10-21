import { describe, expect, expectTypeOf, it } from "vitest";
import { isGpuModelDocument } from "@plasius/gpu-model-core";
import { prepareGpuModelRendererInput } from "@plasius/gpu-model-renderer";
import { importGltfToGpuModelDocument, importGlbToGpuModelDocument, validateAndExportGlb } from "../src/index.js";
import { glb, options, resolver, code, fixture, encoder } from "./material-fixture.js";
import { rig, rigBytes, rigOptions, deformationProfile, identity, append } from "./deformation-fixture.js";

const load = (f = rig()) => importGltfToGpuModelDocument(rigBytes(f), rigOptions(f));
describe("opt-in bounded glTF deformation preservation", () => {
  it.each(["STEP", "LINEAR", "CUBICSPLINE"])("preserves skin/morph/independent node animation and material %s source round trips", async interpolation => {
    const f = rig(interpolation); const first = await load(f); const d = first.document;
    expect(first.profile).toBe(deformationProfile); expect(isGpuModelDocument(d)).toBe(true);
    expect(d.skins[0]).toMatchObject({ id: "skin-0", jointIds: ["joint-0-0", "joint-0-1"], skeletonId: "skeleton-0" });
    expect(d.skeletons[0]!.rootJointIds).toEqual(["joint-0-0"]);
    expect(d.joints[1]).toMatchObject({ nodeId: "node-2", parentJointId: "joint-0-0", restLocalTransform: { translation: [0, 1, 0] } });
    expect(d.skins[0]!.inverseBindMatrices[0]).toEqual(identity);
    expect(d.skins[0]!.inverseBindMatrices[1]![14]).toBe(2);
    expect(d.skins[0]!.weightSets[0]).toMatchObject({ influencesPerVertex: 4, joints: [[0, 1, 0, 0], [0, 1, 0, 0], [0, 1, 0, 0]], weights: [[0.75, 0.25, 0, 0], [0.75, 0.25, 0, 0], [0.75, 0.25, 0, 0]] });
    expect(d.blendShapes.map(s => s.defaultWeight)).toEqual([-0.25, 1.5]);
    expect(d.nodes.find(n => n.id === "node-0")!.morphWeights!.map(w => w.weight)).toEqual([-0.25, 1.5]);
    expect(d.nodes.find(n => n.id === "node-3")!.morphWeights!.map(w => w.weight)).toEqual([0.75, -0.5]);
    const a = d.animations[0]!;
    expect(a.channels.map(c => c.targetType)).toEqual(["node-translation", "node-rotation", "node-scale", "node-weights", "node-weights"]);
    const k = interpolation === "CUBICSPLINE" ? 3 : 0;
    expect(a.samplers[0]!.outputValues.slice(k, k + 3)).toEqual([1, 2, -3]);
    const r = interpolation === "CUBICSPLINE" ? 4 : 0;
    expect(a.samplers[1]!.outputValues.slice(r, r + 4)).toEqual([0, 0, 0, -1]);
    if (interpolation === "CUBICSPLINE") {
      expect(a.samplers[0]!.outputValues[2]).toBeCloseTo(-0.3);
      expect(a.samplers[1]!.outputValues.slice(0, 4)).toEqual([-Math.fround(0.1), Math.fround(0.2), Math.fround(0.3), -Math.fround(0.4)]);
    }
    expect(a.samplers[3]!.outputValues).not.toEqual(a.samplers[4]!.outputValues);
    const prepared = await prepareGpuModelRendererInput(d, { conversionEnabled: true });
    expect(prepared.document).toBe(d); expect(prepared.document.animations).toBe(d.animations);
    expect(Array.from(prepared.animations[0]!.samplers[0]!.output)).toEqual(a.samplers[0]!.outputValues);
    const delta = d.blendShapes[0]!.deltas[0]!;
    expect(Array.from(prepared.accessors[delta.positionAccessorId!]!)).toEqual([0, 0, -1, 0, 0, -1, 0, 0, -1]);
    expect(Array.from(prepared.accessors[delta.tangentAccessorId!]!)).toEqual([0, 0, -0.5, 0, 0, -0.5, 0, 0, -0.5]);
    expect(d.blendShapes.map(s => s.name)).toEqual(["bend", "stretch"]);
    expect(d.animations[0]!.samplers[1]!.outputValues.at(interpolation === "CUBICSPLINE" ? 16 : 4)).toBe(-Math.fround(0.6));
    expect(Object.isFrozen(d.animations[0]!.samplers[0]!.outputValues)).toBe(true);
    const artifact = await first.normalizedGlb.payload.arrayBuffer(); const noNetwork = resolver({});
    const round = await importGltfToGpuModelDocument(artifact, { profile: deformationProfile, conversionEnabled: true, resourceResolver: noNetwork });
    expect(noNetwork.resolve).not.toHaveBeenCalled(); expect(round.normalizedGlb.contentHash).toBe(first.normalizedGlb.contentHash);
    for (const field of ["skins", "joints", "skeletons", "blendShapes", "animations", "nodes", "materials", "textures"] as const) expect(round.document[field]).toEqual(d[field]);
    expect((await load(f)).normalizedGlb.contentHash).toBe(first.normalizedGlb.contentHash);
  });
  it("retains authored signed TRS and independent quaternion sign without decomposition", async () => {
    const f = rig(); f.json.nodes[3].rotation = [0.6, 0, 0, -0.8]; f.json.nodes[3].scale = [-1, 2, 0]; f.json.nodes[3].translation = [1, 2, 3];
    const d = (await load(f)).document;
    expect(d.nodes.find(n => n.id === "node-3")!.restLocalTransform).toEqual({ translation: [1, 2, -3], rotation: [-0.6, 0, 0, -0.8], scale: [-1, 2, 0] });
  });
  it("defaults absent inverse matrices/mesh/node weights and supports shared samplers and shared joint nodes across skins", async () => {
    const f = rig(); delete f.json.skins[0].inverseBindMatrices; delete f.json.meshes[0].weights; delete f.json.nodes[3].weights;
    f.json.skins.push({ joints: [1, 2] }); f.json.nodes[3].skin = 1;
    f.json.animations[0].channels[4].sampler = 3; f.json.animations[0].samplers.pop();
    const d = (await load(f)).document;
    expect(d.skins).toHaveLength(2); expect(d.joints).toHaveLength(4);
    expect(d.skins[0]!.inverseBindMatrices).toEqual([identity, identity]);
    expect(d.nodes.find(n => n.id === "node-0")!.morphWeights!.map(w => w.weight)).toEqual([0, 0]);
    expect(d.animations[0]!.samplers).toHaveLength(4);
  });
  it("admits normalized integer weight rows without repair", async () => {
    const f = rig(); const a = append(f, [255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0], "VEC4", 5121, 34962); f.json.accessors[a].normalized = true;
    f.json.meshes[0].primitives[0].attributes.WEIGHTS_0 = a;
    expect((await load(f)).document.skins[0]!.weightSets[0]!.weights[0]).toEqual([1, 0, 0, 0]);
  });
  it("retains node-local joint rest transforms across non-joint intermediaries", async () => {
    const f = rig(); f.json.nodes.push({ children: [2], translation: [0, 0, 2] }); f.json.nodes[1].children = [4];
    const d = (await load(f)).document;
    expect(d.joints[1]!.parentJointId).toBe("joint-0-0");
    expect(d.nodes.find(n => n.id === "node-4")!.restLocalTransform!.translation).toEqual([0, 0, -2]);
  });
  it("maps shared morph ordering across multiple primitives and contiguous influence sets", async () => {
    const f = rig(); const p = f.json.meshes[0].primitives[0];
    p.attributes.JOINTS_1 = append(f, Array(12).fill(0), "VEC4", 5123, 34962);
    p.attributes.WEIGHTS_1 = append(f, Array(12).fill(0), "VEC4", 5126, 34962);
    f.json.meshes[0].primitives.push(structuredClone(p));
    const d = (await load(f)).document;
    expect(d.blendShapes).toHaveLength(2); expect(d.blendShapes[0]!.deltas).toHaveLength(2);
    expect(d.skins[0]!.weightSets).toHaveLength(2);
    expect(d.skins[0]!.weightSets[1]!.influencesPerVertex).toBe(8);
    expect(d.skins[0]!.weightSets[1]!.weights[0]).toEqual([0.75, 0.25, 0, 0, 0, 0, 0, 0]);
  });
  it("preserves the original static profile literal type for existing callers", async () => {
    const f = fixture(); const result = await importGltfToGpuModelDocument(encoder.encode(JSON.stringify(f.json)), options(f));
    expectTypeOf(result.profile).toEqualTypeOf<"gltf-static-resources-v1">();
    expectTypeOf((await load()).profile).toEqualTypeOf<typeof deformationProfile>();
  });
  it("retains all existing strict/static rejection boundaries", async () => {
    const f = rig();
    await expect(importGltfToGpuModelDocument(rigBytes(f), options(f))).rejects.toSatisfy(code("unsupported-gltf-feature"));
    const json = structuredClone(f.json); delete json.buffers[0].uri; delete json.images; delete json.textures; delete json.materials; delete json.meshes[0].primitives[0].material;
    const bytes = glb(json, f.bytes);
    await expect(validateAndExportGlb(bytes)).rejects.toSatisfy(code("unsupported-gltf-feature"));
    await expect(importGlbToGpuModelDocument(bytes, { pvoxModelsEnabled: true, gltfConverterEnabled: true })).rejects.toSatisfy(code("unsupported-gltf-feature"));
  });
});
