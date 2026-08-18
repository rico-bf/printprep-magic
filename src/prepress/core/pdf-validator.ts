import { PrepressErrorCode } from "./errors";
import { allLayerNames, technicalLayerNames } from "./template-config";
import type {
  GoldenComparisonRow,
  LayerSignature,
  PageBox,
  PdfInspection,
  PrepressError,
  TemplateConfig,
  ValidationCheck,
} from "./types";

export interface ValidationOutcome {
  checks: ValidationCheck[];
  errors: PrepressError[];
}

function pass(key: string, label: string, critical = true, detail?: string): ValidationCheck {
  return detail === undefined
    ? { key, label, status: "PASS", critical }
    : { key, label, status: "PASS", critical, detail };
}

function fail(key: string, label: string, critical = true, detail?: string): ValidationCheck {
  return detail === undefined
    ? { key, label, status: "FAIL", critical }
    : { key, label, status: "FAIL", critical, detail };
}

function boxesMatch(a: PageBox | undefined, b: PageBox | undefined, tolerance: number): boolean {
  if (!a || !b) return false;
  return (
    Math.abs(a.x - b.x) <= tolerance &&
    Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.width - b.width) <= tolerance &&
    Math.abs(a.height - b.height) <= tolerance
  );
}

export function formatBox(box: PageBox | undefined): string {
  if (!box) return "onbekend";
  return `${box.width.toFixed(3)} × ${box.height.toFixed(3)} pt`;
}

function whiteSeparationPresent(inspection: PdfInspection, whiteName: string): boolean {
  return inspection.separations.some((sep) => sep.toLowerCase() === whiteName.toLowerCase());
}

function overprintStatePresent(inspection: PdfInspection): boolean {
  return Object.values(inspection.graphicsStates).some(
    (state) => state.OP === true && state.op === true && state.OPM === 1,
  );
}

/** Preflight of the master file; the master is the source of truth. */
export function validateMaster(config: TemplateConfig, master: PdfInspection): ValidationOutcome {
  const checks: ValidationCheck[] = [];
  const errors: PrepressError[] = [];

  if (!master.valid || master.pageCount === 0) {
    checks.push(fail("master_pdf_valid", "Master is een geldige PDF", true, master.parseError));
    errors.push({
      code: PrepressErrorCode.MASTER_INVALID_PDF,
      message: `Master kon niet worden gelezen: ${master.parseError ?? "onbekende fout"}`,
    });
    return { checks, errors };
  }
  checks.push(pass("master_pdf_valid", "Master is een geldige PDF"));

  const required = allLayerNames(config);
  const missing = required.filter((name) => !master.ocgNames.includes(name));
  if (missing.length > 0) {
    checks.push(fail("master_layers", "Master bevat de vier vereiste lagen", true, `Ontbreekt: ${missing.join(", ")}`));
    errors.push({
      code: PrepressErrorCode.MASTER_LAYER_MISSING,
      message: `Master mist verplichte laag/lagen: ${missing.join(", ")}`,
    });
  } else {
    checks.push(pass("master_layers", "Master bevat de vier vereiste lagen"));
  }

  const orderMatches =
    master.layerOrder.length === config.layerOrder.length &&
    master.layerOrder.every((name, index) => name === config.layerOrder[index]);
  if (orderMatches) {
    checks.push(pass("master_layer_order", "Master laagvolgorde correct"));
  } else {
    checks.push(
      fail("master_layer_order", "Master laagvolgorde correct", true, master.layerOrder.join(" | ")),
    );
    errors.push({
      code: PrepressErrorCode.MASTER_LAYER_ORDER_INVALID,
      message: `Laagvolgorde in master wijkt af: ${master.layerOrder.join(" | ")}`,
    });
  }

  const visibilityProblems = Object.entries(config.defaultVisibility).filter(([name, visible]) => {
    if (!master.ocgNames.includes(name)) return false;
    return visible ? !master.visibleLayers.includes(name) : !master.hiddenLayers.includes(name);
  });
  if (visibilityProblems.length === 0) {
    checks.push(pass("master_layer_visibility", "Master standaard zichtbaarheid correct"));
  } else {
    checks.push(
      fail(
        "master_layer_visibility",
        "Master standaard zichtbaarheid correct",
        true,
        visibilityProblems.map(([name]) => name).join(", "),
      ),
    );
    errors.push({
      code: PrepressErrorCode.MASTER_LAYER_VISIBILITY_INVALID,
      message: `Standaard zichtbaarheid onjuist voor: ${visibilityProblems.map(([n]) => n).join(", ")}`,
    });
  }

  if (whiteSeparationPresent(master, config.spotColors.white)) {
    checks.push(pass("master_white_separation", `Master bevat steunkleur ${config.spotColors.white}`));
  } else {
    checks.push(fail("master_white_separation", `Master bevat steunkleur ${config.spotColors.white}`));
    errors.push({
      code: PrepressErrorCode.MASTER_WHITE_SEPARATION_MISSING,
      message: `White Separation ontbreekt in de master`,
    });
  }

  if (overprintStatePresent(master)) {
    checks.push(pass("master_white_overprint", "Master bevat overprint state (OP/op/OPM)"));
  } else {
    checks.push(fail("master_white_overprint", "Master bevat overprint state (OP/op/OPM)"));
    errors.push({
      code: PrepressErrorCode.MASTER_WHITE_OVERPRINT_MISSING,
      message: "Overprintinstelling (OP=true, op=true, OPM=1) ontbreekt in de master",
    });
  }

  const artworkProperty = Object.entries(master.markedContentProperties).find(
    ([, layerName]) => layerName === config.layers.artwork,
  );
  if (artworkProperty) {
    checks.push(pass("master_artwork_block", "Master bevat marked-content blok voor de artworklaag"));
  } else {
    checks.push(fail("master_artwork_block", "Master bevat marked-content blok voor de artworklaag"));
    errors.push({
      code: PrepressErrorCode.MASTER_ARTWORK_BLOCK_MISSING,
      message: `Master bevat geen marked-content blok gekoppeld aan "${config.layers.artwork}"`,
    });
  }

  return { checks, errors };
}

