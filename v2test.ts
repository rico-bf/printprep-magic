import { readFileSync, writeFileSync } from "node:fs";
import { PDFArray, PDFBool, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream } from "pdf-lib";
import { generatePrintReadyPdf } from "./src/prepress/core/pdf-engine";
import { CAVA_293X237 } from "./src/prepress/core/template-config";
import { findMarkedContentBlocks, getPageContentString, latin1ToBytes, loadPdf } from "./src/prepress/core/pdf-inspect";
import { runSleeveManagerValidation } from "./src/prepress/validation2";

const master = new Uint8Array(readFileSync("/mnt/user-uploads/MASTER_TEMPLATE_CAVA_TEST_v3.pdf"));
const artwork = new Uint8Array(readFileSync("/mnt/user-uploads/Sleeve-Cava-Expivi-alleen_artwork.pdf"));

const result = await generatePrintReadyPdf({ masterBytes: master, artworkBytes: artwork, config: CAVA_293X237 });
console.log("VALIDATIE 1:", result.status, "errors", result.errors.length);
const good = result.outputBytes!;
writeFileSync("/tmp/good.pdf", good);

function short(r: Awaited<ReturnType<typeof runSleeveManagerValidation>>) {
  return { status: r.status, ...r.checkStatus };
}
const baseline = await runSleeveManagerValidation(good, CAVA_293X237);
console.log("BASELINE V2", JSON.stringify(short(baseline), null, 1));
console.log("findings", baseline.findings);
console.log("complexity", baseline.complexity, baseline.artworkColorSpaces, baseline.artworkSpotColors);

// ---- helpers for synthetic mutations (test only) ----
async function mutate(fn: (doc: any) => Promise<void> | void) {
  const doc = await loadPdf(good);
  await fn(doc);
  return doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
}
function res(doc: any, key: string) {
  const page = doc.getPage(0);
  const r = doc.context.lookupMaybe(page.node.get(PDFName.of("Resources")), PDFDict) ?? page.node.get(PDFName.of("Resources"));
  const rd = r instanceof PDFDict ? r : doc.context.lookup(r) as PDFDict;
  let d = rd.get(PDFName.of(key));
  d = d instanceof PDFRef ? doc.context.lookup(d) : d;
  if (!(d instanceof PDFDict)) { const nd = doc.context.obj({}); rd.set(PDFName.of(key), nd); return nd; }
  return d;
}
function artworkMc(doc: any) {
  const page = doc.getPage(0);
  const rd = doc.context.lookup(page.node.get(PDFName.of("Resources"))) as PDFDict ?? page.node.get(PDFName.of("Resources")) as PDFDict;
  let props: any = rd.get(PDFName.of("Properties"));
  props = props instanceof PDFRef ? doc.context.lookup(props) : props;
  for (const [k, v] of (props as PDFDict).entries()) {
    const ocg = doc.context.lookup(v) as PDFDict;
    const nm = ocg.get(PDFName.of("Name")) as any;
    if (nm?.decodeText?.() === CAVA_293X237.layers.artwork) return k.asString().slice(1);
  }
  throw new Error("mc not found");
}
function injectInLayer(doc: any, layer: string, snippet: string) {
  const page = doc.getPage(0);
  const rd = doc.context.lookup(page.node.get(PDFName.of("Resources"))) as PDFDict;
  let props: any = rd.get(PDFName.of("Properties"));
  props = props instanceof PDFRef ? doc.context.lookup(props) : props;
  let mc: string | undefined;
  for (const [k, v] of (props as PDFDict).entries()) {
    const ocg = doc.context.lookup(v) as PDFDict;
    if ((ocg.get(PDFName.of("Name")) as any)?.decodeText?.() === layer) mc = k.asString().slice(1);
  }
  const content = getPageContentString(doc);
  const block = findMarkedContentBlocks(content).find((b) => b.propertyName === mc)!;
  const next = content.slice(0, block.innerEnd) + `\n${snippet}\n` + content.slice(block.innerEnd);
  const stream = doc.context.flateStream(latin1ToBytes(next));
  page.node.set(PDFName.of("Contents"), doc.context.register(stream));
}

// 1. RGB image in artwork
const rgbImg = await mutate(async (doc) => {
  const x = res(doc, "XObject");
  const img = doc.context.stream(new Uint8Array([255, 0, 0, 0, 255, 0]), {
    Type: "XObject", Subtype: "Image", Width: 2, Height: 1, ColorSpace: "DeviceRGB", BitsPerComponent: 8,
  });
  x.set(PDFName.of("RgbImg"), doc.context.register(img));
  injectInLayer(doc, CAVA_293X237.layers.artwork, "q 10 0 0 10 0 0 cm /RgbImg Do Q");
});
console.log("RGB IMAGE TEST", JSON.stringify(short(await runSleeveManagerValidation(rgbImg, CAVA_293X237))));

// 2. artwork overprint
const opArt = await mutate(async (doc) => {
  const gs = res(doc, "ExtGState");
  gs.set(PDFName.of("GSOP"), doc.context.register(doc.context.obj({ Type: "ExtGState", OP: true, op: true, OPM: 1 })));
  injectInLayer(doc, CAVA_293X237.layers.artwork, "/GSOP gs");
});
console.log("ARTWORK OVERPRINT TEST", JSON.stringify(short(await runSleeveManagerValidation(opArt, CAVA_293X237))));

// 3. artwork spot colour
const spotArt = await mutate(async (doc) => {
  const cs = res(doc, "ColorSpace");
  const fn = doc.context.register(doc.context.obj({ FunctionType: 2, Domain: [0, 1], C0: [0,0,0,0], C1: [0,0.6,1,0], N: 1 }));
  const arr = doc.context.obj([PDFName.of("Separation"), PDFName.of("PANTONE 123 C"), PDFName.of("DeviceCMYK"), fn]);
  cs.set(PDFName.of("CSSpot"), doc.context.register(arr));
  injectInLayer(doc, CAVA_293X237.layers.artwork, "/CSSpot cs 1 scn 0 0 5 5 re f");
});
console.log("ARTWORK SPOT TEST", JSON.stringify(short(await runSleeveManagerValidation(spotArt, CAVA_293X237))));

// 4. wrong white overprint
const badWhite = await mutate(async (doc) => {
  const gs = res(doc, "ExtGState");
  for (const [, v] of gs.entries()) {
    const d = (v instanceof PDFRef ? doc.context.lookup(v) : v) as PDFDict;
    if (d instanceof PDFDict) { d.set(PDFName.of("OP"), PDFBool.False); d.set(PDFName.of("op"), PDFBool.False); }
  }
});
console.log("WRONG WHITE OVERPRINT TEST", JSON.stringify(short(await runSleeveManagerValidation(badWhite, CAVA_293X237))));

// 5. Maten ON
const matenOn = await mutate(async (doc) => {
  const oc = doc.context.lookup(doc.catalog.get(PDFName.of("OCProperties"))) as PDFDict ?? doc.catalog.get(PDFName.of("OCProperties")) as PDFDict;
  const d = doc.context.lookup(oc.get(PDFName.of("D"))) as PDFDict ?? oc.get(PDFName.of("D")) as PDFDict;
  d.set(PDFName.of("OFF"), doc.context.obj([]));
});
console.log("MATEN ON TEST", JSON.stringify(short(await runSleeveManagerValidation(matenOn, CAVA_293X237))));
