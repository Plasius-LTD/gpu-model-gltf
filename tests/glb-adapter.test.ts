import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import {
  DEFAULT_GLB_LIMITS,
  GLB_ADAPTER_VERSION,
  GLB_FIXED_WORKING_SET_BYTES,
  GLB_JSON_WORKING_SET_MULTIPLIER,
  GLB_WORKING_SET_MULTIPLIER,
  GlbAdapterError,
  glbAdapter,
  packageBootstrap,
  packageName,
  sniffGlb,
  validateAndExportGlb,
} from "../src/index.js";
import goldenTriangle from "./fixtures/minimal-triangle.fixture.json" with { type: "json" };

type JsonRecord = Record<string, unknown>;

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

function align4(value: number): number {
  return (value + 3) & ~3;
}

function encodeChunk(type: number, payload: Uint8Array, padding = type === JSON_CHUNK ? 0x20 : 0): Uint8Array {
  const paddedLength = align4(payload.byteLength);
  const chunk = new Uint8Array(8 + paddedLength);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, paddedLength, true);
  view.setUint32(4, type, true);
  chunk.set(payload, 8);
  chunk.fill(padding, 8 + payload.byteLength);
  return chunk;
}

function createRawGlb(chunks: readonly Uint8Array[]): Uint8Array {
  const length = 12 + chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const output = new Uint8Array(length);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, length, true);
  let offset = 12;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function createGlb(document: JsonRecord, binary?: Uint8Array): Uint8Array {
  const chunks = [encodeChunk(JSON_CHUNK, new TextEncoder().encode(JSON.stringify(document)))];
  if (binary) chunks.push(encodeChunk(BIN_CHUNK, binary));
  return createRawGlb(chunks);
}

function triangleDocument(overrides: JsonRecord = {}): JsonRecord {
  return {
    asset: { version: "2.0", generator: "Plasius test fixture" },
    buffers: [{ byteLength: 42 }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
      { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
      {
        bufferView: 1,
        componentType: 5123,
        count: 3,
        type: "SCALAR",
        min: [0],
        max: [2],
      },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
    ...overrides,
  };
}

function triangleBinary(): Uint8Array {
  const bytes = new Uint8Array(42);
  const view = new DataView(bytes.buffer);
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  positions.forEach((value, index) => view.setFloat32(index * 4, value, true));
  [0, 1, 2].forEach((value, index) => view.setUint16(36 + index * 2, value, true));
  return bytes;
}

function triangleGlb(document = triangleDocument(), binary = triangleBinary()): Uint8Array {
  return createGlb(document, binary);
}

function onePixelPng(): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, 1, false);
  view.setUint32(4, 1, false);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Uint8Array.of(
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...pngChunk("IHDR", ihdr),
    ...pngChunk("IDAT", deflateSync(Uint8Array.of(0, 255, 255, 255, 255))),
    ...pngChunk("IEND", new Uint8Array()),
  );
}

function pngCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const output = new Uint8Array(12 + data.byteLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, data.byteLength, false);
  output.set(typeBytes, 4);
  output.set(data, 8);
  view.setUint32(8 + data.byteLength, pngCrc32(output.subarray(4, 8 + data.byteLength)), false);
  return output;
}

function pngWithEmptyImageData(): Uint8Array {
  const source = onePixelPng();
  const ihdr = source.subarray(8, 33);
  return Uint8Array.of(
    ...source.subarray(0, 8),
    ...ihdr,
    ...pngChunk("IDAT", new Uint8Array()),
    ...pngChunk("IEND", new Uint8Array()),
  );
}

function pngWithCorruptCompressedData(): Uint8Array {
  const source = onePixelPng();
  const output = new Uint8Array(source);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  let offset = 8;
  while (offset < output.byteLength) {
    const length = view.getUint32(offset, false);
    const type = new TextDecoder().decode(output.subarray(offset + 4, offset + 8));
    const crcOffset = offset + 8 + length;
    if (type === "IDAT" && length > 0) {
      output[offset + 8] = (output[offset + 8] ?? 0) ^ 0xff;
      view.setUint32(crcOffset, pngCrc32(output.subarray(offset + 4, crcOffset)), false);
      return output;
    }
    offset = crcOffset + 4;
  }
  throw new Error("PNG test fixture has no IDAT bytes.");
}

function indexedPngWithOutOfRangePixel(): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, 1, false);
  view.setUint32(4, 1, false);
  ihdr.set([1, 3, 0, 0, 0], 8);
  return Uint8Array.of(
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...pngChunk("IHDR", ihdr),
    ...pngChunk("PLTE", Uint8Array.of(0, 0, 0)),
    ...pngChunk("IDAT", deflateSync(Uint8Array.of(0, 0x80))),
    ...pngChunk("IEND", new Uint8Array()),
  );
}

function pngWithDimensions(width: number, height: number, repairCrc = true): Uint8Array {
  const png = onePixelPng();
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  if (repairCrc) {
    view.setUint32(29, pngCrc32(png.subarray(12, 29)), false);
  }
  return png;
}

