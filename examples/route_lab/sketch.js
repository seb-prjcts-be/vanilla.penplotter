import { buildRouteLab } from "./composition.js";
import { mountPen } from "../pen.js";

const $ = (selector) => document.querySelector(selector);
const plot = buildRouteLab();
const context = $("#preview").getContext("2d");

// The raw plan: input order, no optimizer passes. The comparison baseline.
plot.optimize({ passes: [] });
const raw = plot.plan({ strategy: "drawn" });

function settings() {
  const passes = [];
  for (const box of document.querySelectorAll("[data-pass]")) if (box.checked) passes.push(box.dataset.pass);
  return { passes, strategy: $("#strategy").value };
}

function formatTime(seconds) {
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function render() {
  const { passes, strategy } = settings();
  plot.optimize({ passes, mergeTolerance: 0.05, duplicateTolerance: 0.01, simplifyTolerance: 0.05 });
  const plan = plot.plan({ strategy });
  plot.drawRoute(context, { showTravel: $("#travel").checked, padding: 24, paper: "#ffffff", travelColor: "rgba(0, 0, 0, .35)" });
  const rows = [
    ["paths", raw.stats.paths, plan.stats.paths, ""],
    ["points", raw.stats.points, plan.stats.points, ""],
    ["pen lifts", raw.stats.penLifts, plan.stats.penLifts, ""],
    ["travel", raw.stats.travelDistance, plan.stats.travelDistance, " mm"],
    ["estimate", raw.stats.estimatedSeconds, plan.stats.estimatedSeconds, "s"]
  ];
  $("#table").innerHTML = rows.map(([label, before, after, unit]) => {
    const format = (value) => (unit === "s" ? formatTime(value) : `${Math.round(value)}${unit}`);
    const gain = before > 0 ? Math.round((1 - after / before) * 100) : 0;
    return `<div><dt>${label}</dt><dd>${format(before)} → <strong>${format(after)}</strong> <span>${gain > 0 ? `−${gain}%` : ""}</span></dd></div>`;
  }).join("");
  if (pen) pen.refresh();
}

let pen = null;
for (const control of document.querySelectorAll(".controls input, .controls select")) control.addEventListener("change", render);
render();
// An A4 sheet, its top-left corner 100 mm right and 60 mm down from home.
pen = mountPen($("#pen"), { getPlot: () => plot, name: "route-lab", offset: { x: 100, y: 60 } });
