import assert from "node:assert/strict";
import fs from "node:fs";
import { PlotterEngine } from "../vanilla.penplotter.js";
import {
  EBB_PROFILES,
  EBB_COMPATIBILITY,
  EbbDriver,
  compileEbbPlan,
  createLogTransport,
  createWebSerialTransport,
  mixCoreXY
} from "../src/driver/ebb.js";

const HSE = EBB_PROFILES["idraw-hse-a2"];
const INTERVAL_S = 40e-6; // the EBB motion ISR runs at 25 kHz
const RATE_PER_HZ = 2 ** 31 * INTERVAL_S; // LM rate units per step/s (≈ 85 899.35)

function motionCommands(compiled) {
  return compiled.commands.filter((entry) => /^(SM|LM),/.test(entry.cmd));
}

// One view on both command styles: steps per axis and the step rate (steps/s)
// of each axis at the start and the end of the command.
function describeMove(entry) {
  const parts = entry.cmd.split(",");
  if (parts[0] === "SM") {
    const [ms, a1, a2] = parts.slice(1).map(Number);
    const rate = (steps) => Math.abs(steps) / (ms / 1000);
    return { steps: [a1, a2], start: [rate(a1), rate(a2)], end: [rate(a1), rate(a2)], ms };
  }
  const [rate1, steps1, accel1, rate2, steps2, accel2] = parts.slice(1).map(Number);
  const intervals = Math.round(entry.durationMs / 1000 / INTERVAL_S);
  const hz = (rate) => rate / RATE_PER_HZ;
  const end = (rate, accel, steps) => (steps === 0 ? 0 : hz(rate + accel * intervals));
  return {
    steps: [steps1, steps2],
    start: [steps1 === 0 ? 0 : hz(rate1), steps2 === 0 ? 0 : hz(rate2)],
    end: [end(rate1, accel1, steps1), end(rate2, accel2, steps2)],
    ms: entry.durationMs
  };
}

function stepTotals(entries) {
  return entries.reduce((acc, entry) => {
    const { steps } = describeMove(entry);
    return [acc[0] + steps[0], acc[1] + steps[1]];
  }, [0, 0]);
}

// The motion commands between two consecutive pen commands: one stroke.
function strokes(compiled) {
  const result = [];
  let current = null;
  for (const entry of compiled.commands) {
    if (entry.kind === "pen-up" || entry.kind === "pen-down") {
      current = [];
      result.push(current);
    } else if (/^(SM|LM),/.test(entry.cmd) && current) current.push(entry);
  }
  return result.filter((stroke) => stroke.length > 0);
}

function planOf(build, page = { width: 594, height: 432 }) {
  const plot = new PlotterEngine({ units: "mm", page });
  build(plot);
  return plot.plan({ strategy: "input" });
}

// Measured on the physical iDraw HSE/A2 on 2026-09-21: equal steps on both
// motors draw along X, opposite steps draw along Y, one motor alone draws a
// diagonal. 1200 steps on both motors is 15 mm.
function testCoreXYMixing() {
  assert.deepEqual(mixCoreXY(15, 0, 80), { a1: 1200, a2: 1200 });
  assert.deepEqual(mixCoreXY(0, 10, 80), { a1: 800, a2: -800 });
  assert.deepEqual(mixCoreXY(10, 10, 80), { a1: 1600, a2: 0 });
  assert.equal(HSE.stepsPerMm, 80);
  assert.deepEqual(HSE.travel, { width: 594, height: 432 });
}

function testCompileSequence() {
  const plan = planOf((plot) => plot.line(10, 10, 25, 10));
  const compiled = compileEbbPlan(plan, { profile: HSE });
  const cmds = compiled.commands.map((entry) => entry.cmd);
  assert.equal(cmds[0], "EM,1,1");
  assert.match(cmds[1], /^SP,1,\d+$/, "pen goes up before any motion");
  assert.equal(cmds[cmds.length - 1], "EM,0,0");

  const firstMove = cmds.findIndex((cmd) => /^(SM|LM),/.test(cmd));
  const penDown = cmds.findIndex((cmd) => cmd.startsWith("SP,0"));
  assert.ok(firstMove > 1 && penDown > firstMove, "travel happens pen-up, then pen-down");

  const [travel, draw] = strokes(compiled);
  assert.deepEqual(stepTotals(travel), [1600, 0], "travel to (10,10) is one motor alone");
  assert.deepEqual(stepTotals(draw), [1200, 1200], "15 mm along X is 1200 steps on both motors");
  const lastUp = cmds.lastIndexOf(cmds.filter((cmd) => cmd.startsWith("SP,1")).pop());
  assert.ok(lastUp > penDown);
  assert.deepEqual(stepTotals(motionCommands(compiled)), [0, 0], "step totals return to the origin");
  for (const entry of motionCommands(compiled)) {
    if (entry.kind === "travel") assert.match(entry.cmd, /^SM,\d+,-?\d+,-?\d+$/);
    else assert.match(entry.cmd, /^LM,\d+,-?\d+,-?\d+,\d+,-?\d+,-?\d+,3$/, "LM with positive rates, signed steps, cleared accumulators");
  }
}