function boundedJpegHeader(width: number, height: number): Uint8Array {
  return Uint8Array.of(
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    0x00,
    0xff, 0xd9,
  );
}

function imageDocument(bytes: Uint8Array, mimeType: string, imageCount = 1): JsonRecord {
  return {
    asset: { version: "2.0" },
    buffers: [{ byteLength: bytes.byteLength }],
    bufferViews: [{ buffer: 0, byteLength: bytes.byteLength }],
    images: Array.from({ length: imageCount }, () => ({ bufferView: 0, mimeType })),
  };
}

async function outputBytes(result: Awaited<ReturnType<typeof validateAndExportGlb>>): Promise<Uint8Array> {
  return new Uint8Array(await result.output.arrayBuffer());
}

function expectCode(code: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof GlbAdapterError && error.code === code;
}

describe("package surface", () => {
  it("preserves package identity while exposing the feature-gated runtime adapter", () => {
    expect(packageName).toBe("@plasius/gpu-model-gltf");
    expect(packageBootstrap.featureFlag).toBe("gpu.model.conversion.enabled");
    expect(GLB_ADAPTER_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.v\d+$/u);
    expect(glbAdapter).toMatchObject({ formatId: "gltf", supportsWorker: true });
  });

  it("sniffs GLB magic without trusting extension or MIME alone", () => {
    const bytes = triangleGlb();
    expect(sniffGlb({ bytes, sourceKind: "uint8-array" })).toBeGreaterThan(0);
    expect(sniffGlb({
      bytes: new TextEncoder().encode('{"asset":{"version":"2.0"}}'),
      contentType: "model/gltf-binary",
      fileName: "spoof.glb",
      sourceKind: "uint8-array",
    })).toBe(0);
    expect(sniffGlb({ bytes: new Uint8Array(4), sourceKind: "uint8-array" })).toBe(0);
  });
});

describe("strict GLB validation and deterministic export", () => {
  it("validates a golden uncompressed triangle and returns immutable evidence", async () => {
    const binary = Uint8Array.from(atob(goldenTriangle.binaryBase64), (character) => character.charCodeAt(0));
    const source = createGlb(goldenTriangle.document as JsonRecord, binary);
    const result = await validateAndExportGlb(source, {
      contentType: "model/gltf-binary",
      fileName: "triangle.glb",
    });

    expect(result).toMatchObject({
      format: "glb",
      glbVersion: 2,
      mimeType: "model/gltf-binary",
      sourceByteLength: source.byteLength,
      converterEvidence: {
        id: "gltf-glb-adapter",
        version: GLB_ADAPTER_VERSION,
        sourceFormat: "glb",
        targetFormat: "glb",
        losses: [],
      },
      resources: { bufferByteLength: 42, imageCount: 0, imageByteLength: 0 },
    });
    expect(result.sourceContentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.outputContentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.outputContentHash).toBe("6d20d45a1209f61a89a3a6309401cde64f0d5600689bae7fd7527065b4fd3c0d");
    expect(result.output.type).toBe("model/gltf-binary");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.document)).toBe(true);

    const roundTrip = await validateAndExportGlb(await outputBytes(result));
    expect(await outputBytes(roundTrip)).toEqual(await outputBytes(result));
    expect(roundTrip.outputContentHash).toBe(result.outputContentHash);
  });

  it("canonicalizes JSON key order without changing exact source evidence", async () => {
    const canonical = triangleDocument();
    const reversed = Object.fromEntries(Object.entries(canonical).reverse());
    const left = await validateAndExportGlb(triangleGlb(canonical));
    const right = await validateAndExportGlb(triangleGlb(reversed));

    expect(left.sourceContentHash).not.toBe(right.sourceContentHash);
    expect(left.outputContentHash).toBe(right.outputContentHash);
    expect(await outputBytes(left)).toEqual(await outputBytes(right));
    expect(left.converterEvidence.diagnostics).toContainEqual(expect.objectContaining({
      code: "deterministic-glb-export",
      severity: "info",
    }));
  });

  it("binds hashes and output to the private source snapshot", async () => {
    const pristine = triangleGlb();
    const mutable = new Uint8Array(pristine);
    const expected = await validateAndExportGlb(pristine);
    const pending = validateAndExportGlb(mutable);
    mutable.fill(0);
    const actual = await pending;

    expect(actual.sourceContentHash).toBe(expected.sourceContentHash);
    expect(actual.outputContentHash).toBe(expected.outputContentHash);
    expect(await outputBytes(actual)).toEqual(await outputBytes(expected));
  });

  it("preserves bounded validator findings ahead of synthetic export diagnostics", async () => {
    const binary = new Uint8Array(4);
    const result = await validateAndExportGlb(createGlb({
      asset: { version: "2.0" },
      buffers: [{ byteLength: binary.byteLength }],
      bufferViews: [{ buffer: 0, byteLength: binary.byteLength }],
      scenes: [{}],
      scene: 0,
    }, binary), { limits: { maxDiagnostics: 1 } });

    expect(result.validator.issueCount).toBeGreaterThan(0);
    expect(result.converterEvidence.diagnostics).toHaveLength(1);
    expect(result.converterEvidence.diagnostics[0]?.code).not.toBe("deterministic-glb-export");
  });

  it("supports empty, self-contained GLBs with no binary chunk", async () => {
    const result = await validateAndExportGlb(createGlb({
      asset: { version: "2.0" },
      scenes: [{}],
      scene: 0,
    }));
    expect(result.resources).toEqual({
      bufferByteLength: 0,
      imageCount: 0,
      imageByteLength: 0,
      imageDecodedByteLength: 0,
    });
  });

  it("accepts an ArrayBuffer and normalized octet-stream source hints", async () => {
    const source = triangleGlb();
    const result = await validateAndExportGlb(Uint8Array.from(source).buffer, {
      contentType: "Application/Octet-Stream; charset=binary",
      fileName: "TRIANGLE.GLB",
      mode: "strict",
    });
    expect(result.sourceByteLength).toBe(source.byteLength);
  });

  it("honours cancellation before work starts", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(validateAndExportGlb(triangleGlb(), { signal: controller.signal }))
      .rejects.toSatisfy(expectCode("aborted"));
  });
});

