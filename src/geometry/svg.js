import { addLayer, addPath, createDocument, point } from "../core/model.js";
import { Matrix, transformPoint } from "./transform.js";

const ARG_COUNTS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

function tokenizePath(data) {
  return String(data).match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
}

function curvePoint(a, b, c, d, t) {
  const inverse = 1 - t;
  return point(
    inverse ** 3 * a.x + 3 * inverse ** 2 * t * b.x + 3 * inverse * t ** 2 * c.x + t ** 3 * d.x,
    inverse ** 3 * a.y + 3 * inverse ** 2 * t * b.y + 3 * inverse * t ** 2 * c.y + t ** 3 * d.y
  );
}

function quadraticPoint(a, b, c, t) {
  const inverse = 1 - t;
  return point(
    inverse ** 2 * a.x + 2 * inverse * t * b.x + t ** 2 * c.x,
    inverse ** 2 * a.y + 2 * inverse * t * b.y + t ** 2 * c.y
  );
}

function vectorAngle(ux, uy, vx, vy) {
  const dot = ux * vx + uy * vy;
  const length = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  const angle = Math.acos(Math.max(-1, Math.min(1, dot / (length || 1))));
  return ux * vy - uy * vx < 0 ? -angle : angle;
}

function flattenArc(start, values, stepsPerTurn) {
  let [radiusX, radiusY, rotation, largeArc, sweep, endX, endY] = values;
  radiusX = Math.abs(radiusX);
  radiusY = Math.abs(radiusY);
  if (radiusX === 0 || radiusY === 0) return [point(endX, endY)];
  const phi = rotation * Math.PI / 180;
  const cosine = Math.cos(phi);
  const sine = Math.sin(phi);
  const xPrime = cosine * (start.x - endX) / 2 + sine * (start.y - endY) / 2;
  const yPrime = -sine * (start.x - endX) / 2 + cosine * (start.y - endY) / 2;
  const scale = Math.sqrt((xPrime ** 2) / (radiusX ** 2) + (yPrime ** 2) / (radiusY ** 2));
  if (scale > 1) {
    radiusX *= scale;
    radiusY *= scale;
  }
  const numerator = Math.max(0,
    radiusX ** 2 * radiusY ** 2 - radiusX ** 2 * yPrime ** 2 - radiusY ** 2 * xPrime ** 2
  );
  const denominator = radiusX ** 2 * yPrime ** 2 + radiusY ** 2 * xPrime ** 2 || 1;
  const sign = largeArc === sweep ? -1 : 1;
  const factor = sign * Math.sqrt(numerator / denominator);
  const centerPrimeX = factor * radiusX * yPrime / radiusY;
  const centerPrimeY = factor * -radiusY * xPrime / radiusX;
  const centerX = cosine * centerPrimeX - sine * centerPrimeY + (start.x + endX) / 2;
  const centerY = sine * centerPrimeX + cosine * centerPrimeY + (start.y + endY) / 2;
  const startAngle = vectorAngle(1, 0, (xPrime - centerPrimeX) / radiusX, (yPrime - centerPrimeY) / radiusY);
  let delta = vectorAngle(
    (xPrime - centerPrimeX) / radiusX,
    (yPrime - centerPrimeY) / radiusY,
    (-xPrime - centerPrimeX) / radiusX,
    (-yPrime - centerPrimeY) / radiusY
  );
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  if (sweep && delta < 0) delta += Math.PI * 2;
  const steps = Math.max(2, Math.ceil(Math.abs(delta) / (Math.PI * 2) * stepsPerTurn));
  const result = [];
  for (let index = 1; index <= steps; index += 1) {
    const angle = startAngle + delta * index / steps;
    const localX = radiusX * Math.cos(angle);
    const localY = radiusY * Math.sin(angle);
    result.push(point(
      centerX + cosine * localX - sine * localY,
      centerY + sine * localX + cosine * localY
    ));
  }
  return result;
}

