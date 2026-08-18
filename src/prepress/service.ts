import { PrepressErrorCode } from "./core/errors";
import { buildOutputFilename } from "./core/naming";
import { generatePrintReadyPdf } from "./core/pdf-engine";
import { getTemplateConfig } from "./core/template-config";
import type { PrepressResult } from "./core/types";
import type { MasterProvider, StorageAdapter } from "./ports";

export interface PrepressServiceDeps {
  storage: StorageAdapter;
  masterProvider: MasterProvider;
  /** Overridable for deterministic tests. */
  newId?: () => string;
  downloadUrlTtlSeconds?: number;
}

export interface PrepressRequest {
  templateId: string;
  artworkBytes: Uint8Array;
  filename: string;
}

export type PrepressResponse = Omit<PrepressResult, "outputBytes"> & {
  outputFilename?: string;
  outputPath?: string;
  downloadUrl?: string;
  downloadExpiresInSeconds?: number;
};

function failure(templateId: string, code: string, message: string): PrepressResponse {
  return {
    status: "FAIL",
    templateId,
    checks: [{ key: "input", label: "Verwerking gestart", status: "FAIL", critical: true, detail: message }],
    validation: {
      pdf_valid: false,
      page_count: false,
      page_size: false,
      layers_present: false,
      layer_order: false,
      layer_visibility: false,
      white_separation: false,
      white_overprint: false,
      artwork_present: false,
      artwork_ocg: false,
      artwork_scaled: false,
      master_content_preserved: false,
      no_extra_ocg: false,
      no_illustrator_private_data: false,
    },
    errors: [{ code, message }],
    logs: [{ at: new Date().toISOString(), event: "aborted", data: { code } }],
  };
}

/**
 * Framework-agnostic orchestration: master ophalen, engine draaien, output
 * privé opslaan en een tijdelijke download-URL teruggeven.
 */
export async function runPrepress(
  deps: PrepressServiceDeps,
  request: PrepressRequest,
): Promise<PrepressResponse> {
  const config = getTemplateConfig(request.templateId);
  if (!config) {
    return failure(request.templateId, PrepressErrorCode.TEMPLATE_UNKNOWN, `Onbekend template: ${request.templateId}`);
  }

  let masterBytes: Uint8Array;
  try {
    masterBytes = await deps.masterProvider.getMaster(config);
  } catch (error) {
    return failure(
      config.id,
      PrepressErrorCode.MASTER_UNAVAILABLE,
      `Master template niet beschikbaar: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const result = await generatePrintReadyPdf({
    masterBytes,
    artworkBytes: request.artworkBytes,
    config,
  });

  const { outputBytes, ...rest } = result;
  if (result.status !== "PASS" || !outputBytes) return rest;

  const id = deps.newId ? deps.newId() : crypto.randomUUID();
  const outputFilename = buildOutputFilename(request.filename);
  const outputPath = `outputs/${config.id}/${id}/${outputFilename}`;
  const ttl = deps.downloadUrlTtlSeconds ?? 900;

  await deps.storage.write(outputPath, outputBytes, "application/pdf");
  const downloadUrl = await deps.storage.createTemporaryUrl(outputPath, ttl);

  return {
    ...rest,
    outputFilename,
    outputPath,
    downloadUrl,
    downloadExpiresInSeconds: ttl,
  };
}