describe("GLB container admission", () => {
  it.each([
    ["short header", new Uint8Array(11), "invalid-glb-header"],
    ["bad magic", (() => { const bytes = triangleGlb(); bytes[0] = 0; return bytes; })(), "invalid-glb-header"],
    ["unsupported version", (() => { const bytes = triangleGlb(); new DataView(bytes.buffer).setUint32(4, 3, true); return bytes; })(), "unsupported-glb-version"],
    ["declared length mismatch", (() => { const bytes = triangleGlb(); new DataView(bytes.buffer).setUint32(8, bytes.byteLength - 4, true); return bytes; })(), "invalid-glb-header"],
    ["missing JSON chunk", createRawGlb([encodeChunk(BIN_CHUNK, new Uint8Array(4))]), "invalid-glb-chunk"],
    ["unknown chunk", createRawGlb([
      encodeChunk(JSON_CHUNK, new TextEncoder().encode('{"asset":{"version":"2.0"}}')),
      encodeChunk(0x12345678, new Uint8Array(4)),
    ]), "unsupported-glb-chunk"],
    ["duplicate JSON chunk", createRawGlb([
      encodeChunk(JSON_CHUNK, new TextEncoder().encode('{"asset":{"version":"2.0"}}')),
      encodeChunk(JSON_CHUNK, new TextEncoder().encode('{"asset":{"version":"2.0"}}')),
    ]), "invalid-glb-chunk"],
    ["invalid JSON", createRawGlb([encodeChunk(JSON_CHUNK, new TextEncoder().encode("{nope"))]), "invalid-gltf-json"],
    ["invalid UTF-8", createRawGlb([encodeChunk(JSON_CHUNK, Uint8Array.of(0xff, 0xff, 0xff, 0xff))]), "invalid-gltf-json"],
  ])("rejects %s", async (_name, bytes, code) => {
    await expect(validateAndExportGlb(bytes)).rejects.toSatisfy(expectCode(code));
  });

  it("rejects truncated chunk payloads and non-aligned chunks", async () => {
    const truncated = triangleGlb();
    new DataView(truncated.buffer).setUint32(12, 0xfffffffc, true);
    await expect(validateAndExportGlb(truncated)).rejects.toSatisfy(expectCode("invalid-glb-chunk"));

    const nonAligned = triangleGlb();
    new DataView(nonAligned.buffer).setUint32(12, 3, true);
    await expect(validateAndExportGlb(nonAligned)).rejects.toSatisfy(expectCode("invalid-glb-chunk"));

    const partialHeader = new Uint8Array(16);
    const partialView = new DataView(partialHeader.buffer);
    partialView.setUint32(0, 0x46546c67, true);
    partialView.setUint32(4, 2, true);
    partialView.setUint32(8, partialHeader.byteLength, true);
    await expect(validateAndExportGlb(partialHeader)).rejects.toSatisfy(expectCode("invalid-glb-chunk"));

    const zeroLength = triangleGlb();
    new DataView(zeroLength.buffer).setUint32(12, 0, true);
    await expect(validateAndExportGlb(zeroLength)).rejects.toSatisfy(expectCode("invalid-glb-chunk"));
  });

  it("rejects duplicate BIN chunks, byte-order marks, and non-object roots", async () => {
    const json = encodeChunk(JSON_CHUNK, new TextEncoder().encode('{"asset":{"version":"2.0"}}'));
    await expect(validateAndExportGlb(createRawGlb([
      json,
      encodeChunk(BIN_CHUNK, new Uint8Array(4)),
      encodeChunk(BIN_CHUNK, new Uint8Array(4)),
    ]))).rejects.toSatisfy(expectCode("invalid-glb-chunk"));

    const bomJson = Uint8Array.of(0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"asset":{"version":"2.0"}}'));
    await expect(validateAndExportGlb(createRawGlb([encodeChunk(JSON_CHUNK, bomJson)])))
      .rejects.toSatisfy(expectCode("invalid-gltf-json"));
    await expect(validateAndExportGlb(createRawGlb([encodeChunk(JSON_CHUNK, new TextEncoder().encode("[]"))])))
      .rejects.toSatisfy(expectCode("invalid-gltf-document"));
    const duplicateKey = new TextEncoder().encode('{"asset":{"version":"1.0","version":"2.0"}}');
    await expect(validateAndExportGlb(createRawGlb([encodeChunk(JSON_CHUNK, duplicateKey)])))
      .rejects.toSatisfy(expectCode("unsafe-gltf-json"));
  });

  it("rejects MIME, filename, and GLB magic mismatches", async () => {
    await expect(validateAndExportGlb(triangleGlb(), { contentType: "model/gltf+json" }))
      .rejects.toSatisfy(expectCode("source-type-mismatch"));
    await expect(validateAndExportGlb(triangleGlb(), { fileName: "triangle.gltf" }))
      .rejects.toSatisfy(expectCode("source-type-mismatch"));
  });
});

