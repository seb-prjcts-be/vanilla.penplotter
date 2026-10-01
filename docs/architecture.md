# Technical architecture — vanilla.penplotter

## 1. Product promise

`vanilla.penplotter` is not an export button but a programmable compiler for
plotter jobs:

```text
p5.js / p5.waves / vanilla JS / SVG
                  ↓
          GeometryDocument
                  ↓
     effects + normalization
                  ↓
               PlotJob
                  ↓
       optimization + planning
                  ↓
               PlotPlan
                  ↓
      renderer + machine profile
                  ↓
            MachineProgram
                  ↓
         driver + transport
                  ↓
              hardware
```

Every arrow is a public module. An expert can replace the whole chain; a
beginner only uses `new PlotterEngine()`.

## 2. Four representations, not one universal object

### GeometryDocument

The authoring layer. It stores lines, polylines, Bézier curves, arcs, compound
paths, closedness, layers, tools, units and metadata. Curves stay curves here.
Objects have stable ids and `source`/`lineage` metadata.

The current v0.1 code already uses the document/layer/tool model, but still
normalizes geometry to polylines early. V0.2 formally splits the curve authoring
layer from the plot job.

### PlotJob

The machine-independent production geometry. Everything here is an explicit
sequence of points in physical units. A path has a `layerId`, `toolId`, `closed`,
`reversible`, constraints and provenance. This is the level for hatch, clipping,
deduplication and line merging.

For small jobs, plain `{x, y}` objects are understandable and plugin-friendly.
From roughly 100,000 points onwards, a `Float64Array` plus offset table can be
used internally. The public snapshot stays serializable.

### PlotPlan

An ordered, immutable list of actions: `tool-change`, `travel`, `draw`,
`pause`, `home` and later `checkpoint`. The plan contains distances, pen lifts,
estimated time and the exact route that preview and driver share.

### MachineProgram

Protocol-specific output: SVG, HPGL, G-code or a binary/textual command
stream. A renderer produces the program; a driver sends it. That way a planner
needs to know nothing about serial ports, and a driver no longer needs to
understand geometry.

## 3. Modules

| Module | Responsibility | Not responsible for |
|---|---|---|
| `core` | schemas, ids, units, layers, tools, validation, snapshots | geometric algorithms |
| `geometry` | primitives, curves, transformations, offsets, clipping | route order |
| `io-svg` | SVG read/write, transforms, viewBox, layers | machine control |
| `effects` | hatch, crosshatch, stipple, contours, artistic passes | pen changes |
| `optimizer` | clean, fuse, dedupe, simplify, resample | hardware protocol |
| `planner` | order, reversal, seams, layers, pen schedule, time | SVG parsing |
| `renderer` | preview, SVG, HPGL, G-code, JSON | serial flow control |
| `driver` | connection, capabilities, streaming, pause/resume/abort | creative geometry |
| `plugins` | lifecycle and named extension points | global monkey patches |
| external adapters | separate repositories such as `p5.penplotter` and future canvas-sketch integrations | core logic |

Every transformation returns a new snapshot. No optimizer may silently mutate
the original artwork. That makes comparison, undo, caching, workers and
reproducible exports possible.

The v0.1 facade keeps the optimization and the plan as long as the document
stays the same. Before every reuse it compares the full document (as JSON) with
the previous state; any difference — including a direct mutation of the public
document or of returned paths and layers — invalidates both caches. Rebuilding
uses the most recently passed optimization and plan settings.
Previously returned plans are not modified. There is deliberately only one
mechanism: no separate invalidation per drawing method. The price is one
comparison per call (± 5 ms at 11,000 points, ± 230 ms at 500,000); document
data must therefore remain JSON-serializable.

## 4. Geometry and topology

### Connected segments and line merging

For a small document, endpoint comparison is enough. For large jobs:

1. snap endpoints into a spatial hash with an explicit tolerance;
2. build a graph with points as nodes and segments as edges;
3. use union-find to identify connected components;
4. walk nodes of degree 1 first, then cycles;
5. keep source ids in `lineage` and mark reversals.

