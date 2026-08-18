/**
 * Optional SleeveManager Validation V2 — read-only PDF inspection.
 *
 * Functional specification: the Illustrator script BedrukteFles-SleeveManager-v11.jsx.
 * That script also *corrects* documents; this module NEVER modifies anything.
 * It only inspects the already generated output PDF and reports findings.
 *
 * Validation 1 stays the only production gating validator; this report is
 * informational (blocking: false).
 */
import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  decodePDFRawStream,
  type PDFDocument,
} from "pdf-lib";
import { findMarkedContentBlocks, getPageContentString, loadPdf } from "../core/pdf-inspect";
import type { TemplateConfig } from "../core/types";
import { sleeveManagerV2Config } from "./sleevemanager-config";
import type { V2Check, V2CheckStatus, V2Complexity, V2Report } from "./sleevemanager-types";

/* ------------------------------------------------------------------ helpers */

function lookup(doc: PDFDocument, value: unknown): unknown {
  return value instanceof PDFRef ? doc.context.lookup(value) : value;
}

function asDict(doc: PDFDocument, value: unknown): PDFDict | undefined {
  const resolved = lookup(doc, value);
  if (resolved instanceof PDFDict) return resolved;
  if (resolved instanceof PDFStream) return resolved.dict;
  return undefined;
}

function asArray(doc: PDFDocument, value: unknown): PDFArray | undefined {
  const resolved = lookup(doc, value);
  return resolved instanceof PDFArray ? resolved : undefined;
}

function sub(doc: PDFDocument, dict: PDFDict | undefined, key: string): PDFDict | undefined {
  if (!dict) return undefined;
  return asDict(doc, dict.get(PDFName.of(key)));
}

function decodeText(value: unknown): string | undefined {
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText();
  return undefined;
}

function ocgNamesFrom(doc: PDFDocument, array: PDFArray | undefined): string[] {
  if (!array) return [];
  const out: string[] = [];
  for (let i = 0; i < array.size(); i += 1) {
    const entry = array.get(i);
    const nested = asArray(doc, entry);
    if (nested) {
      out.push(...ocgNamesFrom(doc, nested));
      continue;
    }
    const name = decodeText(asDict(doc, entry)?.get(PDFName.of("Name")));
    if (name) out.push(name);
  }
  return out;
}

function streamText(doc: PDFDocument, stream: PDFStream): string {
  void doc;
  const bytes =
    stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents();
  let out = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return out;
}

