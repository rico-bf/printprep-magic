import { PDFDict, PDFName, PDFRef, PDFStream } from "pdf-lib";
import { PrepressErrorCode } from "./errors";
import {
  bytesToLatin1,
  findMarkedContentBlocks,
  getOcProperties,
  getOcgRefsByName,
  getPageContentString,
  inspectPdf,
  latin1ToBytes,
  loadPdf,
} from "./pdf-inspect";
import { validateArtwork, validateMaster, validateOutput } from "./pdf-validator";
import type {
  LogEntry,
  PrepressError,
  PrepressResult,
  TemplateConfig,
  ValidationCheck,
  ValidationSummary,
} from "./types";

export interface GenerateInput {
  masterBytes: Uint8Array;
  artworkBytes: Uint8Array;
  config: TemplateConfig;
}

function nowIso(): string {
  return new Date().toISOString();
}

function summarize(checks: ValidationCheck[]): ValidationSummary {
  const ok = (key: string) => {
    const check = checks.find((c) => c.key === key);
    return check ? check.status === "PASS" : false;
  };
  const allLayerContentOk = checks
    .filter((c) => c.key.startsWith("output_layer_") && !["output_layer_order", "output_layer_visibility", "output_layers"].includes(c.key))
    .every((c) => c.status === "PASS");
  return {
    pdf_valid: ok("pdf_valid") && ok("output_pdf_valid"),
    page_count: ok("page_count") && ok("output_page_count"),
    page_size: ok("page_size") && ok("output_page_size"),
    layers_present: ok("output_layers"),
    layer_order: ok("output_layer_order"),
    layer_visibility: ok("output_layer_visibility"),
    white_separation: ok("output_white_separation"),
    white_overprint: ok("output_white_overprint"),
    artwork_present: ok("output_artwork_present"),
    artwork_ocg: ok("output_artwork_ocg"),
    artwork_scaled: ok("output_artwork_not_scaled"),
    master_content_preserved: allLayerContentOk,
    no_extra_ocg: ok("output_no_extra_ocg"),
  };
}

function dictOf(doc: Awaited<ReturnType<typeof loadPdf>>, ref: PDFRef): PDFDict | undefined {
  const resolved = doc.context.lookup(ref);
  if (resolved instanceof PDFStream) return resolved.dict;
  if (resolved instanceof PDFDict) return resolved;
  return undefined;
}

/**
 * Rewrites every optional-content reference inside the embedded artwork form so
 * it points at the master's existing artwork OCG. This prevents the artwork's
 * own layer (e.g. "Laag 1") from surviving as a fifth OCG.
 */
function remapArtworkOptionalContent(
  doc: Awaited<ReturnType<typeof loadPdf>>,
  formRef: PDFRef,
  artworkOcgRef: PDFRef,
  visited = new Set<string>(),
): void {
  const key = `${formRef.objectNumber}:${formRef.generationNumber}`;
  if (visited.has(key)) return;
  visited.add(key);

  const dict = dictOf(doc, formRef);
  if (!dict) return;

  if (dict.get(PDFName.of("OC")) !== undefined) {
    dict.set(PDFName.of("OC"), artworkOcgRef);
  }

  const resources = dict.get(PDFName.of("Resources"));
  const resourcesDict =
    resources instanceof PDFDict
      ? resources
      : resources instanceof PDFRef
        ? dictOf(doc, resources)
        : undefined;
  if (!resourcesDict) return;

  const properties = resourcesDict.get(PDFName.of("Properties"));
  const propertiesDict =
    properties instanceof PDFDict
      ? properties
      : properties instanceof PDFRef
        ? dictOf(doc, properties)
        : undefined;
  if (propertiesDict) {
    for (const [propKey] of propertiesDict.entries()) {
      propertiesDict.set(propKey, artworkOcgRef);
    }
  }

  const xObjects = resourcesDict.get(PDFName.of("XObject"));
  const xObjectsDict =
    xObjects instanceof PDFDict
      ? xObjects
      : xObjects instanceof PDFRef
        ? dictOf(doc, xObjects)
        : undefined;
  if (xObjectsDict) {
    for (const [, value] of xObjectsDict.entries()) {
      if (value instanceof PDFRef) remapArtworkOptionalContent(doc, value, artworkOcgRef, visited);
    }
  }
}

/** Removes optional-content dictionaries that are not registered in the master. */
function dropUnregisteredOcgs(
  doc: Awaited<ReturnType<typeof loadPdf>>,
  allowed: Set<string>,
): string[] {
  const dropped: string[] = [];
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    const type = obj.get(PDFName.of("Type"));
    if (!(type instanceof PDFName)) continue;
    const typeName = type.asString();
    if (typeName !== "/OCG" && typeName !== "/OCMD") continue;
    const key = `${ref.objectNumber}:${ref.generationNumber}`;
    if (allowed.has(key)) continue;
    doc.context.delete(ref);
    dropped.push(key);
  }
  return dropped;
}

