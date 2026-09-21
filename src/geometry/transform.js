import { cloneDocument, point } from "../core/model.js";

export const Matrix = {
  identity() {
    return [1, 0, 0, 1, 0, 0];
  },
  translate(x, y) {
    return [1, 0, 0, 1, x, y];
  },
  scale(x, y = x) {
    return [x, 0, 0, y, 0, 0];
  },
  rotate(angle) {
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return [cosine, sine, -sine, cosine, 0, 0];
  },
  multiply(a, b) {
    return [
      a[0] * b[0] + a[2] * b[1],
      a[1] * b[0] + a[3] * b[1],
      a[0] * b[2] + a[2] * b[3],
      a[1] * b[2] + a[3] * b[3],
      a[0] * b[4] + a[2] * b[5] + a[4],
      a[1] * b[4] + a[3] * b[5] + a[5]
    ];
  }
};

export function transformPoint(value, matrix) {
  return point(
    matrix[0] * value.x + matrix[2] * value.y + matrix[4],
    matrix[1] * value.x + matrix[3] * value.y + matrix[5]
  );
}

export function transformDocument(document, matrix) {
  const result = cloneDocument(document);
  for (const layer of result.layers) {
    for (const path of layer.paths) {
      path.points = path.points.map((value) => transformPoint(value, matrix));
    }
  }
  return result;
}

export function offsetPolyline(points, distance, options = {}) {
  if (points.length < 2) return points.slice();
  const closed = Boolean(options.closed);
  const source = closed && points.length > 2 ? points.slice(0, -1) : points.slice();
  const result = [];
  for (let index = 0; index < source.length; index += 1) {
    const previous = source[index === 0 ? (closed ? source.length - 1 : 0) : index - 1];
    const current = source[index];
    const next = source[index === source.length - 1 ? (closed ? 0 : source.length - 1) : index + 1];
    const dxA = current.x - previous.x;
    const dyA = current.y - previous.y;
    const dxB = next.x - current.x;
    const dyB = next.y - current.y;
    const lengthA = Math.hypot(dxA, dyA) || 1;
    const lengthB = Math.hypot(dxB, dyB) || 1;
    const normalX = -dyA / lengthA - dyB / lengthB;
    const normalY = dxA / lengthA + dxB / lengthB;
    const normalLength = Math.hypot(normalX, normalY) || 1;
    result.push(point(
      current.x + (normalX / normalLength) * distance,
      current.y + (normalY / normalLength) * distance
    ));
  }
  if (closed && result.length > 0) result.push(point(result[0].x, result[0].y));
  return result;
}