// Every stroke starts from rest, ramps up, cruises at the chosen speed, and
// ramps down to rest again; consecutive commands hand over the speed
// without a jump. This is what the machine was missing: it used to go from
// zero to full speed in one step and back, on every segment.
function testAccelerationProfile() {
  const plan = planOf((plot) => plot.line(10, 10, 210, 10));
  const compiled = compileEbbPlan(plan, { profile: HSE, drawSpeed: 40, acceleration: 800 });
  const [, draw] = strokes(compiled);
  const moves = draw.map(describeMove);
  assert.ok(moves.length >= 3, "a long line has an acceleration, a cruise and a deceleration phase");
  const cruiseHz = 40 * HSE.stepsPerMm; // along X both motors run at the same rate
  const floorHz = HSE.minSpeed * HSE.stepsPerMm; // never exactly zero, see testNoDwellAtRest
  assert.ok(moves[0].start[0] <= floorHz * 1.05, `starts at the floor, not at ${moves[0].start[0]} steps/s`);
  assert.ok(moves[moves.length - 1].end[0] <= floorHz * 1.05, "ends at the floor");
  const peak = Math.max(...moves.map((move) => Math.max(...move.start, ...move.end)));
  assert.ok(peak <= cruiseHz * 1.01 && peak >= cruiseHz * 0.99, `cruises at the draw speed (${peak} steps/s)`);
  for (let index = 1; index < moves.length; index += 1) {
    for (const axis of [0, 1]) {
      const handover = Math.abs(moves[index].start[axis] - moves[index - 1].end[axis]);
      assert.ok(handover <= cruiseHz * 0.02, `no speed jump between commands (${handover} steps/s on axis ${axis + 1})`);
    }
  }
  // 1 mm to accelerate, 1 mm to brake, 198 mm at 40 mm/s: about 5.05 s.
  const drawMs = draw.reduce((sum, entry) => sum + entry.durationMs, 0);
  assert.ok(Math.abs(drawMs - 5050) < 100, `draw time ${drawMs} ms`);

  // Bends of about 25° are allowed through at just under the cruise speed.
  // The ramp from 39.9 to 40 mm/s would be a command of a few ticks; it is
  // folded into its neighbour instead. The board parses a command in a few
  // milliseconds, so every command on a long segment has to last longer.
  const zigzag = [{ x: 20, y: 100 }];
  for (let index = 1; index <= 12; index += 1) {
    zigzag.push({ x: 20 + index * 18, y: 100 + (index % 2 ? 8.5 : 0) });
  }
  const bends = compileEbbPlan(planOf((plot) => plot.polyline(zigzag)), { profile: HSE, drawSpeed: 40, acceleration: 800 });
  for (const entry of strokes(bends)[1]) assert.ok(entry.durationMs >= 4, `no micro command: ${entry.cmd} lasts ${entry.durationMs} ms`);
}

// A reversal brings the pen to a halt at the vertex; a straight continuation
// does not slow down at all; a gentle bend keeps most of the speed.
function testCornering() {
  const speedAtVertex = (points, segmentsBefore = 1) => {
    const plan = planOf((plot) => plot.polyline(points));
    const compiled = compileEbbPlan(plan, { profile: HSE, drawSpeed: 40, acceleration: 800 });
    const [, draw] = strokes(compiled);
    // Walk the commands until the steps reach the vertex, then read its speed.
    // All vertices here lie on a stretch along X, where both motors run at
    // the same rate; a straight continuation may be crossed mid-command.
    const vertex = mixCoreXY(points[segmentsBefore].x, points[segmentsBefore].y, HSE.stepsPerMm);
    const origin = mixCoreXY(points[0].x, points[0].y, HSE.stepsPerMm);
    let a1 = origin.a1;
    let a2 = origin.a2;
    const mmPerS = (hz) => hz / HSE.stepsPerMm;
    for (const entry of draw) {
      const move = describeMove(entry);
      const before = [a1, a2];
      a1 += move.steps[0];
      a2 += move.steps[1];
      if (a1 === vertex.a1 && a2 === vertex.a2) return mmPerS(move.end[0]);
      const inside = (axis, value) => (value - before[axis]) * (value - [a1, a2][axis]) < 0;
      if (inside(0, vertex.a1) && inside(1, vertex.a2)) return mmPerS((move.start[0] + move.end[0]) / 2);
    }
    throw new Error("no command reaches the vertex");
  };
  const reversal = speedAtVertex([{ x: 10, y: 10 }, { x: 60, y: 10 }, { x: 10, y: 10 }]);
  assert.ok(reversal <= HSE.minSpeed * 1.05, `a reversal drops to the floor at the vertex (${reversal} mm/s)`);
  const straight = speedAtVertex([{ x: 10, y: 10 }, { x: 60, y: 10 }, { x: 110, y: 10 }]);
  assert.ok(straight > 39, `a straight continuation keeps the draw speed (${straight} mm/s)`);
  const bend = speedAtVertex([{ x: 10, y: 10 }, { x: 60, y: 10 }, { x: 110, y: 60 }]);
  assert.ok(bend > 15 && bend < 30, `a 45° bend slows a little (${bend} mm/s)`);
  const square = speedAtVertex([{ x: 10, y: 10 }, { x: 60, y: 10 }, { x: 60, y: 60 }]);
  assert.ok(square > 2 && square < 15, `a right angle slows down hard (${square} mm/s)`);
}

function testNoRoundingDrift() {
  const points = [];
  for (let i = 0; i <= 300; i += 1) points.push({ x: 20 + i * 0.3137, y: 50 + Math.sin(i / 9) * 7.77 });
  const plan = planOf((plot) => plot.polyline(points));
  const last = points[points.length - 1];
  const target = [Math.round((last.x + last.y) * 80), Math.round((last.x - last.y) * 80)];
  for (const commandSet of ["LM", "SM"]) {
    const compiled = compileEbbPlan(plan, { profile: HSE, returnHome: false, commandSet });
    assert.deepEqual(stepTotals(motionCommands(compiled)), target, `${commandSet}: ends exactly on the last point`);
  }
}

