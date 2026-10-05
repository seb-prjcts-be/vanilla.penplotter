import { PlotterEngine } from "../../vanilla.penplotter.js";
import {
  EbbDriver, createLogTransport, createWebSerialTransport
} from "../../src/driver/ebb.js";

const $ = selector => document.querySelector(selector);
let driver = null;
let busy = false;

function controls() {
  $("#demo").disabled = busy;
  $("#connect").disabled = busy;
  $("#plot").disabled = busy || !driver;
  $("#stop").disabled = !busy;
  $("#paper-x").disabled = busy;
  $("#paper-y").disabled = busy;
}

async function drawOneAtATime(activeDriver, demo) {
  const paperX = Number($("#paper-x").value);
  const paperY = Number($("#paper-y").value);
  if (!Number.isFinite(paperX) || !Number.isFinite(paperY) ||
      paperX < 0 || paperY < 0 || paperX > 384 || paperY > 135) {
    throw new Error("Enter a paper corner that leaves room for an A4 sheet.");
  }
  busy = true;
  controls();
  const screen = new PlotterEngine({ units: "mm", page: { width: 210, height: 297 } });
  screen.drawRoute($("#preview").getContext("2d"));
  $("#status").textContent = "Starting...";
  try {
    const result = await activeDriver.session(async function (session) {
      for (let index = 0; index < 3; index += 1) {
        if (activeDriver.aborted) throw new Error("Stopped. Return the pen to the machine origin before another plot.");
        const y = 12 + index * 5;
        const object = new PlotterEngine({
          units: "mm", page: { width: 594, height: 432 }
        });
        object.line(paperX + 12, paperY + y, paperX + 17, paperY + y);
        screen.line(12, y, 17, y);
        screen.drawRoute($("#preview").getContext("2d"), { showTravel: false });
        $("#status").textContent = `Line ${index + 1}: plotting`;
        await session.run(object.plan({ strategy: "drawn" }));
        $("#status").textContent = `Line ${index + 1}: complete`;
        if (demo) await new Promise(resolve => setTimeout(resolve, 500));
      }
    }, { confirmed: true });
    $("#status").textContent = demo
      ? `Screen demo complete: ${result.jobs} lines. No commands sent to a plotter.`
      : `Complete: ${result.jobs} lines. The pen is back at the machine origin.`;
  } finally {
    busy = false;
    controls();
  }
}

function failed(error) {
  $("#status").textContent = error.message;
}

let active = null;
$("#demo").addEventListener("click", () => {
  active = new EbbDriver({ transport: createLogTransport(), profile: "idraw-hse-a2" });
  drawOneAtATime(active, true).catch(failed);
});
$("#connect").addEventListener("click", async () => {
  try {
    const transport = createWebSerialTransport();
    await transport.open();
    driver = new EbbDriver({ transport, profile: "idraw-hse-a2" });
    $("#status").textContent = "Connected. Ready to plot.";
    controls();
  } catch (error) { failed(error); }
});
$("#plot").addEventListener("click", () => {
  if (!window.confirm("Plot three 5 mm lines near the paper corner? Check the paper position and park the pen at the machine origin first.")) return;
  active = driver;
  drawOneAtATime(active, false).catch(failed);
});
$("#stop").addEventListener("click", () => {
  if (active) active.abort();
});
controls();
