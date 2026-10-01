# Two modes — draw everything, then plot; draw something, plot it

A plotter can be a printer or an instrument. As a printer it gets a finished
sheet and reproduces it. As an instrument it is played: it draws what you make
while you make it. Both libraries will offer both, under two names that are
used everywhere in the code and the docs:

| | **sheet mode** | **live mode** |
|---|---|---|
| in one sentence | draw everything, then plot | draw something, plot it |
| the sheet is | a result, planned as a whole | a canvas, written as you go |
| order of the strokes | the planner's: nearest neighbour, reversal, reloop | yours: the order in which they were made |
| start and end | from the home corner, back to the home corner | from the home corner once; the carriage stays where the last stroke ended |
| time inside the sketch | does not exist on paper | is the drawing |
| pens | any number, one stop per change | one pen for the whole session |
| preview | the plan, before anything moves | optional; the pen is the output |
| the engine's call | `driver.run(plot.plan())` | `session.draw(points)` on a `driver.live()` session |
| the p5 call | `plot.go()` | `createPlot({ live: true })` or `plot.live()` |
| state in 0.3.1 | built, plotted, published | designed here, not built |

Sheet mode is what every page of this site describes today. This page is the
design of live mode: what it is for, what it does on the wire, what it asks of
the engine and the adapter, and in which order it gets built. Nothing of it is
in the code yet. When it is, the "state" row above changes and this sentence
goes.

## Why

Three things become possible that a finished sheet cannot do.

**Draw without a preview.** The sheet is the canvas. You can switch the screen
off, or never look at it, and the pen is the only output. What the drawing is,
is what the pen did. For a generative sketch this is the difference between
printing a picture and performing one.

**Draw with your hands.** A hand tracked by a camera (ml5 handPose) becomes the
pen: pinch thumb and index finger and the pen goes down, move the hand and the
stroke follows, open the hand and the pen lifts. The plotter plays back a
little behind you. This is drawing as an instrument, with the machine's own
precision added to your gesture.

**Watch an animation appear.** Set `frameRate(0.5)` and let every frame add a
few objects. What appears on the canvas appears on paper, in that order,
object by object, as slow as the pen is. The sketch is a score; the plotter
performs it. Ink accumulates: a plotted animation is a palimpsest, and nothing
is ever erased.

Make, plot, make, plot. That is the loop, and it is the loop of every sketch
that already runs in `draw()`.

## What happens on the wire

The EBB board does not know about sheets. It knows pen up, pen down, and moves
with a speed profile, queued a few at a time. Sheet mode compiles a whole plan
into that stream and sends it from start to end. Live mode keeps the same
stream open and appends to it one stroke at a time.

One stroke in live mode, from the pen's point of view:

1. The pen is up and the carriage is where the previous stroke ended.
2. Travel with ramps to the first point of the new stroke.
3. Pen down, wait the pen-down delay.
4. The stroke itself with the same acceleration profile as sheet mode: ramp
   up, cruise, slow into corners, ramp down to the floor speed.
5. Pen up, wait the pen-up delay.

Nothing else changes: the bounds check per stroke, the step-rate limits, the
floor speed that keeps the last step from hanging with the pen on the paper,
the pipelined sends and the emergency stop are the same code. The difference
is only where a stroke starts (the current position instead of a position the
planner computed) and when it is compiled (now, instead of all at once).

## What the engine needs

### A session

```js
import { EbbDriver, createWebSerialTransport } from "./src/driver/ebb.js";

const transport = createWebSerialTransport();
await transport.open();                                  // from a click
const driver = new EbbDriver({ transport, profile: "idraw-hse-a2" });

const session = await driver.live({ confirmed: true });  // motors on, pen up, position = home
await session.draw([{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 60 }]);   // mm, on the bed
await session.draw(circlePoints);
await session.idle();                                    // the pen has caught up
await session.close();                                   // back home, motors off
```

