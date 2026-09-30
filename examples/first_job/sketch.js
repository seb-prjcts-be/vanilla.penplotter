import { buildFirstJob } from "./composition.js";

const plot = buildFirstJob();
const plan = plot.plan();

const canvas = document.querySelector("#preview");
const context = canvas.getContext("2d");
let showTravel = true;

function render() {
  plot.drawPreview(context, {
    showTravel,
    padding: 26,
    paper: "#fffdf6"
  });
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

document.querySelector("#paths").textContent = String(plan.stats.paths);
document.querySelector("#draw").textContent = `${plan.stats.drawDistance.toFixed(1)} mm`;
document.querySelector("#travel").textContent = `${plan.stats.travelDistance.toFixed(1)} mm`;
document.querySelector("#time").textContent = formatTime(plan.stats.estimatedSeconds);

document.querySelector("#travel-toggle").addEventListener("click", function toggleTravel() {
  showTravel = !showTravel;
  this.textContent = showTravel ? "Hide pen-up travel" : "Show pen-up travel";
  render();
});

document.querySelector("#download").addEventListener("click", function downloadSVG() {
  const blob = new Blob([plot.exportSVG()], { type: "image/svg+xml" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "first-job.svg";
  link.click();
  URL.revokeObjectURL(link.href);
});

render();