export function parseSVGPath(data, options = {}) {
  const tokens = tokenizePath(data);
  const curveSteps = Math.max(4, Math.floor(options.curveSteps ?? 16));
  const arcSteps = Math.max(12, Math.floor(options.arcSteps ?? 64));
  const paths = [];
  let currentPath = [];
  let current = point(0, 0);
  let subpathStart = point(0, 0);
  let command = "";
  let index = 0;
  let previousControl = null;
  function finish(closed = false) {
    if (currentPath.length > 0) paths.push({ points: currentPath, closed });
    currentPath = [];
  }
  while (index < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[index])) command = tokens[index++];
    if (!command) throw new Error("SVG path data starts without a command.");
    const upper = command.toUpperCase();
    const relative = command !== upper;
    if (!(upper in ARG_COUNTS)) throw new Error(`Unsupported SVG path command: ${command}`);
    if (upper === "Z") {
      if (currentPath.length > 0) {
        currentPath.push(point(subpathStart.x, subpathStart.y));
        current = point(subpathStart.x, subpathStart.y);
        finish(true);
      }
      previousControl = null;
      command = "";
      continue;
    }
    const count = ARG_COUNTS[upper];
    if (index + count > tokens.length) throw new Error(`Incomplete SVG path command: ${command}`);
    const values = tokens.slice(index, index + count).map(Number);
    if (values.some((value) => !Number.isFinite(value))) throw new Error("Invalid SVG path number.");
    index += count;
    const absolutePoint = (x, y) => point(relative ? current.x + x : x, relative ? current.y + y : y);
    if (upper === "M") {
      if (currentPath.length > 0) finish(false);
      current = absolutePoint(values[0], values[1]);
      subpathStart = point(current.x, current.y);
      currentPath.push(point(current.x, current.y));
      command = relative ? "l" : "L";
    } else if (upper === "L") {
      current = absolutePoint(values[0], values[1]);
      currentPath.push(point(current.x, current.y));
    } else if (upper === "H") {
      current = point(relative ? current.x + values[0] : values[0], current.y);
      currentPath.push(point(current.x, current.y));
    } else if (upper === "V") {
      current = point(current.x, relative ? current.y + values[0] : values[0]);
      currentPath.push(point(current.x, current.y));
    } else if (upper === "C") {
      const controlA = absolutePoint(values[0], values[1]);
      const controlB = absolutePoint(values[2], values[3]);
      const end = absolutePoint(values[4], values[5]);
      for (let step = 1; step <= curveSteps; step += 1) {
        currentPath.push(curvePoint(current, controlA, controlB, end, step / curveSteps));
      }
      current = end;
      previousControl = controlB;
    } else if (upper === "S") {
      const controlA = previousControl
        ? point(current.x * 2 - previousControl.x, current.y * 2 - previousControl.y)
        : point(current.x, current.y);
      const controlB = absolutePoint(values[0], values[1]);
      const end = absolutePoint(values[2], values[3]);
      for (let step = 1; step <= curveSteps; step += 1) {
        currentPath.push(curvePoint(current, controlA, controlB, end, step / curveSteps));
      }
      current = end;
      previousControl = controlB;
    } else if (upper === "Q" || upper === "T") {
      const control = upper === "Q"
        ? absolutePoint(values[0], values[1])
        : (previousControl
          ? point(current.x * 2 - previousControl.x, current.y * 2 - previousControl.y)
          : point(current.x, current.y));
      const end = upper === "Q"
        ? absolutePoint(values[2], values[3])
        : absolutePoint(values[0], values[1]);
      for (let step = 1; step <= curveSteps; step += 1) {
        currentPath.push(quadraticPoint(current, control, end, step / curveSteps));
      }
      current = end;
      previousControl = control;
    } else if (upper === "A") {
      const end = absolutePoint(values[5], values[6]);
      const arcValues = values.slice();
      arcValues[5] = end.x;
      arcValues[6] = end.y;
      currentPath.push(...flattenArc(current, arcValues, arcSteps));
      current = end;
      previousControl = null;
    }
    if (!["C", "S", "Q", "T"].includes(upper)) previousControl = null;
  }
  if (currentPath.length > 0) finish(false);
  return paths;
}

function parsePoints(value) {
  const numbers = String(value).match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g)?.map(Number) || [];
  const points = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) points.push(point(numbers[index], numbers[index + 1]));
  return points;
}

