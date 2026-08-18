# Print Prep Master

PROJECT: Automatisch drukklaar maken van shrink sleeve PDF-bestanden

Bouw een werkende technische proof-of-concept waarmee een klant-artwork als PDF kan worden geüpload en volledig automatisch wordt omgezet naar een drukklaar PDF-bestand.

Dit is nadrukkelijk GEEN visuele mock-up.

Het belangrijkste doel is technisch bewijzen dat we zonder Adobe Illustrator of Adobe Acrobat in het productieproces een correcte druk-PDF kunnen genereren.

Adobe Illustrator en Acrobat worden alleen achteraf gebruikt om het automatisch gegenereerde resultaat handmatig te controleren.

1. BEDRIJFSCONTEXT EN LANGERE TERMIJN

Deze proof-of-concept wordt eerst in Lovable gebouwd om snel te kunnen testen.

Onze bestaande website/webshop draait echter op:

Laravel

Lunar e-commerce

Als de POC succesvol is, moet onze eigen developer de oplossing eenvoudig kunnen begrijpen, overnemen en integreren in onze bestaande Laravel/Lunar-omgeving.

Daarom gelden vanaf het begin deze architectuurregels:

Bouw de PDF-processing volledig los van de frontend.

Bouw geen essentiële businesslogica in React/TanStack UI-components.

Bouw de PDF-engine als aparte TypeScript module/service.

De PDF-engine mag geen directe afhankelijkheid hebben van Lovable.

De core PDF-engine mag geen directe afhankelijkheid hebben van Supabase Storage, database of React.

Lovable/Supabase mogen alleen als adapter/wrapper rondom de core worden gebruikt.

Zorg voor een duidelijk API-contract.

Zorg dat dezelfde PDF-engine later door Laravel aangeroepen kan worden via HTTP/API.

Bouw nu GEEN Laravel-code en GEEN Lunar-integratie.

Houd wel vanaf het begin rekening met overdracht naar Laravel/Lunar.

De POC moet dus aantonen dat de PDF-engine werkt. Lovable is alleen de testinterface eromheen.

2. PROGRAMMEERTAAL EN TECHNISCHE STACK

Gebruik voor alle backend PDF-processing:

TypeScript

Gebruik voor server-side verwerking:

Deno / Supabase Edge Function of de server-side omgeving die Lovable hiervoor standaard aanbiedt.

De daadwerkelijke PDF-core moet een gewone TypeScript module zijn.

Bijvoorbeeld conceptueel:

generatePrintReadyPdf(
    masterPdfBytes,
    artworkPdfBytes,
    templateConfig
): Promise<PrepressResult>


Deze functie mag niets weten over:

Lovable UI

React

TanStack

Supabase database

Supabase Storage

gebruikersaccounts

Lunar

Laravel

Hij ontvangt alleen data en PDF-bytes en retourneert data en PDF-bytes.

Gebruik daarom een architectuur zoals:

Lovable frontend
       ↓
API / Edge Function
       ↓
Prepress service
       ↓
Pure TypeScript PDF engine
       ↓
Generated PDF


Later moet dit mogelijk zijn:

Laravel + Lunar
       ↓
HTTP API
       ↓
Prepress service
       ↓
dezelfde PDF engine


3. TESTBESTANDEN

Ik lever drie PDF-bestanden aan.

Bestand 1 – Master

MASTER_TEMPLATE_CAVA_TEST_v2.pdf

Dit is de technische master/template.

Gebruik DIT bestand als source of truth voor:

paginaformaat

stans

maten

dekwit

PDF-lagen

steunkleuren

overdrukinstellingen

technische PDF-structuur

De master mag NIET worden gereconstrueerd.

Bestand 2 – Klant-artwork

Sleeve-Cava-Expivi-alleen_artwork.pdf

Dit simuleert het bestand dat straks door een klant of medewerker wordt geüpload.

Dit bestand bevat alleen het ontwerp.

Het volledige paginaformaat mag voor deze POC 1-op-1 worden gebruikt.

Het artwork hoeft niet opnieuw gepositioneerd te worden.

Geen automatische fitting uitvoeren.

Geen automatische scaling uitvoeren.

Bestand 3 – Golden reference

Sleeve-Cava-Expivi.pdf

