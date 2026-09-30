// Live drawings for docs/possibilities.html. Each builder returns a plan on a
// landscape 210 x 89 mm strip; possibilities.js draws it, tests run it headless.
import { PlotterEngine, Geometry } from "../vanilla.penplotter.js";
import { compileEbbPlan } from "../src/driver/ebb.js";

const STRIP = { width: 210, height: 89, margin: 0 };
const engine = (options = {}) => new PlotterEngine({ units: "mm", page: STRIP, ...options });
const square = (x, y, size) => [{ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }];

function randomFactory(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export const builders = {
  tone() {
    const plot = engine();
    const spacings = [6, 4, 2.6, 1.7, 1.2];
    spacings.forEach((spacing, index) => {
      plot.hatch(square(8 + index * 33, 24, 28), { spacing, angle: Math.PI / 4 });
      plot.polygon(square(8 + index * 33, 24, 28));
    });
    plot.crossHatch(square(8 + 5 * 33, 24, 28), { spacing: 1.2 });
    plot.polygon(square(8 + 5 * 33, 24, 28));
    return plot.plan();
  },
  stipple() {
    const plot = engine();
    const counts = [40, 120, 300, 600, 1000];
    counts.forEach((count, index) => {
      plot.stipple(square(8 + index * 39, 22, 34), { count, minDistance: 1.1, seed: 7 + index });
    });
    return plot.plan();
  },
  pens() {
    const plot = engine({
      tools: [
        { id: "black", color: "#171815", width: 0.3 },
        { id: "blue", color: "#385a86", width: 0.5 },
        { id: "red", color: "#c8402c", width: 0.8 }
      ]
    });
    plot.layer("sky", { toolId: "blue" });
    for (let row = 0; row < 7; row += 1) {
      const points = [];
      for (let x = 10; x <= 200; x += 1) points.push({ x, y: 12 + row * 5 + Math.sin(x * 0.11 + row) * 2.2 });
      plot.polyline(points);
    }
    plot.layer("ground", { toolId: "black" });
    plot.hatch([{ x: 10, y: 52 }, { x: 200, y: 58 }, { x: 200, y: 84 }, { x: 10, y: 84 }], { spacing: 2, angle: 0.05 });
    plot.layer("sun", { toolId: "red" });
    plot.circle(160, 30, 14);
    plot.circle(160, 30, 10);
    return plot.plan();
  },
  route() {
    // The same strokes twice: left in input order, right planned nearest-first.
    const random = randomFactory(11);
    const strokes = [];
    for (let index = 0; index < 60; index += 1) {
      const x = 10 + random() * 75;
      const y = 10 + random() * 70;
      const angle = random() * Math.PI;
      strokes.push([{ x, y }, { x: x + Math.cos(angle) * 9, y: y + Math.sin(angle) * 9 }]);
    }
    const left = engine();
    for (const [a, b] of strokes) left.line(a.x, a.y, b.x, b.y);
    left.optimize({ passes: [] });
    const input = left.plan({ strategy: "input" });
    const right = engine();
    for (const [a, b] of strokes) right.line(a.x + 110, a.y, b.x + 110, b.y);
    const nearest = right.plan({ strategy: "nearest" });
    // One preview, two plans side by side: concatenate their moves.
    return { ...input, moves: input.moves.concat(nearest.moves), routes: input.routes.concat(nearest.routes) };
  },
  import() {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><g transform="translate(10 10)">
      <path d="M 0 60 C 30 0, 60 90, 90 40 S 150 0, 180 60"/><circle cx="90" cy="45" r="28"/><rect x="0" y="0" width="180" height="80"/></g></svg>`;
    const imported = Geometry.importSVG(svg, { curveSteps: 30 });
    const plot = engine();
    const fitted = Geometry.transformDocument(imported, Geometry.Matrix.multiply(Geometry.Matrix.translate(10, 5), Geometry.Matrix.scale(0.95)));
    for (const layer of fitted.layers) plot.layer(layer.id).paths = layer.paths;
    return plot.plan();
  },
  waves() {
    const plot = engine();
    const wave = (x, row) => Math.sin(x * 0.12 + row * 0.6) * 4 + Math.sin(x * 0.031) * 6 * Math.sign(Math.sin(x * 0.27 + row));
    for (let row = 0; row < 8; row += 1) {
      const points = [];
      for (let x = 12; x <= 198; x += 0.5) points.push({ x, y: 14 + row * 9 + wave(x, row) });
      plot.polyline(points);
    }
    return plot.plan();
  },
  series() {
    const plot = engine();
    for (const seed of [1, 2, 3, 4]) {
      const random = randomFactory(seed * 97);
      const left = 8 + (seed - 1) * 50;
      plot.polygon(square(left, 22, 42));
      for (let ring = 1; ring <= 5; ring += 1) {
        const inset = ring * 3.6;
        const wobble = () => (random() - 0.5) * ring * 1.2;
        plot.polygon([
          { x: left + inset + wobble(), y: 22 + inset + wobble() },
          { x: left + 42 - inset + wobble(), y: 22 + inset + wobble() },
          { x: left + 42 - inset + wobble(), y: 22 + 42 - inset + wobble() },
          { x: left + inset + wobble(), y: 22 + 42 - inset + wobble() }
        ]);
      }
    }
    return plot.plan();
  }
};

// One plan, four programs: the head of each text.
export function programs() {
  const plot = engine();
  plot.line(20, 20, 60, 20);
  plot.circle(120, 45, 12, { segments: 12 });
  const plan = plot.plan();
  const head = (text, count, separator) => text.split(separator).filter(Boolean).slice(0, count).join("\n");
  const ebb = compileEbbPlan(plan, { profile: "idraw-hse-a2" }).commands.slice(0, 6);
  return [
    "HPGL", head(plot.exportHPGL(), 5, ";"),
    "", "G-code", head(plot.exportGCode(), 7, "\n"),
    "", "EBB", ebb.map((command) => command.cmd || `(${command.kind})`).join("\n")
  ].join("\n");
}