| member | what it does |
|---|---|
| `driver.live(options)` | opens the session: version check, FIFO depth, `EM,1,1`, `SP,1`; the carriage's position at that moment is `(0, 0)`, the home corner, exactly as in `run()` |
| `session.draw(points, options)` | compiles one stroke from the current position (travel, pen down, stroke, pen up) and sends it; resolves when the stroke is *queued*, not when it is drawn; `options` may override `drawSpeed`, `travelSpeed`, `acceleration` for this stroke |
| `session.move(point)` | travel with the pen up, no stroke; for parking or for a gesture that lifts and moves |
| `session.pending` | seconds of motion queued and not yet drawn; what the adapter reads to pace a sketch |
| `session.idle()` | resolves when the queue is empty |
| `session.position` | where the carriage will be when the queue is empty, in mm |
| `session.close()` | waits for idle, travels home, `SP,1`, `EM,0,0`, closes nothing else (the transport stays yours) |
| `session.stop()` | the emergency stop of 0.3.0: `ES`, pen up, motors off, the session is dead |
| `session.stats` | strokes drawn, millimetres drawn and travelled, seconds of motion, since the session opened |

The session is the only new object. `compileEbbPlan()` gets one more option so
that it can serve it: `{ origin: position, returnHome: false }`, meaning
"start from here and do not go back". Everything the compile already does per
stroke stays.

### Time is the order

Live mode does not run the planner. The order of the strokes is the order of
the calls, because the order is part of the drawing. The one optimisation that
stays is inside a stroke: chords within 0.02 mm of a straight line are merged
before compiling, as in sheet mode.

The adapter may order the few strokes of *one frame* nearest-first before
handing them to the session, since inside a frame the order was never the
artist's choice. That is an adapter option, off by default, not an engine
feature.

### The pen sets the pace

A frame takes a sixtieth of a second on screen and forty seconds on paper.
Something has to wait, and it is the sketch. Rules:

- `session.draw()` never blocks on the pen; it queues and returns. The queue is
  bounded: the session refuses to queue more than `maxPending` seconds of
  motion (default 10 s) and `draw()` then waits until there is room. So a
  runaway `draw()` loop cannot put a minute of moves on the wire that an
  emergency stop would have to tear down.
- `session.pending` and `session.idle()` let a consumer pace itself. The
  adapter uses them: it calls the sketch's `draw()` only when the pen has less
  than one frame of work left.
- A stroke that cannot be queued for `timeout` ms (default 30 s) throws; the
  session is then considered lost and does the safe stop.

### What stays out

- **No pen changes.** One pen per session. Pens as layers remain a feature of
  sheet mode, where the planner can group them.
- **No undo.** Ink is ink.
- **No speed.** Live mode is not a faster way to plot. Every stroke starts and
  ends at rest, and the pen waits for the sketch between frames.
- **No homing.** As everywhere in this engine: the carriage is parked in the
  home corner by hand before the session opens, and `(0, 0)` is wherever it was
  then.

## What the adapter needs

```js
let plot;

function setup() {
  createCanvas(600, 600);
  frameRate(0.5);                                 // one frame every two seconds
  plot = createPlot({ x: 147, y: 66, width: 300, live: true });
}

function draw() {
  // no background(), no plot.clear(): the sheet remembers everything
  const x = random(width), y = random(height);
  plot.circle(x, y, random(10, 60));             // on the canvas now, on paper when the pen gets there
}

function keyPressed() {
  if (key === "l") plot.live();                  // connect, confirm, start following
  if (key === "s") plot.stop();                  // emergency stop
  if (key === "e") plot.end();                   // wait for the pen, go home, motors off
}
```

| call | sheet mode | live mode |
|---|---|---|
| `createPlot({ live: true })` | — | the plot will follow the sketch once `plot.live()` has opened the session |
| `plot.line()` and the others | draw on the canvas, remember in mm | draw on the canvas, remember in mm, and go out at the end of this frame |
| `plot.clear()` | forget the recorded frame | forget nothing on paper; marks where the next frame's additions start |
| `plot.go()` | plan and plot the last frame as a sheet | not available while a live session is open |
| `plot.live()` | — | connect (port picker), confirm, open the session; `plot.live(false)` is `plot.end()` |
| `plot.end()` | — | wait for the pen, return home, motors off |
| `plot.stop()` | emergency stop | emergency stop |
| `plot.pending()` | — | seconds of motion still queued |
| `plot.isLive()` | false | true while the session is open |