describe("closed resource and feature policy", () => {
  it.each([
    ["relative traversal buffer", triangleDocument({ buffers: [{ uri: "../mesh.bin", byteLength: 42 }] })],
    ["absolute buffer URL", triangleDocument({ buffers: [{ uri: "https://invalid.example/mesh.bin", byteLength: 42 }] })],
    ["data URI buffer", triangleDocument({ buffers: [{ uri: "data:application/octet-stream;base64,AAAA", byteLength: 3 }] })],
    ["relative image", triangleDocument({ images: [{ uri: "texture.png" }] })],
  ])("rejects %s without invoking a resolver", async (_name, document) => {
    await expect(validateAndExportGlb(triangleGlb(document)))
      .rejects.toSatisfy(expectCode("external-resource-forbidden"));
  });

  it.each([
    ["extensions", triangleDocument({ extensionsUsed: ["KHR_draco_mesh_compression"] })],
    ["animation", triangleDocument({ animations: [{ channels: [], samplers: [] }] })],
    ["skin", triangleDocument({ skins: [{ joints: [0] }] })],
    ["morph target", triangleDocument({ meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, targets: [{ POSITION: 0 }] }] }] })],
    ["sparse accessor", triangleDocument({ accessors: [{ ...((triangleDocument().accessors as JsonRecord[])[0]), sparse: { count: 1 } }, (triangleDocument().accessors as JsonRecord[])[1]] })],
    ["line primitive", triangleDocument({ meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 1 }] }] })],
  ])("fails closed for unsupported %s", async (_name, document) => {
    await expect(validateAndExportGlb(triangleGlb(document)))
      .rejects.toSatisfy(expectCode("unsupported-gltf-feature"));
  });

  it("validates embedded image MIME against magic bytes", async () => {
    const pngHeader = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);
    const document = {
      asset: { version: "2.0" },
      buffers: [{ byteLength: pngHeader.byteLength }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pngHeader.byteLength }],
      images: [{ bufferView: 0, mimeType: "image/jpeg" }],
    };
    await expect(validateAndExportGlb(createGlb(document, pngHeader)))
      .rejects.toSatisfy(expectCode("image-mime-mismatch"));
  });

  it("accepts a valid embedded PNG and accounts for its immutable bytes", async () => {
    const png = onePixelPng();
    const result = await validateAndExportGlb(createGlb(imageDocument(png, "image/png"), png));
    expect(result.resources).toEqual({
      bufferByteLength: png.byteLength,
      imageCount: 1,
      imageByteLength: png.byteLength,
      imageDecodedByteLength: 4,
    });
  });

  it("rejects CRC-valid but undecodable PNG image data", async () => {
    for (const png of [pngWithEmptyImageData(), pngWithCorruptCompressedData()]) {
      await expect(validateAndExportGlb(createGlb(imageDocument(png, "image/png"), png)))
        .rejects.toSatisfy(expectCode("invalid-image-resource"));
    }
  });

  it("fails closed for indexed PNGs until palette indices are fully decoded", async () => {
    const png = indexedPngWithOutOfRangePixel();
    await expect(validateAndExportGlb(createGlb(imageDocument(png, "image/png"), png)))
      .rejects.toSatisfy(expectCode("unsupported-gltf-feature"));
  });

  it("bounds PNG chunk fan-out before retaining image-data slices", async () => {
    const source = onePixelPng();
    const png = Uint8Array.of(
      ...source.subarray(0, 33),
      ...pngChunk("tEXt", new Uint8Array()),
      ...source.subarray(33),
    );
    await expect(validateAndExportGlb(createGlb(imageDocument(png, "image/png"), png), {
      limits: { maxPngChunks: 3 },
    })).rejects.toSatisfy(expectCode("document-resource-limit"));
  });

  it("rejects corrupt and oversized PNG dimensions before texture decoding", async () => {
    const corrupt = pngWithDimensions(8_192, 1, false);
    await expect(validateAndExportGlb(createGlb(imageDocument(corrupt, "image/png"), corrupt)))
      .rejects.toSatisfy(expectCode("invalid-image-resource"));

    const oversized = pngWithDimensions(8_192, 1);
    await expect(validateAndExportGlb(createGlb(imageDocument(oversized, "image/png"), oversized)))
      .rejects.toSatisfy(expectCode("image-dimension-limit"));

    const decodedBudget = pngWithDimensions(4_096, 4_096);
    await expect(validateAndExportGlb(createGlb(imageDocument(decodedBudget, "image/png"), decodedBudget), {
      limits: { maxDecodedImageBytes: 1024 },
    })).rejects.toSatisfy(expectCode("image-dimension-limit"));
  });

  it("rejects invalid image magic, unsupported MIME, and image budgets", async () => {
    const invalid = Uint8Array.of(1, 2, 3, 4);
    await expect(validateAndExportGlb(createGlb(imageDocument(invalid, "image/png"), invalid)))
      .rejects.toSatisfy(expectCode("invalid-image-resource"));

    const png = onePixelPng();
    await expect(validateAndExportGlb(createGlb(imageDocument(png, "image/webp"), png)))
      .rejects.toSatisfy(expectCode("unsupported-gltf-feature"));
    await expect(validateAndExportGlb(createGlb(imageDocument(png, "image/png"), png), {
      limits: { maxImageBytes: png.byteLength - 1 },
    })).rejects.toSatisfy(expectCode("document-resource-limit"));
    await expect(validateAndExportGlb(createGlb(imageDocument(png, "image/png", 2), png), {
      limits: { maxAggregateImageBytes: png.byteLength },
    })).rejects.toSatisfy(expectCode("document-resource-limit"));
  });

  it("fails closed for JPEG until a bounded full decoder is released", async () => {
    for (const jpeg of [boundedJpegHeader(1, 1), boundedJpegHeader(8_192, 1)]) {
      await expect(validateAndExportGlb(createGlb(imageDocument(jpeg, "image/jpeg"), jpeg)))
        .rejects.toSatisfy(expectCode("unsupported-gltf-feature"));
    }
  });
});

