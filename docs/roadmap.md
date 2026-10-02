# Roadmap

## Working now

The current source records polylines in layers, generates simple fills, imports a subset of SVG, cleans up paths and plans a route. It previews the plan and exports SVG, HPGL, G-code and JSON.

Direct plotting uses the EBB driver. Physical tests cover the iDraw HSE / A2 with firmware 3.0.2: axes and scale on 2026-09-21, acceleration and queued low-level moves on 2026-10-01. The examples' pen panel places the sheet, offers a dry run and remembers completed strokes for resuming the same drawing.

The latest tagged releases are core 0.3.1 and p5 adapter 0.2.1. The site's current source also includes the `pen()` and `drawRoute()` aliases and bed preview helpers. These additions are not a new tagged release.

## Proposed next work

- Pause and resume within a stroke. Completed-stroke resume already exists in the example panel.
- Configurable pen heights in the machine profile.
- A Node serial transport for plotting from a script.
- More curve support in the p5 adapter; arcs are already implemented.
- [Live drawing](live.html), with a bounded queue and pacing that follows the pen.

These are directions, not available APIs or release dates.

## Larger work

Full SVG/CSS support, robust polygon operations, spatial indexing and more advanced route planning would require substantial work. They are outside the current implementation.

Other machine drivers need tests on the actual hardware before being described as supported. A profile entry or an exported file alone is not that test.

A future 1.0 would need stable schemas, migration rules, type declarations and a tested support matrix. The [architecture](architecture.html) describes what exists today.