function testStepRateLimits() {
  const plan = planOf((plot) => plot.line(0, 0, 400, 0));
  const fast = compileEbbPlan(plan, { profile: HSE, drawSpeed: 100000, travelSpeed: 100000, acceleration: 1e6, travelAcceleration: 1e6 });
  for (const entry of motionCommands(fast)) {
    const move = describeMove(entry);
    for (const hz of [...move.start, ...move.end]) assert.ok(hz <= HSE.maxStepRate * 1000 * 1.001, "never above the EBB step-rate limit");
  }
  // A nearly diagonal line gives motor 2 a step rate far below motor 1. The
  // low-level move has no minimum, so every step is sent as it comes.
  const slowPlan = planOf((plot) => plot.line(0, 0, 100, 99.99));
  const slow = compileEbbPlan(slowPlan, { profile: HSE, drawSpeed: 5, returnHome: false });
  assert.deepEqual(stepTotals(motionCommands(slow)), [Math.round(199.99 * 80), Math.round(0.01 * 80)]);
  // With plain SM commands the firmware does enforce a minimum; the slices
  // are short enough that a single step never falls below it.
  const sliced = compileEbbPlan(slowPlan, { profile: HSE, drawSpeed: 5, returnHome: false, commandSet: "SM" });
  for (const entry of motionCommands(sliced)) {
    const [ms, a1, a2] = entry.cmd.split(",").slice(1).map(Number);
    for (const steps of [a1, a2]) {
      if (steps !== 0) assert.ok(Math.abs(steps) / (ms / 1000) >= HSE.minStepRate);
    }
  }
}

// Firmware older than 2.7 has no LM: the same profile is cut into short
// constant-speed SM slices instead, so the ramps survive as a staircase.
function testSmFallback() {
  const plan = planOf((plot) => plot.line(10, 10, 210, 10));
  const compiled = compileEbbPlan(plan, { profile: HSE, drawSpeed: 40, acceleration: 800, commandSet: "SM" });
  const moves = motionCommands(compiled);
  assert.ok(moves.length > 0 && moves.every((entry) => entry.cmd.startsWith("SM,")));
  for (const entry of moves) assert.ok(describeMove(entry).ms <= 30, "slices stay short");
  const [, draw] = strokes(compiled);
  const rates = draw.map((entry) => describeMove(entry).start[0]);
  assert.ok(rates[0] < 40 * 80 * 0.3, "the first slice is slow");
  assert.ok(Math.max(...rates) > 40 * 80 * 0.98, "the middle slices cruise");
  assert.ok(rates[rates.length - 1] < 40 * 80 * 0.3, "the last slice is slow");
  assert.deepEqual(stepTotals(moves), [0, 0]);
}

function testBoundsAndUnits() {
  const outside = planOf((plot) => plot.line(10, 10, 600, 10), { width: 700, height: 432 });
  assert.throws(() => compileEbbPlan(outside, { profile: HSE }), /outside the machine travel/);
  const negative = planOf((plot) => plot.line(-1, 10, 20, 10));
  assert.throws(() => compileEbbPlan(negative, { profile: HSE }), /outside the machine travel/);

  const plot = new PlotterEngine({ units: "px", page: { width: 500, height: 400 } });
  plot.line(10, 10, 20, 10);
  assert.throws(() => compileEbbPlan(plot.plan(), { profile: HSE }), /physical units/);

  const cm = new PlotterEngine({ units: "cm", page: { width: 59, height: 43 } });
  cm.line(0, 0, 1.5, 0);
  const compiled = compileEbbPlan(cm.plan({ strategy: "input" }), { profile: HSE, returnHome: false });
  assert.deepEqual(stepTotals(motionCommands(compiled)), [1200, 1200]);
}

// The speeds a sketch planned with are the speeds the machine gets, unless
// the caller says otherwise; the profile only fills the gaps.
function testSpeedsFollowThePlan() {
  const plot = new PlotterEngine({ units: "mm", page: { width: 594, height: 432 } });
  plot.line(10, 10, 210, 10);
  const planned = compileEbbPlan(plot.plan({ strategy: "input", drawSpeed: 20 }), { profile: HSE });
  const defaults = compileEbbPlan(plot.plan({ strategy: "input" }), { profile: HSE });
  const overridden = compileEbbPlan(plot.plan({ strategy: "input", drawSpeed: 20 }), { profile: HSE, drawSpeed: 80 });
  const drawingMs = (compiled) => compiled.commands
    .filter((entry) => entry.kind === "draw")
    .reduce((sum, entry) => sum + entry.durationMs, 0);
  assert.ok(drawingMs(planned) > drawingMs(defaults) * 1.5, "a slower plan takes longer to draw");
  assert.ok(overridden.stats.durationMs < planned.stats.durationMs, "an explicit option wins over the plan");
}

async function testDriverRun() {
  const plan = planOf((plot) => {
    plot.line(10, 10, 25, 10);
    plot.line(10, 20, 25, 20);
  });
  const transport = createLogTransport();
  const driver = new EbbDriver({ transport, profile: HSE });

  await assert.rejects(() => driver.run(plan), /confirmed: true/);
  assert.equal(transport.log.length, 0, "nothing is sent without confirmation");

  const progress = [];
  const result = await driver.run(plan, { confirmed: true, onProgress: (index, total) => progress.push([index, total]) });
  assert.equal(result.status, "complete");
  assert.equal(transport.log[0], "V");
  assert.equal(transport.log[transport.log.length - 1], "EM,0,0");
  assert.equal(progress.length, result.commands);

  // Firmware 3.x: ask for the largest motion FIFO and use it, so the host
  // never has to race the machine command by command.
  const firstMotion = transport.log.findIndex((cmd) => cmd.startsWith("LM,"));
  assert.ok(transport.log.indexOf("QU,2") < firstMotion, "asks the maximum FIFO depth first");
  assert.ok(transport.log.indexOf("CU,4,32") < firstMotion, "sets the FIFO depth before the first move");

  const wrong = new EbbDriver({ transport: createLogTransport({ version: "Grbl 1.1h" }), profile: HSE });
  await assert.rejects(() => wrong.run(plan, { confirmed: true }), /not an EBB/);
}

