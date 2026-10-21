import type {
  GpuModelAccessor, GpuModelAnimation, GpuModelAnimationTargetType,
  GpuModelBlendShape, GpuModelJoint, GpuModelMatrix4, GpuModelNode,
  GpuModelSkeleton, GpuModelSkin, GpuModelTransformTrs,
  GpuModelSourceMetadata,
} from "@plasius/gpu-model-core";
import { array, record, integer, fail, type JsonRecord } from "./resource-values.js";
import type { ImportBudget, ResolvedImport } from "./resource-resolution.js";
import { staticGeometryInternals as geometry } from "./static-demo-import.js";

/** @internal Dense, bounded decoded data shared with the canonical packer. */
export interface DecodedAccessor {
  readonly count: number;
  readonly size: number;
  readonly values: Float32Array | Uint32Array;
}
type Decode = (index: number, joints?: boolean) => DecodedAccessor;
type Add = (data: DecodedAccessor, semantic: string) => GpuModelAccessor;
const sourceMetadata = (value: JsonRecord): GpuModelSourceMetadata => value.extras === undefined ? {} : { sourceExtras: value.extras } as GpuModelSourceMetadata;
const floatAccessor = (accessors: unknown[], index: unknown, type: string) => {
  const a = record(accessors[integer(index, 0, accessors.length - 1)]);
  if (a.type !== type || a.componentType !== 5126 || (a.normalized !== undefined && a.normalized !== false))
    fail("unsupported-gltf-feature", "Deformation requires non-normalized float accessors of the declared shape.");
  return a;
};
const finiteWeights = (value: unknown, count: number) => {
  const values = value === undefined ? Array<number>(count).fill(0) : array(value);
  if (values.length !== count || values.some(v => typeof v !== "number" || !Number.isFinite(v)))
    fail("invalid-gltf-document", "Morph weights must be a complete finite ordered vector.");
  return values as number[];
};