Dit is de PDF die momenteel handmatig in Adobe Illustrator drukklaar is gemaakt.

Gebruik dit bestand uitsluitend als technische referentie om het automatisch gegenereerde bestand te vergelijken.

Gebruik dit bestand NIET als template voor de generatie.

De automatische output hoeft niet byte-for-byte identiek te zijn.

PDF object-ID's, metadata, timestamps en compressie mogen verschillen.

De relevante technische eigenschappen moeten wel overeenkomen.

4. TEMPLATE

Voor deze POC ondersteunen we exact één template.

Template ID:

cava-293x237


Weergavenaam:

CAVA – 293 × 237 mm


Gebruik het paginaformaat van de master-PDF als absolute source of truth.

De weergegeven maat is ongeveer:

293 × 237 mm


Gebruik intern bij validatie de daadwerkelijke PDF MediaBox/PageBox van de master in PDF-punten.

Vergelijk het artwork met de masterpagina.

Gebruik geen onnauwkeurige mm → pixel conversie.

5. BESTAANDE PDF-LAGEN

De master bevat vier PDF Optional Content Groups / PDF-lagen.

De gebruikersweergave moet uiteindelijk deze laagstructuur bevatten:

Stans (NIET IN WERKEN)
Maten (NIET IN WERKEN)
Wit (NIET IN WERKEN)
Artworklaag voor bedrukte fles


De bestaande laagnamen moeten exact behouden blijven.

Geen namen aanpassen.

Geen extra technische laag aanmaken.

Geen lagen samenvoegen.

Geen lagen flattenen.

6. STANDAARD ZICHTBAARHEID LAGEN

De uiteindelijke PDF moet bij openen standaard deze toestand hebben:

Stans (NIET IN WERKEN)                = zichtbaar
Maten (NIET IN WERKEN)                = verborgen
Wit (NIET IN WERKEN)                  = zichtbaar
Artworklaag voor bedrukte fles        = zichtbaar


Dit moet via de daadwerkelijke PDF OCG-configuratie worden behouden.

Niet alleen visueel nabootsen.

7. STANS

De complete inhoud van:

Stans (NIET IN WERKEN)


moet rechtstreeks uit de master worden behouden.

Deze content mag niet:

opnieuw getekend worden

verschoven worden

geschaald worden

geconverteerd worden

geflattened worden

van kleur veranderen

De master is hiervoor de source of truth.

8. MATEN

De complete inhoud van:

Maten (NIET IN WERKEN)


moet rechtstreeks uit de master worden behouden.

Deze laag moet standaard verborgen blijven.

De maatteksten in deze laag hoeven voor deze POC inhoudelijk NIET gevalideerd te worden.

Het gaat alleen om behoud van de laag en de oorspronkelijke content.

9. DEKWIT

Dit is een bedrijfskritisch onderdeel van deze POC.

De bestaande laag:

Wit (NIET IN WERKEN)


moet rechtstreeks uit de master behouden blijven.

Regenereer het dekwit NIET.

Gebruik de bestaande technische PDF-content.

De steunkleur / Separation:

White


moet behouden blijven.

De bestaande overprintinstellingen moeten behouden blijven.

Controleer minimaal dat de relevante graphics state nog bevat:

OP = true
op = true
OPM = 1


Het dekwit mag niet:

CMYK-wit worden

RGB-wit worden

gerasterd worden

geflattened worden

zijn steunkleur verliezen

zijn overprintinstelling verliezen

Bij verlies van deze technische eigenschappen moet het resultaat:

FAIL


zijn.

Nooit een bestand als succesvol markeren wanneer dit niet aantoonbaar gecontroleerd kan worden.

10. ARTWORK

Het geüploade artwork is het enige variabele onderdeel.

Accepteer voor deze POC alleen:

PDF

exact één pagina

Het paginaformaat moet overeenkomen met het paginaformaat van de master.

Vergelijk hiervoor de relevante PDF PageBox/MediaBox.

Bij een afwijkend formaat:

FAIL


Voer NOOIT automatisch scaling uit.

Voer NOOIT automatisch fitting uit.

Voer NOOIT automatisch cropping uit.

Voer NOOIT een automatische kleurconversie uit.

