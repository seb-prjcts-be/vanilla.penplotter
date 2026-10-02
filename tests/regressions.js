import assert from "node:assert/strict";
import { PlotterEngine, Optimizer, Driver, Renderer, Planner } from "../vanilla.penplotter.js";
import { paperSize, describePaper } from "../src/core/model.js";

function testPaperSizes() {
  assert.deepEqual(paperSize("A4"), { width: 210, height: 297 });
  assert.deepEqual(paperSize("A2", "landscape"), { width: 594, height: 420 });
  assert.deepEqual(paperSize("A3", "portrait", "cm"), { width: 29.7, height: 42 });
  assert.throws(() => paperSize("A42"), /Unknown paper format/);
  assert.throws(() => paperSize("A4", "sideways"), /portrait or landscape/);
  assert.equal(describePaper({ width: 29.7, height: 21 }, "cm").format, "A4");
  assert.equal(describePaper({ width: 80, height: 50 }).format, "Custom");
  const plot = new PlotterEngine({ units: "mm", page: paperSize("A4") });
  plot.line(20, 30, 100, 80);
  const turned = Planner.placePlan(plot.plan(), { x: 10, y: 20 }, 90);
  assert.equal(describePaper(turned.page).orientation, "landscape");
  assert.deepEqual([turned.page.width, turned.page.height], [297, 210]);
}

function testEditsAfterPlanning() {
  const plot = new PlotterEngine();
  plot.line(0, 0, 10, 0);
  plot.optimize({ passes: [] });
  plot.plan({ strategy: "input", drawSpeed: 10, toolChangeDelay: 0 });
  plot.line(0, 1, 10, 1);
  assert.equal(JSON.parse(plot.exportJSON()).stats.paths, 2);
  assert.equal(plot.stats().paths, 2);
  assert.equal(plot.plan().stats.paths, 2);

  // Low-level edits are public API too: returned paths and layers are mutable.
  plot.document.layers[0].paths[0].points[1].x = 20;
  assert.match(plot.exportSVG(), /L20 0/);
  plot.document.layers[0].visible = false;
  assert.equal(plot.stats().paths, 0);
}

function testOptimizationSettingsSurviveEdits() {
  const plot = new PlotterEngine();
  plot.line(0, 0, 10, 0);
  plot.optimize({ passes: [] });
  plot.plan({ drawSpeed: 10, travelSpeed: 20, toolChangeDelay: 0 });
  plot.line(0, 0, 10, 0);
  const plan = JSON.parse(plot.exportJSON());
  assert.equal(plan.stats.paths, 2, "Disabled deduplication must stay disabled");
  assert.equal(plan.options.drawSpeed, 10);
  assert.equal(plan.options.travelSpeed, 20);
}

function testUnits() {
  // Each document describes the same physical 25.4 mm line.
  for (const [units, length] of [["mm", 25.4], ["cm", 2.54], ["in", 1], ["px", 96]]) {
    const plot = new PlotterEngine({ units });
    plot.line(0, 0, length, 0);
    const plan = plot.plan({ drawSpeed: 25.4, acceleration: 0, liftDelay: 0, toolChangeDelay: 0 });
    assert.ok(Math.abs(plan.stats.estimatedSeconds - 1) < 1e-9, units);
    assert.match(plot.exportGCode(), /G1 X25\.4 Y0/, units);
    assert.match(plot.exportHPGL(), /PD0,0,1016,0;/, units);
    assert.equal(plan.stats.drawDistance, length, "Statistics retain document units");
    assert.match(plot.exportSVG(), new RegExp(`width="210${units}"`));
  }
}

function testBacktracking() {
  const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 1, y: 0 }];
  assert.deepEqual(Optimizer.simplifyPath(points, 0.03), points);
  const straight = [{ x: 0, y: 0 }, { x: 0.5, y: 0.01 }, { x: 1, y: 0 }];
  assert.deepEqual(Optimizer.simplifyPath(straight, 0.03), [straight[0], straight[2]]);
  const plot = new PlotterEngine();
  plot.polyline(points);
  assert.equal(plot.plan().stats.drawDistance, 19);
  assert.match(plot.exportSVG(), /M0 0 L10 0 L1 0/);
}

