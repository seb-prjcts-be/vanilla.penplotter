import { buildFirstJob } from "./composition.js";
import { mountPen } from "../pen.js";

const plot = buildFirstJob();
const plan = plot.plan();
const context = document.querySelector("#preview").getContext("2d");
let showTravel = true;

function render() {
  plot.drawPreview(context, { showTravel, padding: 26, paper: "#fffdf6" });
}

document.querySelector("#paths").textContent = String(plan.stats.paths);
document.querySelector("#draw").textContent = `${plan.stats.drawDistance.toFixed(0)} mm`;
document.querySelector("#travel").textContent = `${plan.stats.travelDistance.toFixed(0)} mm`;
document.querySelector("#time").textContent = `${Math.floor(plan.stats.estimatedSeconds / 60)}m ${Math.round(plan.stats.estimatedSeconds % 60)}s`;

document.querySelector("#travel-toggle").addEventListener("click", function toggleTravel() {
  showTravel = !showTravel;
  this.textContent = showTravel ? "Hide pen-up travel" : "Show pen-up travel";
  render();
});

render();
// An A4 sheet, its top-left corner 100 mm right and 60 mm down from home.
mountPen(document.querySelector("#pen"), { getPlot: () => plot, name: "first-job", offset: { x: 100, y: 60 } });
