# vanilla.penplotter

**[Open site](https://seb-prjcts-be.github.io/vanilla.penplotter/)** · **[Examples](https://seb-prjcts-be.github.io/vanilla.penplotter/docs/examples.html)** · **[Possibilities](https://seb-prjcts-be.github.io/vanilla.penplotter/docs/possibilities.html)** · **[p5.js adapter](https://github.com/seb-prjcts-be/p5.penplotter)**

A JavaScript engine between generative geometry and a physical pen plotter. Build paths in millimetres, remove wasted travel, plan the pens, then export the job or send it straight to the pen.

**No dependencies, no build step, no p5.js required.** ES modules, tested with Node ≥ 18. The p5.js layer lives in the separate repository [`p5.penplotter`](https://github.com/seb-prjcts-be/p5.penplotter).

**Plots for real on one machine:** an iDraw HSE / A2 with an EBB board, over Web Serial, straight from the browser. Every other plotter gets SVG, HPGL or G-code.

This is version **0.2.0**: a tested vertical slice of Geometry → Optimizer → Planner → Renderer → Driver. The [architecture](https://seb-prjcts-be.github.io/vanilla.penplotter/docs/architecture.html) is deliberately larger than the code; the [roadmap](https://seb-prjcts-be.github.io/vanilla.penplotter/docs/roadmap.html) says which part exists.

## Install

```html
<script type="module">
  import { PlotterEngine } from "https://cdn.jsdelivr.net/gh/seb-prjcts-be/vanilla.penplotter@v0.2.0/vanilla.penplotter.js";
</script>
```

The root module imports its own `src/` folder, so load it from a place that serves the whole repository: the jsDelivr tag above, GitHub Pages (`https://seb-prjcts-be.github.io/vanilla.penplotter/vanilla.penplotter.js`, always the latest `main`), or a local clone. Pin the tag for anything you want to keep.

## Quick start

```js
import { PlotterEngine } from "./vanilla.penplotter.js";

const plot = new PlotterEngine({
  units: "mm",
  page: { width: 210, height: 297, margin: 12 }
});

plot.line(20, 30, 190, 30);
plot.circle(105, 145, 48);

const plan = plot.plan({ drawSpeed: 35, travelSpeed: 80 });
console.log(plan.stats);          // paths, travel, pen lifts, estimated seconds
const svg = plot.exportSVG();
```

## Straight to the pen

No SVG in between: `EbbDriver` streams a plan to an AxiDraw-style CoreXY plotter with an EBB board.

```js
import { PlotterEngine } from "./vanilla.penplotter.js";
import { EbbDriver, createWebSerialTransport } from "./src/driver/ebb.js";

const plot = new PlotterEngine({ units: "mm", page: { width: 594, height: 432 } });
plot.line(80, 70, 120, 70);

const transport = createWebSerialTransport();
await transport.open();               // from a click: the browser shows its port list
const driver = new EbbDriver({ transport, profile: "idraw-hse-a2" });
await driver.run(plot.plan(), { confirmed: true });
```

- `compileEbbPlan(plan)` produces the exact command list without sending anything; `createLogTransport()` is the dry run.
- Before the first byte: units must be mm, cm or in, and every point must lie inside the travel, otherwise nothing is sent.
- `driver.abort()` and every error end in the same safe stop: motion halted, pen up, motors off.
- The machine has no home position. Park the carriage in the home corner by hand: that spot is 0,0 of the plan.
- Web Serial works in Chrome and Edge, on `localhost` or https.

Tested on one machine: iDraw HSE / A2 with EBB firmware 3.0.2, on 2026-09-21 (axes, scale measured on paper, a full plot from `examples/direct_plot/`). Not there yet: acceleration (hence deliberately slow fixed speeds), pause, and resume from a checkpoint.

## Requirements

This table is literally identical in the README of `p5.penplotter`; a test guards that.

<!-- vereisten:start -->
| component | requires | note |
|---|---|---|
| `vanilla.penplotter` | nothing | no dependencies; works without p5.js. Node ≥ 18 only to run the tests |
| `p5.penplotter` | vanilla.penplotter ≥ 0.2.0 | the adapter contains no plotting or machine code; with a driver attached it refuses an older core with a clear message |
| `p5.penplotter` | p5.js ≥ 2.2.2 | tested with 2.2.2, in global and instance mode |
| direct plotting | Chrome or Edge, on `localhost` or https | Web Serial; the browser shows its port list only after a click or keypress |
| direct plotting | iDraw HSE / A2 with EBB firmware 3.0.2 | the only physically tested profile (`idraw-hse-a2`) |
| examples | p5.waves 3.4.0, vanilla.waves (pinned commit) | examples only; neither library depends on them |

Tested together: `vanilla.penplotter` 0.2.0 with `p5.penplotter` 0.2.0.

Publishing: always `vanilla.penplotter` first, then `p5.penplotter`. The examples of
`p5.penplotter` load the core as a sibling folder (`../vanilla.penplotter/`), locally under
`htdocs` and online on GitHub Pages. They therefore always get the latest core, not a
pinned one; the version check in the adapter catches a core that does not match.
<!-- vereisten:end -->

## The facade

`PlotterEngine` is one object that holds a document and rebuilds its plan whenever the document changes.

| method | what it does |
|---|---|
| `line`, `polyline`, `polygon`, `rect`, `circle`, `arc` | add paths to the active layer, in document units |
| `hatch`, `crossHatch`, `stipple` | fill a polygon with lines or seeded dots (`spacing`, `angle`, `count`, `minDistance`, `seed`) |
| `tool({ id, color, width })`, `layer(id, { toolId })` | pens and layers; the planner finishes one pen before the next |
| `importSVG(text)` | paths, lines, polygons, rects, circles and nested transforms; curves flattened |
| `optimize({ passes, mergeTolerance, duplicateTolerance, simplifyTolerance, maxSegmentLength })` | deduplicate, merge, simplify, resample, clean |
| `plan({ strategy, drawSpeed, travelSpeed, liftDelay, toolChangeDelay })` | nearest-neighbour order with reversal and closed-path reloop, or `"input"` order |
| `stats()` | paths, points, draw and travel distance, pen lifts, tool changes, estimated seconds |
| `exportSVG`, `exportHPGL({ penMap, unitsPerMm })`, `exportGCode({ penUp, penDown })`, `exportJSON` | the same plan as a file |
| `drawPreview(context, { showTravel })` | the plan on a canvas, pen-up travel in red |

## Every stage on its own

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

Every stage accepts and returns plain, JSON-serialisable snapshots: `vanilla.penplotter/document@1` in, `vanilla.penplotter/plan@1` out. No stage mutates its input.

## Structure

- `vanilla.penplotter.js` — root entry and the `PlotterEngine` facade
- `src/core/` — documents, layers, tools, paths and validation
- `src/geometry/` — primitives, fills, offsets, transforms and SVG import
- `src/optimizer/` — merging, deduplication, simplification and resampling
- `src/planner/` — drawing order, pen moves, statistics and time
- `src/renderer/` — SVG, HPGL, G-code, JSON and canvas preview
- `src/driver/` — machine profiles, simulation, a text transport and the EBB driver that plots directly
- `src/plugins/` — extension points for effects, optimizers, renderers and drivers
- `index.html`, `docs/`, `examples/` — the GitHub Pages site, in the same formula as p5.waves and p5.gysin

## Examples

Each one is a standalone page under `examples/`; the [examples page](https://seb-prjcts-be.github.io/vanilla.penplotter/docs/examples.html) previews them live.

- `first_job` - a hatched polygon, its contour and a circle: the smallest complete job
- `two_pens` - layers and tools; the same plan as SVG, HPGL with a pen map, and G-code
- `route_lab` - bad input on purpose; switch optimizer passes on and off and read what each one buys
- `waves_svg` - 32 lines sampled from vanilla.waves at a fixed time, exported as an A4 SVG
- `wave_hatch` - seventy cells hatched at a spacing and angle two waves decide: tone from lines
- `svg_to_pen` - any SVG (p5.plotSvg, Inkscape) fitted onto the bed, planned, and plotted or exported
- `direct_plot` - dry run, connect over Web Serial, plot on an iDraw HSE / A2

## Behaviour and limits

**Edits.** After every change, through the drawing methods, `tool()`, `layer()`, `importSVG()` or directly in `plot.document` and returned paths or layers, planning, statistics, preview and export rebuild the plan with the last optimisation and planning settings. A plan returned earlier stays a separate snapshot. The check compares the whole document on every call, so document data must stay JSON-serialisable. Measured: about 5 ms at 11 000 points, 20 ms at 50 000, 230 ms at 500 000. Negligible for one plot or export; do not redraw a huge plan as a preview every frame.

**Units.** Coordinates, tolerances and distance statistics are in the document unit. Plan speeds are mm/s, G-code feeds mm/min. HPGL and G-code export and the time estimate convert mm, cm, inch and CSS pixels (96 px per inch) to physical sizes; SVG keeps the document unit. Direct plotting accepts only mm, cm and inch.

**Geometry.** SVG import and the geometric effects are good for experiments, not yet for every SVG/CSS, compound-path and self-intersection case.

**Hardware.** `WebSerialTextDriver` is a low-level transport for text protocols, not a machine driver. `EbbDriver` is one, but only for the profile it has been tested on; every other profile stays experimental until there are hardware tests. Direct plotting always requires an explicit confirmation.

## Related work

[p5.plotSvg](https://github.com/golanlevin/p5.plotSvg) by Golan Levin is the usual way to export a plotter-friendly SVG from p5.js. It deliberately does not optimise and drives no machine; for that it points to [vpype](https://vpype.readthedocs.io/). `vanilla.penplotter` starts where that road ends: ordering and planning in the browser, and straight to the pen. The `svg_to_pen` example reads exactly such a file.

[p5.gysin](https://github.com/seb-prjcts-be/p5.gysin) writes plotter-safe SVG with one Inkscape layer per pen; this engine can read it. [p5.waves](https://github.com/seb-prjcts-be/p5.waves) and [vanilla.waves](https://github.com/seb-prjcts-be/vanilla.waves) supply the numbers the examples draw with.

## Test

```powershell
npm test
npm run docs
npm run manifest
```

`npm test` runs the snapshot, driver, regression and version tests, checks every local link on the site, renders every live preview headlessly, and fails when a generated docs page is stale. `npm run docs` renders `docs/architecture.md` and `docs/roadmap.md` to HTML; `npm run manifest` regenerates `docs/vanilla.penplotter.manifest.json`. The optional vanilla.waves integration check stays off the network: download `waves-core.js` from vanilla.waves commit `4fad55570d9dab243e99f40181f12b5aede2c5be` and run:

```powershell
node tests/waves-integration.js path/to/waves-core.js waves-a4.svg
```

## How this was made

Designed and directed by Sebastien Vanblaere, written with AI assistance, and held to one rule: nothing is claimed that a test or a plot on paper has not shown. See [About](https://seb-prjcts-be.github.io/vanilla.penplotter/docs/about.html).

MIT License.
