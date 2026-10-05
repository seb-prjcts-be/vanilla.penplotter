# vanilla.penplotter

![From JavaScript geometry to a planned drawing on paper](docs/images/animations/overview.gif)

**[Open site](https://seb-prjcts-be.github.io/vanilla.penplotter/)** · **[Setup](https://seb-prjcts-be.github.io/vanilla.penplotter/docs/setup.html)** · **[Examples](https://seb-prjcts-be.github.io/vanilla.penplotter/docs/examples.html)** · **[p5.penplotter](https://github.com/seb-prjcts-be/p5.penplotter)**

You supply polylines in physical units. This engine can clean up paths, plan the pen’s route, preview it and export files.

Its drivers can also send a complete plan to an iDraw HSE / A2 with EBB or an A3 H with DrawCore.

## Two ways to work

Draw everything and run one plan with `driver.run()`. Or use `driver.session()` to draw one object, plot it and wait before making the next. The session retains position between objects and returns home after the last. Start a new engine for each object; plotting does not clear an existing document. The [Guide](https://seb-prjcts-be.github.io/vanilla.penplotter/docs/guide.html#werkwijzen) has a working log example.

## Which library?

**vanilla.penplotter** is the engine. Use it for your own JavaScript, arrays of points or supported SVG geometry. It has no dependencies and works without p5.js.

**[p5.penplotter](https://github.com/seb-prjcts-be/p5.penplotter)** connects this engine to p5.js. Use it when you want to draw with supported p5 shapes and send them to the pen with `plot.go()`.

Each object is prepared before plotting. Sending new geometry during a moving job is not implemented; [live drawing notes](https://seb-prjcts-be.github.io/vanilla.penplotter/docs/live.html) describe the proposed direction.

**Tested on paper:** iDraw HSE / A2 with EBB firmware 3.0.2, and small drawings on an A3 H with DrawCore V2.09. Use Web Serial in Chrome or Edge. SVG, HPGL and G-code exports need software and settings suited to the receiving machine.

The current release is **0.5.0**. The [architecture](https://seb-prjcts-be.github.io/vanilla.penplotter/docs/architecture.html) describes the current implementation. Proposed work is on the [roadmap](https://seb-prjcts-be.github.io/vanilla.penplotter/docs/roadmap.html).

## Install

The examples use the repository source. The import below pins release `v0.5.0`, which adds DrawCore plotting and controller recognition.

```html
<script type="module">
  import { PlotterEngine } from "https://cdn.jsdelivr.net/gh/seb-prjcts-be/vanilla.penplotter@v0.5.0/vanilla.penplotter.js";
</script>
```

The root module imports its own `src/` folder, so load it from somewhere that serves the whole repository: the jsDelivr source above, GitHub Pages (`https://seb-prjcts-be.github.io/vanilla.penplotter/vanilla.penplotter.js`, always the latest `main`), or a local clone. Keep a source commit or tag pinned for sketches you want to preserve.

## To the pen

```js
import { PlotterEngine } from "./vanilla.penplotter.js";
import { EbbDriver, createWebSerialTransport } from "./src/driver/ebb.js";

const plot = new PlotterEngine({ units: "mm", page: { width: 210, height: 297 } });
plot.line(20, 30, 190, 30);
plot.circle(105, 145, 48);

const plan = plot.plan();             // the iDraw's speeds and ramps, unless you say otherwise
console.log(plan.stats);              // paths, travel, pen lifts, estimated seconds

const transport = createWebSerialTransport();
await transport.open();               // from a click: the browser shows its port list
const driver = new EbbDriver({ transport, profile: "idraw-hse-a2" });
await driver.run(plan, { confirmed: true });
```

### Before plotting

A few things I learned the hard way, so you do not have to:

- The machine has no home position. Park the carriage in the home corner by hand before you start; that spot is 0,0 of the plan.
- The machine's X runs along the long rail, so a portrait sheet drawn on screen lies sideways on a portrait sheet on the bed. The pen panel of every example shows the bed as the machine sees it (home, the sheet at its offsets, the drawing inside) and has "Turn on the bed" (0, 90, 180, 270°), so what you see there is what lands on paper.
- Nothing is sent before every point has been checked against the bed, and units have to be mm, cm or inches.
- `driver.abort()` and errors attempt the same stop sequence: motion stopped, pen up, motors off. Delivery depends on a working connection. While a plot runs, every link that leaves the page is greyed out; whoever leaves anyway gets the browser's "leave site?" question first, and if the page goes the panel attempts stop, pen up, motors off in one last write (`driver.emergencyStop()`).
- An interrupted plot can go on where it stopped: every pen-up in the compiled list says which stroke it completes, and `compileEbbPlan(plan, { skipDraws: n })` leaves the first `n` strokes out and starts from home, where you park the carriage again by hand. The pen panel of every example remembers the count and offers "Resume at stroke n".
- `compileEbbPlan(plan)` gives you the exact command list without sending it; `createLogTransport()` is the dry run. Do one the first time.
- Web Serial only exists in Chrome and Edge, on `localhost` or https.

### Motion

Pen-up travel uses timed `SM` steps along the planned ramp. Drawing uses `LM` on supported firmware; older firmware uses timed steps for both.

Motion is planned with acceleration: every stroke ramps up from rest, cruises, slows into corners by how sharp they are, and ramps down again. The plan's `drawSpeed` and `travelSpeed` are the speeds the machine gets; the profile fills in the rest (40 mm/s drawing and travelling, 800 mm/s² drawing and 300 mm/s² travelling, a corner deviation of 0.05 mm), and every value can be overridden in `compileEbbPlan(plan, { drawSpeed, travelSpeed, acceleration, travelAcceleration, junctionDeviation })` or `driver.run(plan, { ... })`.

A stroke never aims at exactly zero speed (floor 2 mm/s, so the last step of a line is never left hanging with the pen on the paper), chords within 0.02 mm of a straight line are merged before planning (a circle of 360 chords is a few dozen commands, not 360), and commands go out ahead of their acknowledgements to reduce waiting between short moves.

On firmware 3.x the driver also opens the board's motion queue to its full depth.

The planner's estimate uses the same speeds, the same ramps and the same pen delays, so the seconds in `plan.stats` are the seconds the pen panel shows and, on the iDraw, close to the measured time in the wave hatch test: 681 seconds estimated, 680 plotted.

**EBB tests:** iDraw HSE / A2 with firmware 3.0.2. Axes and scale were measured on paper on 2026-09-21; the acceleration planning, the `LM` moves and the deep motion queue were plotted on 2026-10-01. The iDraw HSE/A3 and standard-servo AxiDraw models are likely candidates, not tested profiles. NextDraw needs its own pen-lift and homing configuration. See the [machine notes](docs/architecture.html).

`EBB_PROFILES["idraw-hse-a2"]` keeps the manufacturer's defaults separately from the operating settings. Pen heights and lift rates remain unchanged unless you pass `penLift: { up: 60, down: 30, raiseRate: 75, lowerRate: 50 }` to `compileEbbPlan()` or `driver.run()`. These are percentages for the profile's standard servo, not millimetres; check the installed pen lift and mounting first. `EBB_COMPATIBILITY` lists the researched candidates and source links, without selecting a machine automatically.

## DrawCore

An A3 H with DrawCore speaks GRBL. Its pen moves along Z. `detectDriver()` reads the controller's version and selects EBB or DrawCore before sending movement commands. You still supply the machine bounds, pen heights and axis directions; a version response does not tell us which frame surrounds the board.

Small tests on one A3 H with DrawCore V2.09 worked on 2026-10-05: a 10 mm line and square, pen up/down, a 1 mm pen-up move and return to the work origin. The [test record](tests/hardware/drawcore-a3-h-2026-10-05.json) preserves the settings and serial log. Stopping during movement and larger drawings still need a physical test.

`DrawCoreDriver.run()` supports one pen. It waits until the controller reports `Idle` before finishing. Stop requests GRBL feed-hold; the pen may remain down and queued moves may remain paused. Sessions and automatic resume are not implemented for DrawCore. The [Guide](docs/guide.html#drawcore) shows the connection and settings.

## Requirements

<!-- vereisten:start -->
| component | requires | note |
|---|---|---|
| `vanilla.penplotter` | nothing | no dependencies; works without p5.js. Node ≥ 18 only to run the tests |
| `p5.penplotter` | vanilla.penplotter ≥ 0.2.0 | the adapter contains no plotting or machine code; with a driver attached it refuses an older core with a clear message |
| `p5.penplotter` | p5.js ≥ 2.2.2 | tested with 2.2.2, in global and instance mode |
| direct plotting | Chrome or Edge, on `localhost` or https | Web Serial; the browser shows its port list only after a click or keypress |
| direct plotting | iDraw HSE / A2 (EBB 3.0.2), A3 H (DrawCore V2.09) | HSE/A2 profile tested; A3 H small plots tested with explicit settings |
| examples | wave formulas, vanilla.waves (pinned commit) | examples only; neither library depends on them |

The standalone core is version 0.5.0. The `p5.penplotter` 0.3.0 bundle includes this core and both drivers. Older bundles keep the core they were built with.

The standalone browser imports above use the fixed core release tag. The p5 browser bundle contains its core and driver; it does not fetch the latest standalone core at startup.
<!-- vereisten:end -->

## The facade

`PlotterEngine` is one object that holds a document and rebuilds its plan whenever the document changes.

| method | what it does |
|---|---|
| `line`, `polyline`, `polygon`, `rect`, `circle`, `arc` | add paths to the active layer, in document units |
| `hatch`, `crossHatch`, `stipple` | fill a polygon with lines or seeded dots (`spacing`, `angle`, `count`, `minDistance`, `seed`) |
| `pen({ id, color, width })` (also `tool()`), `layer(id, { toolId })` | pens and layers; layers stay in document order; a changed tool requests a pen swap |
| `importSVG(text)` | paths, lines, polygons, rects, circles and nested transforms; curves flattened |
| `optimize({ passes, mergeTolerance, duplicateTolerance, simplifyTolerance, maxSegmentLength })` | deduplicate, merge, simplify, resample, clean |
| `plan({ strategy, drawSpeed, travelSpeed, acceleration, travelAcceleration, liftDelay, toolChangeDelay })` | `"nearest"`: greedy nearest-path routing, with reversal and closed-path reloop; `"drawn"`: the order you drew |
| `stats()` | paths, points, draw and travel distance, pen lifts, pen changes, estimated seconds |
| `drawRoute(context, { showTravel })` | the route on a canvas, the pen in the air in red (also `drawPreview`) |
| `drawBed(context, { bed, sheet })` | the bed as the machine sees it: the home corner, the sheet where it lies, the drawing on it |
| `exportSVG`, `exportHPGL({ penMap, unitsPerMm })`, `exportGCode({ penUp, penDown })`, `exportJSON` | the same plan as a file, for machines without a driver |

The shared pen panel in the examples lets you choose A0–A6 or keep the drawing’s page, turn the sheet and drawing together, and centre the paper on the bed. Paper choice preserves stroke size. A sheet outside the bed or strokes outside the sheet block plotting; export links retain the original drawing before placement.

`PlotterEngine.paperSize(format, orientation, units)` exposes the same A0–A6 helper as the named `paperSize()` export. Adapters use it without copying a second size table. The p5 adapter uses it for `createPlot({ paper: "A2", margin: 12 })`.

## Planning the route

<p align="center">
  <img src="docs/images/animations/route.gif" alt="The same drawing in input order and planned order, with dotted pen-up moves" width="480">
</p>

The marks stay the same; the order changes. `plan({ strategy: "nearest" })` uses greedy nearest-path routing. Use `"drawn"` when the order you drew matters.

## Every stage on its own

```js
import { createDocument, addLayer } from "./src/core/model.js";
import { line } from "./src/geometry/index.js";
import { optimizeDocument } from "./src/optimizer/index.js";
import { planDocument } from "./src/planner/index.js";
import { compileEbbPlan } from "./src/driver/ebb.js";

const document = createDocument({ units: "mm" });
const layer = addLayer(document, { id: "blue", toolId: "pen-blue" });
line(layer, 10, 10, 100, 40);

const optimized = optimizeDocument(document, { mergeTolerance: 0.05 });
const plan = planDocument(optimized, { strategy: "nearest" });
const commands = compileEbbPlan(plan, { profile: "idraw-hse-a2" }).commands;
```

Every stage accepts and returns plain, JSON-serialisable snapshots: `vanilla.penplotter/document@1` in, `vanilla.penplotter/plan@1` out. No stage mutates its input.

## Structure

- `vanilla.penplotter.js`: root entry and the `PlotterEngine` facade
- `src/core/`: documents, layers, tools, paths and validation
- `src/geometry/`: primitives, fills, offsets, transforms and SVG import
- `src/optimizer/`: merging, deduplication, simplification and resampling
- `src/planner/`: drawing order, pen moves, statistics and time
- `src/renderer/`: canvas preview, and SVG, HPGL, G-code and JSON for other machines
- `src/driver/`: machine profiles, simulation, serial connections, and the EBB and DrawCore drivers
- `src/plugins/`: extension points for effects, optimizers, renderers and drivers
- `index.html`, `docs/`, `examples/`: the GitHub Pages site; `examples/pen.js` is the shared "to the pen" panel every example uses

## Examples

Every example includes a plotting panel; the [examples page](https://seb-prjcts-be.github.io/vanilla.penplotter/docs/examples.html) previews them live.

- `direct_plot` - a 40 × 25 mm frame with two waves: the first thing to plot, and a scale check
- `first_job` - a hatched shape, its outline and a circle: the smallest complete job
- `two_pens` - layers and tools; the plot pauses once so you can swap the pen
- `route_lab` - input made bad on purpose; switch optimizer passes on and off and read what each one buys
- `waves_pen` - 32 lines from vanilla.waves, sampled at a fixed time: a still from an animation
- `wave_hatch` - seventy cells hatched at a spacing and angle two waves decide: tone from lines
- `svg_to_pen` - supported SVG paths and basic shapes fitted to a width, previewed and plotted

## Behaviour and limits

**Edits.** After every change, through the drawing methods, `tool()`, `layer()`, `importSVG()` or directly in `plot.document` and returned paths or layers, planning, statistics, preview and export rebuild the plan with the last optimisation and planning settings. A plan returned earlier stays a separate snapshot. The check compares the whole document on every call, so document data must stay JSON-serialisable.

Measured: about 5 ms at 11 000 points, 20 ms at 50 000, 230 ms at 500 000. Negligible for one plot; do not redraw a huge plan as a preview every frame.

**Units.** Coordinates, tolerances and distance statistics are in the document unit. Plan speeds are mm/s, G-code feeds mm/min. HPGL and G-code export and the time estimate convert mm, cm, inch and CSS pixels (96 px per inch) to physical sizes; SVG keeps the document unit. Direct plotting accepts only mm, cm and inch.

**Geometry.** SVG import and the geometric effects are good for experiments, not yet for every SVG/CSS, compound-path and self-intersection case.

**Hardware.** `WebSerialTextDriver` sends text without following the machine's replies. Use `EbbDriver` or `DrawCoreDriver` for the controllers described above. Other machine configurations need their own physical tests. Direct plotting always requires an explicit confirmation.

## Related work

[p5.plotSvg](https://github.com/golanlevin/p5.plotSvg) by Golan Levin is the usual way to export a plotter-friendly SVG from p5.js. It deliberately does not optimise and drives no machine; for that it points to [vpype](https://vpype.readthedocs.io/). You can try importing its supported SVG paths here, inspect the plan and plot it with the `svg_to_pen` example.

[p5.gysin](https://github.com/seb-prjcts-be/p5.gysin) writes plotter-safe SVG with one Inkscape layer per pen; this engine can read it. Wave samplers and [vanilla.waves](https://github.com/seb-prjcts-be/vanilla.waves) supply the numbers several examples draw with.

## Test

```powershell
npm test
npm run docs
npm run manifest
```

`npm test` runs the snapshot, driver, regression and version tests, checks every local link on the site, builds every example composition and live preview headlessly, and fails when a generated docs page is stale. `npm run docs` renders `docs/architecture.md` and `docs/roadmap.md` to HTML; `npm run manifest` regenerates `docs/vanilla.penplotter.manifest.json`.

The optional vanilla.waves check stays off the network: download `waves-core.js` from vanilla.waves commit `4fad55570d9dab243e99f40181f12b5aede2c5be` and run:

```powershell
node tests/waves-integration.js path/to/waves-core.js waves-a4.svg
```

## How this was made

Written with AI assistance, under the direction of Sebastien Vanblaere. Changes are checked in code and on the iDraw; physical tests cover that machine only. See [About](https://seb-prjcts-be.github.io/vanilla.penplotter/docs/about.html).

MIT License.

Sebastien Vanblaere
