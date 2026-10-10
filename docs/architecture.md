# How vanilla.penplotter works

## From points to a plan

You add lines and polylines in physical units. The engine keeps them in layers, with a tool for each layer. A tool describes a pen's colour and width; it does not choose or load a pen on the machine.

The pipeline is geometry, optional cleanup, route planning, preview or export, and a separate machine driver. The core uses plain JavaScript objects and ES modules. It does not depend on p5.js.

## Geometry

`PlotterEngine.paperSize()` exposes the existing core A0–A6 helper to adapters that receive the engine class. The p5 adapter uses it to fit a canvas to chosen paper; the standalone core panel preserves the source drawing's scale.

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

The browser SVG importer reads paths and basic shapes, including nested transform attributes. Curves are sampled with fixed step counts. It does not reproduce SVG text, images, CSS, masks, clipping, `use` elements, viewBox mapping or filled compound shapes. Definitions, clip paths, masks, patterns and gradients are skipped, so a `clipPath` rectangle is never drawn. Imported content becomes one layer, except that every Inkscape layer (`inkscape:groupmode="layer"`) becomes a layer with its own pen. A number that opens the label (`2 red`) or a `data-pen` attribute, as p5.gysin writes it, names a physical pen that layers share; a layer without a number gets a pen of its own. `layers: "single"` keeps the old single layer. Layer order is kept, and the planner does not regroup layers by pen. Check the preview and scale; this is not a full SVG renderer.

`drawBed()` previews the sheet on the machine bed. `placePlan()` moves or rotates the plan's machine moves; it does not rewrite its route array. Use the bed preview for that placed plan rather than assuming every renderer applies the placement.

The shared example panel can choose an A-format sheet without scaling the geometry. It uses that sheet as the frame for `placePlan()`, then checks the paper against the bed and the placed strokes against the paper before compiling commands. Placement fields are locked during a run. The source plan remains unchanged, and export links use that original plan rather than the machine placement.

## Direct plotting

`EbbDriver` from `src/driver/ebb.js` compiles a complete plan into commands, checks units and bed bounds, and sends commands through a transport with acknowledgement handling. Motion uses acceleration ramps and corner speeds. Pen-up travel uses timed `SM` slices; drawing uses `LM` on supported firmware and timed slices on older firmware.

Physical EBB tests cover one profile: **iDraw HSE / A2, EBB firmware 3.0.2**. Other profile entries and the generic text transport do not establish support for other machines. A log transport is available for a dry run without hardware.

`driver.run()` executes one complete plan and returns home. `driver.session(prepare, options)` keeps carriage position and motor steps between complete plans. Await each `session.run(plan)` before preparing the next object. It supports one pen and returns home once, after the callback finishes. A stopped or failed session ends without an uncertain return-home move. Simulated tests and the three-line hardware run on 2026-10-03 cover this implementation; see `tests/hardware/session-2026-10-03.json`.

The carriage must be parked at home by hand. On abort or error, the driver attempts to stop motion, lift the pen and release the motors. A disconnected or unresponsive machine cannot be guaranteed to receive those commands.

The examples' pen panel remembers completed strokes in local storage. It can resume the same drawing with `skipDraws`, after you park the carriage at home again. This is not a pause or a mid-stroke resume. Live streaming and a Node serial transport are not implemented.

## Machine profiles and compatibility