/** Preflight of the uploaded artwork; no scaling, fitting or cropping allowed. */
export function validateArtwork(
  config: TemplateConfig,
  artwork: PdfInspection,
  masterBox: PageBox | undefined,
): ValidationOutcome {
  const checks: ValidationCheck[] = [];
  const errors: PrepressError[] = [];

  if (!artwork.valid) {
    checks.push(fail("pdf_valid", "PDF geldig", true, artwork.parseError));
    errors.push({
      code: PrepressErrorCode.INVALID_PDF,
      message: `Geen geldige PDF: ${artwork.parseError ?? "onbekende fout"}`,
    });
    return { checks, errors };
  }
  checks.push(pass("pdf_valid", "PDF geldig"));

  if (artwork.pageCount === 1) {
    checks.push(pass("page_count", "1 pagina"));
  } else {
    checks.push(fail("page_count", "1 pagina", true, `${artwork.pageCount} pagina's`));
    errors.push({
      code: PrepressErrorCode.PAGE_COUNT_INVALID,
      message: `Artwork moet exact 1 pagina bevatten, gevonden: ${artwork.pageCount}`,
    });
  }

  if (boxesMatch(artwork.mediaBox, masterBox, config.pageSizeTolerancePt)) {
    checks.push(pass("page_size", "Formaat correct", true, formatBox(artwork.mediaBox)));
  } else {
    checks.push(
      fail(
        "page_size",
        "Formaat correct",
        true,
        `artwork ${formatBox(artwork.mediaBox)} vs master ${formatBox(masterBox)}`,
      ),
    );
    errors.push({
      code: PrepressErrorCode.PAGE_SIZE_MISMATCH,
      message: `Artworkformaat wijkt af van master (${formatBox(artwork.mediaBox)} vs ${formatBox(masterBox)})`,
    });
  }

  return { checks, errors };
}

export interface LayerComparison {
  layer: string;
  matches: boolean;
  differences: string[];
}

function compareNumberArrays(a: number[], b: number[], tolerance = 0.001): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => Math.abs(value - (b[index] ?? Number.NaN)) <= tolerance);
}