This is stronger than searching two arrays each time: T-junctions, loops and
thousands of segments become visible as topology. An R-tree or uniform grid
limits the neighbour search to local work.

### Duplicate lines

Exactly identical paths are only the simple case, already present in v0.1.
The full approach canonicalizes individual segments after snapping:

- sort each segment independently of direction;
- group collinear segments by normalized line equation;
- project them onto a single axis;
- perform an interval union to find full as well as partial overlap;
- reconstruct only the unique intervals.

For curves, comparison happens only after controlled flattening, so that the
error margin remains measurable.

### Simplification and resampling

- Ramer–Douglas–Peucker: fast maximum-deviation simplification for polylines.
- Visvalingam–Whyatt: visually more even on organic lines.
- arc-length resampling: even motor movement and stable effects.
- adaptive Bézier flattening: subdivision until the chord error is below tolerance.
- curve fitting after Schneider: optionally rebuild compact Béziers for
  SVG, never for the machine plan.

The user chooses tolerance in physical units, not on an abstract
“quality” slider.

### Offset curves

A naive normal offset is usable for open sketch lines but fails at
cusps, self-intersections and sharp corners. The production version uses a
robust integer-based offset/boolean kernel, comparable to Clipper2,
with configurable joins, miter limit and explicit cleanup. That kernel belongs
behind the same API as an optional geometry backend, so that the light build
can stay small.

## 5. Fills

### Hatch

1. rotate polygons into hatch space;
2. intersect parallel scanlines with outer contours and holes;
3. apply the even-odd or nonzero fill rule;
4. rotate segments back;
5. order boustrophedon: left→right, then right→left;
6. connect only where a bridge demonstrably stays inside the shape.

Crosshatching is two or more separate hatch passes. They can share the same pen
or each get their own layer/tool. Spacing can be a function, so that
p5.waves can drive a field, angle or local density without the core knowing
p5.js.

### Stippling

- Bridson Poisson-disc sampling for a uniform minimum distance;
- weighted rejection or a density map for tonal values;
- Lloyd relaxation for more even cells;
- deterministic PRNG for reproducibility;
- output modes `tap`, `dash`, `circle` and later pen-specific marks.

The stipple points are then planned again as a routing problem. So they are
not special preview pixels.

## 6. Route and pen planning

The path problem is a directed/asymmetric TSP variant: open paths can often be
reversed, closed paths can move their start seam, and some tools or layers
impose ordering constraints.

Recommended cascade:

1. group by hard constraints and tool;
2. cluster spatially (grid, k-d tree or Hilbert order) for very large jobs;
3. nearest-neighbour as a fast, good start;
4. 2-opt for route improvement;
5. optionally 3-opt/Lin–Kernighan for expensive repeat jobs;
6. optimize direction and seam at the same time;
7. keep a maximum time/passes as a predictable stop condition.

The cost function is time-based:

```text
cost = travelTime
     + penLiftTime
     + toolChangeTime
     + cornerSlowdown
     + constraintPenalty
```

Shortest distance is not always the fastest plot. Acceleration, sharp turns,
servo delay and pen changes are measurable in a machine profile.

Layers get a dependency DAG (`before`, `after`, `keepTogether`). Within
those constraints the planner can minimize pen changes. That way a black
contour can be forced to come after a wet fountain-pen layer without switching
off the whole optimization.

## 7. Machine profiles and drivers

A profile is data: bed dimensions, origin, units, speeds, acceleration,
pen mechanism, protocol and capabilities. A driver is behaviour: connecting,
handshake, streaming, flow control, status, pause, resume and abort.

A reliable driver is a state machine:

```text
disconnected → connecting → ready → running → paused → complete
                         ↘ error ↗       ↘ aborted
```

Mandatory safety rules:

- bounds check before the first byte;
- connection only after a user action;
- dry run/preview and explicit confirmation;
- protocol-specific ACK/flow control, no blind “write everything”;
- an abort that raises the pen when the protocol allows it;
- checkpoints and resuming from a confirmed command number;
- storing the profile version alongside the plan.

Web Serial is a transport, not a universal driver. AxiDraw/EBB, iDraw,
GRBL and classic HPGL machines get separate implementations and a
hardware-tested support matrix.

