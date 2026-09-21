import { addPath, point } from "../core/model.js";

function positive(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be greater than zero.`);
  }
  return value;
}

export function line(layer, x1, y1, x2, y2, options = {}) {
  return addPath(layer, [point(x1, y1), point(x2, y2)], options);
}

export function polyline(layer, points, options = {}) {
  return addPath(layer, points, options);
}

export function polygon(layer, points, options = {}) {
  return addPath(layer, points, { ...options, closed: true });
}

export function rectangle(layer, x, y, width, height, options = {}) {
  positive(width, "width");
  positive(height, "height");
  return polygon(layer, [
    point(x, y),
    point(x + width, y),
    point(x + width, y + height),
    point(x, y + height)
  ], options);
}

export function circle(layer, centerX, centerY, radius, options = {}) {
  positive(radius, "radius");
  const segments = Math.max(12, Math.floor(options.segments ?? 96));
  const points = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    points.push(point(
      centerX + Math.cos(angle) * radius,
      centerY + Math.sin(angle) * radius
    ));
  }
  return polygon(layer, points, options);
}

export function arc(layer, centerX, centerY, radius, startAngle, endAngle, options = {}) {
  positive(radius, "radius");
  const span = endAngle - startAngle;
  const segments = Math.max(2, Math.ceil(Math.abs(span) / (Math.PI / 24)));
  const points = [];
  for (let index = 0; index <= segments; index += 1) {
    const angle = startAngle + (span * index) / segments;
    points.push(point(
      centerX + Math.cos(angle) * radius,
      centerY + Math.sin(angle) * radius
    ));
  }
  return addPath(layer, points, options);
}
