import { PlotterEngine } from "../vanilla.penplotter.js";

const plot = new PlotterEngine({
  units: "mm",
  page: { width: 210, height: 297, margin: 12 },
  tools: [
    { id: "pen-1", name: "Graphite", color: "#20211e", width: 0.32 }
  ]
});

const boundary = [
  { x: 28, y: 42 },
  { x: 182, y: 42 },
  { x: 182, y: 238 },
  { x: 28, y: 238 }
];

plot.hatch(boundary, { spacing: 5.2, angle: Math.PI / 5 });
for (let ring = 0; ring < 8; ring += 1) {
  const points = [];
  const radius = 24 + ring * 6.4;
  for (let index = 0; index <= 180; index += 1) {
    const angle = index / 180 * Math.PI * 2;
    const pulse = Math.sin(angle * 7 + ring * 0.7) * (2.3 + ring * 0.18);
    points.push({
      x: 105 + Math.cos(angle) * (radius + pulse),
      y: 142 + Math.sin(angle) * (radius + pulse) * 1.13
    });
  }
  plot.polyline(points, { closed: true });
}

plot.optimize({
  mergeTolerance: 0.08,
  duplicateTolerance: 0.02,
  simplifyTolerance: 0.04
});
const plan = plot.plan({
  strategy: "nearest",
  drawSpeed: 35,
  travelSpeed: 80,
  liftDelay: 0.14
});

const canvas = document.querySelector("#hero-plot");
const context = canvas.getContext("2d");
let showTravel = true;

function render() {
  const ratio = window.devicePixelRatio || 1;
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.floor(bounds.width * ratio));
  const height = Math.max(420, Math.floor(bounds.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  plot.drawPreview(context, {
    showTravel,
    padding: 26 * ratio,
    paper: "#fffdf6"
  });
}

function duration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}

document.querySelector("#stat-paths").textContent = String(plan.stats.paths);
document.querySelector("#stat-travel").textContent = plan.stats.travelDistance.toFixed(1);
document.querySelector("#stat-time").textContent = duration(plan.stats.estimatedSeconds);
document.querySelector("#travel-toggle").addEventListener("click", function toggleTravel() {
  showTravel = !showTravel;
  this.setAttribute("aria-pressed", String(showTravel));
  this.textContent = showTravel ? "Pen-up visible" : "Pen-up hidden";
  render();
});
document.querySelector(".menu").addEventListener("click", function toggleMenu() {
  document.querySelector(".nav").classList.toggle("nav-open");
});
window.addEventListener("resize", render);
render();