11. ARTWORK PLAATSEN

Neem de volledige pagina-content van het geüploade artwork.

Plaats deze 1-op-1 binnen de bestaande PDF-laag:

Artworklaag voor bedrukte fles


De artworkpagina moet dezelfde fysieke positie en grootte behouden.

Gebruik indien een transformation matrix nodig is:

scaleX = 1
scaleY = 1
translationX = 0
translationY = 0


of technisch het exacte equivalent daarvan.

Het systeem mag geen artwork schalen.

12. BELANGRIJK: GEEN RASTERISATIE

Render het artwork NIET eerst als PNG, JPEG, canvas, screenshot of afbeelding.

Gebruik geen browser rendering voor de daadwerkelijke PDF-output.

Gebruik geen screenshot based PDF generation.

De originele PDF-content moet als PDF-content worden overgenomen.

Als het klantbestand vectorcontent bevat, moet deze vectorcontent behouden blijven.

Als het klantbestand zelf rasterafbeeldingen bevat, mogen die uiteraard raster blijven.

Het systeem mag echter zelf geen aanvullende rasterisatie uitvoeren.

13. PDF-IMPLEMENTATIE

Onderzoek eerst de technische structuur van de aangeleverde master.

Start bij voorkeur met:

pdf-lib


omdat we TypeScript gebruiken.

Gebruik waar nodig de low-level PDF API.

Het gewenste principe is:

laad de master-PDF;

behoud de bestaande PDF-objecten zoveel mogelijk;

laad de artwork-PDF;

embed de artworkpagina als PDF/Form XObject;

plaats die pagina op schaal 1:1;

wrap de artworkcontent in de bestaande OCG van:
Artworklaag voor bedrukte fles;

sla de gewijzigde master opnieuw op.

De relevante content sequence moet daadwerkelijk aan de bestaande Artwork OCG gekoppeld worden.

Gebruik hiervoor waar nodig PDF marked content zoals:

BDC
...
EMC


gekoppeld aan de juiste Optional Content Group.

Een gewone visuele PDF merge is NIET voldoende.

14. ZEER BELANGRIJKE FAIL-SAFE

Als pdf-lib of een andere gekozen library:

bestaande OCG's verwijdert;

lagen flattent;

White Separation verwijdert;

overprint verwijdert;

artwork rasteriseert;

transparantie onbedoeld flattent;

kleuren converteert;

dan NIET proberen dit te verbergen.

Gebruik dan eventueel een geschiktere PDF-library of technische aanpak.

Als het technisch nog niet correct opgelost kan worden:

toon:

TECHNICAL FAIL


en leg exact uit welke PDF-eigenschap niet behouden kon worden.

Een ogenschijnlijk werkende visuele PDF die technisch incorrect is, geldt als een mislukte POC.

15. GEEN RECONSTRUCTIE VAN DE MASTER

Dit is een fundamentele eis.

Bouw NIET programmatisch opnieuw:

de Stans-laag

de Maten-laag

de Wit-laag

de White Separation

overprint

technische lijnen

Deze zijn al correct aanwezig in de master.

De beste output is een minimaal gewijzigde master waarbij uitsluitend de artworkcontent wordt toegevoegd.

16. PREFLIGHT VOOR UPLOAD

Controleer vóór verwerking minimaal:

PDF magic bytes geldig
Bestand kan worden geopend
Aantal pagina's = 1
Paginaformaat = master paginaformaat
Master beschikbaar
Master bevat vereiste OCG's


Controleer niet alleen de bestandsextensie .pdf.

17. PREFLIGHT VAN MASTER

Controleer voordat een order verwerkt wordt dat de master minimaal bevat:

Stans (NIET IN WERKEN)
Maten (NIET IN WERKEN)
Wit (NIET IN WERKEN)
Artworklaag voor bedrukte fles


Controleer tevens:

White Separation aanwezig
White overprint aanwezig
Maten standaard verborgen
Stans standaard zichtbaar
Wit standaard zichtbaar
Artwork standaard zichtbaar


Als de master zelf niet voldoet:

FAIL


18. PREFLIGHT VAN AUTOMATISCHE OUTPUT

Controleer NA generatie opnieuw de daadwerkelijk gegenereerde PDF.

