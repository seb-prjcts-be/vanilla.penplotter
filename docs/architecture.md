# Technische architectuur — vanilla.penplotter

## 1. Productbelofte

`vanilla.penplotter` is geen exportknop maar een programmeerbare compiler voor
plotterjobs:

```text
p5.js / p5.waves / vanilla JS / SVG
                  ↓
          GeometryDocument
                  ↓
     effecten + normalisatie
                  ↓
               PlotJob
                  ↓
       optimalisatie + planning
                  ↓
               PlotPlan
                  ↓
       renderer + machineprofiel
                  ↓
            MachineProgram
                  ↓
         driver + transport
                  ↓
              hardware
```

Iedere pijl is een publieke module. Een expert kan de hele keten vervangen; een
beginner gebruikt alleen `new PlotterEngine()`.

## 2. Vier representaties, niet één universeel object

### GeometryDocument

De auteurslaag. Ze bewaart lijnen, polylines, Bézier-curves, bogen, compound
paths, geslotenheid, lagen, tools, units en metadata. Curves blijven hier curves.
Objecten hebben stabiele ids en `source`/`lineage`-metadata.

De huidige v0.1-code gebruikt al het document/layer/tool-model, maar normaliseert
geometrie nog vroeg naar polylines. V0.2 splitst de curve-authoringlaag formeel
van de plotjob.

### PlotJob

De machine-onafhankelijke productiegeometrie. Alles is hier een expliciete reeks
punten in fysieke units. Een pad kent `layerId`, `toolId`, `closed`,
`reversible`, beperkingen en herkomst. Dit is het niveau voor hatch, clipping,
deduplicatie en lijnfusie.

Voor kleine jobs zijn gewone `{x, y}`-objecten begrijpelijk en pluginvriendelijk.
Vanaf ongeveer 100.000 punten kan intern een `Float64Array` plus offsettabel
worden gebruikt. De publieke snapshot blijft serialiseerbaar.

### PlotPlan

Een geordende, onveranderlijke lijst acties: `tool-change`, `travel`, `draw`,
`pause`, `home` en later `checkpoint`. Het plan bevat afstanden, penlifts,
geschatte tijd en de exacte route die preview en driver delen.

### MachineProgram

Protocolspecifieke uitvoer: SVG, HPGL, G-code of een binaire/tekstuele command
stream. Een renderer maakt het programma; een driver verstuurt het. Daardoor
hoeft een planner niets te weten over seriële poorten en hoeft een driver geen
geometrie meer te begrijpen.

## 3. Modules

| Module | Verantwoordelijkheid | Geen verantwoordelijkheid |
|---|---|---|
| `core` | schema's, ids, units, lagen, tools, validatie, snapshots | geometrische algoritmen |
| `geometry` | primitives, curves, transformaties, offsets, clipping | routevolgorde |
| `io-svg` | SVG lezen/schrijven, transforms, viewBox, lagen | machinebesturing |
| `effects` | hatch, crosshatch, stipple, contouren, artistieke passes | penwissels |
| `optimizer` | clean, fuse, dedupe, simplify, resample | hardwareprotocol |
| `planner` | volgorde, omkering, seams, lagen, penschema, tijd | SVG-parsing |
| `renderer` | preview, SVG, HPGL, G-code, JSON | seriële flow control |
| `driver` | connectie, capabilities, streaming, pause/resume/abort | creatieve geometrie |
| `plugins` | lifecycle en benoemde uitbreidingspunten | globale monkey patches |
| externe adapters | aparte repositories zoals `p5.penplotter` en toekomstige canvas-sketch-koppelingen | kernlogica |

Elke transformatie retourneert een nieuw snapshot. Geen optimizer mag het
originele artwork stilzwijgend muteren. Dat maakt vergelijken, undo, caching,
workers en reproduceerbare exports mogelijk.