/** Semantic comparison of a technical layer: content, resources, colours, states. */
export function compareLayerSignature(
  expected: LayerSignature | undefined,
  actual: LayerSignature | undefined,
  layer: string,
  /** Ignore resource key names (used when comparing against an externally produced file). */
  nameAgnostic = false,
): LayerComparison {
  const differences: string[] = [];
  if (!expected) differences.push("laag ontbreekt in master");
  if (!actual) differences.push("laag ontbreekt in output");
  if (!expected || !actual) return { layer, matches: false, differences };

  if (expected.ocgName !== actual.ocgName) {
    differences.push(`OCG-koppeling ${actual.ocgName} i.p.v. ${expected.ocgName}`);
  }
  if (
    expected.operators.length !== actual.operators.length ||
    expected.operators.some((op, i) => op !== actual.operators[i])
  ) {
    differences.push(
      `operatorreeks wijkt af (${expected.operators.length} vs ${actual.operators.length} operatoren)`,
    );
  }
  if (!compareNumberArrays(expected.coordinates, actual.coordinates)) {
    differences.push("coördinaten wijken af");
  }
  if (!nameAgnostic && expected.resourceNames.join(",") !== actual.resourceNames.join(",")) {
    differences.push(
      `resourceverwijzingen wijken af (${expected.resourceNames.join(" ")} vs ${actual.resourceNames.join(" ")})`,
    );
  }
  const colorValues = (sig: LayerSignature) => Object.values(sig.colorSpaces).sort().join(",");
  const stateValues = (sig: LayerSignature) =>
    Object.values(sig.graphicsStates)
      .map((state) => JSON.stringify(state))
      .sort()
      .join(",");
  if (
    nameAgnostic
      ? colorValues(expected) !== colorValues(actual)
      : JSON.stringify(expected.colorSpaces) !== JSON.stringify(actual.colorSpaces)
  ) {
    differences.push("kleurruimten wijken af");
  }
  if (
    nameAgnostic
      ? stateValues(expected) !== stateValues(actual)
      : JSON.stringify(expected.graphicsStates) !== JSON.stringify(actual.graphicsStates)
  ) {
    differences.push("graphics states wijken af");
  }
  if (!nameAgnostic && expected.fonts.join(",") !== actual.fonts.join(",")) {
    differences.push("fontverwijzingen wijken af");
  }

  return { layer, matches: differences.length === 0, differences };
}

export interface OutputValidationInput {
  config: TemplateConfig;
  master: PdfInspection;
  output: PdfInspection;
  /** Transformation matrix the engine wrote for the artwork placement. */
  artworkMatrix: number[] | undefined;
  /** XObject name of the placed artwork. */
  artworkXObjectName: string | undefined;
}