function hex(channels: number[]): string {
  return `#${channels
    .map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();
}

function cmykToRgb(c: number, m: number, y: number, k: number): number[] {
  return [255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k)];
}

function hexClose(a: string, b: string, tolerance: number): boolean {
  const parse = (value: string) => {
    const clean = value.replace("#", "");
    return [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16));
  };
  const left = parse(a);
  const right = parse(b);
  return left.every((v, i) => Math.abs(v - (right[i] ?? 0)) <= tolerance);
}

/* ------------------------------------------------------ colour space model */

interface ColorSpaceInfo {
  family: string;
  /** Separation / DeviceN colorant names. */
  colorants: string[];
  isRgb: boolean;
  /** Derived alternate colour at tint 1.0, when reliably computable. */
  alternateHex?: string;
  alternateVerifiable: boolean;
}

function iccFamily(doc: PDFDocument, streamValue: unknown): { family: string; isRgb: boolean } {
  const dict = asDict(doc, streamValue);
  const n = dict?.get(PDFName.of("N"));
  const components = n instanceof PDFNumber ? n.asNumber() : 0;
  if (components === 3) return { family: "ICCBased RGB", isRgb: true };
  if (components === 4) return { family: "ICCBased CMYK", isRgb: false };
  if (components === 1) return { family: "ICCBased Gray", isRgb: false };
  return { family: "ICCBased", isRgb: false };
}

/** Evaluates a tint transform at tint 1.0 — only exponential (type 2) functions. */
function tintAtOne(doc: PDFDocument, fnValue: unknown): number[] | undefined {
  const dict = asDict(doc, fnValue);
  const type = dict?.get(PDFName.of("FunctionType"));
  if (!(type instanceof PDFNumber) || type.asNumber() !== 2) return undefined;
  const c1 = asArray(doc, dict?.get(PDFName.of("C1")));
  if (!c1) return undefined;
  const values: number[] = [];
  for (let i = 0; i < c1.size(); i += 1) {
    const entry = lookup(doc, c1.get(i));
    if (!(entry instanceof PDFNumber)) return undefined;
    values.push(entry.asNumber());
  }
  return values;
}

function resolveColorSpace(doc: PDFDocument, value: unknown, depth = 0): ColorSpaceInfo {
  const base: ColorSpaceInfo = { family: "?", colorants: [], isRgb: false, alternateVerifiable: false };
  if (depth > 4) return base;
  const resolved = lookup(doc, value);

  if (resolved instanceof PDFName) {
    const name = resolved.asString();
    if (name === "/DeviceRGB" || name === "/RGB") return { ...base, family: "DeviceRGB", isRgb: true };
    if (name === "/DeviceCMYK" || name === "/CMYK") return { ...base, family: "DeviceCMYK" };
    if (name === "/DeviceGray" || name === "/G") return { ...base, family: "DeviceGray" };
    if (name === "/Pattern") return { ...base, family: "Pattern" };
    return { ...base, family: name.slice(1) };
  }

  const array = resolved instanceof PDFArray ? resolved : undefined;
  if (!array || array.size() === 0) return base;
  const familyName = lookup(doc, array.get(0));
  const family = familyName instanceof PDFName ? familyName.asString().slice(1) : "?";

  if (family === "ICCBased") {
    const icc = iccFamily(doc, array.get(1));
    return { ...base, family: icc.family, isRgb: icc.isRgb };
  }
  if (family === "Indexed") {
    const inner = resolveColorSpace(doc, array.get(1), depth + 1);
    return { ...base, family: `Indexed ${inner.family}`, isRgb: inner.isRgb };
  }
  if (family === "Separation" || family === "DeviceN") {
    const colorants: string[] = [];
    const nameValue = lookup(doc, array.get(1));
    if (nameValue instanceof PDFName) colorants.push(nameValue.asString().slice(1));
    const namesArray = asArray(doc, array.get(1));
    if (namesArray) {
      for (let i = 0; i < namesArray.size(); i += 1) {
        const entry = lookup(doc, namesArray.get(i));
        if (entry instanceof PDFName) colorants.push(entry.asString().slice(1));
      }
    }
    const alt = resolveColorSpace(doc, array.get(2), depth + 1);
    const tint = tintAtOne(doc, array.get(3));
    let alternateHex: string | undefined;
    if (tint) {
      if ((alt.family === "DeviceRGB" || alt.family === "ICCBased RGB") && tint.length >= 3) {
        alternateHex = hex(tint.slice(0, 3).map((v) => v * 255));
      } else if ((alt.family === "DeviceCMYK" || alt.family === "ICCBased CMYK") && tint.length >= 4) {
        alternateHex = hex(cmykToRgb(tint[0]!, tint[1]!, tint[2]!, tint[3]!));
      }
    }
    return {
      ...base,
      family,
      colorants,
      isRgb: false,
      ...(alternateHex ? { alternateHex } : {}),
      alternateVerifiable: alternateHex !== undefined,
    };
  }
  if (family === "Lab" || family === "CalRGB") {
    return { ...base, family, isRgb: family === "CalRGB" };
  }
  return { ...base, family };
}

/* --------------------------------------------------------- content scanning */

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;
const PATH_OPS = new Set(["m", "l", "c", "v", "y", "re"]);

interface ScannedContent {
  gsNames: string[];
  colorSpaceNames: string[];
  xObjectNames: string[];
  shadingNames: string[];
  strokeWidths: number[];
  pathSegments: number;
  subpathStarts: number;
  /** Device colour operators used inline. */
  inlineRgb: number;
  inlineCmyk: number;
  inlineGray: number;
  inlineImages: number;
  nonIdentityCm: boolean;
}

function scanContent(content: string): ScannedContent {
  const result: ScannedContent = {
    gsNames: [],
    colorSpaceNames: [],
    xObjectNames: [],
    shadingNames: [],
    strokeWidths: [],
    pathSegments: 0,
    subpathStarts: 0,
    inlineRgb: 0,
    inlineCmyk: 0,
    inlineGray: 0,
    inlineImages: 0,
    nonIdentityCm: false,
  };
  const tokens = content
    .replace(/[[\]{}]/g, (m) => ` ${m} `)
    .split(/\s+/)
    .filter((token) => token.length > 0);

  let operands: string[] = [];
  for (const token of tokens) {
    if (NUMBER.test(token) || token.startsWith("/") || token.startsWith("(") || token === "[" || token === "]") {
      operands.push(token);
      continue;
    }
    const op = token;
    const lastName = [...operands].reverse().find((o) => o.startsWith("/"));
    if (op === "gs" && lastName) result.gsNames.push(lastName.slice(1));
    else if ((op === "cs" || op === "CS") && lastName) result.colorSpaceNames.push(lastName.slice(1));
    else if (op === "Do" && lastName) result.xObjectNames.push(lastName.slice(1));
    else if (op === "sh" && lastName) result.shadingNames.push(lastName.slice(1));
    else if (op === "scn" || op === "SCN") {
      if (lastName) result.colorSpaceNames.push(lastName.slice(1));
    } else if (op === "w") {
      const value = Number(operands[operands.length - 1]);
      if (Number.isFinite(value)) result.strokeWidths.push(value);
    } else if (op === "rg" || op === "RG") result.inlineRgb += 1;
    else if (op === "k" || op === "K") result.inlineCmyk += 1;
    else if (op === "g" || op === "G") result.inlineGray += 1;
    else if (op === "BI") result.inlineImages += 1;
    else if (op === "cm") {
      const nums = operands.slice(-6).map(Number);
      if (nums.length === 6 && nums.every((n) => Number.isFinite(n))) {
        const identity = [1, 0, 0, 1];
        if (nums.slice(0, 4).some((n, i) => Math.abs(n - identity[i]!) > 1e-6)) result.nonIdentityCm = true;
      }
    } else if (PATH_OPS.has(op)) {
      result.pathSegments += 1;
      if (op === "m" || op === "re") result.subpathStarts += 1;
    }
    operands = [];
  }
  return result;
}

/* ------------------------------------------------------- artwork traversal */

interface ArtworkAnalysis {
  scanned: ScannedContent[];
  overprintStates: string[];
  transparencySignals: string[];
  colorSpaceFamilies: Set<string>;
  spotColors: Set<string>;
  rgbResources: string[];
  rgbImages: string[];
  imageCount: number;
  formCount: number;
  pathSegments: number;
  inlineImages: number;
}

function readGraphicsState(dict: PDFDict): {
  overprint: boolean;
  transparency: string[];
} {
  const transparency: string[] = [];
  const bool = (key: string) => {
    const value = dict.get(PDFName.of(key));
    return value instanceof PDFBool ? value.asBoolean() : undefined;
  };
  const num = (key: string) => {
    const value = dict.get(PDFName.of(key));
    return value instanceof PDFNumber ? value.asNumber() : undefined;
  };
  const ca = num("ca");
  const CA = num("CA");
  if (ca !== undefined && ca < 1) transparency.push(`ca=${ca}`);
  if (CA !== undefined && CA < 1) transparency.push(`CA=${CA}`);
  const bm = dict.get(PDFName.of("BM"));
  if (bm instanceof PDFName && !["/Normal", "/Compatible"].includes(bm.asString())) {
    transparency.push(`BM=${bm.asString().slice(1)}`);
  }
  if (bm instanceof PDFArray) {
    const first = bm.get(0);
    if (first instanceof PDFName && !["/Normal", "/Compatible"].includes(first.asString())) {
      transparency.push(`BM=${first.asString().slice(1)}`);
    }
  }
  const smask = dict.get(PDFName.of("SMask"));
  if (smask !== undefined && !(smask instanceof PDFName && smask.asString() === "/None")) {
    transparency.push("SMask");
  }
  return { overprint: bool("OP") === true || bool("op") === true, transparency };
}

function analyzeArtwork(
  doc: PDFDocument,
  startContent: string,
  startResources: PDFDict | undefined,
): ArtworkAnalysis {
  const analysis: ArtworkAnalysis = {
    scanned: [],
    overprintStates: [],
    transparencySignals: [],
    colorSpaceFamilies: new Set(),
    spotColors: new Set(),
    rgbResources: [],
    rgbImages: [],
    imageCount: 0,
    formCount: 0,
    pathSegments: 0,
    inlineImages: 0,
  };
  const visited = new Set<string>();

  const walk = (content: string, resources: PDFDict | undefined, label: string) => {
    const scanned = scanContent(content);
    analysis.scanned.push(scanned);
    analysis.pathSegments += scanned.pathSegments;
    analysis.inlineImages += scanned.inlineImages;
    if (scanned.inlineRgb > 0) analysis.rgbResources.push(`${label}: inline rg/RG ×${scanned.inlineRgb}`);

    const gsDict = sub(doc, resources, "ExtGState");
    for (const name of new Set(scanned.gsNames)) {
      const dict = sub(doc, gsDict, name);
      if (!dict) continue;
      const state = readGraphicsState(dict);
      if (state.overprint) analysis.overprintStates.push(`${label}/${name}`);
      for (const signal of state.transparency) {
        analysis.transparencySignals.push(`${label}/${name}: ${signal}`);
      }
    }

    const csDict = sub(doc, resources, "ColorSpace");
    for (const name of new Set(scanned.colorSpaceNames)) {
      const raw = csDict?.get(PDFName.of(name));
      if (raw === undefined) continue;
      const info = resolveColorSpace(doc, raw);
      analysis.colorSpaceFamilies.add(info.family);
      for (const colorant of info.colorants) {
        if (!["All", "None"].includes(colorant)) analysis.spotColors.add(colorant);
      }
      if (info.isRgb) analysis.rgbResources.push(`${label}: /${name} ${info.family}`);
    }
    if (scanned.inlineRgb > 0) analysis.colorSpaceFamilies.add("DeviceRGB");
    if (scanned.inlineCmyk > 0) analysis.colorSpaceFamilies.add("DeviceCMYK");
    if (scanned.inlineGray > 0) analysis.colorSpaceFamilies.add("DeviceGray");

    const xDict = sub(doc, resources, "XObject");
    for (const name of new Set(scanned.xObjectNames)) {
      const raw = xDict?.get(PDFName.of(name));
      const resolved = lookup(doc, raw);
      if (!(resolved instanceof PDFStream)) continue;
      const key = raw instanceof PDFRef ? raw.toString() : `${label}/${name}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const dict = resolved.dict;
      const subtype = dict.get(PDFName.of("Subtype"));
      const subtypeName = subtype instanceof PDFName ? subtype.asString() : "?";

      if (subtypeName === "/Image") {
        analysis.imageCount += 1;
        const info = resolveColorSpace(doc, dict.get(PDFName.of("ColorSpace")));
        analysis.colorSpaceFamilies.add(info.family);
        if (info.isRgb) analysis.rgbImages.push(`${name} (${info.family})`);
        const smask = dict.get(PDFName.of("SMask"));
        if (smask !== undefined) analysis.transparencySignals.push(`${label}/${name}: image SMask`);
        continue;
      }
      if (subtypeName !== "/Form") continue;
      analysis.formCount += 1;
      const group = sub(doc, dict, "Group");
      const groupSubtype = group?.get(PDFName.of("S"));
      if (groupSubtype instanceof PDFName && groupSubtype.asString() === "/Transparency") {
        analysis.transparencySignals.push(`${label}/${name}: transparency group`);
      }
      walk(streamText(doc, resolved), sub(doc, dict, "Resources"), `${label}/${name}`);
    }
  };

  walk(startContent, startResources, "artwork");
  return analysis;
}

