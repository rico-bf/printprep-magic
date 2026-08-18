import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  decodePDFRawStream,
} from "pdf-lib";
import type {
  GraphicsState,
  LayerSignature,
  PageBox,
  PdfInspection,
} from "./types";

export const PDF_MAGIC = "%PDF-";

export function hasPdfMagicBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 5) return false;
  return bytesToLatin1(bytes.subarray(0, 8)).startsWith(PDF_MAGIC);
}

export function bytesToLatin1(bytes: Uint8Array): string {
  let out = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return out;
}

export function latin1ToBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

export async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, {
    ignoreEncryption: false,
    updateMetadata: false,
    throwOnInvalidObject: false,
  });
}

function decodeTextObject(obj: unknown): string | undefined {
  if (obj instanceof PDFString || obj instanceof PDFHexString) return obj.decodeText();
  return undefined;
}

function ocgName(dict: PDFDict | undefined): string | undefined {
  if (!dict) return undefined;
  return decodeTextObject(dict.get(PDFName.of("Name")));
}

function lookupDict(doc: PDFDocument, value: unknown): PDFDict | undefined {
  if (value instanceof PDFDict) return value;
  if (value instanceof PDFRef) {
    const resolved = doc.context.lookup(value);
    if (resolved instanceof PDFDict) return resolved;
  }
  return undefined;
}

function lookupArray(doc: PDFDocument, value: unknown): PDFArray | undefined {
  if (value instanceof PDFArray) return value;
  if (value instanceof PDFRef) {
    const resolved = doc.context.lookup(value);
    if (resolved instanceof PDFArray) return resolved;
  }
  return undefined;
}

export function getOcProperties(doc: PDFDocument): PDFDict | undefined {
  return lookupDict(doc, doc.catalog.get(PDFName.of("OCProperties")));
}

export function getOcgRefsByName(doc: PDFDocument): Map<string, PDFRef> {
  const result = new Map<string, PDFRef>();
  const ocProps = getOcProperties(doc);
  const ocgs = ocProps ? lookupArray(doc, ocProps.get(PDFName.of("OCGs"))) : undefined;
  if (!ocgs) return result;
  for (let i = 0; i < ocgs.size(); i += 1) {
    const raw = ocgs.get(i);
    const dict = lookupDict(doc, raw);
    const name = ocgName(dict);
    if (name && raw instanceof PDFRef) result.set(name, raw);
  }
  return result;
}

function namesFromArray(doc: PDFDocument, array: PDFArray | undefined): string[] {
  if (!array) return [];
  const names: string[] = [];
  for (let i = 0; i < array.size(); i += 1) {
    const entry = array.get(i);
    const nested = lookupArray(doc, entry);
    if (nested) {
      names.push(...namesFromArray(doc, nested));
      continue;
    }
    const name = ocgName(lookupDict(doc, entry));
    if (name) names.push(name);
  }
  return names;
}

function readBox(raw: unknown, doc: PDFDocument): PageBox | undefined {
  const array = lookupArray(doc, raw);
  if (!array || array.size() < 4) return undefined;
  const nums = [0, 1, 2, 3].map((i) => {
    const v = array.get(i);
    return v instanceof PDFNumber ? v.asNumber() : Number.NaN;
  });
  if (nums.some((n) => Number.isNaN(n))) return undefined;
  return {
    x: nums[0]!,
    y: nums[1]!,
    width: nums[2]! - nums[0]!,
    height: nums[3]! - nums[1]!,
  };
}

function readGraphicsState(dict: PDFDict): GraphicsState {
  const state: GraphicsState = {};
  const op = dict.get(PDFName.of("OP"));
  const opLower = dict.get(PDFName.of("op"));
  const opm = dict.get(PDFName.of("OPM"));
  const bm = dict.get(PDFName.of("BM"));
  const smask = dict.get(PDFName.of("SMask"));
  const bigCa = dict.get(PDFName.of("CA"));
  const smallCa = dict.get(PDFName.of("ca"));
  if (op instanceof PDFBool) state.OP = op.asBoolean();
  if (opLower instanceof PDFBool) state.op = opLower.asBoolean();
  if (opm instanceof PDFNumber) state.OPM = opm.asNumber();
  if (bm instanceof PDFName) state.BM = bm.asString();
  if (smask instanceof PDFName) state.SMask = smask.asString();
  if (bigCa instanceof PDFNumber) state.CA = bigCa.asNumber();
  if (smallCa instanceof PDFNumber) state.ca = smallCa.asNumber();
  return state;
}