// An older EBB (before 2.7.0) has neither LM nor a configurable FIFO: the
// driver recompiles the plan into SM slices and skips the FIFO commands.
async function testOldFirmware() {
  const plan = planOf((plot) => plot.line(10, 10, 60, 10));
  const transport = createLogTransport({ version: "EBBv13_and_above EB Firmware Version 2.5.1" });
  const driver = new EbbDriver({ transport, profile: HSE });
  const result = await driver.run(plan, { confirmed: true });
  assert.equal(result.status, "complete");
  assert.ok(transport.log.some((cmd) => cmd.startsWith("SM,")), "falls back to SM");
  assert.ok(!transport.log.some((cmd) => cmd.startsWith("LM,") || cmd.startsWith("QU,") || cmd.startsWith("CU,4")));

  const precompiled = compileEbbPlan(plan, { profile: HSE });
  const again = new EbbDriver({ transport: createLogTransport({ version: "EBBv13_and_above EB Firmware Version 2.5.1" }), profile: HSE });
  await assert.rejects(() => again.run(precompiled, { confirmed: true }), /2\.7/);
}

async function testAbortRaisesPen() {
  const plan = planOf((plot) => {
    for (let i = 0; i < 20; i += 1) plot.line(10, 10 + i * 5, 60, 10 + i * 5);
  });
  const transport = createLogTransport();
  const driver = new EbbDriver({ transport, profile: HSE });
  const result = await driver.run(plan, {
    confirmed: true,
    onProgress: (index) => { if (index === 12) driver.abort(); }
  });
  assert.equal(result.status, "aborted");
  assert.deepEqual(transport.log.slice(-3), ["ES", "SP,1", "EM,0,0"]);
}

async function testErrorReplyStopsSafely() {
  const plan = planOf((plot) => plot.line(10, 10, 25, 10));
  const transport = createLogTransport({ failOn: (cmd) => cmd.startsWith("LM,") ? "!8 Err: LM bad" : null });
  const driver = new EbbDriver({ transport, profile: HSE });
  await assert.rejects(() => driver.run(plan, { confirmed: true }), /LM bad/);
  assert.deepEqual(transport.log.slice(-3), ["ES", "SP,1", "EM,0,0"]);
}

// A pen change waits until the machine has really finished, not until the
// last command was merely queued: with a deep FIFO those are far apart.
async function testToolChangeWaitsForIdle() {
  const plan = (() => {
    const plot = new PlotterEngine({
      units: "mm",
      page: { width: 594, height: 432 },
      tools: [{ id: "black", name: "black" }, { id: "red", name: "red" }]
    });
    plot.layer("a", { toolId: "black" });
    plot.line(10, 10, 60, 10);
    plot.layer("b", { toolId: "red" });
    plot.line(10, 20, 60, 20);
    return plot.plan({ strategy: "input" });
  })();
  const transport = createLogTransport();
  const driver = new EbbDriver({ transport, profile: HSE });
  let changed = 0;
  await driver.run(plan, { confirmed: true, onToolChange: () => { changed += 1; } });
  assert.equal(changed, 1);
  const compiled = compileEbbPlan(plan, { profile: HSE });
  const change = compiled.commands.findIndex((entry) => entry.kind === "tool-change");
  assert.equal(compiled.commands[change - 1].kind, "wait-idle", "the plot waits for the pen to be up and still before the change");
}

// A real consumer of the Web Serial contract: a fake port built from the same
// WHATWG streams a browser hands out, answering like the EBB did on 2026-09-21
// (V and QM reply without OK, everything else ends in OK).
async function testWebSerialTransport() {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const written = [];
  let push;
  const port = {
    readable: new ReadableStream({ start(controller) { push = (text) => controller.enqueue(encoder.encode(text)); } }),
    writable: new WritableStream({
      write(chunk) {
        const cmd = decoder.decode(chunk).trim();
        written.push(cmd);
        if (cmd === "V") push("EBBv13_and_above EB Firmware Version 3.0.2\r\n");
        else if (cmd === "QS") { push("1500,"); setTimeout(() => push("1000\n\rOK\r\n"), 5); }
        else if (cmd === "QU,2") push("QU,2,32\r\nOK\r\n");
        else push("OK\r\n");
      }
    }),
    async close() {}
  };
  const transport = createWebSerialTransport(port);
  await transport.open();
  assert.match(await transport.send("V"), /EBB/);
  assert.equal(await transport.send("QS"), "1500,1000");
  assert.equal(await transport.send("QU,2"), "QU,2,32");
  assert.equal(await transport.send("SP,1,300"), "");
  assert.deepEqual(written, ["V", "QS", "QU,2", "SP,1,300"]);
  // Replies are picked up the moment they arrive, not on a polling timer:
  // two hundred acknowledged commands take milliseconds, not a second.
  const started = performance.now();
  for (let i = 0; i < 200; i += 1) await transport.send("LM,0,1,100,0,0,0,3");
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 150, `200 round trips took ${elapsed.toFixed(0)} ms`);
  await transport.close();
}