describe("geometry and dependency validation", () => {
  it("rejects non-finite accessor payloads", async () => {
    const binary = triangleBinary();
    new DataView(binary.buffer).setUint32(0, 0x7fc00000, true);
    await expect(validateAndExportGlb(triangleGlb(triangleDocument(), binary)))
      .rejects.toSatisfy(expectCode("non-finite-accessor"));
  });

  it("rejects accessors and images outside declared buffer bounds", async () => {
    const accessors = triangleDocument().accessors as JsonRecord[];
    await expect(validateAndExportGlb(triangleGlb(triangleDocument({
      accessors: [{ ...accessors[0], count: 4 }, accessors[1]],
    })))).rejects.toSatisfy(expectCode("accessor-out-of-bounds"));

    await expect(validateAndExportGlb(triangleGlb(triangleDocument({
      images: [{ bufferView: 99, mimeType: "image/png" }],
    })))).rejects.toSatisfy(expectCode("missing-gltf-dependency"));
  });

  it("fails on Khronos validator errors not covered by the bounded preflight", async () => {
    await expect(validateAndExportGlb(triangleGlb(triangleDocument({
      nodes: [{ mesh: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], translation: [0, 0, 0] }],
    })))).rejects.toSatisfy(expectCode("gltf-spec-validation-failed"));
  });

  it("supports bounded strided and zero-initialized accessor layouts", async () => {
    const binary = new Uint8Array(8);
    const document = {
      asset: { version: "2.0" },
      buffers: [{ byteLength: 8 }],
      bufferViews: [{ buffer: 0, byteLength: 8, byteStride: 4 }],
      accessors: [
        { bufferView: 0, byteOffset: 4, componentType: 5126, count: 1, type: "SCALAR" },
        { componentType: 5121, count: 1, type: "MAT2" },
        { componentType: 5121, count: 1, type: "MAT3" },
        { componentType: 5123, count: 1, type: "MAT3" },
      ],
    };
    const result = await validateAndExportGlb(createGlb(document, binary));
    expect(result.resources.bufferByteLength).toBe(8);
  });

  it("rejects malformed accessor components, dependencies, and strides", async () => {
    const accessors = triangleDocument().accessors as JsonRecord[];
    await expect(validateAndExportGlb(triangleGlb(triangleDocument({
      accessors: [{ ...accessors[0], componentType: 999 }, accessors[1]],
    })))).rejects.toSatisfy(expectCode("invalid-gltf-document"));
    await expect(validateAndExportGlb(triangleGlb(triangleDocument({
      accessors: [{ ...accessors[0], type: null }, accessors[1]],
    })))).rejects.toSatisfy(expectCode("invalid-gltf-document"));
    await expect(validateAndExportGlb(triangleGlb(triangleDocument({
      accessors: [{ ...accessors[0], bufferView: 99 }, accessors[1]],
    })))).rejects.toSatisfy(expectCode("missing-gltf-dependency"));

    const views = triangleDocument().bufferViews as JsonRecord[];
    await expect(validateAndExportGlb(triangleGlb(triangleDocument({
      bufferViews: [{ ...views[0], byteStride: 8 }, views[1]],
    })))).rejects.toSatisfy(expectCode("accessor-out-of-bounds"));
  });
});