/** @internal Bound expanded references and duplicated arrays before acquisition/validator work. */
export function preflightDeformation(document: JsonRecord, budget: ImportBudget): number {
  const nodes = array(document.nodes).map(record);
  const accessors = array(document.accessors);
  const meshes = array(document.meshes).map(record);
  const skinValues = array(document.skins);
  const animationValues = array(document.animations);
  const limits = budget.limits;
  let elements = 0, shapes = 0, bindings = 0, jointCount = 0, samplerCount = 0, channelCount = 0;
  const consume = (amount: number) => {
    if (!Number.isSafeInteger(amount) || amount > limits.maxDeformationElements - elements)
      fail("document-resource-limit", "Deformation references exceed the expanded work budget.");
    elements += amount;
  };
  const capped = (count: number, cap: number) => {
    if (count > cap) fail("document-resource-limit", "Deformation entities exceed their hard limit.");
  };
  capped(skinValues.length, limits.maxSkins); capped(animationValues.length, limits.maxAnimations);
  const skins = skinValues.map(record), animations = animationValues.map(record);
  const morphCounts = meshes.map(mesh => {
    budget.check();
    const primitives = array(mesh.primitives).map(record);
    const count = array(primitives[0]?.targets).length;
    if (count === 0 && primitives[0]?.targets !== undefined)
      fail("invalid-gltf-document", "Present morph targets must be non-empty.");
    shapes += count; capped(shapes, limits.maxMorphTargets);
    finiteWeights(mesh.weights, count);
    const names = mesh.extras && typeof mesh.extras === "object" && !Array.isArray(mesh.extras) ? record(mesh.extras).targetNames : undefined;
    if (names !== undefined && (array(names).length !== count || array(names).some(n => typeof n !== "string")))
      fail("invalid-gltf-document", "Morph target names must match the ordered target list.");
    for (const p of primitives) {
      const targets = array(p.targets); const attrs = record(p.attributes);
      if (targets.length !== count) fail("invalid-gltf-document", "Every primitive must have the same ordered morph target count.");
      const positions = record(accessors[integer(attrs.POSITION, 0, accessors.length - 1)]);
      for (const value of targets) {
        budget.check(); const target = record(value); const entries = Object.entries(target);
        if (!entries.length) fail("invalid-gltf-document", "A morph target requires displacement data.");
        for (const [semantic, index] of entries) {
          if (!["POSITION", "NORMAL", "TANGENT"].includes(semantic))
            fail("unsupported-gltf-feature", "Only position, normal and tangent morph deltas are admitted.");
          if (attrs[semantic] === undefined) fail("invalid-gltf-document", "Morph deltas require the corresponding base attribute.");
          const a = floatAccessor(accessors, index, "VEC3");
          if (a.count !== positions.count) fail("invalid-gltf-document", "Morph and base attribute counts differ.");
          consume(integer(a.count, 1) * 3);
        }
      }
    }
    return count;
  });
  const meshesBySkin = skins.map(() => new Set<number>());
  for (const node of nodes) {
    budget.check();
    if (node.mesh !== undefined) {
      const mesh = integer(node.mesh, 0, meshes.length - 1); const count = morphCounts[mesh]!;
      finiteWeights(node.weights ?? meshes[mesh]!.weights, count);
      bindings += count; capped(bindings, limits.maxMorphBindings); consume(count);
      if (node.skin !== undefined) meshesBySkin[integer(node.skin, 0, skins.length - 1)]!.add(mesh);
    } else if (node.skin !== undefined || node.weights !== undefined)
      fail("invalid-gltf-document", "Skin and morph bindings require a mesh node.");
  }
  for (const [i, skin] of skins.entries()) {
    budget.check(); const joints = array(skin.joints);
    if (!joints.length || new Set(joints).size !== joints.length)
      fail("invalid-gltf-document", "Skins require a unique non-empty ordered joint list.");
    jointCount += joints.length; capped(jointCount, limits.maxJoints); consume(joints.length * 16 + nodes.length);
    for (const value of joints) {
      const n = nodes[integer(value, 0, nodes.length - 1)]!;
      if (n.matrix !== undefined)
        fail("unsupported-gltf-feature", "Matrix-authored joint rest poses require explicit TRS qualification.");
    }
    if (skin.skeleton !== undefined) integer(skin.skeleton, 0, nodes.length - 1);
    if (skin.inverseBindMatrices !== undefined) {
      const a = floatAccessor(accessors, skin.inverseBindMatrices, "MAT4");
      // Extra authored matrices cannot be represented by core's exactly-one-per-joint contract.
      if (a.count !== joints.length) fail("unsupported-gltf-feature", "Inverse bind matrices must exactly match the ordered skin joints.");
    }
    if (!meshesBySkin[i]!.size) fail("unsupported-gltf-feature", "Unbound skins cannot be represented by the canonical contract.");
    for (const mesh of meshesBySkin[i]!) for (const p of array(meshes[mesh]!.primitives).map(record)) {
      const attrs = record(p.attributes);
      const sets = Object.keys(attrs).filter(s => /^JOINTS_/u.test(s));
      if (!sets.length) fail("invalid-gltf-document", "Skinned primitives require joint and weight attributes.");
      const a = record(accessors[integer(attrs.POSITION, 0, accessors.length - 1)]);
      consume(integer(a.count, 1) * sets.length * 8);
    }
  }
  for (const animation of animations) {
    budget.check(); const samplers = array(animation.samplers).map(record); const channels = array(animation.channels).map(record);
    samplerCount += samplers.length; channelCount += channels.length;
    capped(samplerCount, limits.maxAnimationSamplers); capped(channelCount, limits.maxAnimationChannels);
    if (!samplers.length || !channels.length) fail("invalid-gltf-document", "Animations require non-empty samplers and channels.");
    const targets = new Set<string>(); const samplerPaths = new Map<number, { path: string; arity: number }>();
    for (const channel of channels) {
      budget.check(); const sampler = integer(channel.sampler, 0, samplers.length - 1); const target = record(channel.target);
      if (!["translation", "rotation", "scale", "weights"].includes(String(target.path)))
        fail("unsupported-gltf-feature", "The animation target path is unsupported.");
      const node = integer(target.node, 0, nodes.length - 1); const n = nodes[node]!;
      if (target.path !== "weights" && n.matrix !== undefined)
        fail("invalid-gltf-document", "TRS animation cannot target a matrix-authored node.");
      const key = `${node}/${String(target.path)}`;
      if (targets.has(key)) fail("invalid-gltf-document", "An animation repeats a node and target path.");
      targets.add(key);
      const arity = target.path === "weights" ? morphCounts[integer(n.mesh, 0, meshes.length - 1)]! : 1;
      if (!arity) fail("invalid-gltf-document", "Weight animation requires node morph bindings.");
      const previous = samplerPaths.get(sampler);
      if (previous && (previous.path !== target.path || previous.arity !== arity))
        fail("unsupported-gltf-feature", "A shared sampler requires matching target semantics and morph arity.");
      samplerPaths.set(sampler, { path: String(target.path), arity });
    }
    if (samplerPaths.size !== samplers.length) fail("unsupported-gltf-feature", "Unused animation samplers cannot be represented by the canonical contract.");
    for (const [i, sampler] of samplers.entries()) {
      budget.check(); const interpolation = sampler.interpolation ?? "LINEAR";
      if (!["STEP", "LINEAR", "CUBICSPLINE"].includes(String(interpolation)))
        fail("unsupported-gltf-feature", "The animation interpolation is unsupported.");
      const { path, arity } = samplerPaths.get(i)!;
      const input = floatAccessor(accessors, sampler.input, "SCALAR");
      const type = path === "weights" ? "SCALAR" : path === "rotation" ? "VEC4" : "VEC3";
      const output = floatAccessor(accessors, sampler.output, type);
      const keys = integer(input.count, interpolation === "CUBICSPLINE" ? 2 : 1);
      if (output.count !== keys * arity * (interpolation === "CUBICSPLINE" ? 3 : 1))
        fail("invalid-gltf-document", "Animation input/output counts do not match the target arity.");
      consume(keys + integer(output.count, 1) * (type === "SCALAR" ? 1 : type === "VEC4" ? 4 : 3));
    }
  }
  return elements;
}

