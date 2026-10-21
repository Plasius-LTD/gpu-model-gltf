import { describe, expect, it } from "vitest";
import {
  createGpuModelDocument,
  verifyGpuModelResource,
} from "@plasius/gpu-model-core";
import {
  exportGpuModelToGltf,
  importGltfToGpuModelDocument,
} from "../src/index.js";
import {
  extended,
  encoder,
  options,
  resolver,
  code,
} from "./material-fixture.js";
import { rig, rigBytes, rigOptions, identity } from "./deformation-fixture.js";

const importRig = async (mode = "LINEAR") => {
  const f = rig(mode);
  return (await importGltfToGpuModelDocument(rigBytes(f), rigOptions(f)))
    .document;
};
async function unpack(out: Awaited<ReturnType<typeof exportGpuModelToGltf>>) {
  const files = Object.fromEntries(
    await Promise.all(
      out.resources.map(async (r) => [
        r.path,
        new Uint8Array(await r.payload.arrayBuffer()),
      ]),
    ),
  );
  const entry = files[out.entryPoint]!;
  const parsed =
    out.format === "gltf"
      ? JSON.parse(new TextDecoder().decode(entry))
      : JSON.parse(
          new TextDecoder()
            .decode(
              entry.slice(
                20,
                20 + new DataView(entry.buffer).getUint32(12, true),
              ),
            )
            .trim(),
        );
  return { files, entry, parsed };
}
async function roundtrip(
  out: Awaited<ReturnType<typeof exportGpuModelToGltf>>,
) {
  const { files, entry } = await unpack(out);
  return (
    await importGltfToGpuModelDocument(entry, {
      conversionEnabled: true,
      profile: "gltf-deformation-resources-v1",
      resourceResolver: resolver(files),
    })
  ).document;
}

