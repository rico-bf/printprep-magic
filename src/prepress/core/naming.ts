/**
 * Output naming. Kept as a standalone function so Laravel can replace it with
 * e.g. order number + product name without touching the engine.
 */
export function buildOutputFilename(inputFilename: string): string {
  const withoutPath = inputFilename.split(/[\\/]/).pop() ?? inputFilename;
  const withoutExt = withoutPath.replace(/\.pdf$/i, "");
  const base = withoutExt.replace(/[-_ ]*alleen[-_ ]*artwork$/i, "");
  const safe = (base.trim().length > 0 ? base.trim() : "artwork").replace(/[\\/:*?"<>|]/g, "-");
  return `${safe}-DRUKKLAAR.pdf`;
}