import { buildTwoPens } from "./composition.js";
import { mountPen } from "../pen.js";

const plot = buildTwoPens();
const plan = plot.plan();
const $ = (selector) => document.querySelector(selector);

plot.drawRoute($("#preview").getContext("2d"), { showTravel: false, padding: 26, paper: "#ffffff", travelColor: "rgba(0, 0, 0, .35)" });

$("#paths").textContent = String(plan.stats.paths);
$("#changes").textContent = String(plan.stats.penChanges);
$("#draw").textContent = `${plan.stats.drawDistance.toFixed(0)} mm`;
$("#time").textContent = `${Math.floor(plan.stats.estimatedSeconds / 60)}m ${Math.round(plan.stats.estimatedSeconds % 60)}s`;

// A4 paper starts at the machine work origin; the panel keeps stroke sizes.
mountPen($("#pen"), { getPlot: () => plot, name: "two-pens" });
