import {
  cloneDocument,
  clonePoint,
  createPath,
  distance,
  pathLength
} from "../core/model.js";

function perpendicularDistance(value, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return distance(value, start);
  // Measure against the finite segment, not its infinite supporting line.
  // Otherwise collinear excursions beyond either endpoint disappear.
  const ratio = Math.max(0, Math.min(1,
    ((value.x - start.x) * dx + (value.y - start.y) * dy) / (dx * dx + dy * dy)
  ));
  const projected = { x: start.x + ratio * dx, y: start.y + ratio * dy };
  return distance(value, projected);
}

export function simplifyPath(points, tolerance = 0.05) {
  if (points.length <= 2 || tolerance <= 0) return points.map(clonePoint);
  let maxDistance = 0;
  let splitIndex = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = perpendicularDistance(points[index], points[0], points[points.length - 1]);
    if (current > maxDistance) {
      maxDistance = current;
      splitIndex = index;
    }
  }
  if (maxDistance <= tolerance) return [clonePoint(points[0]), clonePoint(points[points.length - 1])];
  const left = simplifyPath(points.slice(0, splitIndex + 1), tolerance);
  const right = simplifyPath(points.slice(splitIndex), tolerance);
  return left.slice(0, -1).concat(right);
}

export function resamplePath(points, maxSegmentLength = 1) {
  if (points.length <= 1 || maxSegmentLength <= 0) return points.map(clonePoint);
  const result = [clonePoint(points[0])];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const length = distance(start, end);
    const segments = Math.max(1, Math.ceil(length / maxSegmentLength));
    for (let step = 1; step <= segments; step += 1) {
      const ratio = step / segments;
      result.push({
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio
      });
    }
  }
  return result;
}

function quantize(value, tolerance) {
  return Math.round(value / tolerance);
}

function pathKey(path, tolerance) {
  const forward = path.points
    .map((value) => `${quantize(value.x, tolerance)},${quantize(value.y, tolerance)}`)
    .join(";");
  if (!path.reversible) return forward;
  const reverse = path.points
    .slice()
    .reverse()
    .map((value) => `${quantize(value.x, tolerance)},${quantize(value.y, tolerance)}`)
    .join(";");
  return forward < reverse ? forward : reverse;
}

export function deduplicatePaths(paths, tolerance = 0.01) {
  const seen = new Set();
  const result = [];
  for (const path of paths) {
    const key = pathKey(path, Math.max(tolerance, 1e-9));
    if (!seen.has(key)) {
      seen.add(key);
      result.push(createPath(path.points, path));
    }
  }
  return result;
}

function reversePoints(points) {
  return points.slice().reverse().map(clonePoint);
}

function tryMerge(a, b, tolerance) {
  if (a.closed || b.closed || !a.reversible || !b.reversible) return null;
  const aStart = a.points[0];
  const aEnd = a.points[a.points.length - 1];
  const bStart = b.points[0];
  const bEnd = b.points[b.points.length - 1];
  if (distance(aEnd, bStart) <= tolerance) return a.points.concat(b.points.slice(1));
  if (distance(aEnd, bEnd) <= tolerance) return a.points.concat(reversePoints(b.points).slice(1));
  if (distance(aStart, bEnd) <= tolerance) return b.points.concat(a.points.slice(1));
  if (distance(aStart, bStart) <= tolerance) return reversePoints(b.points).concat(a.points.slice(1));
  return null;
}

export function mergePaths(paths, tolerance = 0.05) {
  const remaining = paths.map((path) => createPath(path.points, path));
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let aIndex = 0; aIndex < remaining.length; aIndex += 1) {
      for (let bIndex = aIndex + 1; bIndex < remaining.length; bIndex += 1) {
        const merged = tryMerge(remaining[aIndex], remaining[bIndex], tolerance);
        if (!merged) continue;
        remaining[aIndex] = createPath(merged, {
          ...remaining[aIndex],
          id: remaining[aIndex].id,
          metadata: {
            ...remaining[aIndex].metadata,
            mergedFrom: [remaining[aIndex].id, remaining[bIndex].id]
          }
        });
        remaining.splice(bIndex, 1);
        changed = true;
        break outer;
      }
    }
  }
  return remaining;
}

export function removeDegeneratePaths(paths, minLength = 0.01) {
  return paths
    .filter((path) => path.metadata.effect === "stipple" || pathLength(path.points) >= minLength)
    .map((path) => createPath(path.points, path));
}

export function optimizeDocument(document, options = {}, pluginHost = null) {
  const result = cloneDocument(document);
  const passes = options.passes || ["deduplicate", "merge", "simplify", "resample", "clean"];
  for (const layer of result.layers) {
    let paths = layer.paths;
    for (const pass of passes) {
      if (pass === "deduplicate") paths = deduplicatePaths(paths, options.duplicateTolerance ?? 0.01);
      else if (pass === "merge") paths = mergePaths(paths, options.mergeTolerance ?? 0.05);
      else if (pass === "simplify") {
        paths = paths.map((path) => createPath(
          simplifyPath(path.points, options.simplifyTolerance ?? 0.03),
          path
        ));
      } else if (pass === "resample" && options.maxSegmentLength) {
        paths = paths.map((path) => createPath(
          resamplePath(path.points, options.maxSegmentLength),
          path
        ));
      } else if (pass === "clean") {
        paths = removeDegeneratePaths(paths, options.minPathLength ?? 0.01);
      } else if (pluginHost && pluginHost.has("optimizer", pass)) {
        paths = pluginHost.get("optimizer", pass)(paths, options, layer);
      } else if (!["resample"].includes(pass)) {
        throw new Error(`Unknown optimizer pass: ${pass}`);
      }
    }
    layer.paths = paths;
  }
  return result;
}