/** @internal Exact reflection of authored TRS, including quaternion sign and signed scales. */
export function nodeRestTrs(node: JsonRecord): GpuModelTransformTrs {
  const t = (node.translation ?? [0, 0, 0]) as number[];
  const r = (node.rotation ?? [0, 0, 0, 1]) as number[];
  return { translation: [t[0]!, t[1]!, -t[2]!], rotation: [-r[0]!, -r[1]!, r[2]!, r[3]!], scale: (node.scale ?? [1, 1, 1]) as GpuModelTransformTrs["scale"] };
}

/** @internal One mesh-owned shape per target, deltas spanning all its primitives. */
export function mapMorphTargets(mesh: JsonRecord, meshIndex: number, decode: Decode, add: Add): GpuModelBlendShape[] {
  const primitives = array(mesh.primitives).map(record);
  const count = array(primitives[0]?.targets).length;
  const weights = finiteWeights(mesh.weights, count);
  return Array.from({ length: count }, (_, i) => ({
    id: `morph-${meshIndex}-${i}`, meshId: `mesh-${meshIndex}`, defaultWeight: weights[i]!,
    ...(mesh.extras && typeof mesh.extras === "object" && !Array.isArray(mesh.extras) && record(mesh.extras).targetNames !== undefined
      ? { name: array(record(mesh.extras).targetNames)[i] as string } : {}),
    deltas: primitives.map((p, j) => {
      const target = record(array(p.targets)[i]);
      return { primitiveId: `primitive-${meshIndex}-${j}`, ...Object.fromEntries(Object.entries(target).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([semantic, index]) => [
        `${semantic.toLowerCase()}AccessorId`, add(decode(integer(index)), "MORPH_DELTA").id,
      ])) };
    }),
    sourceMetadata: {},
  }));
}

/** @internal Ordered effective per-node weights, independent of other mesh instances. */
export function nodeMorphBindings(node: JsonRecord, meshes: unknown[]) {
  if (node.mesh === undefined) return {};
  const mesh = record(meshes[integer(node.mesh, 0, meshes.length - 1)]);
  const count = array(record(array(mesh.primitives)[0]).targets).length;
  return count ? { morphWeights: finiteWeights(node.weights ?? mesh.weights, count).map((weight, i) => ({ blendShapeId: `morph-${node.mesh}-${i}`, weight })) } : {};
}

