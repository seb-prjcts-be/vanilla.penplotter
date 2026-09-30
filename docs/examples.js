import { builders } from "./examples-builders.js";

for (const canvas of document.querySelectorAll("canvas[data-example]")) {
  try {
    builders[canvas.dataset.example]().drawPreview(canvas.getContext("2d"), {
      showTravel: canvas.dataset.example === "route_lab" || canvas.dataset.example === "first_job",
      padding: 14,
      paper: "#ffffff", travelColor: "rgba(0, 0, 0, .35)"
    });
  } catch (error) {
    canvas.replaceWith(Object.assign(document.createElement("p"), { className: "note", textContent: error.message }));
  }
}
