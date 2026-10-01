# Roadmap

Direction since 2026-09-21: **the sketch goes straight to the pen, with no SVG
in between.** `vanilla.penplotter` is the engine and the driver; `p5.penplotter` is the thin
p5.js layer on top. SVG, HPGL and G-code export remain, but are
no longer the main path.

## Present in 0.3.1

- document, layers, tools and polyline paths
- primitives, transforms, simple offsets
- hatch, crosshatch and deterministic stippling
- browser SVG import with flattening
- path deduplication, line merging, RDP and resampling
- nearest-neighbour routing, reversal and closed-path reloop
- SVG, HPGL, G-code, JSON and canvas preview, with conversion to physical units
- distance, pen-up/down, pen changes and a time estimate with the machine's own
  ramps and pen delays (0.3.1), so a page and the pen panel say the same seconds
- plan that refreshes itself after every change to the document
- simulator, generic Web Serial text transport and machine profiles
- **EBB driver: plotting directly on an iDraw HSE / A2** (CoreXY, bounds checking,
  flow control per command, safe stop), physically tested on 2026-09-21
- **acceleration in the EBB driver** (0.3.0): ramps, cornering by junction
  deviation, exact-step `LM` moves, the board's full motion queue on firmware 3.x,
  `SM` slices on older firmware
- examples: direct plot, first job, two pens, route lab, waves to pen, wave hatch, SVG to pen
- plugin host; the p5 adapter lives in `p5.penplotter`

## Live: the plotter as an output device

Two ways to draw. *Sheet mode*: draw everything, then plot; your program
makes the whole drawing, the engine finds a good order, the plotter draws it.
That is 0.3.1. *Live mode*: draw something, plot it; the plotter draws along
while your program is still drawing, so the picture grows on paper in the
order you made it. For things that happen over time: an animation appearing
dot by dot, a hand drawing in the air. [Two modes](live.html) explains both in
plain words, then carries the design: the driver session, the adapter's
`createPlot({ liveMode: true })`, the pacing rules, the order of work. Nothing of
it is built yet; that page says what is real.

## Next: strengthening the direct route

- pause; resume from an acknowledged command mid-stroke (resuming per completed stroke
  is in 0.3.0: the pen panel remembers the count, `skipDraws` leaves them out); profile
  version alongside the plan
- pen heights configurable from the profile
- Node transport alongside Web Serial, so a script can plot without a browser
- more p5 primitives in `p5.penplotter` (arcs, curves)

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