/** @internal Preserve format deformation data through the released core boundary. */
export function mapDeformation(source: ResolvedImport, nodes: GpuModelNode[], budget: ImportBudget, decode: Decode, add: Add) {
  const sourceNodes = array(source.document.nodes).map(record);
  const meshes = array(source.document.meshes).map(record);
  const parents = new Map<number, number>();
  sourceNodes.forEach((n, i) => array(n.children).forEach(c => parents.set(integer(c), i)));
  const joints: GpuModelJoint[] = [], skeletons: GpuModelSkeleton[] = [];
  const skins: GpuModelSkin[] = array(source.document.skins).map((value, i) => {
    budget.check(); const skin = record(value); const members = array(skin.joints).map(v => integer(v));
    const ordinal = new Map(members.map((n, j) => [n, j]));
    const jointIds = members.map((_, j) => `joint-${i}-${j}`);
    // Memoized nearest-joint lookup crosses non-joint intermediary nodes in linear work per skin.
    const nearest = new Map<number, number | undefined>();
    const nearestJoint = (n: number | undefined): number | undefined => {
      const path: number[] = []; let cursor = n;
      while (cursor !== undefined && !ordinal.has(cursor) && !nearest.has(cursor)) {
        budget.check(); path.push(cursor); cursor = parents.get(cursor);
      }
      const found = cursor === undefined ? undefined : ordinal.has(cursor) ? cursor : nearest.get(cursor);
      for (const p of path) nearest.set(p, found);
      return found;
    };
    const inverse = skin.inverseBindMatrices === undefined ? undefined : decode(integer(skin.inverseBindMatrices));
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;
    const matrices = members.map((_, j) => inverse ? geometry.conjugateBasis(Array.from(inverse.values.slice(j * 16, j * 16 + 16)) as unknown as GpuModelMatrix4) : identity);
    const roots: string[] = [];
    members.forEach((n, j) => {
      budget.check(); const parent = nearestJoint(parents.get(n));
      if (parent === undefined) roots.push(jointIds[j]!);
      joints.push({ id: jointIds[j]!, nodeId: `node-${n}`, ...(sourceNodes[n]!.name === undefined ? {} : { name: sourceNodes[n]!.name as string }),
        ...(parent === undefined ? {} : { parentJointId: jointIds[ordinal.get(parent)!]! }),
        restLocalTransform: nodes[n]!.restLocalTransform!, inverseBindMatrix: matrices[j] as GpuModelMatrix4,
        sourceMetadata: sourceMetadata(sourceNodes[n]!),
      });
    });
    const meta = { ...sourceMetadata(skin), ...(skin.skeleton === undefined ? {} : { gltfSkeletonNodeId: `node-${skin.skeleton}` }) };
    skeletons.push({ id: `skeleton-${i}`, ...(skin.name === undefined ? {} : { name: skin.name as string }), jointIds, rootJointIds: roots, sourceMetadata: meta });
    const linkedMeshes = new Set(sourceNodes.filter(n => n.skin === i).map(n => integer(n.mesh)));
    const weightSets = [...linkedMeshes].flatMap(meshIndex => array(meshes[meshIndex]!.primitives).map((p, j) => {
      const attrs = record(record(p).attributes);
      const setCount = Object.keys(attrs).filter(s => /^JOINTS_/u.test(s)).length;
      const jointData = Array.from({ length: setCount }, (_, s) => decode(integer(attrs[`JOINTS_${s}`]), true));
      const weightData = Array.from({ length: setCount }, (_, s) => decode(integer(attrs[`WEIGHTS_${s}`])));
      const jointRows: number[][] = [], weightRows: number[][] = [];
      for (let v = 0; v < jointData[0]!.count; v += 1) {
        if ((v & 1023) === 0) budget.check();
        jointRows.push(jointData.flatMap(a => Array.from(a.values.slice(v * 4, v * 4 + 4))));
        weightRows.push(weightData.flatMap(a => Array.from(a.values.slice(v * 4, v * 4 + 4))));
      }
      return { primitiveId: `primitive-${meshIndex}-${j}`, influencesPerVertex: setCount * 4, joints: jointRows, weights: weightRows };
    }));
    return { id: `skin-${i}`, skeletonId: `skeleton-${i}`, jointIds, inverseBindMatrices: matrices as GpuModelMatrix4[], weightSets, sourceMetadata: meta };
  });
  const animations: GpuModelAnimation[] = array(source.document.animations).map((value, i) => {
    budget.check(); const animation = record(value); const rawSamplers = array(animation.samplers).map(record);
    const paths = new Map<number, string>();
    const channels = array(animation.channels).map((v, j) => {
      const channel = record(v), target = record(channel.target); const sampler = integer(channel.sampler);
      paths.set(sampler, String(target.path));
      return { id: `channel-${i}-${j}`, samplerId: `sampler-${i}-${sampler}`, targetId: `node-${target.node}`,
        targetType: (target.path === "weights" ? "node-weights" : `node-${target.path}`) as GpuModelAnimationTargetType, sourceMetadata: sourceMetadata(channel) };
    });
    let durationSeconds = 0;
    const samplers = rawSamplers.map((s, j) => {
      budget.check(); const input = decode(integer(s.input)), output = decode(integer(s.output)); const path = paths.get(j)!;
      const a = add(input, "ANIMATION_TIME");
      const b = add(output, path === "translation" ? "POSITION" : path === "rotation" ? "ANIMATION_ROTATION" : "ANIMATION_VALUE");
      durationSeconds = Math.max(durationSeconds, input.values.at(-1)!);
      return { id: `sampler-${i}-${j}`, inputAccessorId: a.id, outputAccessorId: b.id,
        inputTimesSeconds: Array.from(input.values), outputValues: Array.from(output.values),
        interpolation: s.interpolation === "STEP" ? "step" as const : s.interpolation === "CUBICSPLINE" ? "cubic-spline" as const : "linear" as const,
        sourceMetadata: sourceMetadata(s) };
    });
    return { id: `animation-${i}`, ...(animation.name === undefined ? {} : { name: animation.name as string }), durationSeconds, samplers, channels, sourceMetadata: sourceMetadata(animation) };
  });
  return { joints, skeletons, skins, animations };
}