function describeColorSpace(doc: PDFDocument, raw: unknown): string {
  const array = lookupArray(doc, raw);
  if (array && array.size() >= 2) {
    const family = array.get(0);
    const second = array.get(1);
    const familyName = family instanceof PDFName ? family.asString() : "?";
    const secondName = second instanceof PDFName ? second.asString() : "";
    return `${familyName}${secondName ? ` ${secondName}` : ""}`;
  }
  if (raw instanceof PDFName) return raw.asString();
  const dict = lookupDict(doc, raw);
  if (dict) {
    const subtype = dict.get(PDFName.of("Subtype"));
    return subtype instanceof PDFName ? subtype.asString() : "/Dict";
  }
  return "?";
}

export function getPageContentString(doc: PDFDocument, pageIndex = 0): string {
  const page = doc.getPage(pageIndex);
  const raw = page.node.get(PDFName.of("Contents"));
  const streams: PDFStream[] = [];
  const pushStream = (value: unknown) => {
    const resolved = value instanceof PDFRef ? doc.context.lookup(value) : value;
    if (resolved instanceof PDFStream) streams.push(resolved);
  };
  const array = lookupArray(doc, raw);
  if (array) {
    for (let i = 0; i < array.size(); i += 1) pushStream(array.get(i));
  } else {
    pushStream(raw);
  }
  return streams
    .map((stream) => {
      const bytes =
        stream instanceof PDFRawStream
          ? decodePDFRawStream(stream).decode()
          : stream.getContents();
      return bytesToLatin1(bytes);
    })
    .join("\n");
}

/** Marked-content block boundaries for `/OC /MCx BDC ... EMC`. */
export interface MarkedContentBlock {
  propertyName: string;
  /** Index of the first character after `BDC`. */
  innerStart: number;
  /** Index of the `EMC` token. */
  innerEnd: number;
  content: string;
}

export function findMarkedContentBlocks(content: string): MarkedContentBlock[] {
  const blocks: MarkedContentBlock[] = [];
  const opener = /\/OC\s*\/([^\s/[\]<>]+)\s*BDC/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(content)) !== null) {
    const innerStart = match.index + match[0].length;
    let depth = 1;
    let cursor = innerStart;
    const token = /\b(BDC|BMC|EMC)\b/g;
    token.lastIndex = innerStart;
    let innerEnd = content.length;
    let tokenMatch: RegExpExecArray | null;
    while ((tokenMatch = token.exec(content)) !== null) {
      if (tokenMatch[1] === "EMC") {
        depth -= 1;
        if (depth === 0) {
          innerEnd = tokenMatch.index;
          break;
        }
      } else {
        depth += 1;
      }
      cursor = tokenMatch.index;
    }
    void cursor;
    blocks.push({
      propertyName: match[1]!,
      innerStart,
      innerEnd,
      content: content.slice(innerStart, innerEnd),
    });
  }
  return blocks;
}

const NUMBER_TOKEN = /^[+-]?(\d+\.?\d*|\.\d+)$/;

