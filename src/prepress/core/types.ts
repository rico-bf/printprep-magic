/**
 * Pure data contracts for the prepress core.
 * No dependency on React, Lovable, Supabase, Laravel or Lunar.
 */

export interface TemplateConfig {
  id: string;
  name: string;
  masterFile: string;
  masterStoragePath: string;
  layers: {
    dieCut: string;
    dimensions: string;
    white: string;
    artwork: string;
  };
  /** Expected default visibility per layer name. */
  defaultVisibility: Record<string, boolean>;
  /** Expected layer order, top-level /Order of the OCG configuration. */
  layerOrder: string[];
  spotColors: { white: string };
  /** Tolerance in PDF points when comparing page boxes. */
  pageSizeTolerancePt: number;
}

export interface PageBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphicsState {
  OP?: boolean;
  op?: boolean;
  OPM?: number;
  BM?: string;
  SMask?: string;
  CA?: number;
  ca?: number;
}

export interface LayerSignature {
  /** OCG name this marked-content block is bound to. */
  ocgName: string;
  /** Content stream operators in order (operator names only). */
  operators: string[];
  /** All numeric operands, rounded, in order. */
  coordinates: number[];
  /** Resource names referenced from within the block. */
  resourceNames: string[];
  /** Resolved colour spaces used by the block. */
  colorSpaces: Record<string, string>;
  /** Resolved graphics states used by the block. */
  graphicsStates: Record<string, GraphicsState>;
  /** Fonts used by the block. */
  fonts: string[];
}

export interface PdfInspection {
  valid: boolean;
  parseError?: string;
  pageCount: number;
  mediaBox?: PageBox | undefined;
  trimBox?: PageBox | undefined;
  /** OCG names registered in /OCProperties /OCGs, in document order. */
  ocgNames: string[];
  /** Any OCG object found anywhere in the document (also unregistered ones). */
  allOcgNames: string[];
  layerOrder: string[];
  visibleLayers: string[];
  hiddenLayers: string[];
  /** /Properties map of the first page: MC name -> OCG name. */
  markedContentProperties: Record<string, string>;
  separations: string[];
  graphicsStates: Record<string, GraphicsState>;
  colorSpaces: Record<string, string>;
  xObjects: Record<string, { subtype: string; hasOc: boolean }>;
  /** Marked-content blocks of the first page, keyed by OCG name. */
  layerSignatures: Record<string, LayerSignature>;
  /** Raw decoded first-page content stream length in bytes. */
  contentLength: number;
}

export type CheckStatus = "PASS" | "FAIL";

export interface ValidationCheck {
  key: string;
  label: string;
  status: CheckStatus;
  critical: boolean;
  detail?: string;
}

export interface PrepressError {
  code: string;
  message: string;
}

export interface LogEntry {
  at: string;
  event: string;
  data?: Record<string, unknown>;
}

/** Boolean summary used in the API response contract. */
export interface ValidationSummary {
  pdf_valid: boolean;
  page_count: boolean;
  page_size: boolean;
  layers_present: boolean;
  layer_order: boolean;
  layer_visibility: boolean;
  white_separation: boolean;
  white_overprint: boolean;
  artwork_present: boolean;
  artwork_ocg: boolean;
  /** true when the engine applied scaling — must stay false. */
  artwork_scaled: boolean;
  master_content_preserved: boolean;
  no_extra_ocg: boolean;
}

export interface PrepressResult {
  status: "PASS" | "FAIL";
  templateId: string;
  checks: ValidationCheck[];
  validation: ValidationSummary;
  errors: PrepressError[];
  logs: LogEntry[];
  /** Only present when status === "PASS". */
  outputBytes?: Uint8Array;
}

export interface GoldenComparisonRow {
  property: string;
  matches: boolean;
  generated: string;
  golden: string;
}