// Two pens — one plan, two tools, one pen change.
// The composition only builds geometry; the page around it exports and shows it.
import { PlotterEngine } from "../../vanilla.penplotter.js";

export function buildTwoPens() {
  const plot = new PlotterEngine({
    units: "mm",
    page: { width: 210, height: 297, margin: 15 },
    tools: [
      { id: "black", name: "Black fineliner", color: "#171815", width: 0.3 },
      { id: "red", name: "Red brush pen", color: "#c8402c", width: 0.8 }
    ]
  });

  // Black: a fan of arcs that opens to the right.
  plot.layer("arcs", { toolId: "black" });
  for (let ring = 0; ring < 26; ring += 1) {
    const radius = 18 + ring * 5.2;
    const sweep = Math.PI * (0.55 - ring * 0.012);
    plot.arc(62, 150, radius, -sweep / 2, sweep / 2);
  }

  // Red: one hatched wedge that cuts through the fan, plus its outline.
  plot.layer("wedge", { toolId: "red" });
  const wedge = [
    { x: 62, y: 150 },
    { x: 196, y: 108 },
    { x: 196, y: 128 }
  ];
  plot.hatch(wedge, { spacing: 2.2, angle: -0.32 });
  plot.polygon(wedge);

  plot.optimize({ mergeTolerance: 0.05, simplifyTolerance: 0.03 });
  plot.plan({ toolChangeDelay: 20 });
  return plot;
}
