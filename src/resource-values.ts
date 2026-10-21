import { GlbAdapterError } from "./glb-adapter.js";

export type JsonRecord = Record<string, unknown>;

export function fail(
  code: ConstructorParameters<typeof GlbAdapterError>[0],
  message: string,
): never {
  throw new GlbAdapterError(code, message);
}
export function record(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("invalid-gltf-document", "A glTF object is invalid.");
  return value as JsonRecord;
}
export function array(value: unknown): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    fail("invalid-gltf-document", "A glTF array is invalid.");
  return value;
}
export function integer(
  value: unknown,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    fail(
      "invalid-gltf-document",
      "A glTF integer is outside its admitted range.",
    );
  return value;
}