Vertrouw niet alleen op de instructies die tijdens generatie zijn uitgevoerd.

Lees de resulterende PDF opnieuw in en controleer minimaal:

[ ] PDF geldig
[ ] exact één pagina
[ ] paginaformaat gelijk aan master
[ ] vier vereiste OCG's aanwezig
[ ] correcte laagnamen
[ ] correcte laagvolgorde
[ ] Stans standaard zichtbaar
[ ] Maten standaard verborgen
[ ] Wit standaard zichtbaar
[ ] Artwork standaard zichtbaar
[ ] White Separation aanwezig
[ ] OP = true waar vereist
[ ] op = true waar vereist
[ ] OPM = 1 waar vereist
[ ] artworkcontent aanwezig
[ ] artwork gekoppeld aan Artwork OCG
[ ] geen automatische scaling toegepast
[ ] oorspronkelijke master technische content behouden


Alle kritieke controles moeten PASS zijn voordat een download wordt aangeboden.

19. GOLDEN REFERENCE TEST

Gebruik:

Sleeve-Cava-Expivi.pdf


als golden reference.

Vergelijk de automatisch gegenereerde PDF semantisch met deze handmatig geproduceerde referentie.

Vergelijk NIET op volledige binary hash.

Metadata en interne PDF-objectnummers mogen verschillen.

Vergelijk wel:

paginaformaat
aantal pagina's
OCG/lagen
laagnamen
laagstatus
White Separation
overprint
graphics states
artworkpositie
artworkafmetingen
kleurspaces voor technische kleuren
aanwezigheid van technische mastercontent


Rapporteer welke eigenschappen overeenkomen en welke niet.

20. UI VAN DE POC

Maak een zeer eenvoudige functionele testinterface.

Geen uitgebreide styling nodig.

Gebruik Nederlands.

Pagina:

Automatisch drukklaar maken – POC


Toon:

Template
CAVA – 293 × 237 mm


Uploadzone:

Sleep het klant-artwork als PDF hierheen


Na upload eerst preflight uitvoeren.

Bij correct bestand:

✓ PDF geldig
✓ 1 pagina
✓ Formaat correct


Knop:

DRUKKLAAR MAKEN


21. RESULTAATSCHERM

Na verwerking moet duidelijk zichtbaar zijn:

VALIDATIERAPPORT


Toon iedere belangrijke controle afzonderlijk.

Bijvoorbeeld:

✓ PDF geldig
✓ Paginaformaat correct
✓ Stans behouden
✓ Maten behouden
✓ Maten standaard verborgen
✓ Dekwit behouden
✓ White Separation behouden
✓ Dekwit overprint behouden
✓ Artwork toegevoegd
✓ Artworklaag correct
✓ Artwork niet geschaald


Daaronder:

STATUS: PASS


en alleen bij PASS:

DOWNLOAD DRUKKLAAR PDF


22. FAIL GEDRAG

Bij een technische fout:

STATUS: FAIL


Toon de precieze reden.

Bijvoorbeeld:

✕ White Separation ontbreekt


of:

✕ Artworkformaat wijkt af van master


of:

✕ Artwork kon niet correct aan Artwork OCG worden gekoppeld


Bied bij een kritieke FAIL GEEN drukklaar downloadbestand aan.

23. OUTPUTBESTANDSNAAM

Gebruik als input bijvoorbeeld:

Sleeve-Cava-Expivi-alleen_artwork.pdf


Maak daarvan:

Sleeve-Cava-Expivi-DRUKKLAAR.pdf


Maak de naming-logica een losse functie zodat deze later eenvoudig door Laravel vervangen kan worden door bijvoorbeeld ordernummer + productnaam.

24. OPSLAG

Voor deze POC mag Lovable Cloud / Supabase Storage worden gebruikt voor tijdelijke input- en outputbestanden.

Maar:

de PDF-engine zelf mag GEEN Supabase Storage code bevatten.

Gebruik een aparte storage adapter.

Conceptueel:

Storage adapter
      ↓
download bytes
      ↓
PDF engine
      ↓
output bytes
      ↓
Storage adapter


Later kan Laravel hierdoor eenvoudig Laravel Filesystem/S3 gebruiken.

Gebruik private storage.