/* --------------------------------------------------------------- reporting */

function scoreComplexity(pathSegments: number): V2Complexity["pdfComplexityScore"] {
  if (pathSegments < 2000) return "Zeer goed";
  if (pathSegments < 10000) return "Goed";
  if (pathSegments < 40000) return "Matig";
  return "Slecht";
}

function overall(checks: V2Check[]): "PASS" | "WARNING" | "FAIL" {
  if (checks.some((c) => c.status === "FAIL")) return "FAIL";
  if (checks.some((c) => c.status === "WARNING" || c.status === "NOT_VERIFIABLE")) return "WARNING";
  return "PASS";
}

/**
 * Inspects an already generated print-ready PDF. Never modifies the document.
 */
export async function runSleeveManagerValidation(
  pdfBytes: Uint8Array,
  config: TemplateConfig,
): Promise<V2Report> {
  const checks: V2Check[] = [];
  const findings: string[] = [];
  const add = (key: string, label: string, status: V2CheckStatus, detail?: string) => {
    checks.push(detail === undefined ? { key, label, status } : { key, label, status, detail });
    if (status === "FAIL" || status === "WARNING") findings.push(`${label}${detail ? `: ${detail}` : ""}`);
  };

  const emptyComplexity: V2Complexity = {
    fileSizeBytes: pdfBytes.length,
    fileSizeMb: Math.round((pdfBytes.length / (1024 * 1024)) * 100) / 100,
    imageXObjects: 0,
    formXObjects: 0,
    pathSegments: 0,
    pdfComplexityScore: "Zeer goed",
    note: "PDF complexity score — niet 1-op-1 gelijk aan de Illustrator SleeveManager-score (anchor points).",
  };

  let doc: PDFDocument;
  try {
    doc = await loadPdf(pdfBytes);
  } catch (error) {
    return {
      enabled: true,
      name: sleeveManagerV2Config.name,
      blocking: false,
      status: "FAIL",
      checks: [{ key: "pdf_readable", label: "PDF leesbaar voor validatie 2", status: "FAIL" }],
      checkStatus: { pdf_readable: "FAIL" },
      findings: ["PDF kon niet worden geanalyseerd"],
      complexity: emptyComplexity,
      artworkColorSpaces: [],
      artworkSpotColors: [],
      rgbImages: { count: 0, names: [] },
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const page = doc.getPage(0);
  const resources = sub(doc, page.node, "Resources");
  const csDict = sub(doc, resources, "ColorSpace");
  const gsDict = sub(doc, resources, "ExtGState");
  const propertiesDict = sub(doc, resources, "Properties");

  // OCG state
  const ocProps = sub(doc, doc.catalog, "OCProperties");
  const ocgs = asArray(doc, ocProps?.get(PDFName.of("OCGs")));
  const ocgNames = ocgNamesFrom(doc, ocgs);
  const defaultConfig = sub(doc, ocProps, "D");
  const offNames = ocgNamesFrom(doc, asArray(doc, defaultConfig?.get(PDFName.of("OFF"))));
  const onNames = ocgNamesFrom(doc, asArray(doc, defaultConfig?.get(PDFName.of("ON"))));
  const isVisible = (name: string) => onNames.includes(name) || !offNames.includes(name);

  // Marked content blocks per OCG name
  const content = getPageContentString(doc);
  const mcToLayer = new Map<string, string>();
  if (propertiesDict) {
    for (const [key, value] of propertiesDict.entries()) {
      const name = decodeText(asDict(doc, value)?.get(PDFName.of("Name")));
      if (name) mcToLayer.set(key.asString().slice(1), name);
    }
  }
  const layerContent = new Map<string, string>();
  for (const block of findMarkedContentBlocks(content)) {
    const layer = mcToLayer.get(block.propertyName);
    if (!layer) continue;
    layerContent.set(layer, `${layerContent.get(layer) ?? ""}\n${block.content}`);
  }

  // Colour space resources by colorant name
  const separationByColorant = new Map<string, { resourceName: string; info: ColorSpaceInfo }>();
  for (const [key, value] of csDict?.entries() ?? []) {
    const info = resolveColorSpace(doc, value);
    for (const colorant of info.colorants) {
      separationByColorant.set(colorant, { resourceName: key.asString().slice(1), info });
    }
  }

  const usesResource = (layer: string, resourceName: string) => {
    const layerBody = layerContent.get(layer);
    if (!layerBody) return false;
    const scanned = scanContent(layerBody);
    return scanned.colorSpaceNames.includes(resourceName);
  };

  /* ---------------------------------------------------------- White checks */
  const whiteLayer = config.layers.white;
  add(
    "white_layer_present",
    `OCG "${whiteLayer}" aanwezig`,
    ocgNames.includes(whiteLayer) ? "PASS" : "FAIL",
  );
  add(
    "white_layer_visible",
    "Wit-laag standaard zichtbaar",
    ocgNames.includes(whiteLayer) ? (isVisible(whiteLayer) ? "PASS" : "FAIL") : "NOT_VERIFIABLE",
  );

  const whiteSpotName = config.spotColors.white;
  const whiteSeparation = separationByColorant.get(whiteSpotName);
  add(
    "white_spot",
    `Separation "${whiteSpotName}" aanwezig`,
    whiteSeparation ? "PASS" : "FAIL",
    whiteSeparation ? `/${whiteSeparation.resourceName} ${whiteSeparation.info.family}` : undefined,
  );
  add(
    "white_spot_used",
    "Wit-content gebruikt de White-separation",
    whiteSeparation
      ? usesResource(whiteLayer, whiteSeparation.resourceName)
        ? "PASS"
        : "FAIL"
      : "NOT_VERIFIABLE",
  );

  const whiteBody = layerContent.get(whiteLayer);
  if (whiteBody) {
    const scanned = scanContent(whiteBody);
    const states = [...new Set(scanned.gsNames)]
      .map((name) => ({ name, dict: sub(doc, gsDict, name) }))
      .filter((entry) => entry.dict !== undefined);
    const overprinting = states.filter(({ dict }) => {
      const op = dict!.get(PDFName.of("OP"));
      const opLower = dict!.get(PDFName.of("op"));
      const opm = dict!.get(PDFName.of("OPM"));
      return (
        op instanceof PDFBool &&
        op.asBoolean() &&
        opLower instanceof PDFBool &&
        opLower.asBoolean() &&
        opm instanceof PDFNumber &&
        opm.asNumber() === 1
      );
    });
    add(
      "white_overprint",
      "Overdruk actief op Wit-content (OP=true, op=true, OPM=1)",
      states.length === 0 ? "FAIL" : overprinting.length > 0 ? "PASS" : "FAIL",
      states.length === 0
        ? "Geen ExtGState in de Wit-content"
        : `${overprinting.length}/${states.length} graphics states volledig overprint`,
    );
  } else {
    add("white_overprint", "Overdruk actief op Wit-content", "NOT_VERIFIABLE", "Geen Wit-content gevonden");
  }

  if (whiteSeparation?.info.alternateVerifiable && whiteSeparation.info.alternateHex) {
    const matches = hexClose(
      whiteSeparation.info.alternateHex,
      sleeveManagerV2Config.whiteAlternateHex,
      sleeveManagerV2Config.hexChannelTolerance,
    );
    add(
      "white_alternate_color",
      `Alternatieve kleur White ≈ ${sleeveManagerV2Config.whiteAlternateHex}`,
      matches ? "PASS" : "FAIL",
      `Afgeleid: ${whiteSeparation.info.alternateHex}`,
    );
  } else {
    add(
      "white_alternate_color",
      `Alternatieve kleur White ≈ ${sleeveManagerV2Config.whiteAlternateHex}`,
      "NOT_VERIFIABLE",
      "Tint transform niet betrouwbaar te evalueren (geen type 2 functie)",
    );
  }

  /* ---------------------------------------------------------- Stans checks */
  const stansLayer = config.layers.dieCut;
  add("stans_layer_present", `OCG "${stansLayer}" aanwezig`, ocgNames.includes(stansLayer) ? "PASS" : "FAIL");
  add(
    "stans_layer_visible",
    "Stans-laag standaard zichtbaar",
    ocgNames.includes(stansLayer) ? (isVisible(stansLayer) ? "PASS" : "FAIL") : "NOT_VERIFIABLE",
  );

  const stansSeparation =
    separationByColorant.get("Stans") ??
    [...separationByColorant.entries()].find(([name]) => /stans|die.?cut/i.test(name))?.[1];
  add(
    "stans_spot",
    'Separation "Stans" aanwezig',
    stansSeparation ? "PASS" : "FAIL",
    stansSeparation ? `/${stansSeparation.resourceName} ${stansSeparation.info.family}` : undefined,
  );
  add(
    "stans_spot_used",
    "Stans-content gebruikt de Stans-separation",
    stansSeparation
      ? usesResource(stansLayer, stansSeparation.resourceName)
        ? "PASS"
        : "FAIL"
      : "NOT_VERIFIABLE",
  );

  const stansBody = layerContent.get(stansLayer);
  if (stansBody) {
    const scanned = scanContent(stansBody);
    const widths = [...new Set(scanned.strokeWidths)];
    const expected = sleeveManagerV2Config.stansStrokeWidthPt;
    const tol = sleeveManagerV2Config.strokeWidthTolerancePt;
    if (widths.length === 0) {
      add("stans_width", "Stans-lijnbreedte 1 pt", "NOT_VERIFIABLE", "Geen expliciete 'w' operator gevonden");
    } else if (scanned.nonIdentityCm) {
      add(
        "stans_width",
        "Stans-lijnbreedte 1 pt",
        "NOT_VERIFIABLE",
        `Niet-identieke CTM in de Stans-content; gevonden w: ${widths.join(", ")}`,
      );
    } else {
      const ok = widths.every((w) => Math.abs(w - expected) <= tol);
      add("stans_width", "Stans-lijnbreedte 1 pt", ok ? "PASS" : "FAIL", `w: ${widths.join(", ")}`);
    }
    add(
      "stans_subpaths",
      "Aantal stans-subpaden (PDF-afgeleid)",
      scanned.subpathStarts === 1 ? "PASS" : "WARNING",
      `${scanned.subpathStarts} subpad(en), ${scanned.pathSegments} padsegmenten`,
    );
  } else {
    add("stans_width", "Stans-lijnbreedte 1 pt", "NOT_VERIFIABLE", "Geen Stans-content gevonden");
    add("stans_subpaths", "Aantal stans-subpaden (PDF-afgeleid)", "NOT_VERIFIABLE");
  }
  add(
    "stans_exact_path_item_count",
    "Precies één Illustrator PathItem voor de stans",
    "NOT_VERIFIABLE",
    "Illustrator PathItem-begrip bestaat niet in PDF; zie stans_subpaths",
  );

  if (stansSeparation?.info.alternateVerifiable && stansSeparation.info.alternateHex) {
    const matches = hexClose(
      stansSeparation.info.alternateHex,
      sleeveManagerV2Config.stansAlternateHex,
      sleeveManagerV2Config.hexChannelTolerance,
    );
    add(
      "stans_alternate_color",
      `Alternatieve kleur Stans ≈ ${sleeveManagerV2Config.stansAlternateHex}`,
      matches ? "PASS" : "FAIL",
      `Afgeleid: ${stansSeparation.info.alternateHex}`,
    );
  } else {
    add(
      "stans_alternate_color",
      `Alternatieve kleur Stans ≈ ${sleeveManagerV2Config.stansAlternateHex}`,
      "NOT_VERIFIABLE",
      "Tint transform niet betrouwbaar te evalueren",
    );
  }

  /* ---------------------------------------------------------- Maten checks */
  const matenLayer = config.layers.dimensions;
  add("maten_layer_present", `OCG "${matenLayer}" aanwezig`, ocgNames.includes(matenLayer) ? "PASS" : "FAIL");
  add(
    "maten_hidden",
    "Maten-laag standaard uitgeschakeld (OFF)",
    ocgNames.includes(matenLayer) ? (offNames.includes(matenLayer) ? "PASS" : "FAIL") : "NOT_VERIFIABLE",
  );

  /* -------------------------------------------------------- Artwork checks */
  const artworkLayer = config.layers.artwork;
  const artworkBody = layerContent.get(artworkLayer);
  let complexity = emptyComplexity;
  let artworkColorSpaces: string[] = [];
  let artworkSpotColors: string[] = [];
  let rgbImages = { count: 0, names: [] as string[] };

  if (!artworkBody) {
    for (const key of [
      "artwork_overprint",
      "artwork_spot_colors",
      "artwork_rgb_vectors",
      "artwork_rgb_images",
      "artwork_transparency",
      "artwork_color_spaces",
    ]) {
      add(key, `Artwork-controle ${key}`, "NOT_VERIFIABLE", "Geen artwork-content gevonden");
    }
  } else {
    const analysis = analyzeArtwork(doc, artworkBody, resources);
    artworkColorSpaces = [...analysis.colorSpaceFamilies].sort();
    artworkSpotColors = [...analysis.spotColors].sort();
    rgbImages = { count: analysis.rgbImages.length, names: analysis.rgbImages };

    add(
      "artwork_overprint",
      "Geen actieve overdruk in artwork",
      analysis.overprintStates.length === 0 ? "PASS" : "FAIL",
      analysis.overprintStates.length === 0 ? undefined : analysis.overprintStates.join(", "),
    );
    add(
      "artwork_spot_colors",
      "Geen steunkleuren in artwork",
      artworkSpotColors.length === 0 ? "PASS" : "FAIL",
      artworkSpotColors.length === 0 ? "[]" : artworkSpotColors.join(", "),
    );
    add(
      "artwork_rgb_vectors",
      "Geen RGB-vectorcontent in artwork",
      analysis.rgbResources.length === 0 ? "PASS" : "FAIL",
      analysis.rgbResources.length === 0 ? undefined : analysis.rgbResources.join(", "),
    );
    add(
      "artwork_rgb_images",
      "Geen RGB-afbeeldingen in artwork",
      rgbImages.count === 0 ? "PASS" : "FAIL",
      rgbImages.count === 0 ? "0" : `${rgbImages.count}: ${rgbImages.names.join(", ")}`,
    );
    add(
      "artwork_transparency",
      "Geen transparantieconstructies in artwork",
      analysis.transparencySignals.length === 0 ? "PASS" : "FAIL",
      analysis.transparencySignals.length === 0 ? undefined : analysis.transparencySignals.slice(0, 8).join(", "),
    );
    add(
      "artwork_color_spaces",
      "Gebruikte kleurenruimten in artwork",
      artworkColorSpaces.length === 0 ? "NOT_VERIFIABLE" : "PASS",
      artworkColorSpaces.join(", "),
    );
    if (analysis.inlineImages > 0) {
      add(
        "artwork_inline_images",
        "Inline images (BI) in artwork",
        "WARNING",
        `${analysis.inlineImages} inline image(s); kleurruimte niet betrouwbaar te bepalen`,
      );
    }

    complexity = {
      fileSizeBytes: pdfBytes.length,
      fileSizeMb: Math.round((pdfBytes.length / (1024 * 1024)) * 100) / 100,
      imageXObjects: analysis.imageCount,
      formXObjects: analysis.formCount,
      pathSegments: analysis.pathSegments,
      pdfComplexityScore: scoreComplexity(analysis.pathSegments),
      note: emptyComplexity.note,
    };
  }

  add(
    "file_size",
    `Bestandsgrootte onder ${sleeveManagerV2Config.maxFileSizeMb} MB`,
    complexity.fileSizeMb > sleeveManagerV2Config.maxFileSizeMb ? "WARNING" : "PASS",
    `${complexity.fileSizeMb} MB`,
  );
  add(
    "complexity",
    "PDF-complexiteit (informatief)",
    "PASS",
    `${complexity.pdfComplexityScore} — pathSegments ${complexity.pathSegments}, images ${complexity.imageXObjects}, forms ${complexity.formXObjects}`,
  );

  const checkStatus: Record<string, V2CheckStatus> = {};
  for (const check of checks) checkStatus[check.key] = check.status;

  return {
    enabled: true,
    name: sleeveManagerV2Config.name,
    blocking: false,
    status: overall(checks),
    checks,
    checkStatus,
    findings,
    complexity,
    artworkColorSpaces,
    artworkSpotColors,
    rgbImages,
  };
}