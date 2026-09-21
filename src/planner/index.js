import { clonePoint, createPath, distance, millimetersPerUnit, pathLength, validateDocument } from "../core/model.js";

function reversePath(path) {
  return createPath(path.points.slice().reverse(), path);
}

function nearestClosedSeam(path, current) {
  const points = path.points.slice(0, -1);
  if (!current || points.length === 0) return createPath(path.points, path);
  let nearest = 0;
  let best = Infinity;
  for (let index = 0; index < points.length; index += 1) {
    const candidate = distance(current, points[index]);
    if (candidate < best) {
      best = candidate;
      nearest = index;
    }
  }
  const rotated = points.slice(nearest).concat(points.slice(0, nearest));
  rotated.push(clonePoint(rotated[0]));
  return createPath(rotated, path);
}

export function orderPathsNearest(paths, start = { x: 0, y: 0 }, options = {}) {
  const remaining = paths.map((path) => createPath(path.points, path));
  const result = [];
  let current = clonePoint(start);
  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    let shouldReverse = false;
    for (let index = 0; index < remaining.length; index += 1) {
      const path = remaining[index];
      if (path.closed) {
        const seamPath = nearestClosedSeam(path, current);
        const candidate = distance(current, seamPath.points[0]);
        if (candidate < bestDistance) {
          bestDistance = candidate;
          bestIndex = index;
          shouldReverse = false;
        }
        continue;
      }
      const startDistance = distance(current, path.points[0]);
      const endDistance = path.reversible
        ? distance(current, path.points[path.points.length - 1])
        : Infinity;
      const candidate = Math.min(startDistance, endDistance);
      if (candidate < bestDistance) {
        bestDistance = candidate;
        bestIndex = index;
        shouldReverse = endDistance < startDistance;
      }
    }
    let selected = remaining.splice(bestIndex, 1)[0];
    if (selected.closed && options.reloop !== false) selected = nearestClosedSeam(selected, current);
    else if (shouldReverse) selected = reversePath(selected);
    result.push(selected);
    current = clonePoint(selected.points[selected.points.length - 1]);
  }
  return result;
}

export function estimatePlan(stats, options = {}) {
  const drawSpeed = Math.max(0.001, Number(options.drawSpeed ?? 35));
  const travelSpeed = Math.max(0.001, Number(options.travelSpeed ?? 80));
  const liftDelay = Math.max(0, Number(options.liftDelay ?? 0.15));
  const toolChangeDelay = Math.max(0, Number(options.toolChangeDelay ?? 15));
  const scale = millimetersPerUnit(options.units);
  return stats.drawDistance * scale / drawSpeed
    + stats.travelDistance * scale / travelSpeed
    + stats.penLifts * liftDelay
    + stats.toolChanges * toolChangeDelay;
}

export function planDocument(document, options = {}) {
  validateDocument(document);
  const origin = options.origin || { x: 0, y: 0 };
  let current = clonePoint(origin);
  let currentTool = null;
  const moves = [];
  const routes = [];
  const stats = {
    paths: 0,
    points: 0,
    drawDistance: 0,
    travelDistance: 0,
    penLifts: 0,
    penDowns: 0,
    toolChanges: 0,
    estimatedSeconds: 0
  };
  for (const layer of document.layers) {
    if (!layer.visible || layer.paths.length === 0) continue;
    if (currentTool !== layer.toolId) {
      currentTool = layer.toolId;
      stats.toolChanges += 1;
      moves.push({ type: "tool-change", toolId: currentTool, layerId: layer.id });
    }
    const ordered = options.strategy === "input"
      ? layer.paths.map((path) => createPath(path.points, path))
      : orderPathsNearest(layer.paths, current, options);
    for (const path of ordered) {
      const start = path.points[0];
      const travelLength = distance(current, start);
      if (travelLength > 1e-9) {
        moves.push({
          type: "travel",
          from: clonePoint(current),
          to: clonePoint(start),
          length: travelLength,
          layerId: layer.id,
          toolId: currentTool
        });
        stats.travelDistance += travelLength;
      }
      const drawLength = pathLength(path.points);
      moves.push({
        type: "draw",
        points: path.points.map(clonePoint),
        length: drawLength,
        pathId: path.id,
        layerId: layer.id,
        toolId: currentTool,
        metadata: { ...path.metadata }
      });
      routes.push({ layerId: layer.id, toolId: currentTool, path });
      stats.paths += 1;
      stats.points += path.points.length;
      stats.drawDistance += drawLength;
      stats.penDowns += 1;
      stats.penLifts += 1;
      current = clonePoint(path.points[path.points.length - 1]);
    }
  }
  stats.estimatedSeconds = estimatePlan(stats, { ...options, units: document.units });
  return {
    schema: "vanilla.penplotter/plan@1",
    units: document.units,
    page: { ...document.page },
    tools: document.tools.map((tool) => ({ ...tool, metadata: { ...tool.metadata } })),
    routes,
    moves,
    stats,
    options: { ...options }
  };
}