The [official iDraw package](https://idrawpenplotter.com/pages/downloads) supplies `idraw_HSE.inx`, which selects A2 as model 6 and loads the AxiDraw-based driver. Its high-resolution configuration gives 16× microstepping, 80 motor steps/mm and approximately 594 × 432 mm travel. In `extensions-260620.zip`, the speed percentages convert to 50.21 mm/s drawing and 150.63 mm/s travel; the default acceleration factor gives 762 and 1143 mm/s². These values describe that software package, not measured limits of every machine.

The profile records those values under `manufacturerDefaults`. Operating defaults remain 40 mm/s drawing and travel, with 800 mm/s² drawing and 300 mm/s² travel. Manufacturer defaults do not replace settings that worked better on the physical machine.

Optional `penLift` configuration translates standard-servo height and rate percentages into `SC,4`, `SC,5`, `SC,11` and `SC,12` before the first pen command. Omit it to retain existing controller calibration. A brushless or narrow-band pen lift needs a different calibration; firmware version alone does not identify the installed servo.

### Plotters and controller protocols

Paper size and brand do not identify the controller protocol. In particular, an iDraw A3 H with DrawCore is different from an iDraw HSE/A3. The list below records protocol evidence separately from direct plotting support in this library.

| Plotter or controller | Protocol | Evidence and current support |
|---|---|---|
| iDraw HSE / A2 | EBB | Physically tested with EBB firmware 3.0.2; implemented profile `idraw-hse-a2`. |
| iDraw HSE / A3 | EBB candidate | Listed by the same AxiDraw-based vendor extension. Needs confirmed controller identity, separate bed bounds and pen calibration; not physically tested here. |
| iDraw / UUNA TEK A3 H with DrawCore V2.09 | GRBL / DrawCore | Greeting `Grbl 1.1h DrawCore V2.09`; user-reported physical line, square and pen-up direction tests passed on 2026-10-05. Experimental `DrawCoreDriver`; evidence covers this connected machine, not every A3 H revision. |
| Other iDraw / UUNA TEK models with a DrawCore controller | GRBL / DrawCore | The [DrawCore utilities](https://github.com/cfloutier/drawcore_plotink/blob/03196436008d3e7c07b78d0ee638420228e1167a/drawcore_motion.py) contain GRBL movement and Z-axis pen commands. Experimental driver requires explicit bounds, pen positions and axis mapping. Confirm the installed controller; do not infer it from the brand. |
| AxiDraw V2, V3, V3/A3, SE/A3, SE/A2 and MiniKit | EBB | Their [official configuration](https://github.com/evil-mad/axidraw/blob/master/inkscape%20driver/axidraw_conf.py) uses EBB. Each needs its own bounds and pen calibration; not physically tested here. |
| NextDraw | EBB-based | The [migration guide](https://bantam.tools/nd_migrate/) requires model-specific pen lift and homing configuration. Not ready to use with the iDraw profile. |
| EggBot and WaterColorBot | EBB | Share the [EBB protocol](https://evil-mad.github.io/EggBot/ebb.html), but different mechanics prevent reuse of this CoreXY profile. Not supported by that profile. |
| Other GRBL-based plotters | GRBL, with machine-specific pen control | Generic G-code export is available. The `generic-grbl` entry and experimental text sender do not provide a complete acknowledgement-aware GRBL driver. Confirm pen commands, bed bounds and coordinate setup separately. |

The DrawCore utilities by [cfloutier](https://github.com/cfloutier/drawcore_plotink) show pen movement through `G1 G90 Z… F…`, followed by restoration of the XY feed rate. The [extracted iDraw extension configuration](https://github.com/cfloutier/idraw2_internal/blob/ed8bb84f9b34c2cfc6749661f921d25493dfa128/idraw2_0internal/idraw2_0_conf.py) uses Z positions 0.5 for up and 5 for down. These are source defaults, not calibrated values for every machine. These repositories are community extractions of the extension code, not manufacturer confirmation for every model or firmware revision. The generic exporter defaults `M5` and `M3 S1000` are not a verified substitute for DrawCore pen control.

### Controller recognition

`detectDriver()` from `src/driver/auto.js` selects a driver from a read-only identity probe or a startup greeting. An EBB version response identifies the EBB protocol; a DrawCore version response or a greeting containing `Grbl` and `DrawCore` identifies the DrawCore variant. Plain GRBL is recognized but rejected for direct plotting because its pen mechanism is unknown. Unknown responses also fail before movement. No automatic homing, unlock or coordinate reset is performed.

The p5.penplotter 0.3.0 browser bundle uses this selection. Older bundles keep their original drivers.

Protocol recognition alone cannot establish an exact mechanical model, travel bounds, pen heights or homing procedure. Read those from supported controller queries where available, otherwise require an explicit machine configuration. `paper: "A3"` selects paper size, not a controller or plotter model.

### DrawCore

`DrawCoreDriver` compiles physical plans into GRBL commands, validates the entire geometry before sending it, and requires explicit travel bounds, Z pen positions and axis mapping. It supports one pen and `run()`; sessions and automatic resume are not implemented. Drawing and travel feed rates are in mm/min. It queues one acknowledged command at a time and waits for a physical `Idle` report before returning `complete`. Initial status must be `Idle` with a known work position at X0 Y0. The driver never sets that origin itself.

The researched extension maps drawing X to negative GRBL Y and drawing Y to negative GRBL X at its high-resolution setting. Express that as `axes: { swapXY: true, xDirection: -1, yDirection: -1 }`; it remains a machine configuration to verify physically. Bounds are checked in drawing coordinates before this mapping. Source pen defaults and axis directions are not calibration evidence for a particular installed machine.

For p5.penplotter 0.3.0, supply the settings when creating the plot:

```js
const plot = createPlot({
  paper: "A3", paperX: 0, paperY: 0, margin: 12,
  drawcore: {
    travel: { width: 420, height: 297 },
    penUp: 0.5, penDown: 5, penFeed: 1000,
    drawFeed: 600, travelFeed: 900,
    axes: { swapXY: true, xDirection: -1, yDirection: -1 }
  }
});
```

These settings were used in the user-reported A3 H hardware test on 2026-10-05. The [test record](../tests/hardware/drawcore-a3-h-2026-10-05.json) and [serial log](../tests/hardware/drawcore-a3-h-2026-10-05.log) cover automatic recognition, a 10 mm square and line, Z pen operation, explicit XY-origin setting, a 1 mm pen-up drawing-X test and return to the work origin. The controller reports `Run` during movement and `Idle` before completion; no controller errors appear in the supplied log. The user reports that the performed tests work. Dimensions were not independently measured, and full-bed travel, a separate drawing-Y jog, feed-hold during motion and hardware failure recovery are not established by this log. Controller settings report X travel 297 mm, Y travel 420 mm and Z travel 10 mm; swapping axes gives the 420 × 297 mm drawing bounds above.

Use the existing p5 checkout: `node tools/build-hardware-test.js` produces an isolated development bundle and a local test page in `node_modules/.drawcore-test`. The page provides identity and status checks, a pen-up test, an explicit XY-origin button, 1 mm pen-up direction tests, a 10 mm line/square, feed-hold and downloadable command logs. It includes a single-file HTML variant and local-server instructions; Inkscape is not needed. Development builds are marked in metadata and cannot overwrite the release `dist` directory. A release build still requires the pinned, unchanged core source.

Stopping or an error requests GRBL feed-hold (`!`). Delivery can fail when the connection is lost. Feed-hold may leave the pen down and queued moves suspended; it is not a queue flush or a confirmed pen lift. The driver does not reset, unlock or resume automatically. A timeout or controller restart invalidates the transport; reconnect and inspect the machine before another job.

`EBB_COMPATIBILITY` exposes this research list. It does not create profiles, detect the mechanical model, or grant plotting support. A serial acknowledgement means a command was accepted; it does not confirm physical position. Step counters cannot detect a manually moved carriage or missed steps.

## Modules and extensions

The source separates core data, geometry, optimizer, planner, renderer, driver and plugin registry. Optimizer plugins can register a named function. Registries also exist for effects, renderers and drivers, but those extension points are not yet wired into the facade.

The [guide](guide.html) shows the working API. The [roadmap](roadmap.html) keeps proposed work separate from these implemented parts.

## Pen-lift calibration

Omit `penLift` to retain controller calibration. For a known standard servo, up/down heights are 0-100 control percentages and raise/lower rates are 1-100. These are not millimetres. For example: `penLift: { up: 60, down: 30, raiseRate: 75, lowerRate: 50 }`. Check the installed servo and pen mounting before changing these values.