export function validateOutput({
  config,
  master,
  output,
  artworkMatrix,
  artworkXObjectName,
}: OutputValidationInput): ValidationOutcome {
  const checks: ValidationCheck[] = [];
  const errors: PrepressError[] = [];

  if (!output.valid || output.pageCount === 0) {
    checks.push(fail("output_pdf_valid", "PDF geldig", true, output.parseError));
    errors.push({
      code: PrepressErrorCode.OUTPUT_INVALID_PDF,
      message: `Gegenereerde PDF kon niet worden gelezen: ${output.parseError ?? "onbekende fout"}`,
    });
    return { checks, errors };
  }
  checks.push(pass("output_pdf_valid", "PDF geldig"));

  if (output.pageCount === 1) {
    checks.push(pass("output_page_count", "Exact één pagina"));
  } else {
    checks.push(fail("output_page_count", "Exact één pagina", true, `${output.pageCount}`));
    errors.push({
      code: PrepressErrorCode.OUTPUT_PAGE_COUNT_INVALID,
      message: `Output bevat ${output.pageCount} pagina's`,
    });
  }

  if (boxesMatch(output.mediaBox, master.mediaBox, config.pageSizeTolerancePt)) {
    checks.push(pass("output_page_size", "Paginaformaat gelijk aan master", true, formatBox(output.mediaBox)));
  } else {
    checks.push(fail("output_page_size", "Paginaformaat gelijk aan master", true, formatBox(output.mediaBox)));
    errors.push({
      code: PrepressErrorCode.OUTPUT_PAGE_SIZE_MISMATCH,
      message: `Paginaformaat output (${formatBox(output.mediaBox)}) wijkt af van master (${formatBox(master.mediaBox)})`,
    });
  }

  const required = allLayerNames(config);
  const missing = required.filter((name) => !output.ocgNames.includes(name));
  if (missing.length === 0) {
    checks.push(pass("output_layers", "Vier vereiste lagen aanwezig met correcte namen"));
  } else {
    checks.push(fail("output_layers", "Vier vereiste lagen aanwezig met correcte namen", true, missing.join(", ")));
    errors.push({
      code: PrepressErrorCode.OUTPUT_LAYER_MISSING,
      message: `Laag/lagen ontbreken in output: ${missing.join(", ")}`,
    });
  }

  const extraOcgs = output.allOcgNames.filter((name) => !required.includes(name));
  if (extraOcgs.length === 0 && output.ocgNames.length === required.length) {
    checks.push(pass("output_no_extra_ocg", "Geen extra lagen (bijv. artwork-eigen 'Laag 1')"));
  } else {
    const detail = [...new Set(extraOcgs)].join(", ") || `${output.ocgNames.length} OCG's geregistreerd`;
    checks.push(fail("output_no_extra_ocg", "Geen extra lagen (bijv. artwork-eigen 'Laag 1')", true, detail));
    errors.push({
      code: PrepressErrorCode.OUTPUT_EXTRA_OCG,
      message: `Output bevat extra Optional Content Group(s): ${detail}`,
    });
  }

  const orderMatches =
    output.layerOrder.length === config.layerOrder.length &&
    output.layerOrder.every((name, index) => name === config.layerOrder[index]);
  if (orderMatches) {
    checks.push(pass("output_layer_order", "Laagvolgorde correct"));
  } else {
    checks.push(fail("output_layer_order", "Laagvolgorde correct", true, output.layerOrder.join(" | ")));
    errors.push({
      code: PrepressErrorCode.OUTPUT_LAYER_ORDER_INVALID,
      message: `Laagvolgorde output wijkt af: ${output.layerOrder.join(" | ")}`,
    });
  }

  const visibilityProblems = Object.entries(config.defaultVisibility).filter(([name, visible]) =>
    visible ? !output.visibleLayers.includes(name) : !output.hiddenLayers.includes(name),
  );
  if (visibilityProblems.length === 0) {
    checks.push(pass("output_layer_visibility", "Standaard zichtbaarheid correct (Maten verborgen)"));
  } else {
    checks.push(
      fail(
        "output_layer_visibility",
        "Standaard zichtbaarheid correct (Maten verborgen)",
        true,
        visibilityProblems.map(([name]) => name).join(", "),
      ),
    );
    errors.push({
      code: PrepressErrorCode.OUTPUT_LAYER_VISIBILITY_INVALID,
      message: `Standaard zichtbaarheid onjuist voor: ${visibilityProblems.map(([n]) => n).join(", ")}`,
    });
  }

  if (whiteSeparationPresent(output, config.spotColors.white)) {
    checks.push(pass("output_white_separation", `Steunkleur ${config.spotColors.white} behouden`));
  } else {
    checks.push(fail("output_white_separation", `Steunkleur ${config.spotColors.white} behouden`));
    errors.push({
      code: PrepressErrorCode.OUTPUT_WHITE_SEPARATION_MISSING,
      message: "White Separation ontbreekt in de gegenereerde PDF",
    });
  }

  const whiteLayerSignature = output.layerSignatures[config.layers.white];
  const whiteOverprint = Object.values(whiteLayerSignature?.graphicsStates ?? {}).some(
    (state) => state.OP === true && state.op === true && state.OPM === 1,
  );
  if (whiteOverprint && overprintStatePresent(output)) {
    checks.push(pass("output_white_overprint", "Dekwit overprint behouden (OP=true, op=true, OPM=1)"));
  } else {
    checks.push(fail("output_white_overprint", "Dekwit overprint behouden (OP=true, op=true, OPM=1)"));
    errors.push({
      code: PrepressErrorCode.OUTPUT_WHITE_OVERPRINT_MISSING,
      message: "Overprintinstelling van het dekwit is niet aantoonbaar behouden",
    });
  }

  const artworkSignature = output.layerSignatures[config.layers.artwork];
  const artworkPresent =
    !!artworkSignature &&
    artworkSignature.operators.includes("Do") &&
    (artworkXObjectName === undefined ||
      artworkSignature.resourceNames.includes(`/${artworkXObjectName}`));
  if (artworkPresent) {
    checks.push(pass("output_artwork_present", "Artwork toegevoegd"));
    checks.push(pass("output_artwork_ocg", "Artwork gekoppeld aan de bestaande artworklaag"));
  } else {
    checks.push(fail("output_artwork_present", "Artwork toegevoegd"));
    errors.push({
      code: artworkSignature
        ? PrepressErrorCode.OUTPUT_ARTWORK_OCG_UNLINKED
        : PrepressErrorCode.OUTPUT_ARTWORK_MISSING,
      message: artworkSignature
        ? "Artwork kon niet correct aan de Artwork OCG worden gekoppeld"
        : "Artworkcontent niet aangetroffen in de output",
    });
  }

  const identity = artworkMatrix !== undefined && compareNumberArrays(artworkMatrix, [1, 0, 0, 1, 0, 0]);
  if (identity) {
    checks.push(pass("output_artwork_not_scaled", "Artwork niet geschaald (matrix 1 0 0 1 0 0)"));
  } else {
    checks.push(
      fail("output_artwork_not_scaled", "Artwork niet geschaald (matrix 1 0 0 1 0 0)", true, artworkMatrix?.join(" ")),
    );
    errors.push({
      code: PrepressErrorCode.OUTPUT_ARTWORK_SCALED,
      message: `Artwork transformatiematrix is niet de identiteit: ${artworkMatrix?.join(" ") ?? "onbekend"}`,
    });
  }

  const layerComparisons = technicalLayerNames(config).map((layer) =>
    compareLayerSignature(master.layerSignatures[layer], output.layerSignatures[layer], layer),
  );
  for (const comparison of layerComparisons) {
    const label =
      comparison.layer === config.layers.dieCut
        ? "Stans behouden (semantisch gelijk aan master)"
        : comparison.layer === config.layers.dimensions
          ? "Maten behouden (semantisch gelijk aan master)"
          : "Dekwit behouden (semantisch gelijk aan master)";
    if (comparison.matches) {
      checks.push(pass(`output_layer_${comparison.layer}`, label));
    } else {
      checks.push(fail(`output_layer_${comparison.layer}`, label, true, comparison.differences.join("; ")));
      errors.push({
        code: PrepressErrorCode.OUTPUT_MASTER_CONTENT_CHANGED,
        message: `Technische mastercontent van "${comparison.layer}" is gewijzigd: ${comparison.differences.join("; ")}`,
      });
    }
  }

  return { checks, errors };
}

