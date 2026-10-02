# How vanilla.penplotter works

## From points to a plan

You add lines and polylines in physical units. The engine keeps them in layers, with a tool for each layer. A tool describes a pen's colour and width; it does not choose or load a pen on the machine.

The pipeline is geometry, optional cleanup, route planning, preview or export, and a separate machine driver. The core uses plain JavaScript objects and ES modules. It does not depend on p5.js.

## Geometry

The document contains a page, tools, layers and polyline paths. Circles, arcs and imported curves become sampled points. There are no native curve objects, text layout, polygon booleans or clipping.

`hatch()` and `crossHatch()` make separate line segments inside a simple polygon. They do not join the stripes into a continuous zigzag or handle compound shapes with holes. `stipple()` places short dashes with a seeded generator and a minimum distance between centres. Crowded regions can produce fewer dots than requested.

Transforms return new geometry. Drawing methods add paths to the current document. The simple offset helper is not a robust polygon offsetter.

## Cleanup

The optimizer can remove duplicate paths, merge endpoints within a tolerance, simplify polylines, resample long segments and remove very short paths. Tolerances use document units. Simplification changes the geometry within its tolerance, so inspect the result before plotting.

Duplicate removal handles complete paths, including reversed paths, rather than partially overlapping lines. Merging compares paths pair by pair; large drawings can take time. There is no spatial index or worker implementation.

## Route planning

The planner visits visible layers in document order. It asks for a tool change when the next layer uses a different tool; it does not regroup all layers by pen.

Within each layer, `strategy: "nearest"` chooses the next nearby path greedily. It can reverse open paths and move the starting corner of closed paths. This often reduces travel, but does not find the shortest possible route. `strategy: "drawn"` preserves the path order and direction.

A plan contains routes, travel and draw moves, tool changes, and statistics. The time is an estimate based on speeds, ramps and pen delays. Manual pen changes and communication delays can change the actual duration.

The engine checks the document before returning a cached result. An edit invalidates the old optimized document and plan. Previously returned plans remain separate objects, but they are not frozen against changes by your code.

## Preview and files

Canvas preview and SVG, HPGL, G-code and JSON export use the planned geometry. SVG is a line drawing, not a reproduction of arbitrary screen styling. HPGL and G-code are generic outputs; pen commands, units and tool numbers must match the software and machine that receive them.

The browser SVG importer reads paths and basic shapes, including nested transform attributes. Curves are sampled with fixed step counts. It does not reproduce SVG text, images, CSS, masks, clipping, `use` elements, viewBox mapping or filled compound shapes. Imported content becomes one layer unless your code separates it. Check the preview and scale; this is not a full SVG renderer.

`drawBed()` previews the sheet on the machine bed. `placePlan()` moves or rotates the plan's machine moves; it does not rewrite its route array. Use the bed preview for that placed plan rather than assuming every renderer applies the placement.

## Direct plotting

`EbbDriver` from `src/driver/ebb.js` compiles a complete plan into commands, checks units and bed bounds, and sends commands through a transport with acknowledgement handling. Motion uses acceleration ramps and corner speeds. The driver uses low-level moves on supported firmware and sliced moves on older firmware.

Physical tests cover one profile: **iDraw HSE / A2, EBB firmware 3.0.2**. Other profile entries and the generic text transport do not establish support for other machines. A log transport is available for a dry run without hardware.

The carriage must be parked at home by hand. On abort or error, the driver attempts to stop motion, lift the pen and release the motors. A disconnected or unresponsive machine cannot be guaranteed to receive those commands.

The examples' pen panel remembers completed strokes in local storage. It can resume the same drawing with `skipDraws`, after you park the carriage at home again. This is not a pause or a mid-stroke resume. Live streaming and a Node serial transport are not implemented.

## Modules and extensions

The source separates core data, geometry, optimizer, planner, renderer, driver and plugin registry. Optimizer plugins can register a named function. Registries also exist for effects, renderers and drivers, but those extension points are not yet wired into the facade.

The [guide](guide.html) shows the working API. The [handbook](handbook.html) carries the options and driver details. The [roadmap](roadmap.html) keeps proposed work separate from these implemented parts.
