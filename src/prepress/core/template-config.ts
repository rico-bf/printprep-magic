import type { TemplateConfig } from "./types";

/**
 * Single source of truth for template technical data.
 * More templates can be registered here without touching the engine.
 */
export const CAVA_293X237: TemplateConfig = {
  id: "cava-293x237",
  name: "CAVA – 293 × 237 mm",
  masterFile: "MASTER_TEMPLATE_CAVA_TEST_v3.pdf",
  masterVersion: "v3",
  masterStoragePath: "masters/cava-293x237/MASTER_TEMPLATE_CAVA_TEST_v3.pdf",
  layers: {
    dieCut: "Stans (NIET IN WERKEN)",
    dimensions: "Maten (NIET IN WERKEN)",
    white: "Wit (NIET IN WERKEN)",
    artwork: "Artworklaag voor bedrukte fles",
  },
  defaultVisibility: {
    "Stans (NIET IN WERKEN)": true,
    "Maten (NIET IN WERKEN)": false,
    "Wit (NIET IN WERKEN)": true,
    "Artworklaag voor bedrukte fles": true,
  },
  layerOrder: [
    "Stans (NIET IN WERKEN)",
    "Maten (NIET IN WERKEN)",
    "Wit (NIET IN WERKEN)",
    "Artworklaag voor bedrukte fles",
  ],
  spotColors: { white: "White" },
  pageSizeTolerancePt: 0.01,
};

export const templateRegistry: Record<string, TemplateConfig> = {
  [CAVA_293X237.id]: CAVA_293X237,
};

export function getTemplateConfig(templateId: string): TemplateConfig | undefined {
  return templateRegistry[templateId];
}

export function technicalLayerNames(config: TemplateConfig): string[] {
  return [config.layers.dieCut, config.layers.dimensions, config.layers.white];
}

export function allLayerNames(config: TemplateConfig): string[] {
  return [...technicalLayerNames(config), config.layers.artwork];
}