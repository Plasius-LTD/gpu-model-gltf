declare module "gltf-validator" {
  export interface ValidationMessage {
    readonly code?: unknown;
    readonly message?: unknown;
    readonly severity?: unknown;
    readonly pointer?: unknown;
  }

  export interface ValidationReport {
    readonly issues?: {
      readonly numErrors?: unknown;
      readonly numWarnings?: unknown;
      readonly numInfos?: unknown;
      readonly numHints?: unknown;
      readonly messages?: unknown;
    };
  }

  export interface ValidationOptions {
    readonly uri?: string;
    readonly format?: "glb" | "gltf";
    readonly maxIssues?: number;
    readonly writeTimestamp?: boolean;
    readonly externalResourceFunction?: (uri: string) => Promise<Uint8Array>;
  }

  export function version(): string;
  export function validateBytes(data: Uint8Array, options?: ValidationOptions): Promise<ValidationReport>;
}
