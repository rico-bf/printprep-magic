/**
 * Optional SleeveManager Validation V2 — feature flag and expected values.
 * Set ENABLE_SLEEVEMANAGER_VALIDATION_V2=false (or validation2.enabled=false)
 * and the application behaves exactly as if V2 was never built.
 */

export const sleeveManagerV2Config = {
  enabled: true,
  name: "SleeveManager v11 equivalent",
  blocking: false as const,
  /** Expected alternate colour of the White spot colour. */
  whiteAlternateHex: "#A1DAF8",
  /** Expected alternate colour of the Stans spot colour. */
  stansAlternateHex: "#EC6608",
  /** Expected die-cut stroke width in PDF points. */
  stansStrokeWidthPt: 1,
  strokeWidthTolerancePt: 0.01,
  /** Hex comparison tolerance per channel (0-255) for derived tint colours. */
  hexChannelTolerance: 8,
  /** File size warning threshold (SleeveManager parity). */
  maxFileSizeMb: 50,
};

/** Reads the runtime feature flag; env var wins over the config default. */
export function isSleeveManagerV2Enabled(): boolean {
  const raw =
    typeof process !== "undefined"
      ? process.env["ENABLE_SLEEVEMANAGER_VALIDATION_V2"]
      : undefined;
  if (raw === undefined || raw === "") return sleeveManagerV2Config.enabled;
  return raw !== "false" && raw !== "0";
}