function parseTransform(value) {
  let matrix = Matrix.identity();
  const pattern = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  for (const match of String(value || "").matchAll(pattern)) {
    const values = match[2].match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g)?.map(Number) || [];
    let next = Matrix.identity();
    if (match[1] === "matrix" && values.length >= 6) next = values.slice(0, 6);
    else if (match[1] === "translate") next = Matrix.translate(values[0] || 0, values[1] || 0);
    else if (match[1] === "scale") next = Matrix.scale(values[0] ?? 1, values[1] ?? values[0] ?? 1);
    else if (match[1] === "rotate") {
      const rotation = Matrix.rotate((values[0] || 0) * Math.PI / 180);
      next = values.length >= 3
        ? Matrix.multiply(Matrix.translate(values[1], values[2]), Matrix.multiply(rotation, Matrix.translate(-values[1], -values[2])))
        : rotation;
    } else if (match[1] === "skewX") next = [1, 0, Math.tan((values[0] || 0) * Math.PI / 180), 1, 0, 0];
    else if (match[1] === "skewY") next = [1, Math.tan((values[0] || 0) * Math.PI / 180), 0, 1, 0, 0];
    matrix = Matrix.multiply(matrix, next);
  }
  return matrix;
}

function numberAttribute(node, name, fallback = 0) {
  const value = Number.parseFloat(node.getAttribute(name));
  return Number.isFinite(value) ? value : fallback;
}

export function importSVG(svgText, options = {}) {
  const Parser = options.DOMParser || globalThis.DOMParser;
  if (!Parser) throw new Error("SVG import needs DOMParser. In Node, pass { DOMParser } from an XML package.");
  const xml = new Parser().parseFromString(String(svgText), "image/svg+xml");
  if (xml.querySelector("parsererror")) throw new Error("Invalid SVG input.");
  const root = xml.documentElement;
  const viewBox = parsePoints(root.getAttribute("viewBox"));
  const document = createDocument({
    units: options.units || "mm",
    page: {
      width: numberAttribute(root, "width", options.width || (viewBox[1]?.x ?? 210)),
      height: numberAttribute(root, "height", options.height || (viewBox[1]?.y ?? 297)),
      margin: 0
    },
    metadata: { importedFrom: "svg" }
  });
  const layer = addLayer(document, { id: options.layerId || "svg", name: options.layerName || "SVG import" });
  function visit(node, parentMatrix) {
    if (node.nodeType !== 1) return;
    const matrix = Matrix.multiply(parentMatrix, parseTransform(node.getAttribute("transform")));
    const tag = node.tagName.toLowerCase();
    const paths = [];
    if (tag === "path") paths.push(...parseSVGPath(node.getAttribute("d") || "", options));
    else if (tag === "line") paths.push({ points: [point(numberAttribute(node, "x1"), numberAttribute(node, "y1")), point(numberAttribute(node, "x2"), numberAttribute(node, "y2"))], closed: false });
    else if (tag === "polyline" || tag === "polygon") paths.push({ points: parsePoints(node.getAttribute("points")), closed: tag === "polygon" });
    else if (tag === "rect") {
      const x = numberAttribute(node, "x");
      const y = numberAttribute(node, "y");
      const width = numberAttribute(node, "width");
      const height = numberAttribute(node, "height");
      paths.push({ points: [point(x, y), point(x + width, y), point(x + width, y + height), point(x, y + height)], closed: true });
    } else if (tag === "circle" || tag === "ellipse") {
      const centerX = numberAttribute(node, "cx");
      const centerY = numberAttribute(node, "cy");
      const radiusX = tag === "circle" ? numberAttribute(node, "r") : numberAttribute(node, "rx");
      const radiusY = tag === "circle" ? radiusX : numberAttribute(node, "ry");
      const points = [];
      const segments = Math.max(12, Math.floor(options.circleSegments ?? 96));
      for (let index = 0; index < segments; index += 1) {
        const angle = index / segments * Math.PI * 2;
        points.push(point(centerX + Math.cos(angle) * radiusX, centerY + Math.sin(angle) * radiusY));
      }
      paths.push({ points, closed: true });
    }
    for (const path of paths) {
      if (path.points.length === 0) continue;
      addPath(layer, path.points.map((value) => transformPoint(value, matrix)), {
        closed: path.closed,
        metadata: { source: "svg", sourceTag: tag, sourceId: node.id || null }
      });
    }
    for (const child of node.children || []) visit(child, matrix);
  }
  visit(root, Matrix.identity());
  return document;
}