// A circle drawn as 360 chords of 0.2 mm would be 360 commands of 5 ms: the
// board cannot parse them that fast and the pen stutters. Chords that stay
// within two steps of a straight line are merged before planning.
function testMicroSegmentsMerge() {
  const circle = [];
  for (let degree = 0; degree <= 360; degree += 1) {
    const angle = (degree / 180) * Math.PI;
    circle.push({ x: 100 + 12 * Math.cos(angle), y: 100 + 12 * Math.sin(angle) });
  }
  const plan = planOf((plot) => plot.polyline(circle));
  const merged = compileEbbPlan(plan, { profile: HSE, drawSpeed: 40 });
  const [, draw] = strokes(merged);
  assert.ok(draw.length <= 90, `360 chords become few commands (${draw.length})`);
  const durations = draw.map((entry) => entry.durationMs).sort((a, b) => a - b);
  assert.ok(durations[Math.floor(durations.length / 2)] >= 20, `the typical command is long (median ${durations[Math.floor(durations.length / 2)]} ms)`);
  assert.ok(durations.filter((ms) => ms < 10).length <= 3, "at most a few short leftovers at the seams");
  assert.deepEqual(stepTotals(draw), [0, 0], "the circle closes exactly where it started");
  // The engine already simplifies when it plans; the compiler's own pass is
  // for plans that come in raw. Both off: every chord is a command.
  const rawPlan = planOf((plot) => { plot.polyline(circle); plot.optimize({ passes: [] }); });
  const raw = compileEbbPlan(rawPlan, { profile: HSE, drawSpeed: 40, simplifyTolerance: 0 });
  assert.ok(strokes(raw)[1].length >= 300, `with the tolerances off the geometry is left alone (${strokes(raw)[1].length})`);
  const compiled = compileEbbPlan(rawPlan, { profile: HSE, drawSpeed: 40 });
  assert.ok(strokes(compiled)[1].length <= 90, `the compiler merges a raw circle too (${strokes(compiled)[1].length})`);
}

// The firmware's own arithmetic, tick by tick: an LM must take its last step
// no later than its nominal duration. A phase that aimed at exactly zero speed
// could leave the final step hanging for as long as rounding pleased, and the
// pen sat on the paper.
function ticksToFinish(rate, steps, accel, intervals) {
  if (steps === 0) return 0;
  let current = rate - Math.trunc(accel / 2);
  let accumulator = 0;
  let taken = 0;
  for (let tick = 1; tick <= intervals * 4 + 1000; tick += 1) {
    current += accel;
    accumulator += current;
    if (accumulator >= 2 ** 31) {
      accumulator -= 2 ** 31;
      taken += 1;
      if (taken === Math.abs(steps)) return tick;
    }
  }
  return Infinity;
}

function testNoDwellAtRest() {
  const plan = planOf((plot) => {
    plot.polyline([{ x: 10, y: 10 }, { x: 60, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 60 }, { x: 10.3, y: 60.2 }]);
  });
  const compiled = compileEbbPlan(plan, { profile: HSE, drawSpeed: 40, acceleration: 800 });
  const floorHz = HSE.minSpeed * HSE.stepsPerMm;
  for (const entry of motionCommands(compiled)) {
    if (!entry.cmd.startsWith("LM,")) continue; // SM has an explicit duration, not rate/acceleration fields
    const [rate1, steps1, accel1, rate2, steps2, accel2] = entry.cmd.split(",").slice(1).map(Number);
    const intervals = Math.round(entry.durationMs / 1000 / INTERVAL_S);
    for (const [rate, steps, accel] of [[rate1, steps1, accel1], [rate2, steps2, accel2]]) {
      const ticks = ticksToFinish(rate, steps, accel, intervals);
      assert.ok(ticks <= intervals + 2, `${entry.cmd}: an axis finishes ${ticks - intervals} ticks late`);
    }
    // The floor is a pen speed: on CoreXY the faster motor runs at least
    // |vx| + |vy| times the resolution, so it is the one to check.
    const endHz = Math.max(steps1 === 0 ? 0 : rate1 + accel1 * intervals, steps2 === 0 ? 0 : rate2 + accel2 * intervals) / RATE_PER_HZ;
    assert.ok(endHz >= floorHz * 0.8, `${entry.cmd}: never slower than the floor (${endHz} steps/s)`);
  }
}

// Commands go out ahead of their acknowledgements: a plot of short moves is
// not paced by the USB round trip. A transport that answers 5 ms late would
// otherwise stretch 60 one-millisecond moves to 300 ms.
async function testPipelinedSends() {
  const plan = planOf((plot) => {
    const points = [];
    for (let i = 0; i <= 60; i += 1) points.push({ x: 20 + i * 0.3, y: 20 + (i % 2) * 0.3 });
    plot.polyline(points);
  });
  const log = [];
  const slow = {
    log,
    async open() {},
    async close() {},
    send(cmd) {
      log.push(cmd);
      return new Promise((resolve) => setTimeout(() => resolve(cmd === "V" ? "EBBv13_and_above EB Firmware Version 3.0.2" : cmd === "QM" ? "QM,0,0,0,0" : cmd === "QU,2" ? "QU,2,32" : ""), 5));
    }
  };
  const compiled = compileEbbPlan(plan, { profile: HSE, simplifyTolerance: 0, drawSpeed: 60 });
  const count = motionCommands(compiled).length;
  assert.ok(count >= 40, `enough short moves to matter (${count})`);
  const started = performance.now();
  const result = await new EbbDriver({ transport: slow, profile: HSE }).run(compiled, { confirmed: true });
  const elapsed = performance.now() - started;
  assert.equal(result.status, "complete");
  assert.ok(elapsed < count * 5 * 0.5, `${count} commands acknowledged 5 ms late took ${elapsed.toFixed(0)} ms`);
  assert.equal(log[log.length - 1], "EM,0,0");
  // A dwell command or a pen change still waits for the machine to be idle
  // before the plot goes on, and the stop sequence still ends the log.
  const transport = createLogTransport();
  const driver = new EbbDriver({ transport, profile: HSE });
  await driver.run(compiled, { confirmed: true, onProgress: (index) => { if (index === 10) driver.abort(); } });
  assert.deepEqual(transport.log.slice(-3), ["ES", "SP,1", "EM,0,0"]);
}

