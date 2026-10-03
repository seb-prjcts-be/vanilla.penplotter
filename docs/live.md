# Live drawing: design notes

## Draw first, then plot

Each object is prepared before the pen starts. The p5 adapter offers `plot.sequence(prepare)`: calculate one object, plot it, wait for completion, then calculate the next. Its [chaos game](https://seb-prjcts-be.github.io/p5.penplotter/examples/chaos_game/index.html) does this one point at a time. A driver session retains position between objects and returns home after the last one.

## The idea

Live drawing would let a program add a stroke while the plotter is already drawing earlier strokes. A slow animation could grow on paper. A mouse or tracked hand could contribute new lines as you move.

This is a proposal. There is no `liveMode()` or `driver.live()` API in either library. The existing examples do not stream new geometry during a plot.

## What it would need

The existing driver session keeps its position between objects and checks their plans against the bed. Live input would also need to limit the amount of queued motion. The sketch would have to wait when the pen falls behind. A frame rate alone cannot guarantee that the machine keeps up: stroke length, corners and pen lifts all take time.

The first version would use one pen. Strokes would arrive in drawing order, with no undo on paper. Losing the input or leaving the page would request a stop and pen lift; physical behaviour would still depend on a working connection.

Hand tracking would belong in an example, not in the core. That example would need smoothing, a clear drawing gesture and a pen-up state when tracking is lost.

## Before calling it working

The session has been tested with simulated connections and three successive lines on the iDraw. Input arriving during motion still needs implementation and testing. A small mouse-drawing example would be the next hardware check; hand tracking can follow.

Until then, use the current complete-plan workflow. See the [guide](guide.html) for available calls and the [roadmap](roadmap.html) for other proposed work.
