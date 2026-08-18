# Overdracht: prepress-engine (POC) naar Laravel / Lunar

Code-specifieke overdracht op basis van de daadwerkelijk gebouwde POC. Doel van de
POC: aantonen dat shrink sleeve artwork volledig automatisch drukklaar gemaakt kan
worden zonder Adobe Illustrator of Acrobat, met behoud van lagen (OCG's),
steunkleur `White`, overprint en vectorcontent.

## 1. Architectuur en bestandspaden

```text
UI (Nederlands, TanStack route)          src/routes/index.tsx
  -> server function (transport)         src/lib/prepress.functions.ts
     -> service (orchestratie)           src/prepress/service.ts
        -> engine (pure TypeScript)      src/prepress/core/*
        -> ports (interfaces)            src/prepress/ports.ts
           -> adapter (opslag/master)    src/prepress/adapters/supabase-storage.server.ts
POC-testsuite                            src/prepress/__tests__/golden-reference.test.ts
Bundler-detail (pdf-lib alias)           vite.config.ts
```

| Bestand | Verantwoordelijkheid |
| --- | --- |
| `src/prepress/core/types.ts` | Datacontracten: `TemplateConfig`, `PdfInspection`, `ValidationCheck`, `ValidationSummary`, `LayerSignature`, `PrepressResult` |
| `src/prepress/core/errors.ts` | Vaste foutcodes (`PrepressErrorCode`) + `PrepressFailure` |
| `src/prepress/core/template-config.ts` | Templateregistry (`CAVA_293X237`, `getTemplateConfig`, `technicalLayerNames`, `allLayerNames`) |
| `src/prepress/core/pdf-inspect.ts` | Low-level inspectie: OCG's, laagvolgorde/zichtbaarheid, separations, ExtGState, marked content, laagsignatures, Illustrator private data |
| `src/prepress/core/pdf-engine.ts` | `generatePrintReadyPdf`: plaatsing artwork, OCG-remap, opschonen, preflights |
| `src/prepress/core/pdf-validator.ts` | `validateMaster`, `validateArtwork`, `validateOutput`, `compareLayerSignature`, `compareWithGolden` |
| `src/prepress/core/naming.ts` | `buildOutputFilename` -> `<artworknaam>-DRUKKLAAR.pdf` |
| `src/prepress/service.ts` | `runPrepress`: master ophalen, engine draaien, output privé opslaan, tijdelijke URL (TTL 900 s) |
| `src/prepress/ports.ts` | `StorageAdapter` (`read`/`write`/`createTemporaryUrl`) + `MasterProvider` (`getMaster`) |
| `src/prepress/adapters/supabase-storage.server.ts` | POC-implementatie op private bucket `prepress` |
| `src/lib/prepress.functions.ts` | `prepareArtwork` server function; input: `templateId`, `filename`, `artworkBase64` (alleen transport) |

De engine (`src/prepress/core/`) importeert géén React, TanStack, Supabase, Laravel
of Lunar. Enige runtime-dependency is `pdf-lib`. Input = bytes + config,
output = bytes + validatierapport.

## 2. Dependencies (daadwerkelijk gebruikt)

- Engine: `pdf-lib` ^1.17.1 — enige productie-dependency van `src/prepress/core/`.
- Service/adapter: `@supabase/supabase-js` ^2.112.3 (alleen in de adapter; vervangbaar).
- Transportlaag: `@tanstack/react-start` 1.168.32 + `zod` ^3.24.2 (inputvalidatie).
- UI: React 19, TanStack Router 1.170.18, Tailwind CSS 4, shadcn/ui-componenten.
- Test: `vitest` ^4.1.10 (`bunx vitest run src/prepress`).
- Bundler-detail: `vite.config.ts` aliast `pdf-lib` naar `pdf-lib/dist/pdf-lib.esm.js`
  (via `require.resolve`, regex `^pdf-lib$`) omdat de standaard ESM-entry onder
  CJS/ESM-interop faalt met `Cannot destructure property '__extends'`. In een
  Node-service met CommonJS/ESM zonder bundler is die alias niet nodig.

## 3. Actuele template (`cava-293x237`)

Uit `src/prepress/core/template-config.ts`:

- `masterFile` / `masterVersion`: `MASTER_TEMPLATE_CAVA_TEST_v3.pdf` / `v3` (v2 wordt nergens meer gebruikt, geen fallback).
- `masterStoragePath`: `masters/cava-293x237/MASTER_TEMPLATE_CAVA_TEST_v3.pdf` (private bucket `prepress`).
- Lagen en standaardzichtbaarheid: `Stans (NIET IN WERKEN)` ON, `Maten (NIET IN WERKEN)` OFF,
  `Wit (NIET IN WERKEN)` ON, `Artworklaag voor bedrukte fles` ON — in die volgorde.
- Marked content mapping in de master: `/MC0` = Artwork, `/MC1` = Wit, `/MC2` = Maten, `/MC3` = Stans.
- Steunkleur: `White`. Paginaformaat 830.551 × 671.811 pt (293 × 237 mm), tolerantie `0.01` pt.
- Output-pad: `outputs/<templateId>/<uuid>/<artworknaam>-DRUKKLAAR.pdf`.

## 4. Technische werkwijze in de engine

1. Master wordt geladen zonder metadata-reconstructie; paginaformaat, boxes, OCG's,
   laagvolgorde en zichtbaarheid blijven exact zoals in de master.
2. Artwork wordt als **Form XObject** ingebed (`doc.embedPdf`) — geen rasterisatie.
3. `remapArtworkOptionalContent` zet alle `/OC`-verwijzingen binnen het ingebedde
   artwork om naar de bestaande artwork-OCG van de master.
4. `dropUnregisteredOcgs` verwijdert OCG/OCMD-objecten die niet in `/OCProperties`
   van de master staan; hierdoor ontstaat geen vijfde laag (bijv. artwork-eigen "Laag 1").
5. `stripIllustratorPrivateData` verwijdert `/PieceInfo /Illustrator` en
   `AIPDFPrivateData*` uit master- en artworkstructuren. Normale metadata
   (`/Creator`, XMP) blijft intact.
6. Plaatsing gebeurt binnen het bestaande `/OC /MC0 BDC ... EMC` blok van de
   artworklaag met matrix `1 0 0 1 0 0` (1:1, geen scaling/fitting):
   `q 1 0 0 1 0 0 cm /Artwork Do Q`.
7. Output wordt opnieuw geïnspecteerd en volledig gevalideerd; `doc.save` met
   `useObjectStreams: false`.

## 5. Validatie

Drie preflights — **artwork (input)**, **master** en **output** — leveren samen 28
checks (`ValidationCheck[]`) plus een samengevat `ValidationSummary`. Output-checks
onder andere: PDF geldig, 1 pagina, paginaformaat gelijk aan master, vier lagen met
exacte namen, laagvolgorde, standaardzichtbaarheid (Maten uit), steunkleur `White`,
separations `White`/`Info`/`Stans` behouden, overprint (`OP=true`, `op=true`, `OPM=1`),
artwork aanwezig en gekoppeld aan de artwork-OCG, artwork niet geschaald, geen extra
OCG's, geen Illustrator private data, en **semantische** gelijkheid van
Stans/Maten/Wit t.o.v. de master (operatorreeks, coördinaten afgerond op 3
decimalen, resourceverwijzingen, kleurruimten, graphics states, fonts) — dus geen
byte-identieke vergelijking.

Eén falende kritieke check betekent `status: "FAIL"`, geen output, en een foutcode
uit `PrepressErrorCode` met leesbare Nederlandse melding. Beschikbare codes o.a.:
`INVALID_PDF`, `PAGE_SIZE_MISMATCH`, `TEMPLATE_UNKNOWN`, `MASTER_UNAVAILABLE`,
`MASTER_LAYER_MISSING`, `MASTER_WHITE_OVERPRINT_MISSING`,
`MASTER_ARTWORK_BLOCK_MISSING`, `ILLUSTRATOR_PRIVATE_DATA_PRESENT`,
`OUTPUT_ARTWORK_SCALED`, `OUTPUT_ARTWORK_OCG_UNLINKED`,
`OUTPUT_MASTER_CONTENT_CHANGED`, `OUTPUT_EXTRA_OCG`, `TECHNICAL_FAIL`.

### Golden reference

`Sleeve-Cava-Expivi.pdf` wordt **uitsluitend** in de POC-testsuite gebruikt
(`src/prepress/__tests__/golden-reference.test.ts`, functie `compareWithGolden`) om
technische gelijkwaardigheid aan te tonen. Geen onderdeel van de productie-preflight
en geen template. Fixtures in `fixtures/` of via `PREPRESS_FIXTURES_DIR`
(`MASTER_TEMPLATE_CAVA_TEST_v3.pdf`, artwork, golden reference); run
`bunx vitest run src/prepress`.

Bekend, verklaarbaar verschil: de witlaag van de handmatige referentie heeft een
andere operator- en resourceopbouw dan de master omdat Illustrator die laag bij
export herschreven heeft. De gegenereerde PDF volgt de master exact — dat is de eis.

## 6. Migratie naar Laravel / Lunar

De engine draait op elke JavaScript-runtime (Node 20+, Bun, Cloudflare Workers).
Aanbevolen route:

1. Kopieer `src/prepress/` (core, ports, service, naming) naar een interne npm-package,
   bijv. `@company/prepress-engine`. Enige dependency: `pdf-lib`. Laat
   `src/prepress/adapters/` en `src/lib/prepress.functions.ts` achterwege — dat is
   POC-infrastructuur.
2. Draai die package als kleine Node-service (HTTP of queue worker). Laravel roept de
   service aan vanuit een queued job (`ProcessArtworkJob`).
3. Implementeer de twee ports opnieuw in die service:
   - `StorageAdapter` -> S3 / Laravel Storage (`read`, `write`, `createTemporaryUrl`
     ~ `Storage::temporaryUrl`).
   - `MasterProvider` -> master uit private storage of uit het Lunar-productmodel.
4. `TemplateConfig` verhuist van `core/template-config.ts` naar een tabel
   `sleeve_templates` (laagnamen, volgorde, zichtbaarheid, `master_storage_path`,
   `master_version`, spotkleur, tolerantie) en wordt per Lunar-product of -variant
   gekoppeld. `getTemplateConfig` wordt dan een repository-lookup; de engine wijzigt niet.
5. Sla `PrepressResult.checks`, `validation`, `errors` en `logs` op bij de orderregel,
   zodat prepress het rapport kan inzien. De foutcodes uit `core/errors.ts` zijn de
   stabiele sleutel voor monitoring.
6. Outputbestanden blijven privé; lever alleen tijdelijke download-URL's uit
   (POC: 900 seconden, instelbaar via `downloadUrlTtlSeconds`).

### Aandachtspunten

- Geen PHP-implementatie van PDF-manipulatie nodig; die blijft in TypeScript.
- Voeg per nieuw sleeveformaat een template plus master toe; engine ongewijzigd.
- Bestandsnaamgeving zit los in `core/naming.ts`; vervang door ordernummer of SKU.
- Grote artworkbestanden: gebruik een queue met ruimere memory limit; de POC verwerkt
  6 MB artwork in ruim een halve seconde.
- Base64-transport in `src/lib/prepress.functions.ts` is een POC-keuze; gebruik in
  Laravel een directe upload naar storage plus een pad in de jobpayload.

## 7. Optional SleeveManager Validation V2

Experimentele, **read-only** tweede validatielaag, functioneel gebaseerd op het
Illustrator-script `BedrukteFles-SleeveManager-v11.jsx`. Niet blokkerend:
validatie 1 blijft de enige productie-gating validator, en een FAIL van
validatie 2 blokkeert de download niet. Er worden **geen** correcties uitgevoerd
(geen RGB→CMYK, geen flatten, geen overprint-wijzigingen, geen hergeneratie).

### Bijbehorende bestanden

| Pad | Rol |
| --- | --- |
| `src/prepress/validation2/index.ts` | Enige publieke entry point |
| `src/prepress/validation2/sleevemanager-config.ts` | Feature flag + verwachte waarden (`#A1DAF8`, `#EC6608`, 1 pt, 50 MB) |
| `src/prepress/validation2/sleevemanager-types.ts` | Aparte types (`V2Report`, `V2Check`, `V2CheckStatus`) |
| `src/prepress/validation2/sleevemanager-validator.ts` | Volledige inspectielogica (OCG's, separations, overprint, RGB, transparantie, complexiteit) |

Aanknopingspunten buiten deze map (bewust minimaal):

- `src/prepress/service.ts`: één optionele `await import("./validation2")`-aanroep
  ná succesvolle generatie + het optionele veld `validation2` in `PrepressResponse`.
- `src/routes/index.tsx`: één extra UI-kaart "Validatie 2 – SleeveManager".

`src/prepress/core/pdf-engine.ts`, `pdf-validator.ts`, `pdf-inspect.ts` en
`template-config.ts` zijn **niet** gewijzigd voor V2; de validator hergebruikt
alleen bestaande read-only helpers.

### Aan/uit zetten

- Env: `ENABLE_SLEEVEMANAGER_VALIDATION_V2=false` (of `0`) → uit.
- Of `enabled: false` in `sleevemanager-config.ts`.
- Uit betekent: `validation2: { enabled: false }` in de response en geen UI-blok;
  generatie, validatie 1, download, storage, API en templateselectie zijn
  volledig onafhankelijk van V2.

### Volledig verwijderen

1. Verwijder de map `src/prepress/validation2/`.
2. Verwijder in `src/prepress/service.ts` de type-import, het veld `validation2`
   en het blok met de optionele `await import("./validation2")`-aanroep.
3. Verwijder in `src/routes/index.tsx` de `V2Pill`-component, de type-import en de
   kaart "Validatie 2 – SleeveManager".

Daarna werkt de bewezen POC ongewijzigd verder.

### Checks en statussen

Statussen: `PASS` / `FAIL` / `WARNING` / `NOT_VERIFIABLE`. Eigenschappen die niet
betrouwbaar uit een PDF vast te stellen zijn, krijgen expliciet
`NOT_VERIFIABLE` in plaats van een onterechte PASS:

- `stans_exact_path_item_count`: het Illustrator-begrip "één PathItem" bestaat niet
  in PDF; wel controleerbaar is `stans_subpaths` (aantal `m`/`re`-subpaden).
- `white_alternate_color` / `stans_alternate_color`: alleen betrouwbaar als de
  alternate space RGB is. Bij een CMYK alternate space is de hex ICC-afhankelijk;
  de ruwe tint-transformwaarden worden dan wel gerapporteerd.
- Artwork-checks zijn `NOT_VERIFIABLE` als er geen artwork-content is.

Overige checks: `white_layer_present/visible`, `white_spot`, `white_spot_used`,
`white_overprint` (OP=true, op=true, OPM=1), `stans_layer_present/visible`,
`stans_spot`, `stans_spot_used`, `stans_width` (1 pt), `maten_layer_present`,
`maten_hidden` (OFF), `artwork_overprint`, `artwork_spot_colors`,
`artwork_rgb_vectors`, `artwork_rgb_images`, `artwork_transparency`,
`artwork_color_spaces`, `file_size` (>50 MB = WARNING), `complexity`.

Artwork-checks kijken uitsluitend naar content binnen de OCG
"Artworklaag voor bedrukte fles", inclusief geneste Form XObjects; technische
separations uit Stans/Wit tellen niet mee zolang ze alleen buiten artwork worden
gebruikt.

### Complexiteit

`pathSegments`, `imageXObjects`, `formXObjects` en bestandsgrootte zijn
PDF-afgeleid. De score (`Zeer goed`/`Goed`/`Matig`/`Slecht`) heet daarom
expliciet **PDF complexity score** en is **niet** 1-op-1 gelijk aan de
Illustrator-score op anchor points. De 50 MB-waarschuwing is wel direct
overgenomen.

### Testresultaten (POC)

Getest met de bestaande Expivi-artwork plus kunstmatige varianten van de
gegenereerde output:

| Test | Resultaat |
| --- | --- |
| Correcte output | validatie 1 PASS; V2 `artwork_transparency` FAIL (artwork bevat echt Multiply/alpha/SMask) |
| RGB-afbeelding toegevoegd | `artwork_rgb_images` FAIL |
| Artwork-overprint toegevoegd | `artwork_overprint` FAIL |
| Artwork-steunkleur toegevoegd | `artwork_spot_colors` FAIL |
| White-overprint uitgezet | `white_overprint` FAIL |
| Maten ON | `maten_hidden` FAIL |

In alle gevallen bleef validatie 1 PASS en bleef de download beschikbaar.
