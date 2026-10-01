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
- examples: first job, vanilla.waves to SVG, direct plot
- plugin host; the p5 adapter lives in `p5.penplotter`

## Live — the plotter as an output device

Everything above treats a sheet as a whole: `plan()` orders all the paths,
`run()` starts at the home corner, draws the lot and returns. Time inside the
sketch does not exist on paper. Live mode turns that around: the plotter
follows the sketch while it runs. Make, plot, make, plot.

Three ways to use the same thing:

- **No preview.** The sheet is the canvas. You draw blind, or with the canvas
  switched off, and the pen is the only output. A drawing is what the pen did,
  not what the screen showed.
- **Hands.** A hand tracked by ml5 (handPose) draws: a pinch puts the pen
  down, the fingertip path becomes a stroke, opening the hand lifts the pen.
  The plotter is an instrument you play, and it plays back a little behind you.
- **Slow animation.** `frameRate(0.5)`, and every frame adds objects. What
  appears on the canvas appears on paper, in that order, object by object. The
  sketch is a score; the plotter performs it. Ink accumulates: a plotted
  animation is a palimpsest, and `clear()` no longer erases anything on paper.
  It only says "the next additions start here".

### What it takes in the engine

- **A live session in the EBB driver.** Open once: connect, confirm, motors
  on, pen up. Then `session.draw(points)` compiles one stroke from wherever
  the carriage is (travel with ramps, pen down, the stroke with ramps, pen up)
  and sends it straight away; `session.close()` returns home and switches the
  motors off. `compileEbbPlan()` already builds strokes from a running
  position; it needs a mode that starts at the current position instead of
  home and does not return. Pipelining, bounds checking, the floor speed and
  the emergency stop stay as they are.
- **Time is the order.** No nearest-neighbour over the whole sheet: strokes go
  in the order they were made. Within one frame the few strokes of that frame
  may be ordered nearest-first, nothing more.
- **The pen sets the pace.** A frame takes a sixtieth of a second on screen
  and forty seconds on paper. The sketch has to wait for the pen: the session
  reports what is still queued, and the adapter holds the next frame until the
  pen is nearly idle. The queue never grows beyond a few seconds of motion, so
  a stop is a stop.
- **Noisy input.** Hand tracking jitters; a stroke is simplified (RDP) and
  resampled before it goes out. A few hundred milliseconds of latency are
  fine: the pen is behind anyway.
- **One pen.** No tool changes mid-session. Pens as layers stay a feature of
  the planned route.

### What it takes in p5.penplotter

- `createPlot({ live: true })`, or `plot.live()` from a key: at the end of
  every `draw()` the strokes recorded in that frame go to the session.
- `plot.go()` keeps meaning the planned route for a whole sheet; live is the
  other door, not a replacement.
- The on-screen preview stays available, because without it nobody learns the
  trade. Switching it off is the artist's choice, not the library's.

### Order of work

1. The session in the engine, tested dry against the log transport with the
   tick-exact firmware simulation already in `tests/ebb.js`.
2. A plain example: draw with the mouse, the pen follows. The mouse is the
   hand; ml5 comes later and changes nothing in the engine.
3. The adapter option, and a slow-animation example (`frameRate(0.5)`).
4. The ml5 handPose example, pinch to draw, as an optional page that loads
   ml5 from its CDN.

## Next — strengthening the direct route

- pause; resume from an acknowledged command mid-stroke (resuming per completed stroke
  is in 0.3.0: the pen panel remembers the count, `skipDraws` leaves them out); profile
  version alongside the plan
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
