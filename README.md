# vanilla.penplotter

`vanilla.penplotter` is een modulaire JavaScript-engine tussen generatieve geometrie
en een fysieke penplotter. De kern werkt volledig zonder p5.js. De afzonderlijke
repository [`p5.penplotter`](https://github.com/seb-prjcts-be/p5.penplotter) verbindt
dezelfde pipeline met p5.js en p5.waves.

Dit is versie **0.2.0**: een geteste verticale slice van Geometry → Optimizer →
Planner → Renderer → Driver. De architectuur is bewust groter ontworpen dan de
functies die al als stabiel worden aangeboden. Zie
[`docs/architecture.md`](docs/architecture.md) voor het volledige doelmodel en
[`docs/roadmap.md`](docs/roadmap.md) voor de fasering.

## Vereisten

Deze tabel staat letterlijk gelijk in de README van `p5.penplotter`; een test bewaakt dat.

<!-- vereisten:start -->
| onderdeel | vereist | opmerking |
|---|---|---|
| `vanilla.penplotter` | niets | geen dependencies; werkt zonder p5.js. Node ≥ 18 alleen om de tests te draaien |
| `p5.penplotter` | vanilla.penplotter ≥ 0.2.0 | de adapter bevat geen plot- of machinecode; met een driver erbij weigert hij een oudere core met een duidelijke melding |
| `p5.penplotter` | p5.js ≥ 2.2.2 | getest met 2.2.2, in global en instance mode |
| rechtstreeks plotten | Chrome of Edge, op `localhost` of https | Web Serial; de browser toont zijn poortlijst alleen na een klik of toets |
| rechtstreeks plotten | iDraw HSE / A2 met EBB-firmware 3.0.2 | het enige fysiek geteste profiel (`idraw-hse-a2`) |
| voorbeelden | p5.waves 3.4.0, vanilla.waves (vastgepinde commit) | alleen de voorbeelden; geen van beide libraries hangt ervan af |

Samen getest: `vanilla.penplotter` 0.2.0 met `p5.penplotter` 0.2.0.

Publiceren: altijd eerst `vanilla.penplotter`, dan `p5.penplotter`. De voorbeelden van
`p5.penplotter` laden de core als buurmap (`../vanilla.penplotter/`), lokaal onder `htdocs`
en online op GitHub Pages. Ze krijgen dus altijd de recentste core, geen
vastgepinde; de versiecontrole in de adapter vangt een core op die niet past.
<!-- vereisten:end -->

## Structuur

- `vanilla.penplotter.js` — root entry en eenvoudige `PlotterEngine`-facade
- `src/core/` — documenten, lagen, tools, paden en validatie
- `src/geometry/` — primitives, fills, offsets, transformaties en SVG-import
- `src/optimizer/` — samenvoegen, dedupliceren, vereenvoudigen en resampling
- `src/planner/` — tekenvolgorde, penbewegingen, statistieken en tijd
- `src/renderer/` — SVG, HPGL, G-code, JSON en canvaspreview
- `src/driver/` — machineprofielen, simulatie, tekst-transport en de EBB-driver die rechtstreeks plot
- `src/plugins/` — uitbreidingspunten voor effecten, optimizers, renderers en drivers
- `index.html`, `docs/`, `examples/` — GitHub Pages-site in dezelfde formule als p5.waves en p5.gysin

## Snel starten

```html
<script type="module">
  import { PlotterEngine } from "./vanilla.penplotter.js";

  const plot = new PlotterEngine({
    units: "mm",
    page: { width: 210, height: 297, margin: 12 }
  });

  plot.line(20, 30, 190, 30);
  plot.circle(105, 145, 48);

  const plan = plot.plan({
    drawSpeed: 35,
    travelSpeed: 80
  });

  console.log(plan.stats);
  const svg = plot.exportSVG();
</script>
```

## Elke stap los gebruiken

```js
import { createDocument, addLayer } from "./src/core/model.js";
import { line } from "./src/geometry/index.js";
import { optimizeDocument } from "./src/optimizer/index.js";
import { planDocument } from "./src/planner/index.js";
import { renderHPGL } from "./src/renderer/index.js";

const document = createDocument({ units: "mm" });
const layer = addLayer(document, { id: "blue", toolId: "pen-blue" });
line(layer, 10, 10, 100, 40);

const optimized = optimizeDocument(document, { mergeTolerance: 0.05 });
const plan = planDocument(optimized, { strategy: "nearest" });
const hpgl = renderHPGL(plan, { penMap: { "pen-blue": 2 } });
```

## Rechtstreeks plotten

Geen SVG ertussen: `EbbDriver` stuurt een plan rechtstreeks naar een
AxiDraw-achtige CoreXY-plotter met een EBB-stuurbord.

```js
import { PlotterEngine } from "./vanilla.penplotter.js";
import { EbbDriver, createWebSerialTransport } from "./src/driver/ebb.js";

const plot = new PlotterEngine({ units: "mm", page: { width: 594, height: 432 } });
plot.line(80, 70, 120, 70);

const transport = createWebSerialTransport();
await transport.open();               // vanuit een klik: de browser toont zijn poortlijst
const driver = new EbbDriver({ transport, profile: "idraw-hse-a2" });
await driver.run(plot.plan(), { confirmed: true });
```

- `compileEbbPlan(plan)` maakt de exacte commandolijst zonder iets te versturen;
  `createLogTransport()` is de droge run.
- Vóór de eerste byte: eenheden moeten mm, cm of in zijn en elk punt moet binnen
  het werkveld liggen, anders wordt er niets verstuurd.
- `driver.abort()` en elke fout eindigen in dezelfde veilige stop: beweging
  stoppen, pen omhoog, motoren uit.
- De machine kent geen thuispositie. Zet de slede met de hand in de thuishoek:
  die plek is 0,0 van het plan.
- Web Serial werkt in Chrome en Edge, op `localhost` of https.

Getest op één machine: iDraw HSE / A2 met EBB-firmware 3.0.2, op 2026-09-21
(assen, schaal nagemeten, volledige plot vanuit `examples/direct_plot/`). Nog
niet aanwezig: acceleratie (daarom bewust trage vaste snelheden), pauzeren en
hervatten vanaf een checkpoint.

## p5.js en p5.waves

Gebruik voor p5.js de aparte `p5.penplotter`-adapter. `Waves.wave()` blijft daarin
verantwoordelijk voor het getal; `vanilla.penplotter` bewaart de resulterende punten
en plant ze voor de machine.

```js
const points = [];
for (let x = 10; x <= 200; x += 1) {
  points.push({
    x,
    y: 90 + Waves.wave(x, {
      wave: "triangle sine",
      t: 0,
      amplitude: 24,
      frequency: 0.05
    })
  });
}
plot.polyline(points);
```

## vanilla.waves

Het voorbeeld [Waves to SVG](examples/waves_svg/index.html) bemonstert een
vanilla.waves-tekening op een vast tijdstip, plant 32 paden en exporteert een
A4-SVG. Het laadt een vastgepinde vanilla.waves-revisie van jsDelivr; er komt
geen machine aan te pas. Dezelfde punten kunnen ook rechtstreeks naar de pen:
zie *Rechtstreeks plotten*.

## Gedrag en grenzen

**Wijzigingen.** Na elke wijziging — via de tekenmethodes, `tool()`, `layer()`,
`importSVG()` of rechtstreeks in `plot.document` en teruggegeven paden of lagen —
bouwen planning, statistiek, preview en export het plan vanzelf opnieuw op, met
de laatst gebruikte optimalisatie- en planinstellingen. Een eerder teruggegeven
plan blijft een afzonderlijk snapshot. Die controle vergelijkt bij elke aanroep
het volledige document, dat daarom JSON-serialiseerbaar moet blijven. Gemeten:
± 5 ms bij 11 000 punten, ± 20 ms bij 50 000, ± 230 ms bij 500 000. Voor één
plot of export is dat verwaarloosbaar; teken een heel groot plan niet elk frame
opnieuw als preview.

**Eenheden.** Coördinaten, toleranties en afstandsstatistieken staan in de
eenheid van het document. Plansnelheden zijn mm/s, G-code-feeds mm/min. HPGL-
en G-code-export en de tijdsschatting rekenen mm, cm, inch en CSS-pixels
(96 px per inch) om naar fysieke maten; SVG behoudt de documenteenheid.
Rechtstreeks plotten aanvaardt alleen mm, cm en inch.

**Geometrie.** SVG-import en de geometrische effecten zijn bruikbaar voor
experimenten, maar nog niet voor alle SVG/CSS-, compound-path- en
zelfintersectiegevallen.

**Hardware.** `WebSerialTextDriver` is een laag transport voor tekstprotocollen,
geen machinedriver. `EbbDriver` is dat wel, maar alleen voor het profiel waarop
hij fysiek getest is; elk ander profiel blijft experimenteel tot er
hardwaretests bestaan. Rechtstreeks plotten vereist altijd een expliciete
bevestiging.

## Verwant werk

[p5.plotSvg](https://github.com/golanlevin/p5.plotSvg) van Golan Levin is de
gangbare manier om vanuit p5.js een plotter-vriendelijke SVG te exporteren. Het
optimaliseert bewust niet en stuurt geen machine aan; daarvoor verwijst het naar
[vpype](https://vpype.readthedocs.io/). `vanilla.penplotter` begint waar dat pad
ophoudt: ordenen en plannen in de browser, en rechtstreeks naar de pen.

## Test

```powershell
npm test
npm run manifest
```

`npm test` draait de snapshot-, driver- en regressietests (verouderde plannen,
fysieke eenheden, op zichzelf terugkerende paden). De optionele
vanilla.waves-integratiecheck blijft los van het netwerk: download
`waves-core.js` van vanilla.waves-commit
`4fad55570d9dab243e99f40181f12b5aede2c5be` en draai:

```powershell
node tests/waves-integration.js pad/naar/waves-core.js waves-a4.svg
```

MIT License.