// The transport itself keeps several commands in flight and hands each reply
// to the right caller, in order, even when a reply arrives in pieces.
async function testTransportInFlight() {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const written = [];
  let push;
  const port = {
    readable: new ReadableStream({ start(controller) { push = (text) => controller.enqueue(encoder.encode(text)); } }),
    writable: new WritableStream({ write(chunk) { written.push(decoder.decode(chunk).trim()); } }),
    async close() {}
  };
  const transport = createWebSerialTransport(port);
  await transport.open();
  const first = transport.send("QS");
  const second = transport.send("SP,1,300");
  const third = transport.send("QM");
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(written, ["QS", "SP,1,300", "QM"], "all three were written before any reply");
  push("1500,");
  push("1000\n\rOK\r\nOK\r\nQM,0,0,0,0\n\r");
  assert.equal(await first, "1500,1000");
  assert.equal(await second, "");
  assert.equal(await third, "QM,0,0,0,0");
  const bad = transport.send("LM,0,0,0,0,0,0,3");
  push("!8 Err: no motion\r\n");
  assert.match(await bad, /^!8 Err: no motion$/, "an error line is the reply; the driver turns it into a stop");
  await transport.close();
}

// A plot that was cut short can go on where it stopped: the compiled list
// says which pen-up completes which stroke, and a compile can skip the
// strokes already on paper. The carriage is parked at home again by hand, so
// the first travel goes from home to the first stroke that is still to do.
function testResumeSkipsStrokes() {
  const plan = planOf((plot) => {
    plot.line(10, 10, 60, 10);
    plot.line(10, 20, 60, 20);
    plot.line(30, 40, 80, 40);
  });
  const full = compileEbbPlan(plan, { profile: HSE });
  assert.equal(full.draws, 3);
  const completes = full.commands.filter((entry) => entry.completes !== undefined).map((entry) => [entry.kind, entry.completes]);
  assert.deepEqual(completes, [["pen-up", 0], ["pen-up", 1], ["pen-up", 2]], "each pen-up after a stroke says which stroke it completes");

  const resumed = compileEbbPlan(plan, { profile: HSE, skipDraws: 2 });
  assert.equal(resumed.draws, 3, "still counts against the whole drawing");
  assert.equal(resumed.stats.penDowns, 1);
  const [travel, draw] = strokes(resumed);
  assert.deepEqual(stepTotals(travel), [mixCoreXY(30, 40, 80).a1, mixCoreXY(30, 40, 80).a2], "home to the third line");
  assert.deepEqual(stepTotals(draw), [4000, 4000], "the third line itself");
  assert.deepEqual(stepTotals(motionCommands(resumed)), [0, 0]);
  assert.equal(resumed.commands.find((entry) => entry.completes !== undefined).completes, 2);

  const nothingLeft = compileEbbPlan(plan, { profile: HSE, skipDraws: 3 });
  assert.equal(nothingLeft.stats.penDowns, 0);
  assert.equal(motionCommands(nothingLeft).length, 0, "nothing to draw, nothing to move");
}

// When the page goes away mid-plot there is no time for replies: one write
// with stop, pen up, motors off, then the transport is dead.
async function testEmergencyStop() {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const written = [];
  const port = {
    readable: new ReadableStream({ start() {} }),
    writable: new WritableStream({ write(chunk) { written.push(decoder.decode(chunk)); } }),
    async close() {}
  };
  const transport = createWebSerialTransport(port);
  await transport.open();
  const hanging = transport.send("LM,0,80,219902,0,80,219902,3");
  await transport.stop();
  assert.equal(written[written.length - 1], "ES\rSP,1\rEM,0,0\r");
  await assert.rejects(hanging, /stopped/);
  await assert.rejects(() => transport.send("QM"), /Open the transport/);
  void encoder;

  const log = createLogTransport();
  const driver = new EbbDriver({ transport: log, profile: HSE });
  await driver.emergencyStop();
  assert.deepEqual(log.log, ["ES", "SP,1", "EM,0,0"]);
}

// The pen panel places the sheet on the bed: moved by the offsets and turned
// by a quarter turn or more, as a rotation (never a mirror) that keeps every
// point inside the turned sheet. The machine's X runs along the long rail, so
// this is how a portrait drawing gets to lie portrait on a portrait sheet.
async function testPlacePlanOnTheBed() {
  const { placePlan } = await import("../examples/pen.js");
  const plot = new PlotterEngine({ units: "mm", page: { width: 210, height: 297, margin: 0 } });
  plot.line(0, 0, 210, 0); // the top edge, left to right
  plot.line(10, 20, 30, 20); // a short line near the top left
  const plan = plot.plan({ strategy: "input" });
  const lines = (placed) => placed.moves.filter((m) => m.type === "draw").map((m) => m.points.map((p) => [Math.round(p.x), Math.round(p.y)]));

  const flat = placePlan(plan, { x: 100, y: 60 }, 0);
  assert.deepEqual(lines(flat)[0], [[100, 60], [310, 60]]);
  assert.deepEqual([flat.page.width, flat.page.height], [210, 297]);

  const turned = placePlan(plan, { x: 100, y: 60 }, 90);
  assert.deepEqual([turned.page.width, turned.page.height], [297, 210], "a portrait sheet lies sideways");
  assert.deepEqual(lines(turned)[0], [[397, 60], [397, 270]], "the top edge now runs down the right side");
  assert.deepEqual(lines(turned)[1], [[377, 70], [377, 90]], "the short line turns with it, no mirror");
  for (const placed of [flat, turned, placePlan(plan, { x: 0, y: 0 }, 180), placePlan(plan, { x: 0, y: 0 }, 270)]) {
    for (const move of placed.moves.filter((m) => m.type === "draw")) {
      for (const p of move.points) {
        assert.ok(p.x >= -1e-9 && p.y >= -1e-9 && p.x <= 600 && p.y <= 600, "inside the bed");
      }
    }
  }
  assert.throws(() => placePlan(plan, { x: 0, y: 0 }, 45), /0, 90, 180 or 270/);
}

