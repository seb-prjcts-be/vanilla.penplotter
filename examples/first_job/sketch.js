import { PlotterEngine } from "../../vanilla.penplotter.js";

const plot = new PlotterEngine({
  units: "mm",
  page: { width: 210, height: 297, margin: 12 }
});

const polygon = [
  { x: 30, y: 42 },
  { x: 174, y: 31 },
  { x: 187, y: 224 },
  { x: 62, y: 258 },
  { x: 24, y: 172 }
];

plot.hatch(polygon, {
  spacing: 4.5,
  angle: Math.PI / 7
});
plot.polygon(polygon);
plot.circle(108, 145, 38, { segments: 120 });

plot.optimize({
  mergeTolerance: 0.05,
  duplicateTolerance: 0.01,
  simplifyTolerance: 0.03
});
const plan = plot.plan({
  drawSpeed: 35,
  travelSpeed: 80,
  liftDelay: 0.15
});

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
