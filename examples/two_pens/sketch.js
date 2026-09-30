import { buildTwoPens } from "./composition.js";
import { mountPen } from "../pen.js";

const plot = buildTwoPens();
const plan = plot.plan();
const $ = (selector) => document.querySelector(selector);

plot.drawPreview($("#preview").getContext("2d"), { showTravel: false, padding: 26, paper: "#ffffff", travelColor: "rgba(0, 0, 0, .35)" });

$("#paths").textContent = String(plan.stats.paths);
$("#changes").textContent = String(plan.stats.toolChanges);
$("#draw").textContent = `${plan.stats.drawDistance.toFixed(0)} mm`;
$("#time").textContent = `${Math.floor(plan.stats.estimatedSeconds / 60)}m ${Math.round(plan.stats.estimatedSeconds % 60)}s`;

// An A4 sheet, its top-left corner 100 mm right and 60 mm down from home.
mountPen($("#pen"), { getPlot: () => plot, name: "two-pens", offset: { x: 100, y: 60 } });
