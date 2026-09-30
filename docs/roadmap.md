# Roadmap

Direction since 2026-09-21: **the sketch goes straight to the pen, with no SVG
in between.** `vanilla.penplotter` is the engine and the driver; `p5.penplotter` is the thin
p5.js layer on top. SVG, HPGL and G-code export remain, but are
no longer the main path.

## Present in 0.2.0

- document, layers, tools and polyline paths
- primitives, transforms, simple offsets
- hatch, crosshatch and deterministic stippling
- browser SVG import with flattening
- path deduplication, line merging, RDP and resampling
- nearest-neighbour routing, reversal and closed-path reloop
- SVG, HPGL, G-code, JSON and canvas preview, with conversion to physical units
- distance, pen-up/down, pen changes and time estimation
- plan that refreshes itself after every change to the document
- simulator, generic Web Serial text transport and machine profiles
- **EBB driver: plotting directly on an iDraw HSE / A2** (CoreXY, bounds checking,
  flow control per command, safe stop), physically tested on 2026-09-21
- examples: first job, vanilla.waves to SVG, direct plot
- plugin host; the p5 adapter lives in `p5.penplotter`

## Next — strengthening the direct route

- acceleration in the EBB driver (currently deliberately slow, fixed speeds)
- pause, resume from an acknowledged command, profile version alongside the plan
- pen heights configurable from the profile
- Node transport alongside Web Serial, so a script can plot without a browser
- more p5 primitives in `p5.penplotter` (arcs, curves)
- possibly: read SVG from p5.plotSvg and plot it without vpype or Inkscape

## Parked

Not dropped, just not a priority: existing tools (vpype, the
AxiDraw software) already cover this, and it does not bring the sketch closer to the pen.

- curve-rich `GeometryDocument`, full SVG/CSS support, booleans and
  robust offsets
- production planner: spatial index, 2-opt/3-opt, boustrophedon hatch routing,
  layer dependencies, wet-ink delay
- drivers for other families (GRBL + servo, classic HPGL, iDraw 2.0); those
  only come once there is a physical machine to test on

## 1.0

Stable schemas and migrations, TypeScript declarations and npm distribution,
stable adapter contracts for `p5.penplotter`, and a support matrix in which every
profile has been tested on real hardware.
