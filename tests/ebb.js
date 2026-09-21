import assert from "node:assert/strict";
import fs from "node:fs";
import { PlotterEngine } from "../vanilla.penplotter.js";
import {
  EBB_PROFILES,
  EbbDriver,
  compileEbbPlan,
  createLogTransport,
  createWebSerialTransport,
  mixCoreXY
} from "../src/driver/ebb.js";

const HSE = EBB_PROFILES["idraw-hse-a2"];

function smCommands(compiled) {
  return compiled.commands
    .filter((entry) => entry.cmd.startsWith("SM,"))
    .map((entry) => entry.cmd.split(",").slice(1).map(Number));
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
  const compiled = compileEbbPlan(plan, { profile: HSE, drawSpeed: 10, travelSpeed: 20 });
  const cmds = compiled.commands.map((entry) => entry.cmd);
  assert.equal(cmds[0], "EM,1,1");
  assert.match(cmds[1], /^SP,1,\d+$/, "pen goes up before any motion");
  assert.equal(cmds[cmds.length - 1], "EM,0,0");

  const firstMove = cmds.findIndex((cmd) => cmd.startsWith("SM,"));
  const penDown = cmds.findIndex((cmd) => cmd.startsWith("SP,0"));
  assert.ok(firstMove > 1 && penDown > firstMove, "travel happens pen-up, then pen-down");

  const moves = smCommands(compiled);
  assert.deepEqual(moves[0].slice(1), [1600, 0]);
  assert.deepEqual(moves[1], [1500, 1200, 1200]);
  const lastUp = cmds.lastIndexOf(cmds.filter((cmd) => cmd.startsWith("SP,1")).pop());
  assert.ok(lastUp > penDown);
  const sum = moves.reduce((acc, [, a1, a2]) => [acc[0] + a1, acc[1] + a2], [0, 0]);
  assert.deepEqual(sum, [0, 0], "step totals return to the origin");
}

function testNoRoundingDrift() {
  const points = [];
  for (let i = 0; i <= 300; i += 1) points.push({ x: 20 + i * 0.3137, y: 50 + Math.sin(i / 9) * 7.77 });
  const plan = planOf((plot) => plot.polyline(points));
  const compiled = compileEbbPlan(plan, { profile: HSE, returnHome: false });
  const sum = smCommands(compiled).reduce((acc, [, a1, a2]) => [acc[0] + a1, acc[1] + a2], [0, 0]);
  const last = points[points.length - 1];
  assert.deepEqual(sum, [Math.round((last.x + last.y) * 80), Math.round((last.x - last.y) * 80)]);
}

function testStepRateLimits() {
  const plan = planOf((plot) => plot.line(0, 0, 400, 0));
  const fast = compileEbbPlan(plan, { profile: HSE, drawSpeed: 100000, travelSpeed: 100000 });
  for (const [duration, a1, a2] of smCommands(fast)) {
    assert.ok(Math.max(Math.abs(a1), Math.abs(a2)) / duration <= HSE.maxStepRate, "never above the EBB step-rate limit");
  }
  // A nearly diagonal line gives motor 2 a step rate below the firmware
  // minimum; that axis is held back instead of sending an invalid command.
  const slowPlan = planOf((plot) => plot.line(0, 0, 100, 99.99));
  const slow = compileEbbPlan(slowPlan, { profile: HSE, drawSpeed: 5, returnHome: false });
  for (const [duration, a1, a2] of smCommands(slow)) {
    for (const steps of [a1, a2]) {
      if (steps !== 0) assert.ok(Math.abs(steps) / (duration / 1000) >= HSE.minStepRate);
    }
  }
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
  const compiled = compileEbbPlan(cm.plan({ strategy: "input" }), { profile: HSE, drawSpeed: 10, returnHome: false });
  assert.deepEqual(smCommands(compiled)[0], [1500, 1200, 1200]);
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

  const wrong = new EbbDriver({ transport: createLogTransport({ version: "Grbl 1.1h" }), profile: HSE });
  await assert.rejects(() => wrong.run(plan, { confirmed: true }), /not an EBB/);
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
  const transport = createLogTransport({ failOn: (cmd) => cmd.startsWith("SM,") ? "!8 Err: SM bad" : null });
  const driver = new EbbDriver({ transport, profile: HSE });
  await assert.rejects(() => driver.run(plan, { confirmed: true }), /SM bad/);
  assert.deepEqual(transport.log.slice(-3), ["ES", "SP,1", "EM,0,0"]);
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
        else push("OK\r\n");
      }
    }),
    async close() {}
  };
  const transport = createWebSerialTransport(port);
  await transport.open();
  assert.match(await transport.send("V"), /EBB/);
  assert.equal(await transport.send("QS"), "1500,1000");
  assert.equal(await transport.send("SP,1,300"), "");
  assert.deepEqual(written, ["V", "QS", "SP,1,300"]);
  await transport.close();
}

// The driver is public API: every documentation layer has to name it.
function testDocumentationNamesTheDriver() {
  const root = new URL("../", import.meta.url);
  for (const file of ["README.md", "docs/guide.html", "docs/architecture.md", "docs/vanilla.penplotter.manifest.json"]) {
    assert.match(fs.readFileSync(new URL(file, root), "utf8"), /EbbDriver/, file + " does not mention EbbDriver");
  }
}

testCoreXYMixing();
testDocumentationNamesTheDriver();
testCompileSequence();
testNoRoundingDrift();
testStepRateLimits();
testBoundsAndUnits();
await testDriverRun();
await testAbortRaisesPen();
await testErrorReplyStopsSafely();
await testWebSerialTransport();
console.log("vanilla.penplotter ebb: ok");
