import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generatePrintReadyPdf } from "../core/pdf-engine";
import { inspectPdf } from "../core/pdf-inspect";
import { compareWithGolden } from "../core/pdf-validator";
import { CAVA_293X237 } from "../core/template-config";

/**
 * POC-only test suite. The golden reference (manually produced in Illustrator)
 * is used here to prove technical equivalence — it is NOT part of the
 * production preflight.
 *
 * Place the three PDFs in ./fixtures (or set PREPRESS_FIXTURES_DIR):
 *   MASTER_TEMPLATE_CAVA_TEST_v2.pdf
 *   Sleeve-Cava-Expivi-alleen_artwork.pdf
 *   Sleeve-Cava-Expivi.pdf   (golden reference)
 */
const dir = process.env["PREPRESS_FIXTURES_DIR"] ?? join(process.cwd(), "fixtures");
const masterPath = join(dir, "MASTER_TEMPLATE_CAVA_TEST_v2.pdf");
const artworkPath = join(dir, "Sleeve-Cava-Expivi-alleen_artwork.pdf");
const goldenPath = join(dir, "Sleeve-Cava-Expivi.pdf");
const haveFixtures = [masterPath, artworkPath, goldenPath].every((p) => existsSync(p));

const read = (path: string) => new Uint8Array(readFileSync(path));

describe.skipIf(!haveFixtures)("prepress engine tegen golden reference", () => {
  it("levert een technisch correcte drukklare PDF op", async () => {
    const result = await generatePrintReadyPdf({
      masterBytes: read(masterPath),
      artworkBytes: read(artworkPath),
      config: CAVA_293X237,
    });

    expect(result.errors).toEqual([]);
    expect(result.status).toBe("PASS");
    expect(result.outputBytes).toBeDefined();
    expect(result.validation.no_extra_ocg).toBe(true);
    expect(result.validation.artwork_ocg).toBe(true);
    expect(result.validation.master_content_preserved).toBe(true);
  });

  it("bevat exact vier OCG's, dus geen artwork-eigen 'Laag 1'", async () => {
    const result = await generatePrintReadyPdf({
      masterBytes: read(masterPath),
      artworkBytes: read(artworkPath),
      config: CAVA_293X237,
    });
    const output = await inspectPdf(result.outputBytes!);
    expect(output.ocgNames.sort()).toEqual(
      [...CAVA_293X237.layerOrder].sort(),
    );
    expect(output.allOcgNames.filter((name) => !CAVA_293X237.layerOrder.includes(name))).toEqual([]);
  });

  it("is technisch gelijkwaardig aan de handmatige referentie", async () => {
    const result = await generatePrintReadyPdf({
      masterBytes: read(masterPath),
      artworkBytes: read(artworkPath),
      config: CAVA_293X237,
    });
    const generated = await inspectPdf(result.outputBytes!);
    const golden = await inspectPdf(read(goldenPath));
    const rows = compareWithGolden(CAVA_293X237, generated, golden);

    const structural = rows.filter(
      (row) => !row.property.startsWith("laagcontent Wit"),
    );
    expect(structural.filter((row) => !row.matches)).toEqual([]);
  });
});