### EBB driver (`src/driver/ebb.js`)

The first machine driver. Three layers, each testable separately:

- `compileEbbPlan(plan)` is pure: a `PlotPlan` becomes a list of EBB commands
  (the `MachineProgram`). CoreXY mixing `motor1 = X + Y`, `motor2 = X − Y`;
  step targets are absolute so that rounding never accumulates into drift; an
  axis that would run slower than the firmware minimum is held back and caught
  up later. Unit and bounds checking happen here, before anything exists to send.
- `EbbDriver` streams with one reply per command as flow control, refuses
  without `confirmed: true` and without an EBB version reply, and on abort or
  error always ends in the same safe stop (`ES`, pen up, motors off).
- A transport is only `send(cmd) → reply`: `createLogTransport()` for the
  dry run, `createWebSerialTransport()` for the browser.

Support matrix as of 2026-09-21:

| profile | board | status |
|---|---|---|
| `idraw-hse-a2` | EBB, firmware 3.0.2 | physically tested: axes, scale (40 mm verified by measurement), full plot from Chrome |
| others | — | no driver; use SVG, HPGL or G-code export |

Of the safety rules above, these are still missing: checkpoints and resuming,
pause, and storing the profile version alongside the plan. Acceleration is in
place since 0.3.0: the profile carries speeds, accelerations and a junction
deviation, and the driver plans every stroke as ramps and corners.

## 8. Plugins

A plugin has a name, semver compatibility, capabilities and
`install(host)`. Registration is explicit:

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

Plugins receive snapshots and context, no access to hidden mutable state.
Workers become possible because plugin input is serializable. A plugin must
declare determinism and can receive a seed.

## 9. Integration with p5.js and p5.waves

The core does not import p5.js. The separate repository `p5.penplotter` adds
`createPlotterEngine()`, `drawPlotPlan()` and `createPlot()`, whose `plot.go()`
hands the plan to the driver. p5.waves remains a sampler:
a sketch builds points with `Waves.wave(y, { t })` and feeds those points to
the geometry layer. Later a convenience effect can accept a callback such as
`spacingAt(x, y)`; it remains plain JavaScript dependency injection.

## 10. Inspiration and deliberate new choices

- [vpype](https://github.com/abey79/vpype): strong reference for `linemerge`,
  `linesort`, `reloop`, simplification and a composable pipeline. Inspiration,
  but not a runtime basis: it is Python/CLI-oriented.
- [canvas-sketch-util penplot](https://github.com/mattdesl/canvas-sketch-util):
  shows how small a creative JavaScript entry point can be. The engine goes further
  with a job model, pen planning and drivers.
- [Paper.js](https://paperjs.org/reference/path/): mature SVG and curve API;
  interesting as an optional import/geometry adapter, too large as a mandatory core.
- [p5.plotSvg](https://github.com/golanlevin/p5.plotSvg): useful p5 capture and
  interoperability; its explicit focus is export, not the whole machine chain.
- [AxiDraw Python API](https://axidraw.com/doc/py_api/): behavioural reference for
  SVG and interactive motion contexts and reliable device control.
- [Web Serial](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API):
  browser transport with secure-context and compatibility limitations.

What deserves entirely new attention above all: a time-based optimizer,
immutable job snapshots, restartable hardware jobs, real capability
negotiation, a shared preview/driver plan and an API that can start as small
as p5.js without hiding the expert layers.

## 11. Scalability

- fewer than 2,000 paths: simple arrays and O(n²) nearest-neighbour are fine;
- 2,000–50,000: spatial hash/k-d tree, clustering and workers;
- more than 50,000: typed geometry buffers, streaming passes, progress/cancel and
  bounded local search;
- every heavy pass reports before/after statistics and never silently loses
  geometry outside the specified tolerance.

## 12. Version boundary

V0.1 proves the chain. The only hardware claim is the `idraw-hse-a2` profile
from the support matrix in §7; there is no claim for AxiDraw and other iDraw
models. It is also not yet a complete SVG renderer. V1.0 requires fixture files, property tests,
cross-browser tests, hardware tests per profile and a compatibility policy for
document, plan and plugin schemas.
