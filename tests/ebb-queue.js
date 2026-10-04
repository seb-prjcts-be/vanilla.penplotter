import assert from "node:assert/strict";
import { mock } from "node:test";
import { PlotterEngine } from "../vanilla.penplotter.js";
import { EbbDriver, compileEbbPlan } from "../src/driver/ebb.js";

// Model firmware's active move plus 32 FIFO entries. A reply is emitted when
// the command enters the FIFO, not when its physical movement completes.
async function checkQueuedMotion(plan) {
  const compiled = compileEbbPlan(plan, { profile: "idraw-hse-a2" });
  const entries = compiled.commands.filter(entry => entry.cmd);
  const board = [];
  const events = [];
  let now = 0;
  let parserTime = 0;
  let cursor = 0;
  let longestReply = 0;
  let pending = 0;
  let maxPending = 0;
  const clock = mock.method(performance, "now", () => now);
  function replyAt(time, value, error) {
    pending++;
    maxPending = Math.max(maxPending, pending);
    return new Promise((resolve, reject) => events.push({ time, finish() {
      pending--;
      if (error) reject(error);
      else resolve(value);
    } }));
  }
  const transport = { send(cmd, { timeoutMs = 3000 } = {}) {
    if (cmd === "V") return Promise.resolve("EBBv13_and_above EB Firmware Version 3.0.2");
    if (cmd === "QU,2") return Promise.resolve("QU,2,32");
    if (cmd.startsWith("CU,")) return Promise.resolve("");
    if (cmd === "QM") return replyAt(Math.max(now, board.at(-1) || now), "QM,0,0,0,0");
    if (cmd === "ES" || cmd === "SP,1") { board.length = 0; return Promise.resolve(""); }
    const entry = entries[cursor++];
    assert.equal(cmd, entry.cmd, "the driver sends the compiled commands in order");
    let acknowledgement = Math.max(now, parserTime);
    while (board.length && board[0] <= acknowledgement) board.shift();
    if (entry.durationMs > 0) {
      if (board.length >= 33) {
        acknowledgement = Math.max(acknowledgement, board.shift());
        while (board.length && board[0] <= acknowledgement) board.shift();
      }
      board.push(Math.max(acknowledgement, board.at(-1) || acknowledgement) + entry.durationMs);
    }
    parserTime = acknowledgement;
    longestReply = Math.max(longestReply, acknowledgement - now);
    if (acknowledgement - now > timeoutMs) {
      return replyAt(now + timeoutMs, null, new Error(`Premature timeout for ${cmd}: ${timeoutMs} ms`));
    }
    return replyAt(acknowledgement, "");
  } };
  let finished = false;
  let result;
  let failure;
  new EbbDriver({ transport, profile: "idraw-hse-a2" }).run(compiled, { confirmed: true })
    .then(value => { result = value; finished = true; }, error => { failure = error; finished = true; });
  try {
    for (let iteration = 0; !finished && iteration < 100000; iteration++) {
      // Allow the driver's async pipeline to submit all work available at now.
      for (let step = 0; step < 30; step++) await Promise.resolve();
      if (finished) break;
      events.sort((a, b) => a.time - b.time);
      assert.ok(events.length, "the virtual controller must make progress");
      const event = events.shift();
      now = event.time;
      event.finish();
    }
    if (failure) throw failure;
    assert.equal(finished, true);
    assert.equal(result.status, "complete");
    assert.equal(cursor, entries.length);
    assert.ok(longestReply > 5000, "exercise a legitimately long FIFO wait");
    assert.ok(maxPending >= 2, "retain pipelined command submission");
  } finally {
    clock.mock.restore();
  }
}

for (const variant of [0, 1, 2]) {
  const plot = new PlotterEngine({ units: "mm", page: { width: 594, height: 432 } });
  plot.rect(26.25, 52.125, 541.5, 327.75);
  for (let row = 0; row < 5; row++) {
    plot.polyline(Array.from({ length: 86 }, (_, i) => ({
      x: 54.75 + i * 5.7,
      y: 108 + row * 54 + 20 * (variant === 0 ? Math.sin(i * .2) : variant === 1 ? Math.abs(Math.sin(i * .2)) : (i % 2 ? .3 : -.3))
    })));
  }
  await checkQueuedMotion(plot.plan());
}
console.log("vanilla.penplotter FIFO: long frame followed by short moves completes, without premature timeouts");
