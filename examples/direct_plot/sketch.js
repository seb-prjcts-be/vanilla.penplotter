import { PlotterEngine } from "../../vanilla.penplotter.js";
import {
  EBB_PROFILES,
  EbbDriver,
  compileEbbPlan,
  createLogTransport,
  createWebSerialTransport
} from "../../src/driver/ebb.js";

const profile = EBB_PROFILES["idraw-hse-a2"];
const $ = (selector) => document.querySelector(selector);
const canvas = $("#preview");
const context = canvas.getContext("2d");

let plot = null;
let compiled = null;
let transport = null;
let driver = null;
let busy = false;

function status(message) {
  $("#status").textContent = message;
}

function log(message) {
  status(message);
  const box = $("#log");
  box.textContent += `\n${message}`;
  box.scrollTop = box.scrollHeight;
}

function refreshButtons() {
  $("#plot").disabled = !transport || !compiled || busy;
  $("#connect").disabled = Boolean(transport) || busy;
  $("#dry").disabled = !compiled || busy;
  $("#stop").disabled = !busy;
}

// A 40 x 25 mm frame with two periods of a sine inside.
function build() {
  const ox = Number($("#offset-x").value);
  const oy = Number($("#offset-y").value);
  plot = new PlotterEngine({ units: "mm", page: { ...profile.travel } });
  plot.polyline([
    { x: ox, y: oy },
    { x: ox + 40, y: oy },
    { x: ox + 40, y: oy + 25 },
    { x: ox, y: oy + 25 },
    { x: ox, y: oy }
  ]);
  const wave = [];
  for (let x = ox + 3; x <= ox + 37; x += 0.5) {
    wave.push({ x, y: oy + 12.5 + Math.sin(((x - ox - 3) / 34) * Math.PI * 4) * 8 });
  }
  plot.polyline(wave);

  try {
    const plan = plot.plan({ strategy: "input" });
    compiled = compileEbbPlan(plan, { profile });
    $("#commands").textContent = String(compiled.commands.length);
    $("#draw").textContent = `${compiled.stats.drawMm.toFixed(1)} mm`;
    $("#travel").textContent = `${compiled.stats.travelMm.toFixed(1)} mm`;
    $("#time").textContent = `${(compiled.stats.durationMs / 1000).toFixed(1)} s`;
  } catch (error) {
    compiled = null;
    for (const id of ["#commands", "#draw", "#travel", "#time"]) $(id).textContent = "—";
    log(`Not plottable: ${error.message}`);
  }
  plot.drawPreview(context, { showTravel: true, padding: 20, paper: "#fffdf6" });
  refreshButtons();
}

async function dryRun() {
  const dry = createLogTransport();
  const result = await new EbbDriver({ transport: dry, profile }).run(compiled, { confirmed: true });
  log(`Dry run: ${result.status}, ${dry.log.length} lines, nothing was sent.`);
  log(`${dry.log.slice(0, 7).join("  ")}  …  ${dry.log.slice(-3).join("  ")}`);
}

async function connect() {
  status("Waiting for you to pick the plotter in the browser's list…");
  try {
    // A port granted earlier is reused; otherwise the browser shows its picker.
    const granted = navigator.serial ? await navigator.serial.getPorts() : [];
    // No USB filter: run() verifies the device is an EBB.
    const candidate = createWebSerialTransport(granted[0] ?? null, { filters: [] });
    await candidate.open();
    transport = candidate;
    driver = new EbbDriver({ transport, profile });
    log(`Connected: ${await transport.send("V")}`);
    log(`Pen is ${(await transport.send("QP")) === "1" ? "up" : "down"}.`);
  } catch (error) {
    const noPicker = /No port selected/i.test(error.message);
    log(noPicker
      ? "No plotter was chosen. If no list appeared at all, this window cannot show one: open this page in Chrome or Edge itself."
      : `Connect failed: ${error.message}`);
  }
  refreshButtons();
}

async function run() {
  const ok = window.confirm(
    "Plot now?\n\n" +
    "• The carriage is parked in the home corner (next to the board).\n" +
    "• Paper is in place and no magnet lies on the figure or on the way to it.\n" +
    "• Hands are clear of the arm."
  );
  if (!ok) return;
  busy = true;
  refreshButtons();
  const started = performance.now();
  try {
    const result = await driver.run(compiled, {
      confirmed: true,
      onProgress: (index, total) => {
        if (index % 10 === 0 || index === total - 1) log(`${index + 1} / ${total}`);
      }
    });
    log(`Plot ${result.status} after ${((performance.now() - started) / 1000).toFixed(1)} s.`);
    log(`Step counters: ${await transport.send("QS")} (0,0 means back home).`);
  } catch (error) {
    log(`Stopped safely: ${error.message}`);
  }
  busy = false;
  refreshButtons();
}

$("#offset-x").addEventListener("input", build);
$("#offset-y").addEventListener("input", build);
$("#dry").addEventListener("click", dryRun);
$("#connect").addEventListener("click", connect);
$("#plot").addEventListener("click", run);
$("#stop").addEventListener("click", () => {
  if (driver) driver.abort();
  log("Stop requested: pen up, motors off.");
});
window.addEventListener("pagehide", () => { if (transport) transport.close(); });

build();