describe("bounded processing", () => {
  it("rejects attempts to raise hard defaults", async () => {
    await expect(validateAndExportGlb(triangleGlb(), {
      limits: { maxInputBytes: DEFAULT_GLB_LIMITS.maxInputBytes + 1 },
    })).rejects.toSatisfy(expectCode("invalid-limits"));
  });

  it("enforces the measured adapter working-set estimate before copying input", async () => {
    const input = triangleGlb();
    const jsonByteLength = new DataView(input.buffer, input.byteOffset, input.byteLength)
      .getUint32(12, true);
    const expectedWorkingSet = GLB_FIXED_WORKING_SET_BYTES
      + input.byteLength * GLB_WORKING_SET_MULTIPLIER
      + jsonByteLength * GLB_JSON_WORKING_SET_MULTIPLIER;
    await expect(validateAndExportGlb(input, {
      limits: { maxEstimatedWorkingSetBytes: expectedWorkingSet - 1 },
    })).rejects.toSatisfy(expectCode("input-resource-limit"));

    const result = await validateAndExportGlb(input);
    expect(result.estimatedWorkingSetBytes).toBe(expectedWorkingSet);
  });

  it("accounts separately for JSON-dominant working-set amplification", async () => {
    const input = createGlb({
      asset: { version: "2.0" },
      extras: Array.from({ length: 50_000 }, () => 0),
    });
    const jsonByteLength = new DataView(input.buffer, input.byteOffset, input.byteLength)
      .getUint32(12, true);
    const binaryOnlyEstimate = GLB_FIXED_WORKING_SET_BYTES
      + input.byteLength * GLB_WORKING_SET_MULTIPLIER;
    const result = await validateAndExportGlb(input);

    expect(result.estimatedWorkingSetBytes).toBe(
      binaryOnlyEstimate + jsonByteLength * GLB_JSON_WORKING_SET_MULTIPLIER,
    );
    await expect(validateAndExportGlb(input, {
      limits: { maxEstimatedWorkingSetBytes: binaryOnlyEstimate },
    })).rejects.toSatisfy(expectCode("input-resource-limit"));
  });

  it("rejects malformed and unknown limit profiles", async () => {
    await expect(validateAndExportGlb(triangleGlb(), { limits: null as never }))
      .rejects.toSatisfy(expectCode("invalid-limits"));
    await expect(validateAndExportGlb(triangleGlb(), { limits: { unknown: 1 } as never }))
      .rejects.toSatisfy(expectCode("invalid-limits"));
    await expect(validateAndExportGlb(triangleGlb(), { limits: { maxJsonDepth: 0 } }))
      .rejects.toSatisfy(expectCode("invalid-limits"));
    await expect(validateAndExportGlb(triangleGlb(), { limits: { maxAccessors: 0 } }))
      .rejects.toSatisfy(expectCode("document-resource-limit"));
  });

  it.each([
    ["input bytes", { maxInputBytes: 64 }, "input-resource-limit"],
    ["JSON bytes", { maxJsonBytes: 64 }, "json-resource-limit"],
    ["binary bytes", { maxBinaryBytes: 16 }, "binary-resource-limit"],
    ["accessor count", { maxAccessors: 1 }, "document-resource-limit"],
    ["buffer view count", { maxBufferViews: 1 }, "document-resource-limit"],
    ["accessor elements", { maxAccessorElements: 4 }, "document-resource-limit"],
  ])("enforces the %s budget", async (_name, limits, code) => {
    await expect(validateAndExportGlb(triangleGlb(), { limits }))
      .rejects.toSatisfy(expectCode(code));
  });

  it("rejects unsafe or excessively deep JSON", async () => {
    await expect(validateAndExportGlb(createGlb({ asset: { version: "2.0" }, extras: { __proto__: null, constructor: "unsafe" } })))
      .rejects.toSatisfy(expectCode("unsafe-gltf-json"));

    const deep: JsonRecord = {};
    let cursor = deep;
    for (let index = 0; index < 8; index += 1) {
      const next: JsonRecord = {};
      cursor.next = next;
      cursor = next;
    }
    await expect(validateAndExportGlb(createGlb({ asset: { version: "2.0" }, extras: deep }), {
      limits: { maxJsonDepth: 4 },
    })).rejects.toSatisfy(expectCode("json-resource-limit"));
  });

  it("bounds JSON values, strings, keys, and non-finite parsed numbers", async () => {
    await expect(validateAndExportGlb(createGlb({ asset: { version: "2.0" }, extras: [1, 2] }), {
      limits: { maxJsonValues: 2 },
    })).rejects.toSatisfy(expectCode("json-resource-limit"));
    await expect(validateAndExportGlb(createGlb({ asset: { version: "2.0", generator: "long" } }), {
      limits: { maxJsonStringLength: 3 },
    })).rejects.toSatisfy(expectCode("json-resource-limit"));
    await expect(validateAndExportGlb(createGlb({
      asset: { version: "2.0" },
      extras: { ["x".repeat(257)]: true },
    }))).rejects.toSatisfy(expectCode("json-resource-limit"));

    const raw = new TextEncoder().encode('{"asset":{"version":"2.0"},"extras":{"value":1e400}}');
    await expect(validateAndExportGlb(createRawGlb([encodeChunk(JSON_CHUNK, raw)])))
      .rejects.toSatisfy(expectCode("unsafe-gltf-json"));
  });

  it("handles permitted wide JSON without an uncontrolled RangeError", async () => {
    const source = createGlb({
      asset: { version: "2.0" },
      extras: Array.from({ length: 150_000 }, () => 0),
    });
    await expect(validateAndExportGlb(source)).resolves.toMatchObject({ format: "glb" });
  });

  it("rejects an over-budget wide JSON array without retaining a width-sized traversal stack", async () => {
    const source = createGlb({
      asset: { version: "2.0" },
      extras: Array.from({ length: 500_000 }, () => 0),
    });
    await expect(validateAndExportGlb(source, { limits: { maxJsonValues: 2 } }))
      .rejects.toSatisfy(expectCode("json-resource-limit"));
  });

  it("applies the depth ceiling during duplicate-key scanning", async () => {
    const raw = new TextEncoder().encode(`{"asset":{"version":"2.0"},"extras":${"[".repeat(128)}0${"]".repeat(128)}}`);
    await expect(validateAndExportGlb(createRawGlb([encodeChunk(JSON_CHUNK, raw)]), {
      limits: { maxJsonDepth: 8 },
    })).rejects.toSatisfy(expectCode("json-resource-limit"));
  });

  it("rejects non-space JSON padding instead of silently repairing source evidence", async () => {
    const json = new TextEncoder().encode('{"asset":{"version":"2.0"}}');
    const chunk = encodeChunk(JSON_CHUNK, json, 0x09);
    await expect(validateAndExportGlb(createRawGlb([chunk])))
      .rejects.toSatisfy(expectCode("invalid-glb-chunk"));
  });

  it("enforces JSON limits against aligned deterministic output", async () => {
    const raw = new TextEncoder().encode('{"asset":{"version":"2.0"},"extras":1e-6}');
    const source = createRawGlb([encodeChunk(JSON_CHUNK, raw)]);
    await expect(validateAndExportGlb(source, { limits: { maxJsonBytes: 47 } }))
      .rejects.toSatisfy(expectCode("json-resource-limit"));
  });

  it("includes deterministic output growth in the same-profile working-set gate", async () => {
    const raw = new TextEncoder().encode('{"asset":{"version":"2.0"},"extras":1e-6}');
    const source = createRawGlb([encodeChunk(JSON_CHUNK, raw)]);
    const sourceJsonByteLength = new DataView(source.buffer, source.byteOffset, source.byteLength)
      .getUint32(12, true);
    const sourceOnlyEstimate = GLB_FIXED_WORKING_SET_BYTES
      + source.byteLength * GLB_WORKING_SET_MULTIPLIER
      + sourceJsonByteLength * GLB_JSON_WORKING_SET_MULTIPLIER;

    await expect(validateAndExportGlb(source, {
      limits: { maxEstimatedWorkingSetBytes: sourceOnlyEstimate },
    })).rejects.toSatisfy(expectCode("input-resource-limit"));

    const admitted = await validateAndExportGlb(source);
    const roundTrip = await validateAndExportGlb(await outputBytes(admitted), {
      limits: { maxEstimatedWorkingSetBytes: admitted.estimatedWorkingSetBytes },
    });
    expect(roundTrip.estimatedWorkingSetBytes).toBe(admitted.estimatedWorkingSetBytes);
    expect(roundTrip.outputContentHash).toBe(admitted.outputContentHash);
  });

  it("rejects invalid document structures and closed-world counts", async () => {
    await expect(validateAndExportGlb(createGlb({ asset: { version: "1.0" } })))
      .rejects.toSatisfy(expectCode("invalid-gltf-document"));
    await expect(validateAndExportGlb(createGlb({ asset: { version: "2.0" }, meshes: {} as never })))
      .rejects.toSatisfy(expectCode("invalid-gltf-document"));
    await expect(validateAndExportGlb(triangleGlb(triangleDocument({
      meshes: [{ primitives: [
        { attributes: { POSITION: 0 }, indices: 1 },
        { attributes: { POSITION: 0 }, indices: 1 },
      ] }],
    }), triangleBinary()), { limits: { maxPrimitives: 1 } }))
      .rejects.toSatisfy(expectCode("document-resource-limit"));
    await expect(validateAndExportGlb(triangleGlb(triangleDocument({
      meshes: [{ primitives: [{ attributes: {}, indices: 1 }] }],
    })))).rejects.toSatisfy(expectCode("missing-gltf-dependency"));
    await expect(validateAndExportGlb(createGlb({ asset: { version: "2.0" }, extras: { extensions: { TEST_extension: {} } } })))
      .rejects.toSatisfy(expectCode("unsupported-gltf-feature"));
  });

  it("rejects missing, excessive, mis-sized, and padded binary dependencies", async () => {
    await expect(validateAndExportGlb(createGlb({ asset: { version: "2.0" }, buffers: [{ byteLength: 4 }] })))
      .rejects.toSatisfy(expectCode("missing-gltf-dependency"));
    await expect(validateAndExportGlb(createGlb({ asset: { version: "2.0" } }, new Uint8Array(4))))
      .rejects.toSatisfy(expectCode("missing-gltf-dependency"));
    await expect(validateAndExportGlb(createGlb({
      asset: { version: "2.0" },
      buffers: [{ byteLength: 4 }, { byteLength: 4 }],
    }, new Uint8Array(4)))).rejects.toSatisfy(expectCode("unsupported-gltf-feature"));
    await expect(validateAndExportGlb(createGlb({ asset: { version: "2.0" }, buffers: [{ byteLength: 8 }] }, new Uint8Array(4))))
      .rejects.toSatisfy(expectCode("invalid-gltf-document"));

    const padded = triangleGlb();
    padded[padded.byteLength - 1] = 1;
    await expect(validateAndExportGlb(padded)).rejects.toSatisfy(expectCode("invalid-glb-chunk"));
  });

  it("validates bufferView references, implicit offsets, strides, and ranges", async () => {
    const views = triangleDocument().bufferViews as JsonRecord[];
    const noOffset: JsonRecord = { ...views[0], byteStride: 12 };
    delete noOffset.byteOffset;
    const valid = await validateAndExportGlb(triangleGlb(triangleDocument({
      bufferViews: [noOffset, views[1]],
    })));
    expect(valid.outputByteLength).toBeGreaterThan(0);

    await expect(validateAndExportGlb(triangleGlb(triangleDocument({
      bufferViews: [{ ...views[0], buffer: 1 }, views[1]],
    })))).rejects.toSatisfy(expectCode("missing-gltf-dependency"));
    await expect(validateAndExportGlb(triangleGlb(triangleDocument({
      bufferViews: [{ ...views[0], byteLength: 43 }, views[1]],
    })))).rejects.toSatisfy(expectCode("invalid-gltf-document"));
  });

  it("rejects invalid JavaScript-facing source options", async () => {
    await expect(validateAndExportGlb(triangleGlb(), null as never))
      .rejects.toSatisfy(expectCode("invalid-adapter-options"));
    await expect(validateAndExportGlb("not bytes" as never))
      .rejects.toSatisfy(expectCode("invalid-glb-header"));
    await expect(validateAndExportGlb(triangleGlb(), { contentType: 42 as never }))
      .rejects.toSatisfy(expectCode("source-type-mismatch"));
    await expect(validateAndExportGlb(triangleGlb(), { mode: "tolerant" }))
      .rejects.toSatisfy(expectCode("unsupported-adapter-mode"));
  });
});

