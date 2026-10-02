# Live drawing: design notes

## Draw first, then plot

Both libraries currently build a complete drawing before the pen starts. The planner can choose nearby paths or preserve the order in which you drew them. The chaos game example uses that second option: its dots appear in the game's order, but the whole point set is prepared before plotting.

## The idea

Live drawing would let a program add a stroke while the plotter is already drawing earlier strokes. A slow animation could grow on paper. A mouse or tracked hand could contribute new lines as you move.

This is a proposal. There is no `liveMode()` or `driver.live()` API in either library. The existing examples do not stream new geometry during a plot.

## What it would need

A driver session would keep its position between strokes, check each new stroke against the bed and limit the amount of queued motion. The sketch would have to wait when the pen falls behind. A frame rate alone cannot guarantee that the machine keeps up: stroke length, corners and pen lifts all take time.

The first version would use one pen. Strokes would arrive in drawing order, with no undo on paper. Losing the input or leaving the page would request a stop and pen lift; physical behaviour would still depend on a working connection.

Hand tracking would belong in an example, not in the core. That example would need smoothing, a clear drawing gesture and a pen-up state when tracking is lost.

## Before calling it working

Build and test the driver session with the log transport, then plot a small mouse-drawing example on the iDraw. Add the p5 adapter and a slow animation only after those checks. A hand-tracking example can follow.

Until then, use the current complete-plan workflow. See the [guide](guide.html) for available calls and the [roadmap](roadmap.html) for other proposed work.
