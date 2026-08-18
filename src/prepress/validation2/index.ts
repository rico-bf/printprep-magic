/**
 * Single entry point for the optional SleeveManager Validation V2.
 * Removing V2 = delete this directory + the one optional call in
 * `src/prepress/service.ts` (and the UI block in `src/routes/index.tsx`).
 */
export { isSleeveManagerV2Enabled, sleeveManagerV2Config } from "./sleevemanager-config";
export { runSleeveManagerValidation } from "./sleevemanager-validator";
export type {
  SleeveManagerValidation,
  V2Check,
  V2CheckStatus,
  V2Report,
} from "./sleevemanager-types";