export async function generatePrintReadyPdf({
  masterBytes,
  artworkBytes,
  config,
}: GenerateInput): Promise<PrepressResult> {
  const logs: LogEntry[] = [];
  const log = (event: string, data?: Record<string, string | number | boolean | null>) =>
    logs.push(data === undefined ? { at: nowIso(), event } : { at: nowIso(), event, data });

  const checks: ValidationCheck[] = [];
  const errors: PrepressError[] = [];

  log("start", { templateId: config.id, masterBytes: masterBytes.length, artworkBytes: artworkBytes.length });

  const masterInspection = await inspectPdf(masterBytes);
  const masterOutcome = validateMaster(config, masterInspection);
  checks.push(...masterOutcome.checks);
  errors.push(...masterOutcome.errors);
  log("master_preflight", { errors: masterOutcome.errors.length });

  const artworkInspection = await inspectPdf(artworkBytes);
  const artworkOutcome = validateArtwork(config, artworkInspection, masterInspection.mediaBox);
  checks.push(...artworkOutcome.checks);
  errors.push(...artworkOutcome.errors);
  log("artwork_preflight", { errors: artworkOutcome.errors.length });

  if (errors.length > 0) {
    return {
      status: "FAIL",
      templateId: config.id,
      checks,
      validation: summarize(checks),
      errors,
      logs,
    };
  }

  try {
    const doc = await loadPdf(masterBytes);
    const page = doc.getPage(0);

    const ocgRefs = getOcgRefsByName(doc);
    const artworkOcgRef = ocgRefs.get(config.layers.artwork);
    if (!artworkOcgRef) throw new Error(`Artwork OCG "${config.layers.artwork}" niet gevonden in master`);

    const allowedOcgKeys = new Set<string>();
    for (const ref of ocgRefs.values()) {
      allowedOcgKeys.add(`${ref.objectNumber}:${ref.generationNumber}`);
    }
    const ocProps = getOcProperties(doc);
    void ocProps;

    const [embedded] = await doc.embedPdf(artworkBytes, [0]);
    if (!embedded) throw new Error("Artwork kon niet worden ingebed");
    await embedded.embed();
    log("artwork_embedded", { ref: embedded.ref.toString() });

    remapArtworkOptionalContent(doc, embedded.ref, artworkOcgRef);
    const dropped = dropUnregisteredOcgs(doc, allowedOcgKeys);
    log("ocg_remap", { droppedOptionalContentObjects: dropped.length });

    const xObjectName = page.node.newXObject("Artwork", embedded.ref);
    const artworkMatrix = [1, 0, 0, 1, 0, 0];

    const content = getPageContentString(doc);
    const blocks = findMarkedContentBlocks(content);
    const artworkPropertyName = Object.entries(masterInspection.markedContentProperties).find(
      ([, layerName]) => layerName === config.layers.artwork,
    )?.[0];
    const targetBlock = blocks.find((block) => block.propertyName === artworkPropertyName);
    if (!targetBlock) throw new Error("Marked-content blok voor de artworklaag niet gevonden");

    const placement = `\nq ${artworkMatrix.join(" ")} cm ${xObjectName.asString()} Do Q\n`;
    const newContent =
      content.slice(0, targetBlock.innerEnd) + placement + content.slice(targetBlock.innerEnd);

    const contentStream = doc.context.flateStream(latin1ToBytes(newContent));
    const contentRef = doc.context.register(contentStream);
    page.node.set(PDFName.of("Contents"), contentRef);
    log("content_injected", { placement: placement.trim(), contentLength: newContent.length });

    const outputBytes = await doc.save({
      useObjectStreams: false,
      addDefaultPage: false,
      updateFieldAppearances: false,
    });
    log("saved", { bytes: outputBytes.length });

    const outputInspection = await inspectPdf(outputBytes);
    const outputOutcome = validateOutput({
      config,
      master: masterInspection,
      output: outputInspection,
      artworkMatrix,
      artworkXObjectName: xObjectName.asString().slice(1),
    });
    checks.push(...outputOutcome.checks);
    errors.push(...outputOutcome.errors);
    log("output_preflight", { errors: outputOutcome.errors.length });

    const status = errors.length === 0 ? "PASS" : "FAIL";
    return {
      status,
      templateId: config.id,
      checks,
      validation: summarize(checks),
      errors,
      logs,
      ...(status === "PASS" ? { outputBytes } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("technical_failure", { message });
    errors.push({ code: PrepressErrorCode.TECHNICAL_FAIL, message });
    checks.push({
      key: "technical",
      label: "Technische verwerking geslaagd",
      status: "FAIL",
      critical: true,
      detail: message,
    });
    return {
      status: "FAIL",
      templateId: config.id,
      checks,
      validation: summarize(checks),
      errors,
      logs,
    };
  }
}

export { bytesToLatin1 };