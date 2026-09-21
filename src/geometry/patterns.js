import { addPath, clonePoint, distance, point } from "../core/model.js";

function rotate(value, angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return point(
    value.x * cosine - value.y * sine,
    value.x * sine + value.y * cosine
  );
}

function openPolygon(points) {
  const clean = points.map(clonePoint);
  if (clean.length > 1 && distance(clean[0], clean[clean.length - 1]) < 1e-9) clean.pop();
  if (clean.length < 3) throw new TypeError("A fill polygon needs at least three points.");
  return clean;
}

export function hatchPolygon(layer, polygonPoints, options = {}) {
  const spacing = Number(options.spacing ?? 2);
  if (!Number.isFinite(spacing) || spacing <= 0) {
    throw new RangeError("Hatch spacing must be greater than zero.");
  }
  const angle = Number(options.angle ?? Math.PI / 4);
  const source = openPolygon(polygonPoints);
  const rotated = source.map((value) => rotate(value, -angle));
  let minY = Infinity;
  let maxY = -Infinity;
  for (const value of rotated) {
    minY = Math.min(minY, value.y);
    maxY = Math.max(maxY, value.y);
  }
  const created = [];
  const startY = Math.floor(minY / spacing) * spacing;
  for (let y = startY; y <= maxY + 1e-9; y += spacing) {
    const intersections = [];
    for (let index = 0; index < rotated.length; index += 1) {
      const a = rotated[index];
      const b = rotated[(index + 1) % rotated.length];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
        const ratio = (y - a.y) / (b.y - a.y);
        intersections.push(a.x + ratio * (b.x - a.x));
      }
    }
    intersections.sort((a, b) => a - b);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const start = rotate(point(intersections[index], y), angle);
      const end = rotate(point(intersections[index + 1], y), angle);
      created.push(addPath(layer, [start, end], {
        ...options,
        metadata: { ...(options.metadata || {}), effect: "hatch" }
      }));
    }
  }
  return created;
}

export function crossHatchPolygon(layer, polygonPoints, options = {}) {
  const angle = Number(options.angle ?? Math.PI / 4);
  const angleB = Number(options.angleB ?? angle + Math.PI / 2);
  return [
    ...hatchPolygon(layer, polygonPoints, { ...options, angle }),
    ...hatchPolygon(layer, polygonPoints, { ...options, angle: angleB })
  ];
}

function insidePolygon(value, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index];
    const b = polygon[previous];
    const crosses = (a.y > value.y) !== (b.y > value.y)
      && value.x < ((b.x - a.x) * (value.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function randomFactory(seed) {
  let state = (Number(seed) || 1) >>> 0;
  return function random() {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function stipplePolygon(layer, polygonPoints, options = {}) {
  const polygon = openPolygon(polygonPoints);
  const count = Math.max(0, Math.floor(options.count ?? 200));
  const minDistance = Math.max(0, Number(options.minDistance ?? 1.2));
  const radius = Math.max(0, Number(options.radius ?? 0.12));
  const attempts = Math.max(count * 20, Math.floor(options.attempts ?? count * 40));
  const random = randomFactory(options.seed ?? 1);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const value of polygon) {
    minX = Math.min(minX, value.x);
    minY = Math.min(minY, value.y);
    maxX = Math.max(maxX, value.x);
    maxY = Math.max(maxY, value.y);
  }
  const accepted = [];
  for (let attempt = 0; attempt < attempts && accepted.length < count; attempt += 1) {
    const candidate = point(
      minX + random() * (maxX - minX),
      minY + random() * (maxY - minY)
    );
    if (!insidePolygon(candidate, polygon)) continue;
    if (accepted.some((value) => distance(value, candidate) < minDistance)) continue;
    accepted.push(candidate);
  }
  const created = [];
  for (const center of accepted) {
    created.push(addPath(layer, [
      point(center.x - radius, center.y),
      point(center.x + radius, center.y)
    ], {
      ...options,
      metadata: { ...(options.metadata || {}), effect: "stipple" }
    }));
  }
  return created;
}
