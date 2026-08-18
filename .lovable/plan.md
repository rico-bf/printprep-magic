# POC: automatisch drukklaar maken van shrink sleeve PDF's

## Bevindingen uit de drie PDF's (technisch geverifieerd)

- Alle drie: 1 pagina, MediaBox `0 0 830.551 671.811` pt (293 x 237 mm). Identiek, dus 1-op-1 plaatsen kan.
- Master OCG's in `/OCProperties`: `Artworklaag voor bedrukte fles`, `Wit (NIET IN WERKEN)`, `Maten (NIET IN WERKEN)`, `Stans (NIET IN WERKEN)`. `/Order` = Stans, Maten, Wit, Artwork. `/ON` = Artwork, Wit, Stans. `/OFF` = Maten. Exact de gewenste eindtoestand.
- Master `/Resources /Properties`: `/MC0` = Artworklaag, `/MC1` = Wit, `/MC2` = Maten, `/MC3` = Stans.
- Master contentstream (2.430 bytes) bevat vier `BDC ... EMC` blokken. Het `/OC /MC0 BDC ... EMC` blok (artwork) is **leeg** — precies de plek waar het artwork in moet.
- Dekwit: ColorSpace `/CS0 = [/Separation /White ...]`, ExtGState `/GS0` met `OP=true, op=true, OPM=1`. Ook Separations `/Info` en `/Stans` aanwezig.
- Golden reference `Sleeve-Cava-Expivi.pdf` is exact de master met artworkcontent in het MC0-blok (zelfde Properties, Separations, Order, ON/OFF). Onze aanpak reproduceert dus hetzelfde model.
- Artwork-PDF heeft een eigen OCG `Laag 1` met eigen `/OC /MC0 BDC` wrapper, plus Form XObjects `Fm0`/`Fm1` en één image `Im0`.

Conclusie: geen reconstructie nodig. Master laden, artwork als Form XObject embedden en met `1 0 0 1 0 0 cm` in het bestaande lege Artwork-OCG-blok plaatsen. Geen rasterisatie, geen scaling.

## Architectuur

```text
React testpagina (alleen upload + rapport)
        v
server function  (API-contract /api/prepress/generate)
        v
prepress service (adapters: master-provider, storage, naming, logging)
        v
pure TypeScript PDF engine (pdf-lib, low-level API)
        v
output PDF bytes + validatierapport
```

De core kent geen React, Supabase, Lovable, Laravel of Lunar: alleen bytes + config in, bytes + rapport uit.

## Bestandsstructuur

```text
src/prepress/core/types.ts             PrepressResult, ValidationReport, LogEntry
src/prepress/core/errors.ts            vaste error codes (PAGE_SIZE_MISMATCH, ...)
src/prepress/core/template-config.ts   één templateConfig cava-293x237
src/prepress/core/pdf-inspect.ts       low-level lezen: OCG's, /Order, /ON /OFF, Separations, OP/op/OPM, BDC-blokken
src/prepress/core/pdf-validator.ts     preflight artwork / master / output + golden-compare
src/prepress/core/pdf-engine.ts        generatePrintReadyPdf(masterBytes, artworkBytes, templateConfig)
src/prepress/core/naming.ts            buildOutputFilename() als losse functie
src/prepress/adapters/storage-adapter.ts     interface + in-memory implementatie
src/prepress/adapters/master-provider.ts     MasterProvider: haalt masterbytes uit private storage
src/prepress/adapters/supabase-storage-adapter.ts  StorageAdapter op privé bucket (masters + output)
src/lib/prepress.functions.ts          server function wrapper (API-contract)
src/prepress/tests/*.test.ts           vitest tests met de drie PDF's als fixtures
src/routes/index.tsx                   POC-testinterface (Nederlands)
docs/HANDOFF_LARAVEL_LUNAR.md          overdrachtsdocument
```

## PDF-techniek (engine)

1. Master laden met pdf-lib, zonder flatten en zonder metadata-herbouw.
2. Master-preflight: 4 OCG's met exacte namen, `/Order`, ON/OFF-status, `/Separation /White`, ExtGState met `OP/op/OPM`, en het bestaan van het `/OC /MCx BDC` blok van de Artworklaag.
3. Artwork-preflight: magic bytes `%PDF`, parsebaar, exact 1 pagina, MediaBox gelijk aan master (tolerantie 0,01 pt) — anders FAIL.
4. Artwork embedden als Form XObject (`embedPage`): PDF-content blijft PDF-content, vectoren blijven vector, de bestaande image blijft ongewijzigd. Resourcenaam `/PrepressArt0`.
5. In de embedded form worden `/Properties`-verwijzingen naar de artwork-eigen OCG (`Laag 1`) omgezet naar de master-OCG `Artworklaag voor bedrukte fles`, zodat alle marked content aan de juiste bestaande laag hangt en er geen vijfde laag ontstaat.
6. De masterpagina-contentstream wordt op precies één plek gewijzigd: in het bestaande `/OC /MC0 BDC ... EMC` blok komt `q 1 0 0 1 0 0 cm /PrepressArt0 Do Q`. Stans-, Maten- en Wit-blokken worden niet aangeraakt.
7. Opslaan zonder kleurconversie, zonder transparantie-flatten.

