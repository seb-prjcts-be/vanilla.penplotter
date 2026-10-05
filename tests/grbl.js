import assert from "node:assert/strict";
import { PlotterEngine } from "../vanilla.penplotter.js";
import { compileDrawCorePlan, DrawCoreDriver, parseGrblStatus } from "../src/driver/grbl.js";
import { createAutoSerialTransport, detectDriver, identifyController } from "../src/driver/auto.js";
import { createLogTransport } from "../src/driver/ebb.js";

const settings = { travel: { width: 420, height: 297 }, penUp: 0.5, penDown: 5, axes: { swapXY: false, xDirection: 1, yDirection: 1 } };
const plot = new PlotterEngine({ units: "mm" });
plot.line(12, 12, 22, 12);
const plan = plot.plan();
const compiled = compileDrawCorePlan(plan, settings);
assert(compiled.commands.includes("G1 Z0.5 F1000"));
assert(compiled.commands.includes("G1 Z5 F1000"));
assert(compiled.commands.includes("G1 X22 Y12 F1200"));
assert.equal(compiled.commands.at(-1), "G1 X0 Y0 F1800");
assert(!compiled.commands.some(command => /M3|M5|\$H|G92/.test(command)));
assert.throws(() => compileDrawCorePlan(plan), /Travel width/);
assert.throws(() => compileDrawCorePlan(plan, { ...settings, penUp: undefined }), /explicit Z/);
assert.throws(() => compileDrawCorePlan(plan, { ...settings, travel: { width: 10, height: 10 } }), /outside/);
assert.throws(() => compileDrawCorePlan(plan, { ...settings, drawFeed: NaN }), /positive/);
assert.throws(() => compileDrawCorePlan(plan, { ...settings, axes: undefined }), /axes mapping/);
assert(compileDrawCorePlan(plan, { ...settings, axes: { swapXY: true, xDirection: -1, yDirection: -1 } }).commands.includes("G1 X-12 Y-22 F1200"));
assert.throws(() => compileDrawCorePlan({ ...plan, moves: [{ type: "mystery" }] }, settings), /Unsupported/);
const inch = new PlotterEngine({ units: "in" }); inch.line(0, 0, 1, 1);
assert(compileDrawCorePlan(inch.plan(), settings).commands.includes("G1 X25.4 Y25.4 F1200"));
assert.deepEqual(parseGrblStatus("<Idle|MPos:10,20,0|WCO:10,20,0>").position, [0, 0, 0]);
assert.equal(identifyController("Grbl 1.1h DrawCore V2.09 ['$' for help]").protocol, "drawcore");
assert.equal(identifyController("EBBv13_and_above EB Firmware Version 3.0.2").protocol, "ebb");
assert.equal(identifyController("EBB Firmware Version 3.0.2").protocol, "ebb");
assert.equal(identifyController("Grbl 1.1h").protocol, "grbl");

function serial(respond, greeting = "") {
  const sent = [];
  let controller;
  const encoder = new TextEncoder();
  const emit = text => controller.enqueue(encoder.encode(text));
  const port = {
    readable: new ReadableStream({ start(c) { controller = c; if (greeting) emit(greeting); } }),
    writable: new WritableStream({ write(bytes) { const text = new TextDecoder().decode(bytes); sent.push(text); return respond(text, emit); } }),
    async close() {}
  };
  return { port, sent, emit };
}
const device = serial((text, emit) => {
  if (text === "?") emit("<Run|WPos:0,0,0>\r\n");
  else emit("o");
  if (text !== "?") emit("k\r\n");
}, "Grbl 1.1h DrawCore V2.09 ['$' for help]\r\n");
const transport = createAutoSerialTransport(device.port);
await transport.open();
await new Promise(resolve => setTimeout(resolve, 0));
assert((await detectDriver(transport, { drawcore: settings })) instanceof DrawCoreDriver);
await transport.send("G90");
assert.match(await transport.send("?"), /^<Run/);
await transport.close();

const ebb = serial((text, emit) => emit(text === "V\r" ? "EBB Firmware Version 3.0.2\r\n" : "OK\r\n"));
const ebbTransport = createAutoSerialTransport(ebb.port);
await ebbTransport.open();
assert.equal((await detectDriver(ebbTransport)).identity.protocol, "ebb");
await Promise.all([ebbTransport.send("SP,1"), ebbTransport.send("EM,0,0")]);
await ebbTransport.close();

