import { buildTwoPens } from "./composition.js";

const plot = buildTwoPens();
const plan = plot.plan();
const canvas = document.querySelector("#preview");
const context = canvas.getContext("2d");
const $ = (selector) => document.querySelector(selector);

plot.drawPreview(context, { showTravel: false, padding: 26, paper: "#fffdf6" });

$("#paths").textContent = String(plan.stats.paths);
$("#changes").textContent = String(plan.stats.toolChanges);
$("#draw").textContent = `${plan.stats.drawDistance.toFixed(0)} mm`;
$("#time").textContent = `${Math.floor(plan.stats.estimatedSeconds / 60)}m ${Math.round(plan.stats.estimatedSeconds % 60)}s`;

// The same plan, three machine programs. HPGL pens follow the pen map.
const outputs = {
  svg: { text: () => plot.exportSVG(), name: "two-pens.svg", type: "image/svg+xml" },
  hpgl: { text: () => plot.exportHPGL({ penMap: { black: 1, red: 2 } }), name: "two-pens.hpgl", type: "text/plain" },
  gcode: { text: () => plot.exportGCode({ penUp: "M5", penDown: "M3 S1000" }), name: "two-pens.gcode", type: "text/plain" }
};
let current = "svg";

function show(kind) {
  current = kind;
  const text = outputs[kind].text();
  const lines = text.split("\n");
  $("#program").textContent = lines.slice(0, 40).join("\n") + (lines.length > 40 ? `\n… ${lines.length - 40} more lines` : "");
  for (const button of document.querySelectorAll("[data-kind]")) {
    button.setAttribute("aria-pressed", String(button.dataset.kind === kind));
  }
}

for (const button of document.querySelectorAll("[data-kind]")) {
  button.addEventListener("click", () => show(button.dataset.kind));
}
$("#download").addEventListener("click", () => {
  const output = outputs[current];
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([output.text()], { type: output.type }));
  link.download = output.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});
show("svg");