// The driver is public API: every documentation layer has to name it.
function testDocumentationNamesTheDriver() {
  const root = new URL("../", import.meta.url);
  for (const file of ["README.md", "docs/guide.html", "docs/architecture.md", "docs/vanilla.penplotter.manifest.json"]) {
    assert.match(fs.readFileSync(new URL(file, root), "utf8"), /EbbDriver/, file + " does not mention EbbDriver");
  }
}

function testGentleDefaultTravel() {
  // The p5 quick-start drawing: departure and return must use the same
  // gentle pen-up defaults without requiring options in the sketch.
  const plan = planOf((plot) => {
    plot.rect(82, 152, 76, 46);
    plot.line(86, 175, 154, 175);
  });
  const compiled = compileEbbPlan(plan);
  assert.equal(plan.options.travelSpeed, 40);
  assert.equal(plan.options.travelAcceleration, 300);
  assert.equal(compiled.settings.travelSpeed, 40);
  assert.equal(compiled.settings.travelAcceleration, 300);
  assert.equal(compiled.settings.drawSpeed, 40);
  assert.equal(compiled.settings.acceleration, 800);
  assert.ok(compiled.commands.filter((entry) => entry.kind === "travel").every((entry) => entry.cmd.startsWith("SM,")), "pen-up travel uses SM");
  assert.ok(compiled.commands.filter((entry) => entry.kind === "draw").every((entry) => entry.cmd.startsWith("LM,")), "drawing keeps LM");
  assert.deepEqual(stepTotals(motionCommands(compiled)), [0, 0], "return ends at the exact starting step position");
  const fallback = compileEbbPlan({ ...plan, options: {} });
  assert.equal(fallback.settings.travelSpeed, 40);
  assert.equal(fallback.settings.travelAcceleration, 300);
  const custom = compileEbbPlan(plan, { travelSpeed: 60, travelAcceleration: 500 });
  assert.equal(custom.settings.travelSpeed, 60);
  assert.equal(custom.settings.travelAcceleration, 500);
}

async function testModelPenSetup() {
  const plan = planOf((plot) => plot.line(10, 10, 25, 10));
  const defaults = compileEbbPlan(plan);
  assert.ok(!defaults.commands.some((entry) => entry.cmd.startsWith("SC,")), "existing pen calibration is preserved unless requested");
  const configured = compileEbbPlan(plan, { penLift: { up: 60, down: 30, raiseRate: 75, lowerRate: 50 } });
  assert.deepEqual(configured.commands.slice(0, 4).map((entry) => entry.cmd), ["SC,4,20641", "SC,5,15248", "SC,11,1618", "SC,12,1079"]);
  assert.equal(configured.commands[4].cmd, "EM,1,1");
  for (const value of [-1, 101, NaN, Infinity]) {
    assert.throws(() => compileEbbPlan(plan, { penLift: { up: value } }), /between 0 and 100/);
  }
  assert.throws(() => compileEbbPlan(plan, { penLift: true }), /penLift must be an object/);
  assert.throws(() => compileEbbPlan(plan, { penLift: { raiseRate: 0 } }), /between 1 and 100/);
  assert.throws(() => compileEbbPlan(plan, { penLift: { down: null } }), /between 0 and 100/);
  assert.equal(HSE.manufacturerDefaults.stepsPerMm, HSE.stepsPerMm);
  assert.equal(EBB_COMPATIBILITY.filter((entry) => entry.status === "tested").length, 1);
  assert.ok(EBB_COMPATIBILITY.every((entry) => entry.source.startsWith("https://")));
  const transport = createLogTransport();
  await new EbbDriver({ transport }).run(plan, {
    confirmed: true,
    penLift: { up: 60, down: 30, raiseRate: 75, lowerRate: 50 }
  });
  assert.ok(transport.log.indexOf("SC,4,20641") < transport.log.indexOf("SP,1,300"));
  const invalid = createLogTransport();
  await assert.rejects(() => new EbbDriver({ transport: invalid }).run(plan, {
    confirmed: true, penLift: { up: 101 }
  }), /between 0 and 100/);
  assert.deepEqual(invalid.log, ["V"], "invalid pen calibration sends no setup or movement commands");
}

