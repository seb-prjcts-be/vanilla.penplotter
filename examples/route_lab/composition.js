// Route lab — the same drawing, planned badly and planned well.
// Deliberately awkward input: chains cut into pieces and shuffled, exact
// duplicates, and a circle sampled far too densely. Every optimizer pass and
// the planner have something real to do.
import { PlotterEngine } from "../../vanilla.penplotter.js";

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

export function buildRouteLab(seed = 7) {
  const random = randomFactory(seed);
  const plot = new PlotterEngine({ units: "mm", page: { width: 210, height: 297, margin: 15 } });
  const pieces = [];

  // 14 meandering chains, each cut into 8 segments.
  for (let chain = 0; chain < 14; chain += 1) {
    let x = 25 + random() * 160;
    let y = 30 + random() * 230;
    let heading = random() * Math.PI * 2;
    for (let piece = 0; piece < 8; piece += 1) {
      const points = [{ x, y }];
      for (let step = 0; step < 4; step += 1) {
        heading += (random() - 0.5) * 1.1;
        x = Math.min(190, Math.max(20, x + Math.cos(heading) * 4));
        y = Math.min(275, Math.max(22, y + Math.sin(heading) * 4));
        points.push({ x, y });
      }
      pieces.push(points);
    }
  }
  // Every fourth piece twice, as a sloppy generator would.
  const duplicates = pieces.filter((_, index) => index % 4 === 0);
  const all = pieces.concat(duplicates);
  // Shuffle, so the input order is as bad as it gets.
  for (let index = all.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [all[index], all[other]] = [all[other], all[index]];
  }
  for (const points of all) plot.polyline(points);

  // A circle with 1440 points: simplify keeps the shape and drops the rest.
  plot.circle(105, 150, 46, { segments: 1440 });
  return plot;
}