Maak gegenereerde bestanden niet standaard publiek.

25. API-CONTRACT

Ontwerp de serverlogica alsof deze later een zelfstandige service is.

Gebruik conceptueel:

POST /api/prepress/generate


Request:

multipart/form-data


Velden:

template_id = cava-293x237
artwork = <PDF FILE>


Conceptuele response:

{
  "success": true,
  "status": "PASS",
  "template_id": "cava-293x237",
  "output_filename": "Sleeve-Cava-Expivi-DRUKKLAAR.pdf",
  "validation": {
    "pdf_valid": true,
    "page_count": true,
    "page_size": true,
    "layers_present": true,
    "layer_order": true,
    "layer_visibility": true,
    "white_separation": true,
    "white_overprint": true,
    "artwork_present": true,
    "artwork_ocg": true,
    "artwork_scaled": false
  },
  "download_url": "..."
}


Bij fout:

{
  "success": false,
  "status": "FAIL",
  "validation": {
    "page_size": false
  },
  "errors": [
    {
      "code": "PAGE_SIZE_MISMATCH",
      "message": "Artwork page size does not match template."
    }
  ]
}


Gebruik vaste error codes.

Geen foutafhandeling uitsluitend via vrije tekst.

26. TEMPLATE CONFIGURATIE

Hardcode technische templategegevens niet verspreid door de code.

Gebruik één configuratieobject.

Bijvoorbeeld:

const templateConfig = {
  id: "cava-293x237",
  name: "CAVA – 293 × 237 mm",
  masterFile: "MASTER_TEMPLATE_CAVA_TEST_v2.pdf",
  layers: {
    dieCut: "Stans (NIET IN WERKEN)",
    dimensions: "Maten (NIET IN WERKEN)",
    white: "Wit (NIET IN WERKEN)",
    artwork: "Artworklaag voor bedrukte fles"
  },
  spotColors: {
    white: "White"
  }
};


Het systeem moet later eenvoudig meerdere templateConfigs kunnen krijgen.

Bouw nu echter maar één template daadwerkelijk in.

27. VOORBEREIDING VOOR LUNAR

Bouw nu GEEN Lunar-integratie.

Houd wel rekening met dit toekomstige model:

Lunar product / product variant
             ↓
       template_id
             ↓
     cava-293x237
             ↓
    juiste master-PDF


Het enige dat Laravel/Lunar later aan de prepress-engine hoeft te leveren is in essentie:

template_id
artwork PDF
optioneel order_id


De PDF-engine mag geen kennis hebben van Lunar Product-, Cart- of Order-modellen.

28. TESTBAARHEID

Schrijf de PDF-core zodanig dat deze automatisch getest kan worden.

Maak minimaal tests voor:

correct artwork → PASS
verkeerd paginaformaat → FAIL
meer dan één pagina → FAIL
geen geldige PDF → FAIL
master zonder vereiste laag → FAIL
master zonder White Separation → FAIL
master zonder vereiste overprint → FAIL


Gebruik de drie aangeleverde bestanden als testfixtures waar passend.

29. LOGGING

Maak technische logging beschikbaar.

Log minimaal:

template_id
input filename
input page size
master page size
processing start
processing finish
validation status
validation errors
output filename


Log geen volledige PDF binary data.

30. CODESTRUCTUUR

Houd de code overzichtelijk en modulair.

Gebruik een structuur vergelijkbaar met:

/prepress
    /core
        pdf-engine.ts
        pdf-validator.ts
        template-config.ts
        types.ts
        errors.ts

    /adapters
        storage-adapter.ts

    /tests
        pdf-engine.test.ts
        pdf-validator.test.ts

/supabase/functions/prepress-generate
    index.ts


Pas dit aan de daadwerkelijke Lovable-projectstructuur aan indien nodig.

Het belangrijkste is de scheiding:

UI
≠
API wrapper
≠
PDF core
≠
Storage


31. NIET DOEN

Voeg voor deze eerste POC GEEN onnodige functies toe zoals:

gebruikersaccounts

klantaccounts

ordersysteem

Lunar-koppeling

Laravel-koppeling

betalingen

meerdere sleeveformaten

databasebeheer voor templates

AI-analyse

automatische artworkcorrectie

automatische scaling

automatische positionering