const ebbReplies = createLogTransport();
const fullEbb = serial(async (text, emit) => {
  const command = text.trim();
  const reply = await ebbReplies.send(command);
  emit(reply + (["V", "QM"].includes(command) ? "\r\n" : "\r\nOK\r\n"));
});
const fullEbbTransport = createAutoSerialTransport(fullEbb.port);
await fullEbbTransport.open();
const ebbDriver = await detectDriver(fullEbbTransport);
assert.equal((await ebbDriver.run(plan, { confirmed: true })).status, "complete");
assert(ebbReplies.log.includes("CU,4,32"));
assert(ebbReplies.log.some(command => command.startsWith("LM,")));
await fullEbbTransport.close();

const generic = serial((text, emit) => emit(text === "V\r" ? "error:20\r\n" : "[VER:1.1h:]\r\nok\r\n"));
const genericTransport = createAutoSerialTransport(generic.port);
await genericTransport.open();
await assert.rejects(detectDriver(genericTransport), /machine-specific/);
assert.deepEqual(generic.sent, ["V\r", "$I\r"]);
await genericTransport.close();

const silent = serial(() => {});
const silentTransport = createAutoSerialTransport(silent.port, { timeoutMs: 10 });
await silentTransport.open();
await assert.rejects(silentTransport.send("V"), /No reply/);
await assert.rejects(silentTransport.send("G1 X1"), /No reply/);
assert.deepEqual(silent.sent, ["V\r"]);
await silentTransport.writeRealtime("!");
await silentTransport.close();

const timedEbb = serial((text, emit) => { if (text === "V\r") emit("EBBv13_and_above EB Firmware Version 3.0.2\r\n"); });
const timedEbbTransport = createAutoSerialTransport(timedEbb.port, { timeoutMs: 10 });
await timedEbbTransport.open();
const timedEbbDriver = await detectDriver(timedEbbTransport);
await assert.rejects(timedEbbTransport.send("QM"), /No reply/);
await timedEbbDriver.safeStop();
assert.equal(timedEbb.sent.at(-1), "ES\rSP,1\rEM,0,0\r", "EBB stop bytes remain deliverable after a timeout");
await timedEbbTransport.close();

const reset = serial((text, emit) => emit("Grbl 1.1h DrawCore V2.09\r\n"));
const resetTransport = createAutoSerialTransport(reset.port);
await resetTransport.open();
await assert.rejects(resetTransport.send("G1 X1"), /restarted/);
await resetTransport.close();

const log = [];
let statuses = ["<Idle|WPos:0,0,0>", "<Run|WPos:0,0,0>", "<Idle|WPos:0,0,0>"];
const mock = { async send(command) { log.push(command); return command === "?" ? statuses.shift() : ""; }, async writeRealtime(text) { log.push(text); } };
const driver = new DrawCoreDriver({ ...settings, transport: mock });
await assert.rejects(driver.run(plan), /confirmed/);
assert.equal((await driver.run(plan, { confirmed: true })).status, "complete");
assert.equal(log.at(-1), "?");
assert.equal(statuses.length, 0, "acknowledgement alone does not finish the job");
statuses = ["<Idle|WPos:5,0,0>"];
log.length = 0;
await assert.rejects(driver.run(plan, { confirmed: true }), /work origin/);
assert.deepEqual(log, ["?", "!"]);
statuses = ["<Alarm|WPos:0,0,0>"];
log.length = 0;
await assert.rejects(driver.run(plan, { confirmed: true }), /must be Idle/);
assert.deepEqual(log, ["?", "!"]);
statuses = ["<Idle|WPos:0,0,0>"];
log.length = 0;
mock.send = async command => { log.push(command); if (command === "?") return statuses.shift(); driver.abort(); return ""; };
assert.deepEqual(await driver.run(plan, { confirmed: true }), { status: "aborted", holdRequested: true });
assert.deepEqual(log, ["?", "G21", "!"]);
statuses = ["<Idle|WPos:0,0,0>"];
log.length = 0;
mock.send = async command => { log.push(command); if (command === "?") return statuses.shift(); throw new Error("GRBL error: error:2"); };
await assert.rejects(driver.run(plan, { confirmed: true }), /error:2/);
assert.deepEqual(log, ["?", "G21", "!"]);
statuses = ["<Idle|MPos:10,20,0>", "<Idle|MPos:10,20,0|WCO:10,20,0>", "<Idle|MPos:10,20,0>"];
mock.send = async command => command === "?" ? statuses.shift() : "";
assert.equal((await driver.run(plan, { confirmed: true })).status, "complete");
assert.equal(statuses.length, 0, "intermittent WCO is fetched and reused within the job");
console.log("DrawCore: bounds, pen calibration, units, detection, serial acknowledgements, FIFO, timeout, reset, origin, idle, abort and errors verified; no hardware used.");