async function testPersistentSession() {
  for (const version of ["EBB Firmware Version 3.0.2", "EBB Firmware Version 2.6.0"]) {
    const transport = createLogTransport({ version });
    const driver = new EbbDriver({ transport });
    let retained;
    const result = await driver.session(async session => {
      retained = session;
      for (let i = 0; i < 100; i++) {
        const x = 100 + i * 0.017;
        const y = 100 + i * 0.023;
        const plan = planOf(plot => plot.line(x, y, x + 0.137, y + 0.119));
        await session.run(plan);
        const commands = transport.log.filter(cmd => /^(SM|LM),/.test(cmd)).map(cmd => ({ cmd, durationMs: 0 }));
        const target = mixCoreXY(x + 0.137, y + 0.119, 80);
        assert.deepEqual(stepTotals(commands), [target.a1 || 0, target.a2 || 0], "each job ends at its absolute step target");
        assert.deepEqual(session.position, { x: x + 0.137, y: y + 0.119 });
        assert.equal(transport.log.at(-1), "QM", "physical idle is checked before preparing the next job");
        assert.ok(!transport.log.includes("EM,0,0"), "motors remain enabled between jobs");
      }
    }, { confirmed: true });
    assert.deepEqual(result, { status: "complete", jobs: 100 });
    assert.equal(transport.log.filter(cmd => cmd === "EM,1,1").length, 1);
    assert.equal(transport.log.filter(cmd => cmd === "EM,0,0").length, 1);
    assert.deepEqual(stepTotals(transport.log.filter(cmd => /^(SM|LM),/.test(cmd)).map(cmd => ({ cmd, durationMs: 0 }))), [0, 0]);
    await assert.rejects(retained.run(planOf(p => p.line(1, 1, 2, 2))), /ended/);
  }

  const plan = planOf(p => p.line(10, 10, 11, 11));
  const transport = createLogTransport();
  const driver = new EbbDriver({ transport });
  await assert.rejects(driver.session(() => {}, {}), /confirmed/);
  assert.equal(transport.log.length, 0);
  assert.deepEqual(await driver.session(() => {}, { confirmed: true }), { status: "complete", jobs: 0 });
  assert.equal(transport.log.length, 0, "an empty session sends nothing");
  await driver.session(async session => {
    const pending = session.run(plan);
    await assert.rejects(session.run(plan), /Wait/);
    await assert.rejects(driver.run(plan, { confirmed: true }), /already running/);
    await pending;
  }, { confirmed: true });

  const idleTransport = createLogTransport();
  const send = idleTransport.send;
  let releaseIdle;
  const idle = new Promise(resolve => { releaseIdle = resolve; });
  let queriedIdle;
  const queried = new Promise(resolve => { queriedIdle = resolve; });
  idleTransport.send = async (cmd, options) => {
    if (cmd === "QM") { queriedIdle(); await idle; }
    return send(cmd, options);
  };
  let preparedNext = false;
  const operation = new EbbDriver({ transport: idleTransport }).session(async session => {
    await session.run(plan);
    preparedNext = true;
    await session.run(plan);
  }, { confirmed: true });
  await queried;
  assert.equal(preparedNext, false, "an ACK does not complete a job while QM is still pending");
  releaseIdle();
  await operation;
  assert.equal(preparedNext, true);

  const penTransport = createLogTransport();
  await assert.rejects(new EbbDriver({ transport: penTransport }).session(async session => {
    await session.run(planOf(p => { p.layer("black", { toolId: "black" }); p.line(10, 10, 11, 11); }));
    penTransport.log.length = 0;
    await session.run(planOf(p => { p.layer("red", { toolId: "red" }); p.line(11, 11, 12, 12); }));
  }, { confirmed: true }), /one pen/);
  assert.ok(!penTransport.log.some(cmd => /^(SM|LM),/.test(cmd)), "a different pen is rejected before movement");

  const caughtTransport = createLogTransport({ failOn: cmd => cmd.startsWith("LM,") ? "!failed" : null });
  await assert.rejects(new EbbDriver({ transport: caughtTransport }).session(async session => {
    try { await session.run(plan); } catch {}
    await assert.rejects(session.run(plan), /ended/);
  }, { confirmed: true }), /refused/);

  for (const reason of ["prepare", "bounds", "abort", "transport"]) {
    const failedTransport = createLogTransport();
    const failedDriver = new EbbDriver({ transport: failedTransport });
    let retained;
    await assert.rejects(failedDriver.session(async session => {
      retained = session;
      await session.run(plan);
      failedTransport.log.length = 0;
      if (reason === "prepare") throw new Error("prepare failed");
      if (reason === "abort") failedDriver.abort();
      if (reason === "transport") {
        const send = failedTransport.send;
        failedTransport.send = async (cmd, options) => cmd.startsWith("LM,") ? "!failed" : send(cmd, options);
      }
      await session.run(reason === "bounds" ? planOf(p => p.line(600, 1, 601, 2)) : plan);
    }, { confirmed: true }));
    const stop = failedTransport.log.lastIndexOf("ES");
    assert.ok(stop >= 0);
    assert.ok(!failedTransport.log.slice(stop).some(cmd => /^(SM|LM),/.test(cmd)), "no home motion after a failed session");
    assert.equal(failedTransport.log.at(-1), "EM,0,0");
    await assert.rejects(retained.run(plan), /ended/);
  }
}

await testPersistentSession();
await testModelPenSetup();
testGentleDefaultTravel();
testCoreXYMixing();
testDocumentationNamesTheDriver();
testCompileSequence();
testAccelerationProfile();
testCornering();
testNoRoundingDrift();
testStepRateLimits();
testSmFallback();
testBoundsAndUnits();
testSpeedsFollowThePlan();
await testDriverRun();
await testOldFirmware();
await testAbortRaisesPen();
await testErrorReplyStopsSafely();
await testToolChangeWaitsForIdle();
await testWebSerialTransport();
testMicroSegmentsMerge();
testNoDwellAtRest();
await testPipelinedSends();
await testTransportInFlight();
testResumeSkipsStrokes();
await testEmergencyStop();
await testPlacePlanOnTheBed();
console.log("vanilla.penplotter ebb: ok");
