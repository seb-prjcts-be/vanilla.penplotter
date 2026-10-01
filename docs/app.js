// The landing page's hero: one planned A4 job, drawn path by path behind
// the title, the way the machine will draw it, then again from the start.
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
plot.plan({ strategy: "nearest", drawSpeed: 35, travelSpeed: 80, liftDelay: 0.14 });

const canvas = document.querySelector("#hero-plot");
const context = canvas.getContext("2d");
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const CYCLE_MS = 48000; // the whole sheet, then a pause, then again
const HOLD_MS = 6000;
let started = performance.now();

function frame(now) {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.floor(bounds.width * ratio));
  const height = Math.max(320, Math.floor(bounds.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const elapsed = (now - started) % (CYCLE_MS + HOLD_MS);
  const progress = reduced ? 1 : Math.min(1, elapsed / CYCLE_MS);
  plot.drawPreview(context, {
    showTravel: false,
    padding: 40 * ratio,
    paper: "#ffffff",
    progress
  });
  if (!reduced) requestAnimationFrame(frame);
}

window.addEventListener("resize", () => { started = performance.now(); frame(started); });
requestAnimationFrame(frame);
