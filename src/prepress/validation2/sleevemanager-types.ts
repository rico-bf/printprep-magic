/**
 * Optional SleeveManager Validation V2 — data contracts.
 * Read-only analysis layer. Fully removable: nothing in the core prepress
 * engine or Validation 1 depends on these types.
 */

export type V2CheckStatus = "PASS" | "FAIL" | "WARNING" | "NOT_VERIFIABLE";

export interface V2Check {
  key: string;
  label: string;
  status: V2CheckStatus;
  detail?: string;
}

export interface V2Complexity {
  /** Output PDF size in bytes. */
  fileSizeBytes: number;
  fileSizeMb: number;
  imageXObjects: number;
  formXObjects: number;
  /** PDF-derived path segment count inside the artwork layer (m/l/c/v/y/re). */
  pathSegments: number;
  /**
   * PDF-specific score. NOT identical to the Illustrator SleeveManager score
   * (which counts anchor points via the Illustrator DOM).
   */
  pdfComplexityScore: "Zeer goed" | "Goed" | "Matig" | "Slecht";
  note: string;
}

export interface V2Report {
  enabled: true;
  name: string;
  blocking: false;
  status: "PASS" | "WARNING" | "FAIL";
  checks: V2Check[];
  /** Machine readable map: check key -> status. */
  checkStatus: Record<string, V2CheckStatus>;
  findings: string[];
  complexity: V2Complexity;
  artworkColorSpaces: string[];
  artworkSpotColors: string[];
  rgbImages: { count: number; names: string[] };
  error?: string;
}

export type V2ReportDisabled = { enabled: false };

export type SleeveManagerValidation = V2Report | V2ReportDisabled;