function testEstimateFollowsAcceleration() {
  // The planner's number is the one on the example pages; the driver's is the
  // one in the pen panel. They model the same machine, so they must agree.
  const plot = new PlotterEngine();
  plot.line(0, 0, 100, 0);
  // 100 mm at 40 mm/s, 800 mm/s²: 2 mm of ramps, 2.5 s cruise plus 0.05 s
  // of ramp time, then the pen down and up again, 0.3 s each.
  const plan = plot.plan({ strategy: "input" });
  assert.equal(plan.options.drawSpeed, 40);
  assert.equal(plan.options.travelSpeed, 40);
  assert.ok(Math.abs(plan.stats.estimatedSeconds - (2.5 + 0.05 + 0.6)) < 1e-9, `100 mm line: ${plan.stats.estimatedSeconds}`);
  // A short stroke never reaches cruising speed: a 1 mm line is a triangle,
  // 2 · sqrt(1 / 800) s of motion.
  const short = new PlotterEngine();
  short.line(0, 0, 1, 0);
  const shortPlan = short.plan({ liftDelay: 0 });
  assert.ok(Math.abs(shortPlan.stats.estimatedSeconds - 2 * Math.sqrt(1 / 800)) < 1e-9, `1 mm line: ${shortPlan.stats.estimatedSeconds}`);
  // Without acceleration the old plain sum is still there.
  assert.equal(short.plan({ liftDelay: 0, acceleration: 0 }).stats.estimatedSeconds, 1 / 40);

  // A real drawing: the planner's estimate is within a tenth of the machine
  // time the EBB driver computes from the same plan with the same defaults.
  const drawing = new PlotterEngine({ units: "mm", page: { width: 100, height: 100, margin: 0 } });
  for (let row = 0; row < 12; row += 1) drawing.line(5, 5 + row * 7, 95, 5 + row * 7);
  drawing.circle(50, 50, 30);
  const zigzag = [];
  for (let index = 0; index <= 20; index += 1) zigzag.push({ x: 5 + index * 4.5, y: index % 2 ? 92 : 97 });
  drawing.polyline(zigzag);
  const planned = drawing.plan();
  const machine = Driver.compileEbbPlan(planned, { profile: "idraw-hse-a2" }).stats.durationMs / 1000;
  const ratio = planned.stats.estimatedSeconds / machine;
  assert.ok(ratio > 0.9 && ratio < 1.1, `planner ${planned.stats.estimatedSeconds.toFixed(1)} s, machine ${machine.toFixed(1)} s`);
}

function testPeopleWords() {
  // The words people use are the API too: pen() is tool(), drawRoute() is
  // drawPreview(), "drawn" is "input", penChanges counts what toolChanges counts.
  const plot = new PlotterEngine({ units: "mm", page: { width: 100, height: 100, margin: 0 } });
  const red = plot.pen({ id: "red", name: "Red", color: "#c00" });
  assert.equal(plot.document.tools.find((tool) => tool.id === "red"), red);
  plot.line(0, 0, 10, 0);                 // the default pen
  plot.layer("top", { toolId: "red" });   // from here on, the red one
  plot.line(0, 5, 10, 5);
  const plan = plot.plan({ strategy: "drawn" });
  assert.equal(plan.stats.penChanges, plan.stats.toolChanges);
  assert.equal(plan.stats.penChanges, 2, "two pens, two picks");
  assert.deepEqual(plan.moves.map((m) => m.type), plot.plan({ strategy: "input" }).moves.map((m) => m.type), "drawn is the order you drew, as input was");
  const strokes = [];
  const context = { canvas: { width: 200, height: 200 }, beginPath() {}, moveTo() {}, lineTo() {}, stroke() { strokes.push(1); }, clearRect() {}, fillRect() {}, save() {}, restore() {}, setLineDash() {} };
  plot.drawRoute(context);
  assert.ok(strokes.length > 0, "drawRoute draws");
  assert.equal(Renderer.drawRoute, Renderer.drawPreview);
}

function testBedDrawing() {
  // The bed drawing is part of the library now: pen.js and p5.penplotter both call it.
  const plot = new PlotterEngine({ units: "mm", page: { width: 594, height: 432, margin: 0 } });
  plot.rect(100, 60, 210, 297);
  const strokes = [];
  const context = { canvas: { width: 594, height: 432 }, beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, fill() {}, fillText() {}, translate() {}, rotate() {}, stroke() { strokes.push(1); }, strokeRect() { strokes.push(1); }, clearRect() {}, fillRect() {}, save() {}, restore() {} };
  plot.drawBed(context, { sheet: { x: 100, y: 60, width: 210, height: 297 } });
  assert.ok(strokes.length >= 3, "bed outline, sheet outline and the drawing");
  const turned = Planner.placePlan(plot.plan(), { x: 10, y: 20 }, 90);
  assert.equal(turned.page.width, 432);
  assert.equal(turned.page.height, 594);
}

testPaperSizes();
testEditsAfterPlanning();
testOptimizationSettingsSurviveEdits();
testUnits();
testBacktracking();
testEstimateFollowsAcceleration();
testPeopleWords();
testBedDrawing();
console.log("vanilla.penplotter regressions: ok");
