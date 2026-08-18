# Handoff: prepress-engine naar Laravel / Lunar

Doel van deze POC: aantonen dat shrink sleeve artwork volledig automatisch en
zonder Adobe Illustrator of Acrobat drukklaar gemaakt kan worden, met behoud van
lagen (OCG's), steunkleur White, overprint en vectorcontent.

## 1. Architectuur

```text
UI (Nederlands, TanStack route)       src/routes/index.tsx
  -> server function (transport)      src/lib/prepress.functions.ts
     -> service (orchestratie)        src/prepress/service.ts
        -> engine (pure TypeScript)   src/prepress/core/*
        -> ports (interfaces)         src/prepress/ports.ts
           -> adapters                src/prepress/adapters/*
```

De engine (`src/prepress/core/`) is een **pure TypeScript-module**: geen imports
van React, TanStack, Supabase, Laravel of Lunar. Alleen `pdf-lib`. Input =
bytes + config, output = bytes + validatierapport.

| Bestand | Verantwoordelijkheid |
| --- | --- |
| `core/types.ts` | Datacontracten (`TemplateConfig`, `PdfInspection`, `PrepressResult`) |
| `core/errors.ts` | Vaste foutcodes (stabiele sleutel voor logging/monitoring) |
| `core/template-config.ts` | Technische templatedata (laagnamen, volgorde, zichtbaarheid, tolerantie) |
| `core/pdf-inspect.ts` | Low-level inspectie: OCG's, separations, ExtGState, marked content, laagsignatures |
| `core/pdf-engine.ts` | Plaatsing artwork + preflight van input, master en output |
| `core/pdf-validator.ts` | Alle validatieregels en de semantische laagvergelijking |
| `core/naming.ts` | Bestandsnaamconventie output (los vervangbaar) |
| `service.ts` | Master ophalen, engine draaien, output privé opslaan, tijdelijke URL |
| `ports.ts` | `StorageAdapter` + `MasterProvider` interfaces |

## 2. Technische werkwijze

1. Master wordt geladen zonder metadata-reconstructie; paginaformaat, boxes,
   OCG's, laagvolgorde en zichtbaarheid blijven exact zoals in de master.
2. Het artwork wordt als **Form XObject** ingebed (geen rasterisatie).
3. Alle optional-content verwijzingen binnen het ingebedde artwork worden omgezet
   naar de bestaande artwork-OCG van de master; niet-geregistreerde OCG/OCMD-
   objecten worden verwijderd. Daardoor ontstaat er geen vijfde laag (bijv. de
   artwork-eigen "Laag 1").
4. Het artwork wordt binnen het bestaande `/OC /MCx BDC ... EMC` blok van de
   artworklaag geplaatst met matrix `1 0 0 1 0 0` (1:1, geen scaling/fitting).
5. De output wordt opnieuw geïnspecteerd en volledig gevalideerd.

## 3. Validatie

Drie preflights: **input** (artwork), **master** en **output**. De output-checks
bevatten onder andere: paginaformaat gelijk aan master, vier lagen aanwezig met
exacte namen, laagvolgorde, standaardzichtbaarheid (Maten uit), steunkleur
`White`, overprint (`OP=true`, `op=true`, `OPM=1`), artwork aanwezig en gekoppeld
aan de artwork-OCG, artwork niet geschaald, geen extra OCG's, en **semantische**
gelijkheid van Stans/Maten/Wit ten opzichte van de master (operatorreeks,
coördinaten, resourceverwijzingen, kleurruimten, graphics states, fonts) - dus
geen byte-identieke vergelijking.

Falen van één kritieke check betekent `status: "FAIL"`, geen output, en een
foutcode met leesbare Nederlandse melding.

### Golden reference

`Sleeve-Cava-Expivi.pdf` wordt **uitsluitend** in de POC-testsuite gebruikt
(`src/prepress/__tests__/golden-reference.test.ts`) om technische
gelijkwaardigheid aan te tonen. Het is geen onderdeel van de productie-preflight
en geen template. Zet de fixtures in `fixtures/` of gebruik
`PREPRESS_FIXTURES_DIR`, en run `bunx vitest run src/prepress`.

Bekend, verklaarbaar verschil: de witlaag van de handmatige referentie heeft een
andere operator- en resourceopbouw dan de master, omdat Illustrator die laag bij
export herschreven heeft. De gegenereerde PDF volgt de master exact, wat de
vereiste is.

## 4. Migratie naar Laravel / Lunar

De engine draait op elke JavaScript-runtime (Node 20+, Bun, Cloudflare Workers).
Aanbevolen route:

1. Kopieer `src/prepress/` naar een interne npm-package (bijv.
   `@company/prepress-engine`). Enige dependency: `pdf-lib`.
2. Draai die package als kleine Node-service (HTTP of queue worker). Laravel
   roept de service aan vanuit een queued job (`ProcessArtworkJob`).
3. Implementeer de twee ports opnieuw in die service:
   - `StorageAdapter` -> S3 / Laravel Storage (`read`, `write`,
     `createTemporaryUrl` is vergelijkbaar met `Storage::temporaryUrl`).
   - `MasterProvider` -> master uit private storage of uit het Lunar-productmodel.
4. `TemplateConfig` verhuist naar een tabel `sleeve_templates` (laagnamen,
   volgorde, zichtbaarheid, `master_storage_path`, tolerantie) en wordt per
   Lunar-product of -variant gekoppeld.
5. Sla `PrepressResult.checks`, `validation`, `errors` en `logs` op bij de
   orderregel, zodat prepress het rapport kan inzien. De foutcodes uit
   `core/errors.ts` zijn de stabiele sleutel voor monitoring.
6. Outputbestanden blijven privé; lever alleen tijdelijke download-URL's uit
   (POC: 15 minuten).

### Aandachtspunten

- Geen PHP-implementatie nodig: PDF-manipulatie blijft in TypeScript.
- Voeg per nieuw sleeveformaat een template plus master toe; de engine wijzigt niet.
- Bestandsnaamgeving zit los in `core/naming.ts` (nu `<artworknaam>-DRUKKLAAR.pdf`);
  vervang door ordernummer of SKU indien gewenst.
- Grote artworkbestanden: gebruik een queue met ruimere memory limit; de POC
  verwerkt 6 MB artwork in ruim een halve seconde.
