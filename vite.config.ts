// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { createRequire } from "node:module";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const require = createRequire(import.meta.url);
// pdf-lib's ESM build imports tslib helpers in a way that breaks under CJS/ESM
// interop ("Cannot destructure property '__extends'"). The prebundled dist ESM
// file inlines those helpers. Resolved to an absolute path and matched exactly
// so the alias cannot re-apply to its own replacement.
const pdfLibEsm = require.resolve("pdf-lib/dist/pdf-lib.esm.js");

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    resolve: {
      alias: [{ find: /^pdf-lib$/, replacement: pdfLibEsm }],
    },
  },
});