De v0.1-facade bewaart de optimalisatie en het plan zolang het document gelijk
blijft. Vóór elk hergebruik vergelijkt ze het volledige document (als JSON) met
de vorige toestand; elk verschil — ook een rechtstreekse mutatie van het openbare
document of van teruggegeven paden en lagen — maakt beide caches ongeldig. Het
opnieuw opbouwen gebruikt de laatst meegegeven optimalisatie- en planinstellingen.
Eerder teruggegeven plannen worden niet aangepast. Er is bewust maar één
mechanisme: geen aparte invalidatie per tekenmethode. De prijs is een vergelijking
per aanroep (± 5 ms bij 11 000 punten, ± 230 ms bij 500 000); documentdata moet
daarom JSON-serialiseerbaar blijven.

## 4. Geometrie en topologie

### Verbonden segmenten en lijnfusie

Voor een klein document volstaat endpointvergelijking. Voor grote jobs:

1. snap endpoints met een expliciete tolerantie naar een spatial hash;
2. bouw een graaf met punten als knopen en segmenten als zijden;
3. gebruik union-find om verbonden componenten te herkennen;
4. wandel knopen met graad 1 eerst en daarna cycli;
5. behoud bronids in `lineage` en markeer omkeringen.

Dit is sterker dan telkens twee arrays zoeken: T-junctions, lussen en duizenden
segmenten worden zichtbaar als topologie. Een R-tree of uniform grid beperkt de
burenzoektocht tot lokaal werk.

### Dubbele lijnen

Exact gelijke paden zijn alleen de eenvoudige variant, reeds aanwezig in v0.1.
De volledige aanpak canonicaliseert losse segmenten na snapping:

- sorteer elk segment onafhankelijk van richting;
- groepeer collineaire segmenten op genormaliseerde lijnvergelijking;
- projecteer ze naar één as;
- voer interval-union uit om volledige én gedeeltelijke overlap te vinden;
- reconstrueer alleen de unieke intervallen.

Voor curves gebeurt vergelijking pas na gecontroleerde flattening, zodat de
foutmarge meetbaar blijft.

### Simplificatie en resampling

- Ramer–Douglas–Peucker: snelle maximale-afwijking voor polylines.
- Visvalingam–Whyatt: visueel gelijkmatiger bij organische lijnen.
- booglengte-resampling: gelijkmatige motorbeweging en stabiele effecten.
- adaptieve Bézier-flattening: subdivision tot de chord-error onder tolerantie is.
- curve fitting volgens Schneider: optioneel opnieuw compacte Béziers maken voor
  SVG, nooit voor het machineplan.

De gebruiker kiest tolerantie in fysieke units, niet in een abstracte
“quality”-slider.

### Offset curves

Een naïeve normaal-offset is bruikbaar voor open schetslijnen maar faalt bij
cusps, zelfintersecties en scherpe hoeken. De productieversie gebruikt een
robuuste integer-gebaseerde offset/boolean-kern, vergelijkbaar met Clipper2,
met instelbare joins, miterlimiet en expliciete cleanup. Die kern hoort als
optionele geometry-backend achter dezelfde API, zodat de lichte build klein kan
blijven.

## 5. Fills

### Hatch

1. roteer polygonen naar hatchruimte;
2. doorsnijd evenwijdige scanlines met buitencontouren en holes;
3. pas even-odd of nonzero fill rule toe;
4. roteer segmenten terug;
5. orden boustrophedon: links→rechts, dan rechts→links;
6. verbind alleen waar een brug aantoonbaar binnen de vorm blijft.

Crosshatching is twee of meer afzonderlijke hatchpasses. Ze kunnen dezelfde pen
delen of elk een eigen laag/tool krijgen. Spacing kan een functie zijn, zodat
p5.waves een veld, hoek of lokale dichtheid kan sturen zonder dat de kern p5.js
kent.

### Stippling