How a frame goes out: p5 calls `draw()`, the sketch records strokes, and when
`draw()` returns the adapter hands that frame's strokes to the session in the
order they were recorded. Then it holds the next frame until
`session.pending` is below one frame's worth of motion. With `frameRate(0.5)`
and small frames the pen keeps up and the sketch never waits; with
`frameRate(30)` the sketch is throttled to the pen, which is still correct,
only no longer an animation on screen. The adapter says so in its status
line.

The on-screen preview stays available in live mode, because without it nobody
learns the trade. Switching it off is the artist's choice, not the library's.

## The three uses, each with its recipe

### No preview

```js
function setup() {
  noCanvas();                                      // or createCanvas and never look
  plot = createPlot({ width: 300, live: true });
}
function draw() { plot.line(/* … */); }
```

Without a canvas the plot still records in millimetres, because the adapter
never needed the canvas for that. Keep a log: `plot.stats()` after
`plot.end()` tells what was drawn.

### Hands

ml5 handPose gives 21 landmarks per hand at camera rate. The recipe:

1. **Pinch** is the pen: pen down when the distance between thumb tip and
   index tip drops under a threshold, pen up when it opens again. Hysteresis
   on the threshold, or the pen chatters.
2. **Smooth** the index tip with an exponential moving average; hand tracking
   jitters by a few pixels and the pen would draw every one.
3. **Map** the camera frame to the sheet: mirror horizontally (a camera faces
   you), scale to the plot's width. A small dead zone at the camera's edge
   keeps the stroke on the paper.
4. **Cut** the stroke when the pinch opens, simplify it (RDP, 0.3 mm) and
   resample it, then `plot.polyline(points)`; the adapter sends it at the end
   of the frame.
5. **Latency** of a few hundred milliseconds is fine. The pen is behind anyway.
   What matters is that a stroke is one stroke, not twenty short ones.

Nothing in this recipe touches the engine. ml5 is a page's choice, loaded from
its CDN by that page, never a dependency of either library.

### Slow animation

- Never redraw. A sketch that clears and redraws every frame plots the same
  objects again and again; live mode is for sketches that *add*.
- Seed your randomness, so a run can be repeated on a second sheet.
- Let time be a parameter: the frame number is the only clock the pen can
  follow, so what changes from frame to frame is the drawing.
- `frameRate()` is the knob. Below one frame per second the pen keeps up and
  the screen shows the same thing as the paper, a little ahead.

## Safety

The rules of sheet mode apply, and two things are stricter.

- The confirm dialog ("carriage parked, paper in place, hands clear") appears
  once, when the session opens. It is not asked per stroke; after that the
  sketch owns the pen.
- Leaving the page is an emergency stop, as since 0.3.0. In live mode this is
  more likely to happen mid-stroke, so the pen-up on stop stays the first
  thing sent.
- The bounded queue is a safety feature: a stop never has more than
  `maxPending` seconds to tear down.
- The hand recipe keeps the pen up whenever tracking is lost. A hand that
  leaves the camera lifts the pen; it does not freeze it on the paper.

## Order of work

1. **Engine:** `driver.live()`, the session, the `origin` option on
   `compileEbbPlan()`. Tested dry against the log transport with the
   tick-exact firmware simulation of `tests/ebb.js`, including the bounded
   queue and the pace of `pending`.
2. **A plain example on the engine's site:** draw with the mouse, the pen
   follows. The mouse is the hand. ml5 comes later and changes nothing below
   it.
3. **The adapter:** `createPlot({ live: true })`, `plot.live()`, `plot.end()`,
   the frame protocol and the pacing; a slow-animation example with
   `frameRate(0.5)`.
4. **The hands:** the ml5 handPose example, pinch to draw, as a page that
   loads ml5 from its CDN.

Each step is plotted on the iDraw before the next starts, and the "state" row
at the top of this page is updated with what is real.

*Design written on 2026-10-01 from Seb's three questions: what if you could
make art without the canvas preview, what if you could draw with your hands
through ml5, what if you set the frame rate low and watched the animation
appear on the plotter, object by object.*