export function tokenizeContent(content: string): string[] {
  return content
    .replace(/[[\]{}]/g, (m) => ` ${m} `)
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function roundCoordinate(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function buildLayerSignature(
  doc: PDFDocument,
  ocgNameValue: string,
  blockContent: string,
  resources: {
    colorSpaces: Record<string, string>;
    graphicsStates: Record<string, GraphicsState>;
    fonts: string[];
  },
): LayerSignature {
  const tokens = tokenizeContent(blockContent);
  const operators: string[] = [];
  const coordinates: number[] = [];
  const resourceNames: string[] = [];
  for (const token of tokens) {
    if (NUMBER_TOKEN.test(token)) {
      coordinates.push(roundCoordinate(Number(token)));
      continue;
    }
    if (token.startsWith("/")) {
      resourceNames.push(token);
      continue;
    }
    if (/^[A-Za-z'"*][A-Za-z0-9'"*]*$/.test(token)) operators.push(token);
  }
  const usedColorSpaces: Record<string, string> = {};
  const usedGraphicsStates: Record<string, GraphicsState> = {};
  const usedFonts: string[] = [];
  for (const name of new Set(resourceNames)) {
    const bare = name.slice(1);
    if (resources.colorSpaces[bare] !== undefined) usedColorSpaces[bare] = resources.colorSpaces[bare]!;
    if (resources.graphicsStates[bare] !== undefined) usedGraphicsStates[bare] = resources.graphicsStates[bare]!;
    if (resources.fonts.includes(bare)) usedFonts.push(bare);
  }
  void doc;
  return {
    ocgName: ocgNameValue,
    operators,
    coordinates,
    resourceNames: [...new Set(resourceNames)].sort(),
    colorSpaces: usedColorSpaces,
    graphicsStates: usedGraphicsStates,
    fonts: usedFonts.sort(),
  };
}

export function collectAllOcgNames(doc: PDFDocument): string[] {
  const names: string[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    const type = obj.get(PDFName.of("Type"));
    if (type instanceof PDFName && type.asString() === "/OCG") {
      const name = ocgName(obj);
      if (name) names.push(name);
    }
  }
  return names;
}

/**
 * Detects Illustrator private editing/round-trip data only. Regular Illustrator
 * metadata (/Creator, XMP, OCG /Usage /CreatorInfo) is deliberately ignored.
 */
export function collectIllustratorPrivateData(doc: PDFDocument): string[] {
  const findings = new Set<string>();
  const inspectDict = (dict: PDFDict) => {
    for (const [key, value] of dict.entries()) {
      const keyName = key.asString().slice(1);
      if (keyName === "AIPDFPrivateData" || keyName.startsWith("AIPDFPrivateData")) {
        findings.add(`/${keyName}`);
        continue;
      }
      if (keyName !== "PieceInfo") continue;
      const pieceInfo =
        value instanceof PDFDict
          ? value
          : value instanceof PDFRef
            ? (doc.context.lookup(value) as unknown)
            : undefined;
      const pieceDict =
        pieceInfo instanceof PDFDict
          ? pieceInfo
          : pieceInfo instanceof PDFStream
            ? pieceInfo.dict
            : undefined;
      if (!pieceDict) continue;
      for (const [pieceKey] of pieceDict.entries()) {
        const app = pieceKey.asString().slice(1);
        if (/illustrator/i.test(app) || /^AI/.test(app)) {
          findings.add(`/PieceInfo /${app}`);
        }
      }
    }
  };

  const catalog = doc.catalog;
  inspectDict(catalog);
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict) inspectDict(obj);
    else if (obj instanceof PDFStream) inspectDict(obj.dict);
  }
  return [...findings];
}

export async function inspectPdf(bytes: Uint8Array): Promise<PdfInspection> {
  const empty: PdfInspection = {
    valid: false,
    pageCount: 0,
    ocgNames: [],
    allOcgNames: [],
    layerOrder: [],
    visibleLayers: [],
    hiddenLayers: [],
    markedContentProperties: {},
    separations: [],
    graphicsStates: {},
    colorSpaces: {},
    xObjects: {},
    layerSignatures: {},
    contentLength: 0,
    illustratorPrivateData: [],
  };

  if (!hasPdfMagicBytes(bytes)) {
    return { ...empty, parseError: "Bestand begint niet met %PDF-" };
  }

  let doc: PDFDocument;
  try {
    doc = await loadPdf(bytes);
  } catch (error) {
    return { ...empty, parseError: error instanceof Error ? error.message : String(error) };
  }

  const pageCount = doc.getPageCount();
  if (pageCount === 0) {
    return { ...empty, valid: true, parseError: "PDF bevat geen pagina's" };
  }

  const page = doc.getPage(0);
  const mediaBox = readBox(page.node.get(PDFName.of("MediaBox")), doc);
  const trimBox = readBox(page.node.get(PDFName.of("TrimBox")), doc) ?? mediaBox;

  const ocProps = getOcProperties(doc);
  const ocgNames = [...getOcgRefsByName(doc).keys()];
  const defaultConfig = ocProps ? lookupDict(doc, ocProps.get(PDFName.of("D"))) : undefined;
  const layerOrder = namesFromArray(
    doc,
    defaultConfig ? lookupArray(doc, defaultConfig.get(PDFName.of("Order"))) : undefined,
  );
  const explicitOn = namesFromArray(
    doc,
    defaultConfig ? lookupArray(doc, defaultConfig.get(PDFName.of("ON"))) : undefined,
  );
  const hiddenLayers = namesFromArray(
    doc,
    defaultConfig ? lookupArray(doc, defaultConfig.get(PDFName.of("OFF"))) : undefined,
  );
  const visibleLayers = ocgNames.filter(
    (name) => explicitOn.includes(name) || !hiddenLayers.includes(name),
  );

  const resourcesDict = lookupDict(doc, page.node.get(PDFName.of("Resources")));
  const markedContentProperties: Record<string, string> = {};
  const propertiesDict = resourcesDict
    ? lookupDict(doc, resourcesDict.get(PDFName.of("Properties")))
    : undefined;
  if (propertiesDict) {
    for (const [key, value] of propertiesDict.entries()) {
      const name = ocgName(lookupDict(doc, value));
      if (name) markedContentProperties[key.asString().slice(1)] = name;
    }
  }

  const colorSpaces: Record<string, string> = {};
  const separations: string[] = [];
  const colorSpaceDict = resourcesDict
    ? lookupDict(doc, resourcesDict.get(PDFName.of("ColorSpace")))
    : undefined;
  if (colorSpaceDict) {
    for (const [key, value] of colorSpaceDict.entries()) {
      const described = describeColorSpace(doc, value);
      colorSpaces[key.asString().slice(1)] = described;
      if (described.startsWith("/Separation")) {
        separations.push(described.replace("/Separation ", "").replace(/^\//, ""));
      }
    }
  }

  const graphicsStates: Record<string, GraphicsState> = {};
  const extGStateDict = resourcesDict
    ? lookupDict(doc, resourcesDict.get(PDFName.of("ExtGState")))
    : undefined;
  if (extGStateDict) {
    for (const [key, value] of extGStateDict.entries()) {
      const dict = lookupDict(doc, value);
      if (dict) graphicsStates[key.asString().slice(1)] = readGraphicsState(dict);
    }
  }

  const fonts: string[] = [];
  const fontDict = resourcesDict ? lookupDict(doc, resourcesDict.get(PDFName.of("Font"))) : undefined;
  if (fontDict) for (const [key] of fontDict.entries()) fonts.push(key.asString().slice(1));

  const xObjects: Record<string, { subtype: string; hasOc: boolean }> = {};
  const xObjectDict = resourcesDict
    ? lookupDict(doc, resourcesDict.get(PDFName.of("XObject")))
    : undefined;
  if (xObjectDict) {
    for (const [key, value] of xObjectDict.entries()) {
      const resolved = value instanceof PDFRef ? doc.context.lookup(value) : value;
      const dict = resolved instanceof PDFStream ? resolved.dict : lookupDict(doc, resolved);
      const subtype = dict?.get(PDFName.of("Subtype"));
      xObjects[key.asString().slice(1)] = {
        subtype: subtype instanceof PDFName ? subtype.asString() : "?",
        hasOc: dict?.get(PDFName.of("OC")) !== undefined,
      };
    }
  }

  const content = getPageContentString(doc);
  const layerSignatures: Record<string, LayerSignature> = {};
  for (const block of findMarkedContentBlocks(content)) {
    const layerName = markedContentProperties[block.propertyName];
    if (!layerName) continue;
    layerSignatures[layerName] = buildLayerSignature(doc, layerName, block.content, {
      colorSpaces,
      graphicsStates,
      fonts,
    });
  }

  return {
    valid: true,
    pageCount,
    mediaBox,
    trimBox,
    ocgNames,
    allOcgNames: collectAllOcgNames(doc),
    layerOrder,
    visibleLayers,
    hiddenLayers,
    markedContentProperties,
    separations,
    graphicsStates,
    colorSpaces,
    xObjects,
    layerSignatures,
    contentLength: content.length,
    illustratorPrivateData: collectIllustratorPrivateData(doc),
  };
}