- Bridson Poisson-disc sampling voor uniforme minimale afstand;
- weighted rejection of een density map voor toonwaarden;
- Lloyd-relaxatie voor gelijkmatiger cellen;
- deterministische PRNG voor reproduceerbaarheid;
- uitvoermodi `tap`, `dash`, `circle` en later pen-specifieke marks.

De stipplepunten worden daarna opnieuw als routeprobleem gepland. Ze zijn dus
geen speciale previewpixels.

## 6. Route- en penplanning

Het padprobleem is een directed/asymmetric TSP-variant: open paden kunnen vaak
omgekeerd worden, gesloten paden kunnen hun startnaad verplaatsen, en sommige
tools of lagen leggen volgordebeperkingen op.

Aanbevolen cascade:

1. groepeer op harde constraints en tool;
2. cluster ruimtelijk (grid, k-d tree of Hilbert-orde) voor zeer grote jobs;
3. nearest-neighbour als snelle goede start;
4. 2-opt voor routeverbetering;
5. optioneel 3-opt/Lin–Kernighan voor dure herhaaljobs;
6. optimaliseer tegelijk richting en seam;
7. bewaar een maximum tijd/passes als voorspelbare stopvoorwaarde.

De kostfunctie wordt tijdgebaseerd:

```text
cost = travelTime
     + penLiftTime
     + toolChangeTime
     + cornerSlowdown
     + constraintPenalty
```

Kortste afstand is niet altijd snelste plot. Acceleratie, scherpe bochten,
servovertraging en penwissels zijn meetbaar in een machineprofiel.

Lagen krijgen een dependency-DAG (`before`, `after`, `keepTogether`). Binnen
die constraints kan de planner penwissels minimaliseren. Zo kan een zwarte
contour verplicht na een natte vulpenlaag komen zonder de hele optimalisatie uit
te schakelen.

## 7. Machineprofielen en drivers

Een profiel is data: bedafmetingen, oorsprong, units, snelheden, acceleratie,
penmechanisme, protocol en capabilities. Een driver is gedrag: connecteren,
handshake, streamen, flow control, status, pause, resume en abort.

Een betrouwbare driver is een state machine:

```text
disconnected → connecting → ready → running → paused → complete
                         ↘ error ↗       ↘ aborted
```

Verplichte veiligheidsregels:

- boundscontrole vóór de eerste byte;
- verbinding alleen na een gebruikersactie;
- dry-run/preview en expliciete bevestiging;
- protocolspecifieke ACK/flow control, geen blind “alles schrijven”;
- abort die pen omhoog zet wanneer het protocol dat toelaat;
- checkpoints en hervatten vanaf een bevestigd commandonummer;
- profielversie opslaan naast het plan.

Web Serial is een transport, geen universele driver. AxiDraw/EBB, iDraw,
GRBL en klassieke HPGL-machines krijgen afzonderlijke implementaties en een
hardware-geteste supportmatrix.

### EBB-driver (`src/driver/ebb.js`)

De eerste machinedriver. Drie lagen, elk apart testbaar:

- `compileEbbPlan(plan)` is puur: een `PlotPlan` wordt een lijst EBB-commando's
  (het `MachineProgram`). CoreXY-menging `motor1 = X + Y`, `motor2 = X − Y`;
  staptargets zijn absoluut zodat afronding nooit tot drift optelt; een as die
  trager zou lopen dan het firmwareminimum wordt ingehouden en later ingehaald.
  Eenheden- en grenscontrole gebeuren hier, vóór er iets bestaat om te versturen.
- `EbbDriver` streamt met één antwoord per commando als flow control, weigert
  zonder `confirmed: true` en zonder EBB-versieantwoord, en eindigt bij abort of
  fout altijd in dezelfde veilige stop (`ES`, pen omhoog, motoren uit).
- Een transport is alleen `send(cmd) → antwoord`: `createLogTransport()` voor de
  droge run, `createWebSerialTransport()` voor de browser.

Supportmatrix op 2026-09-21:

| profiel | bord | status |
|---|---|---|
| `idraw-hse-a2` | EBB, firmware 3.0.2 | fysiek getest: assen, schaal (40 mm nagemeten), volledige plot vanuit Chrome |
| overige | — | geen driver; gebruik SVG-, HPGL- of G-code-export |

Van de veiligheidsregels hierboven ontbreken nog: checkpoints en hervatten,
pauze, en het opslaan van de profielversie naast het plan. Acceleratie ontbreekt
ook; de profielsnelheden zijn daarom bewust laag.

## 8. Plugins

Een plugin heeft een naam, semver-compatibiliteit, capabilities en
`install(host)`. Registratie is expliciet:

```js
const weavePlugin = {
  name: "weave-order",
  install(host) {
    host.register("optimizer", "weave", function weave(paths, options) {
      return paths;
    });
  }
};
```

Plugins krijgen snapshots en context, geen toegang tot verborgen mutable state.
Workers worden mogelijk omdat plugin-input serialiseerbaar is. Een plugin moet
determinisme declareren en kan een seed krijgen.

## 9. Integratie met p5.js en p5.waves

De kern importeert p5.js niet. De afzonderlijke repository `p5.penplotter` voegt
`createPlotterEngine()` en `drawPlotPlan()` toe. p5.waves blijft een sampler:
een sketch bouwt punten met `Waves.wave(y, { t })` en voert die punten aan de
geometrylaag. Later kan een convenience-effect een callback zoals
`spacingAt(x, y)` accepteren; het blijft gewone JavaScript dependency injection.

## 10. Inspiratie en bewuste nieuwe keuzes

- [vpype](https://github.com/abey79/vpype): sterke referentie voor `linemerge`,
  `linesort`, `reloop`, simplificatie en een composable pipeline. Inspiratie,
  maar geen runtimebasis: het is Python/CLI-georiënteerd.
- [canvas-sketch-util penplot](https://github.com/mattdesl/canvas-sketch-util):
  toont hoe klein een creatieve JavaScript-ingang kan zijn. De engine gaat verder
  met een jobmodel, penplanning en drivers.
- [Paper.js](https://paperjs.org/reference/path/): volwassen SVG- en curve-API;
  interessant als optionele import/geometry-adapter, te groot als verplichte kern.
- [p5.plotSvg](https://github.com/golanlevin/p5.plotSvg): nuttige p5-capture en
  interoperabiliteit; zijn expliciete focus is export, niet de hele machineketen.
- [AxiDraw Python API](https://axidraw.com/doc/py_api/): gedragsreferentie voor
  SVG- en interactieve motion-contexten en betrouwbare device control.
- [Web Serial](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API):
  browsertransport met secure-context- en compatibiliteitsbeperkingen.

Volledig nieuwe aandacht verdient vooral: een tijdgebaseerde optimizer,
onveranderlijke job snapshots, herstartbare hardwarejobs, echte capability
negotiation, een gemeenschappelijk preview/driver-plan en een API die even klein
kan beginnen als p5.js zonder de expertlagen te verbergen.

## 11. Schaalbaarheid

- minder dan 2.000 paden: eenvoudige arrays en O(n²) nearest-neighbour zijn prima;
- 2.000–50.000: spatial hash/k-d tree, clustering en workers;
- meer dan 50.000: typed geometry buffers, streaming passes, progress/cancel en
  begrensde local search;
- iedere zware pass rapporteert voor/na-statistieken en verliest nooit stilzwijgend
  geometrie buiten de opgegeven tolerantie.

## 12. Versiegrens

V0.1 bewijst de keten. De enige hardwareclaim is het profiel `idraw-hse-a2`
uit de supportmatrix in §7; voor AxiDraw en andere iDraw-modellen is er geen
claim. Het is ook nog geen complete SVG-renderer. V1.0 vereist fixturebestanden, property tests,
cross-browser tests, hardwaretests per profiel en een compatibiliteitsbeleid voor
document-, plan- en plugin-schema's.