## Validatie na generatie (output opnieuw inlezen)

De gegenereerde bytes worden opnieuw geparseerd: geldig PDF, exact 1 pagina, paginaformaat, 4 OCG's + exacte namen + volgorde, ON/OFF per laag, `/Separation /White`, `OP=true`/`op=true`/`OPM=1`, artworkcontent aanwezig, artwork gekoppeld aan de Artwork-OCG, transformmatrix exact identiteit (geen scaling).

De Stans/Maten/Wit-lagen worden **semantisch** gevalideerd (geen byte-vergelijking): per laagblok wordt de gedecodeerde contentstream genormaliseerd en vergeleken met de master op operatorreeks, coördinaten (numerieke tolerantie), gebruikte resources (ColorSpace-, ExtGState-, Font-verwijzingen), de bijbehorende OCG-koppeling, kleurruimten/kleurwaarden (o.a. `/Separation /White`, `/Info`, `/Stans`) en graphics states (`OP`, `op`, `OPM`, `BM`, `SMask`, `CA`, `ca`). Verschillen worden per eigenschap gerapporteerd.

Extra kritieke check: het outputdocument bevat **exact vier** OCG's — de artwork-eigen OCG `Laag 1` mag niet als vijfde OCG in `/OCProperties` (`/OCGs`, `/Order`, `/ON`, `/OFF`) of als losse `/OC`-verwijzing voorkomen. Zo niet: FAIL.

Elke kritieke check die faalt = FAIL, geen download.

Als pdf-lib bij verificatie aantoonbaar iets sloopt (OCG's, White Separation, overprint), wordt dat als `TECHNICAL FAIL` met de exacte eigenschap gerapporteerd — niet verborgen en niet opgelost met rasteren of flattenen. Het alternatief zou dan een minimale incremental-update writer zijn (append-only, master-bytes onaangeroerd); dat meld ik eerst voordat ik het bouw.

## API-contract

`POST /api/prepress/generate`, `multipart/form-data` met `template_id` en `artwork`. Response exact zoals gespecificeerd (`success`, `status`, `template_id`, `output_filename`, `validation{...}`, `download_url`), bij fout `errors[{code,message}]` met vaste codes. Naamgeving: `Sleeve-Cava-Expivi-alleen_artwork.pdf` -> `Sleeve-Cava-Expivi-DRUKKLAAR.pdf`.

## Opslag

Lovable Cloud wordt ingeschakeld met één **privé** bucket (`prepress`), met paden `masters/` en `output/`.

- De master (`MASTER_TEMPLATE_CAVA_TEST_v2.pdf`) wordt in `masters/cava-293x237/` gezet en uitsluitend via de `MasterProvider` opgehaald; geen base64-module in de codebase.
- De gegenereerde PDF wordt via de `StorageAdapter` privé opgeslagen onder `output/`. De API retourneert een tijdelijke signed download-URL (geldig ca. 15 minuten), geen base64-payload.
- Core en engine kennen alleen de `StorageAdapter`/`MasterProvider`-interfaces; Laravel kan hier later Filesystem/S3 onder hangen.

## UI

Eén pagina `Automatisch drukklaar maken – POC`, Nederlands, functioneel: template `CAVA – 293 × 237 mm`, dropzone, preflightresultaat, knop `DRUKKLAAR MAKEN`, daarna `VALIDATIERAPPORT` met alle checks, `STATUS: PASS`/`FAIL`, en alleen bij PASS `DOWNLOAD DRUKKLAAR PDF`. Plus een blok technische logging.

## Golden reference

`Sleeve-Cava-Expivi.pdf` wordt **uitsluitend** in de POC/testsuite gebruikt als semantische vergelijkingsbron (rapportage van overeenkomsten/afwijkingen). Het is géén onderdeel van de productie-preflight: de runtime-validatie draait volledig op master + output, zodat productie geen golden reference nodig heeft.

## Tests (vitest)

correct artwork -> PASS; afwijkend paginaformaat -> FAIL; meerdere pagina's -> FAIL; niet-PDF -> FAIL; master zonder vereiste laag -> FAIL; master zonder White Separation -> FAIL; master zonder overprint-ExtGState -> FAIL; output met vijfde OCG (`Laag 1`) -> FAIL. Plus de golden-reference-vergelijkingstest. Fixtures: de drie aangeleverde PDF's, negatieve gevallen afgeleid van de master.

## Daarna stoppen

Na de eerste succesvolle generatie met validatierapport stop ik, zodat je het bestand in Acrobat/Illustrator kunt controleren.