/** POC/test-only: semantic comparison against the manually produced reference. */
export function compareWithGolden(
  config: TemplateConfig,
  generated: PdfInspection,
  golden: PdfInspection,
): GoldenComparisonRow[] {
  const rows: GoldenComparisonRow[] = [];
  const add = (property: string, a: string, b: string) =>
    rows.push({ property, matches: a === b, generated: a, golden: b });

  add("paginaformaat", formatBox(generated.mediaBox), formatBox(golden.mediaBox));
  add("aantal pagina's", String(generated.pageCount), String(golden.pageCount));
  add("OCG's", [...generated.ocgNames].sort().join(" | "), [...golden.ocgNames].sort().join(" | "));
  add("laagvolgorde", generated.layerOrder.join(" | "), golden.layerOrder.join(" | "));
  add("verborgen lagen", generated.hiddenLayers.join(" | "), golden.hiddenLayers.join(" | "));
  add("zichtbare lagen", [...generated.visibleLayers].sort().join(" | "), [...golden.visibleLayers].sort().join(" | "));
  add("separations", [...generated.separations].sort().join(" | "), [...golden.separations].sort().join(" | "));
  add(
    "white overprint aanwezig",
    String(overprintStatePresent(generated)),
    String(overprintStatePresent(golden)),
  );
  add(
    "technische steunkleurruimten",
    [...new Set(Object.values(generated.colorSpaces))].filter((v) => v.startsWith("/Separation")).sort().join(" | "),
    [...new Set(Object.values(golden.colorSpaces))].filter((v) => v.startsWith("/Separation")).sort().join(" | "),
  );
  for (const layer of technicalLayerNames(config)) {
    const comparison = compareLayerSignature(
      golden.layerSignatures[layer],
      generated.layerSignatures[layer],
      layer,
      true,
    );
    rows.push({
      property: `laagcontent ${layer}`,
      matches: comparison.matches,
      generated: comparison.matches ? "gelijk" : comparison.differences.join("; "),
      golden: "referentie",
    });
  }
  const genArtwork = generated.layerSignatures[config.layers.artwork];
  const goldArtwork = golden.layerSignatures[config.layers.artwork];
  add(
    "artworklaag bevat content",
    String((genArtwork?.operators.length ?? 0) > 0),
    String((goldArtwork?.operators.length ?? 0) > 0),
  );
  return rows;
}