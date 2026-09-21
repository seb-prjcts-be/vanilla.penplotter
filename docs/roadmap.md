# Roadmap

Koers sinds 2026-09-21: **de sketch gaat rechtstreeks naar de pen, zonder SVG
ertussen.** `vanilla.penplotter` is de motor en de driver; `p5.penplotter` is het dunne
p5.js-laagje erbovenop. SVG-, HPGL- en G-code-export blijven bestaan, maar zijn
niet meer het hoofdpad.

## Aanwezig in 0.2.0

- document, lagen, tools en polylinepaden
- primitives, transformaties, eenvoudige offsets
- hatch, crosshatch en deterministische stippling
- browser-SVG-import met flattening
- pad-deduplicatie, lijnfusie, RDP en resampling
- nearest-neighbour route, omkering en closed-path reloop
- SVG, HPGL, G-code, JSON en canvaspreview, met omrekening naar fysieke eenheden
- afstand, pen-up/down, penwissels en tijdsinschatting
- plan dat zichzelf vernieuwt na elke wijziging van het document
- simulator, generiek Web Serial-teksttransport en machineprofielen
- **EBB-driver: rechtstreeks plotten op een iDraw HSE / A2** (CoreXY, grenscontrole,
  flow control per commando, veilige stop), fysiek getest op 2026-09-21
- voorbeelden: first job, vanilla.waves naar SVG, direct plot
- pluginhost; de p5-adapter leeft in `p5.penplotter`

## Volgende — de directe route sterker maken

- acceleratie in de EBB-driver (nu bewust trage, vaste snelheden)
- pauzeren, hervatten vanaf een bevestigd commando, profielversie naast het plan
- penhoogtes instelbaar vanuit het profiel
- Node-transport naast Web Serial, zodat een script zonder browser kan plotten
- meer p5-primitieven in `p5.penplotter` (bogen, curves)
- eventueel: SVG van p5.plotSvg inlezen en zonder vpype of Inkscape plotten

## Geparkeerd

Niet geschrapt, wel geen prioriteit: bestaand gereedschap (vpype, de
AxiDraw-software) dekt dit al, en het brengt de sketch niet dichter bij de pen.

- curve-rijk `GeometryDocument`, volledige SVG/CSS-ondersteuning, booleans en
  robuuste offsets
- productieplanner: spatial index, 2-opt/3-opt, boustrophedon hatch-routing,
  laag-afhankelijkheden, natte-inktvertraging
- drivers voor andere families (GRBL + servo, klassieke HPGL, iDraw 2.0); die
  komen er pas met een fysieke machine om op te testen

## 1.0

Stabiele schema's en migraties, TypeScript-declaraties en npm-distributie,
stabiele adaptercontracten voor `p5.penplotter`, en een supportmatrix waarin elk
profiel op echte hardware getest is.
