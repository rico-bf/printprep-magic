import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const inputSchema = z.object({
  templateId: z.string().min(1),
  filename: z.string().min(1),
  /** Artwork PDF as base64 (transport only; nothing is stored publicly). */
  artworkBase64: z.string().min(1),
});

function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export const prepareArtwork = createServerFn({ method: "POST" })
  .inputValidator((data) => inputSchema.parse(data))
  .handler(async ({ data }) => {
    const { createSupabaseStorageAdapter, createStorageMasterProvider } = await import(
      "@/prepress/adapters/supabase-storage.server"
    );
    const { runPrepress } = await import("@/prepress/service");

    const storage = createSupabaseStorageAdapter();
    return runPrepress(
      { storage, masterProvider: createStorageMasterProvider(storage) },
      {
        templateId: data.templateId,
        filename: data.filename,
        artworkBytes: base64ToBytes(data.artworkBase64),
      },
    );
  });