automatische kleurcorrectie

e-mail

uitgebreide dashboardfunctionaliteit

We testen nu slechts één kritieke hypothese:

Kan een artwork-PDF volledig automatisch en technisch correct aan onze bestaande master worden toegevoegd, met behoud van lagen, dekwit, steunkleur en overdruk?

32. DEFINITION OF DONE – FASE 1

Beschouw de POC uitsluitend als geslaagd wanneer:

Ik Sleeve-Cava-Expivi-alleen_artwork.pdf via de webinterface kan uploaden.

Ik op DRUKKLAAR MAKEN kan klikken.

Geen Adobe-software betrokken is bij de verwerking.

Een nieuwe PDF wordt gegenereerd.

De vier vereiste PDF-lagen aanwezig zijn.

De laagstatussen correct zijn.

De technische mastercontent behouden is.

White als steunkleur behouden is.

Dekwit nog correct op overdruk staat.

Artwork correct in de Artworklaag aanwezig is.

Artwork niet automatisch geschaald is.

Artwork niet door de applicatie gerasterd is.

De output een automatische PASS-preflight krijgt.

Het bestand downloadbaar is.

Het bestand vervolgens correct geopend en gecontroleerd kan worden in Adobe Acrobat en Adobe Illustrator.

33. BELANGRIJK: STOP NA FASE 1

Bouw eerst uitsluitend bovenstaande POC.

Ga nog NIET automatisch verder met extra functionaliteit.

Als de eerste gegenereerde PDF beschikbaar is, moet ik deze extern technisch kunnen controleren.

Pas nadat die output aantoonbaar correct is, bouwen we verder.

34. OVERDRACHT AAN ONZE DEVELOPER

Bereid de code vanaf het begin voor op overdracht.

Maak daarnaast in het project een document:

/docs/HANDOFF_LARAVEL_LUNAR.md


Dit document moet na afronding van de POC kort en technisch duidelijk beschrijven:

Wat de oplossing doet

Maximaal enkele alinea's.

Architectuur

Frontend
→ API
→ PDF service
→ PDF engine
→ output


Programmeertaal

TypeScript.

Belangrijkste bestanden/modules

Geef concrete bestandspaden.

API-contract

Request + response.

Template-configuratie

Hoe template_id aan een master wordt gekoppeld.

PDF-techniek

Leg kort uit:

hoe master wordt geladen;

hoe artwork wordt geïmporteerd;

hoe de bestaande Artwork OCG wordt gebruikt;

hoe technische masterlagen worden behouden;

hoe White/overprint worden gecontroleerd.

Laravel/Lunar integratie

Beschrijf kort hoe Laravel later:

template_id + artwork


naar de service kan sturen.

Lunar hoeft alleen te bepalen welke template_id bij een product/productvariant hoort.

Dependencies

Noem alle gebruikte packages en waarom ze worden gebruikt.

Omgevingsafhankelijkheden

Maak expliciet onderscheid tussen:

core dependencies
Lovable dependencies
Supabase dependencies


Migratie

Geef aan welke onderdelen rechtstreeks herbruikbaar zijn en welke Lovable/Supabase-specifieke adapters door onze Laravel-developer vervangen moeten worden.

Het document moet kort, bondig en praktisch zijn.

Geen marketingtekst.

Het moet geschikt zijn om rechtstreeks aan een externe developer te geven.

35. EERSTE OPDRACHT AAN LOVABLE

Begin nu met:

inspecteren van de drie aangeleverde PDF's;

vaststellen hoe de OCG/lagenstructuur van de master technisch is opgebouwd;

opzetten van de modulaire architectuur;

bouwen van de PDF-core;

bouwen van de minimale uploadinterface;

genereren van de eerste automatische test-PDF;

uitvoeren van de automatische technische validatie.

Laat expliciet weten als je bij het inspecteren of verwerken van PDF Optional Content Groups, Separation White of overprint tegen een technische beperking aanloopt.

Los zo'n beperking niet op door het PDF-bestand te rasteren of flattenen.

Het behoud van de originele prepressstructuur heeft prioriteit boven het visueel kunnen genereren van een PDF.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://printprep-magic.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/47d6d058-6e38-4214-877f-19e7fa552b70).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
