import { createWaveDrawing } from "./drawing.js";
import { mountPen } from "../pen.js";

const $ = (selector) => document.querySelector(selector);
try {
  if (!globalThis.VanillaWaves) throw new Error("Could not load vanilla.waves. Check your connection and reload.");
  const plot = createWaveDrawing(globalThis.VanillaWaves);
  const plan = plot.plan();
  plot.drawRoute($("#preview").getContext("2d"), { showTravel: false, padding: 26, paper: "#ffffff", travelColor: "rgba(0, 0, 0, .35)" });
  $("#paths").textContent = String(plan.stats.paths);
  $("#draw").textContent = `${(plan.stats.drawDistance / 1000).toFixed(1)} m`;
  $("#travel").textContent = `${plan.stats.travelDistance.toFixed(0)} mm`;
  $("#status").textContent = "Sampled at t = 0.";
  // An A4 sheet, its top-left corner 100 mm right and 60 mm down from home.
  mountPen($("#pen"), { getPlot: () => plot, name: "waves", offset: { x: 100, y: 60 } });
} catch (error) {
  $("#status").textContent = error.message;
}