describe("canonical edit export", () => {
  it.each(["glb", "gltf"] as const)(
    "exports deterministic %s packages with exact integrity and relative references",
    async (format) => {
      const document = await importRig();
      const a = await exportGpuModelToGltf(document, {
        conversionEnabled: true,
        format,
      });
      const b = await exportGpuModelToGltf(document, {
        conversionEnabled: true,
        format,
      });
      expect(a.entryPoint).toBe(format === "glb" ? "model.glb" : "model.gltf");
      expect(a.validator.id).toBe("KhronosGroup/glTF-Validator");
      expect(
        a.resources.map((r) => [r.path, r.contentHash, r.byteLength]),
      ).toEqual(b.resources.map((r) => [r.path, r.contentHash, r.byteLength]));
      for (let i = 0; i < a.resources.length; i++) {
        const r = a.resources[i]!;
        const bytes = await r.payload.arrayBuffer();
        expect(r.byteLength).toBe(bytes.byteLength);
        expect(r.contentHash).toBe(
          Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString(
            "hex",
          ),
        );
        expect(new Uint8Array(bytes)).toEqual(
          new Uint8Array(await b.resources[i]!.payload.arrayBuffer()),
        );
        expect(r.path).toMatch(
          /^(?:model\.(?:gltf|glb|bin)|images\/image-\d+\.(?:png|jpg))$/,
        );
      }
      const { parsed, files } = await unpack(a);
      if (format === "gltf") {
        expect(parsed.buffers[0].uri).toBe("model.bin");
        for (const image of parsed.images)
          expect(files[image.uri]).toBeDefined();
      } else expect(a.resources).toHaveLength(1);
      const result = await roundtrip(a);
      expect(result.bounds).toEqual(document.bounds);
      expect(result.materials.map((m) => m.baseColorFactor)).toEqual(
        document.materials.map((m) => m.baseColorFactor),
      );
      expect(result.textures.map((t) => t.contentHash)).toEqual(
        document.textures.map((t) => t.contentHash),
      );
    },
  );
  it("exports verified geometry, animation, morph and bind-pose edits without replaying source bytes", async () => {
    const original = await importRig();
    const positionId = original.meshes[0]!.primitives[0]!.attributes.find(
      (a) => a.semantic === "POSITION",
    )!.accessorId;
    const position = original.accessors.find((a) => a.id === positionId)!;
    const animationOutput = original.accessors.find(
      (a) => a.id === original.animations[0]!.samplers[0]!.outputAccessorId,
    )!;
    const resource = original.resources.find(
      (r) => r.id === position.resourceId,
    )!;
    const bytes = new Uint8Array(await resource.payload.arrayBuffer()),
      view = new DataView(bytes.buffer);
    for (let v = 0; v < position.count; v++)
      view.setFloat32(
        position.byteOffset + v * 12,
        view.getFloat32(position.byteOffset + v * 12, true) + 0.5,
        true,
      );
    for (let v = 0; v < animationOutput.count; v++)
      view.setFloat32(
        animationOutput.byteOffset + v * 12 + 8,
        view.getFloat32(animationOutput.byteOffset + v * 12 + 8, true) + 0.25,
        true,
      );
    const hash = Buffer.from(
      await crypto.subtle.digest("SHA-256", bytes),
    ).toString("hex");
    const verified = await verifyGpuModelResource(
      { ...resource, contentHash: hash, payload: new Blob([bytes]) },
      {
        digestSha256: async (chunks) => {
          const parts = [];
          for await (const chunk of chunks) parts.push(Buffer.from(chunk));
          return Buffer.from(
            await crypto.subtle.digest("SHA-256", Buffer.concat(parts)),
          ).toString("hex");
        },
        inspectResource: async (chunks) => {
          for await (const chunk of chunks)
            expect(chunk.length).toBeGreaterThan(0);
          return { valid: true, detectedMimeType: "application/octet-stream" };
        },
      },
    );
    const d = createGpuModelDocument({
      ...original,
      accessors: original.accessors.map((a) =>
        [position.id, animationOutput.id].includes(a.id)
          ? {
              ...a,
              min: a.min!.map((n, i) =>
                i === (a.id === position.id ? 0 : 2)
                  ? n + (a.id === position.id ? 0.5 : 0.25)
                  : n,
              ),
              max: a.max!.map((n, i) =>
                i === (a.id === position.id ? 0 : 2)
                  ? n + (a.id === position.id ? 0.5 : 0.25)
                  : n,
              ),
            }
          : a,
      ),
      resources: original.resources.map((r) =>
        r.id === resource.id ? verified : r,
      ),
      bounds: {
        min: [original.bounds.min[0] + 0.5, ...original.bounds.min.slice(1)],
        max: [original.bounds.max[0] + 0.5, ...original.bounds.max.slice(1)],
      },
      animations: original.animations.map((a) => ({
        ...a,
        samplers: a.samplers.map((s, i) =>
          i
            ? s
            : {
                ...s,
                outputValues: s.outputValues.map((n, i) =>
                  i % 3 === 2 ? n + 0.25 : n,
                ),
              },
        ),
      })),
      blendShapes: original.blendShapes.map((s) => ({
        ...s,
        defaultWeight: (s.defaultWeight ?? 0) + 0.25,
      })),
      joints: original.joints.map((j) => ({
        ...j,
        inverseBindMatrix: j.inverseBindMatrix!.map((n, i) =>
          i === 12 ? n + 0.25 : n,
        ),
      })),
      skins: original.skins.map((s) => ({
        ...s,
        inverseBindMatrices: s.inverseBindMatrices.map((m) =>
          m.map((n, i) => (i === 12 ? n + 0.25 : n)),
        ),
      })),
    });
    const result = await roundtrip(
      await exportGpuModelToGltf(d, { conversionEnabled: true }),
    );
    expect(result.animations[0]!.samplers[0]!.outputValues).toEqual(
      d.animations[0]!.samplers[0]!.outputValues,
    );
    expect(result.skins[0]!.inverseBindMatrices).toEqual(
      d.skins[0]!.inverseBindMatrices,
    );
    expect(result.blendShapes.map((s) => s.defaultWeight)).toEqual(
      d.blendShapes.map((s) => s.defaultWeight),
    );
    const rp = result.accessors.find(
      (a) =>
        a.id ===
        result.meshes[0]!.primitives[0]!.attributes.find(
          (a) => a.semantic === "POSITION",
        )!.accessorId,
    )!;
    const rv = new DataView(
      await result.resources
        .find((r) => r.id === rp.resourceId)!
        .payload.arrayBuffer(),
    );
    for (let v = 0; v < position.count; v++)
      expect(rv.getFloat32(rp.byteOffset + v * 12, true)).toBe(
        view.getFloat32(position.byteOffset + v * 12, true),
      );
  });
  it("serializes edited canonical values rather than old normalized source or adapter metadata", async () => {
    const original = await importRig();
    const document = createGpuModelDocument({
      ...original,
      materials: original.materials.map((m) => ({
        ...m,
        baseColorFactor: [0.2, 0.3, 0.4, 0.5],
      })),
      metadata: { private: "PRIVATE provider URI" },
      provenance: {
        ...original.provenance,
        sourceIdentifier: "PRIVATE provider URI",
      },
    });
    const out = await exportGpuModelToGltf(document, {
      conversionEnabled: true,
    });
    const { parsed } = await unpack(out);
    expect(parsed.materials[0].pbrMetallicRoughness.baseColorFactor).toEqual([
      0.2, 0.3, 0.4, 0.5,
    ]);
    expect(JSON.stringify(parsed)).not.toContain("PRIVATE");
    expect((await roundtrip(out)).materials[0]!.baseColorFactor).toEqual([
      0.2, 0.3, 0.4, 0.5,
    ]);
  });
  it.each(["STEP", "LINEAR", "CUBICSPLINE"])(
    "preserves %s tracks, morphs, skins, signed TRS and sampler data",
    async (mode) => {
      const document = await importRig(mode);
      const out = await exportGpuModelToGltf(document, {
        conversionEnabled: true,
      });
      const result = await roundtrip(out);
      expect(
        result.animations.map((a) =>
          a.samplers.map((s) => ({
            times: s.inputTimesSeconds,
            values: s.outputValues,
            interpolation: s.interpolation,
          })),
        ),
      ).toEqual(
        document.animations.map((a) =>
          a.samplers.map((s) => ({
            times: s.inputTimesSeconds,
            values: s.outputValues,
            interpolation: s.interpolation,
          })),
        ),
      );
      expect(
        result.skins.map((s) => ({
          ibm: s.inverseBindMatrices,
          weights: s.weightSets,
        })),
      ).toEqual(
        document.skins.map((s) => ({
          ibm: s.inverseBindMatrices,
          weights: s.weightSets,
        })),
      );
      expect(
        result.blendShapes.map((s) => ({
          name: s.name,
          weight: s.defaultWeight,
        })),
      ).toEqual(
        document.blendShapes.map((s) => ({
          name: s.name,
          weight: s.defaultWeight,
        })),
      );
      expect(
        result.nodes.filter((n) => n.morphWeights).map((n) => n.morphWeights),
      ).toEqual(
        document.nodes.filter((n) => n.morphWeights).map((n) => n.morphWeights),
      );
    },
  );
  it("preserves extension factors, UV transforms and sampler/normal/occlusion interpretation", async () => {
    const f = extended();
    f.json.materials[0].pbrMetallicRoughness.baseColorTexture.extensions = {
      KHR_texture_transform: {
        offset: [0.2, 0.3],
        scale: [2, -1],
        rotation: 0.4,
      },
    };
    f.json.extensionsUsed.push("KHR_texture_transform");
    f.json.samplers = [
      { wrapS: 33071, wrapT: 33648, minFilter: 9986, magFilter: 9728 },
    ];
    f.json.textures[0].sampler = 0;
    const document = (
      await importGltfToGpuModelDocument(
        encoder.encode(JSON.stringify(f.json)),
        options(f),
      )
    ).document;
    const result = await roundtrip(
      await exportGpuModelToGltf(document, {
        conversionEnabled: true,
        format: "gltf",
      }),
    );
    const materialValues = (d: typeof document) =>
      d.materials.map((m) => ({
        ...m,
        textures: Object.fromEntries(
          Object.entries(m.textures).map(([slot, b]) => [
            slot,
            {
              ...b,
              textureId: d.textures.find((t) => t.id === b.textureId)!
                .contentHash,
            },
          ]),
        ),
      }));
    expect(materialValues(result)).toEqual(materialValues(document));
    expect(
      result.textures.map(({ id: _id, sampler, ...t }) => ({
        ...t,
        sampler: sampler && { ...sampler, id: "sampler" },
      })),
    ).toEqual(
      document.textures.map(({ id: _id, sampler, ...t }) => ({
        ...t,
        sampler: sampler && { ...sampler, id: "sampler" },
      })),
    );
  });
  it("preserves low-level static import/export compatibility", async () => {
    const f = extended();
    const document = (
      await importGltfToGpuModelDocument(
        encoder.encode(JSON.stringify(f.json)),
        options(f),
      )
    ).document;
    expect(
      (await exportGpuModelToGltf(document, { conversionEnabled: true }))
        .format,
    ).toBe("glb");
  });
  it("fails closed on disabled, malformed options, and unbranded documents", async () => {
    const document = await importRig();
    await expect(
      exportGpuModelToGltf(document, { conversionEnabled: false }),
    ).rejects.toSatisfy(code("feature-disabled"));
    await expect(
      exportGpuModelToGltf(document, {
        conversionEnabled: true,
        format: "bad" as "glb",
      }),
    ).rejects.toSatisfy(code("invalid-adapter-options"));
    await expect(
      exportGpuModelToGltf({ ...document }, { conversionEnabled: true }),
    ).rejects.toSatisfy(code("canonical-model-core-rejected"));
  });
  it("honors cancellation before work and tightening-only memory/output/work limits", async () => {
    const document = await importRig();
    const c = new AbortController();
    c.abort();
    await expect(
      exportGpuModelToGltf(document, {
        conversionEnabled: true,
        signal: c.signal,
      }),
    ).rejects.toSatisfy(code("aborted"));
    for (const limits of [
      { maxAggregateBytes: 1 },
      { maxInputBytes: 1 },
      { maxGeometryElements: 1 },
      { maxNodes: 1 },
      { maxResources: 1 },
      { maxSkins: 1, maxJoints: 1 },
    ])
      await expect(
        exportGpuModelToGltf(document, { conversionEnabled: true, limits }),
      ).rejects.toBeDefined();
    await expect(
      exportGpuModelToGltf(document, {
        conversionEnabled: true,
        limits: { maxAggregateBytes: Number.MAX_SAFE_INTEGER },
      }),
    ).rejects.toSatisfy(code("invalid-limits"));
  });
  it("rejects unsupported topology, forbidden embedding and analytic geometry explicitly", async () => {
    const original = await importRig();
    const lines = createGpuModelDocument({
      ...original,
      meshes: original.meshes.map((m) => ({
        ...m,
        primitives: m.primitives.map((p) => ({ ...p, topology: "points" })),
      })),
    });
    await expect(
      exportGpuModelToGltf(lines, { conversionEnabled: true }),
    ).rejects.toSatisfy(code("unsupported-gltf-feature"));
    const forbidden = createGpuModelDocument({
      ...original,
      textures: original.textures.map((t) => ({
        ...t,
        exportEmbeddingPolicy: "forbid-embedding",
      })),
    });
    await expect(
      exportGpuModelToGltf(forbidden, { conversionEnabled: true }),
    ).rejects.toSatisfy(code("unsupported-gltf-feature"));
    expect(
      (
        await exportGpuModelToGltf(forbidden, {
          conversionEnabled: true,
          format: "gltf",
        })
      ).entryPoint,
    ).toBe("model.gltf");
    expect(identity).toHaveLength(16);
  });
});
