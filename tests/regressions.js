import assert from "node:assert/strict";
import { PlotterEngine, Optimizer } from "../vanilla.penplotter.js";

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
    const plan = plot.plan({ drawSpeed: 25.4, liftDelay: 0, toolChangeDelay: 0 });
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

testEditsAfterPlanning();
testOptimizationSettingsSurviveEdits();
testUnits();
testBacktracking();
console.log("vanilla.penplotter regressions: ok");