describe("runtime adapter contract", () => {
  it("fails closed until the static PVOX demo parent flag is enabled", async () => {
    let resolverCalls = 0;
    const source = {
      source: { kind: "uint8-array" as const, bytes: triangleGlb() },
      bytes: triangleGlb(),
      contentType: "model/gltf-binary",
      fileName: "triangle.glb",
      contentHash: "0".repeat(64),
      rangeSupported: false,
      resourceResolver: {
        async resolve() {
          resolverCalls += 1;
          throw new Error("must not be called");
        },
      },
    };
    await expect(glbAdapter.load(source, {
      signal: new AbortController().signal,
      mode: "strict",
      execution: "worker",
      adapterOptions: { limits: { maxMeshes: 2 } },
    })).rejects.toSatisfy(expectCode("feature-disabled"));
    expect(resolverCalls).toBe(0);
  });

  it.each(["tolerant", "forensic"] as const)("fails closed for unimplemented %s repair mode", async (mode) => {
    const bytes = triangleGlb();
    await expect(glbAdapter.load({
      source: { kind: "uint8-array", bytes },
      bytes,
      contentHash: "0".repeat(64),
      rangeSupported: false,
      resourceResolver: { resolve: async () => { throw new Error("unused"); } },
    }, {
      signal: new AbortController().signal,
      mode,
      execution: "main",
      adapterOptions: null,
    })).rejects.toSatisfy(expectCode("unsupported-adapter-mode"));
  });

  it("rejects unknown runtime adapter options and treats a null option bag as disabled", async () => {
    const bytes = triangleGlb();
    const source = {
      source: { kind: "uint8-array" as const, bytes },
      bytes,
      contentHash: "0".repeat(64),
      rangeSupported: false,
      resourceResolver: { resolve: async () => { throw new Error("unused"); } },
    };
    await expect(glbAdapter.load(source, {
      signal: new AbortController().signal,
      mode: "strict",
      execution: "main",
      adapterOptions: { unexpected: true },
    })).rejects.toSatisfy(expectCode("invalid-adapter-options"));
    await expect(glbAdapter.load(source, {
      signal: new AbortController().signal,
      mode: "strict",
      execution: "main",
      adapterOptions: null,
    })).rejects.toSatisfy(expectCode("feature-disabled"));
  });
});
