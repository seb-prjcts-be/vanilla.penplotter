import { Renderer } from "../vanilla.penplotter.js";
import { builders, programs } from "./possibilities-builders.js";

for (const canvas of document.querySelectorAll("canvas[data-possibility]")) {
  Renderer.drawPreview(canvas.getContext("2d"), builders[canvas.dataset.possibility](), {
    showTravel: canvas.dataset.possibility === "route",
    padding: 8,
    paper: "#ffffff", travelColor: "rgba(0, 0, 0, .35)"
  });
}
const text = document.querySelector("[data-possibility='programs']");
if (text) text.textContent = programs();
