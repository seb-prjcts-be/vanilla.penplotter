const VALID_UNITS = new Set(["mm", "cm", "in", "px"]);

// SVG/CSS absolute units: one CSS pixel is 1/96 inch.
export function millimetersPerUnit(units = "mm") {
  const scales = { mm: 1, cm: 10, in: 25.4, px: 25.4 / 96 };
  if (!VALID_UNITS.has(units)) throw new RangeError(`Unsupported unit: ${units}`);
  return scales[units];
}

let nextId = 1;

function finite(value, label) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
  return value;
}

export function point(x, y) {
  return { x: finite(Number(x), "x"), y: finite(Number(y), "y") };
}

export function clonePoint(value) {
  return point(value.x, value.y);
}

export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function pathLength(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += distance(points[index - 1], points[index]);
  }
  return total;
}

export function createPath(points, options = {}) {
  if (!Array.isArray(points) || points.length === 0) {
    throw new TypeError("A path needs at least one point.");
  }
  const clean = points.map((value) => clonePoint(value));
  const closed = Boolean(options.closed);
  if (closed && clean.length > 1 && distance(clean[0], clean[clean.length - 1]) > 1e-9) {
    clean.push(clonePoint(clean[0]));
  }
  return {
    id: options.id || `path_${nextId++}`,
    points: clean,
    closed,
    reversible: options.reversible !== false,
    metadata: { ...(options.metadata || {}) }
  };
}

export function createLayer(options = {}) {
  return {
    id: options.id || `layer_${nextId++}`,
    name: options.name || options.id || "Layer",
    toolId: options.toolId || "pen-1",
    visible: options.visible !== false,
    paths: Array.isArray(options.paths)
      ? options.paths.map((value) => createPath(value.points, value))
      : [],
    metadata: { ...(options.metadata || {}) }
  };
}

export function createTool(options = {}) {
  return {
    id: options.id || `pen-${nextId++}`,
    name: options.name || options.id || "Pen",
    color: options.color || "#111111",
    width: finite(Number(options.width ?? 0.35), "tool width"),
    kind: options.kind || "pen",
    metadata: { ...(options.metadata || {}) }
  };
}

export function createDocument(options = {}) {
  const units = options.units || "mm";
  if (!VALID_UNITS.has(units)) {
    throw new RangeError(`Unsupported unit: ${units}`);
  }
  const page = options.page || {};
  const tools = Array.isArray(options.tools) && options.tools.length > 0
    ? options.tools.map(createTool)
    : [createTool({ id: "pen-1", name: "Black pen", color: "#111111" })];
  return {
    schema: "vanilla.penplotter/document@1",
    units,
    page: {
      width: finite(Number(page.width ?? 210), "page width"),
      height: finite(Number(page.height ?? 297), "page height"),
      margin: finite(Number(page.margin ?? 10), "page margin"),
      origin: page.origin || "top-left"
    },
    tools,
    layers: Array.isArray(options.layers) ? options.layers.map(createLayer) : [],
    metadata: { ...(options.metadata || {}) }
  };
}

export function cloneDocument(document) {
  const clone = createDocument({
    units: document.units,
    page: document.page,
    tools: document.tools,
    metadata: document.metadata
  });
  clone.layers = document.layers.map((layer) => createLayer(layer));
  return clone;
}

export function addLayer(document, options = {}) {
  const layer = createLayer(options);
  document.layers.push(layer);
  return layer;
}

export function addPath(layer, points, options = {}) {
  const path = createPath(points, options);
  layer.paths.push(path);
  return path;
}

export function getLayer(document, id) {
  return document.layers.find((layer) => layer.id === id) || null;
}

export function documentBounds(document) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const layer of document.layers) {
    for (const path of layer.paths) {
      for (const value of path.points) {
        minX = Math.min(minX, value.x);
        minY = Math.min(minY, value.y);
        maxX = Math.max(maxX, value.x);
        maxY = Math.max(maxY, value.y);
      }
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

export function validateDocument(document) {
  if (!document || document.schema !== "vanilla.penplotter/document@1") {
    throw new TypeError("Expected a vanilla.penplotter document.");
  }
  const ids = new Set();
  for (const layer of document.layers) {
    if (ids.has(layer.id)) throw new Error(`Duplicate id: ${layer.id}`);
    ids.add(layer.id);
    for (const path of layer.paths) {
      if (ids.has(path.id)) throw new Error(`Duplicate id: ${path.id}`);
      ids.add(path.id);
      for (const value of path.points) {
        finite(value.x, `${path.id}.x`);
        finite(value.y, `${path.id}.y`);
      }
    }
  }
  return true;
}
