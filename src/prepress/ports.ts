import type { TemplateConfig } from "./core/types";

/** Private file storage. Swap for Laravel Storage / S3 without touching the engine. */
export interface StorageAdapter {
  read(path: string): Promise<Uint8Array>;
  write(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Temporary, private download link. */
  createTemporaryUrl(path: string, expiresInSeconds: number): Promise<string>;
}

/** Resolves the master template PDF for a template configuration. */
export interface MasterProvider {
  getMaster(config: TemplateConfig): Promise<Uint8Array>;
}