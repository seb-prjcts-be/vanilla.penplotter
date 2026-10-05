import { createWaveHatch } from "./drawing.js";
import { mountPen } from "../pen.js";

const $ = (selector) => document.querySelector(selector);
try {
  if (!globalThis.VanillaWaves) throw new Error("Could not load vanilla.waves. Check your connection and reload.");
  const plot = createWaveHatch(globalThis.VanillaWaves);
  const plan = plot.plan();
  plot.drawRoute($("#preview").getContext("2d"), { showTravel: false, padding: 26, paper: "#ffffff", travelColor: "rgba(0, 0, 0, .35)" });
  $("#paths").textContent = String(plan.stats.paths);
  $("#draw").textContent = `${(plan.stats.drawDistance / 1000).toFixed(1)} m`;
  $("#travel").textContent = `${(plan.stats.travelDistance / 1000).toFixed(1)} m`;
  $("#time").textContent = `${Math.round(plan.stats.estimatedSeconds / 60)} min`;
  $("#status").textContent = "Sampled at t = 0. Same waves, same sheet, every time.";
  // A4 paper starts at the machine work origin; the panel keeps stroke sizes.
  mountPen($("#pen"), { getPlot: () => plot, name: "wave-hatch" });
} catch (error) {
  $("#status").textContent = error.message;
}
