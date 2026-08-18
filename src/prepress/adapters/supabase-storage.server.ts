import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { MasterProvider, StorageAdapter } from "../ports";
import type { TemplateConfig } from "../core/types";

export const PREPRESS_BUCKET = "prepress";

export function createSupabaseStorageAdapter(bucket = PREPRESS_BUCKET): StorageAdapter {
  return {
    async read(path) {
      const { data, error } = await supabaseAdmin.storage.from(bucket).download(path);
      if (error || !data) throw new Error(`Bestand niet gevonden in opslag: ${path} (${error?.message})`);
      return new Uint8Array(await data.arrayBuffer());
    },
    async write(path, bytes, contentType) {
      const { error } = await supabaseAdmin.storage
        .from(bucket)
        .upload(path, bytes as unknown as ArrayBufferView, { contentType, upsert: true });
      if (error) throw new Error(`Opslaan mislukt (${path}): ${error.message}`);
    },
    async createTemporaryUrl(path, expiresInSeconds) {
      const { data, error } = await supabaseAdmin.storage
        .from(bucket)
        .createSignedUrl(path, expiresInSeconds);
      if (error || !data) throw new Error(`Tijdelijke download-URL mislukt: ${error?.message}`);
      return data.signedUrl;
    },
  };
}

export function createStorageMasterProvider(storage: StorageAdapter): MasterProvider {
  return {
    async getMaster(config: TemplateConfig) {
      return storage.read(config.masterStoragePath);
    },
  };
}