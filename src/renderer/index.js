import { millimetersPerUnit } from "../core/model.js";

function number(value, precision = 3) {
  return Number(value.toFixed(precision)).toString();
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function pathData(points, precision) {
  return points.map((value, index) => (
    `${index === 0 ? "M" : "L"}${number(value.x, precision)} ${number(value.y, precision)}`
  )).join(" ");
}

export function renderSVG(plan, options = {}) {
  const precision = Math.max(0, Math.floor(options.precision ?? 3));
  const toolMap = new Map(plan.tools.map((tool) => [tool.id, tool]));
  const routesByLayer = new Map();
  for (const route of plan.routes) {
    if (!routesByLayer.has(route.layerId)) routesByLayer.set(route.layerId, []);
    routesByLayer.get(route.layerId).push(route);
  }
  const body = [];
  for (const [layerId, routes] of routesByLayer) {
    const tool = toolMap.get(routes[0].toolId) || {};
    body.push(`<g id="${escapeXml(layerId)}" data-tool="${escapeXml(routes[0].toolId)}">`);
    for (let index = 0; index < routes.length; index += 1) {
      const route = routes[index];
      body.push(`<path d="${pathData(route.path.points, precision)}" data-order="${index + 1}" data-path="${escapeXml(route.path.id)}"/>`);
    }
    body.push(`</g>`);
    body.push(`<metadata data-layer="${escapeXml(layerId)}" data-pen-color="${escapeXml(tool.color || "#111111")}"/>`);
  }
  const travel = options.showTravel
    ? plan.moves.filter((move) => move.type === "travel").map((move) => (
      `<path class="pen-up" d="M${number(move.from.x, precision)} ${number(move.from.y, precision)} L${number(move.to.x, precision)} ${number(move.to.y, precision)}"/>`
    )).join("")
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${plan.page.width}${plan.units}" height="${plan.page.height}${plan.units}" viewBox="0 0 ${plan.page.width} ${plan.page.height}">\n<style>path{fill:none;stroke:#111;stroke-width:.35;stroke-linecap:round;stroke-linejoin:round}.pen-up{stroke:#e05a47;stroke-width:.18;stroke-dasharray:1 1;opacity:.65}</style>\n${body.join("\n")}\n${travel}\n</svg>`;
}

export function renderHPGL(plan, options = {}) {
  const unitsPerMm = Number(options.unitsPerMm ?? 40) * millimetersPerUnit(plan.units);
  const penMap = options.penMap || {};
  const commands = ["IN"];
  let pen = 1;
  for (const move of plan.moves) {
    if (move.type === "tool-change") {
      pen = Number(penMap[move.toolId] ?? pen + (commands.length > 1 ? 1 : 0));
      commands.push(`SP${pen}`);
    } else if (move.type === "travel") {
      commands.push(`PU${Math.round(move.to.x * unitsPerMm)},${Math.round(move.to.y * unitsPerMm)}`);
    } else if (move.type === "draw") {
      const start = move.points[0];
      commands.push(`PU${Math.round(start.x * unitsPerMm)},${Math.round(start.y * unitsPerMm)}`);
      const coordinates = move.points.map((value) => (
        `${Math.round(value.x * unitsPerMm)},${Math.round(value.y * unitsPerMm)}`
      )).join(",");
      commands.push(`PD${coordinates}`);
      commands.push("PU");
    }
  }
  commands.push("SP0");
  return `${commands.join(";")};`;
}

export function renderGCode(plan, options = {}) {
  const scale = millimetersPerUnit(plan.units);
  const coordinate = (value) => number(value * scale);
  const drawFeed = Number(options.drawFeed ?? 1800);
  const travelFeed = Number(options.travelFeed ?? 4200);
  const penUp = options.penUp || "M5";
  const penDown = options.penDown || "M3 S1000";
  const lines = ["G21", "G90", penUp];
  for (const move of plan.moves) {
    if (move.type === "tool-change") {
      lines.push(`; tool ${move.toolId}`);
    } else if (move.type === "travel") {
      lines.push(penUp);
      lines.push(`G0 X${coordinate(move.to.x)} Y${coordinate(move.to.y)} F${travelFeed}`);
    } else if (move.type === "draw") {
      const start = move.points[0];
      lines.push(penUp);
      lines.push(`G0 X${coordinate(start.x)} Y${coordinate(start.y)} F${travelFeed}`);
      lines.push(penDown);
      for (let index = 1; index < move.points.length; index += 1) {
        const value = move.points[index];
        lines.push(`G1 X${coordinate(value.x)} Y${coordinate(value.y)} F${drawFeed}`);
      }
      lines.push(penUp);
    }
  }
  lines.push("M2");
  return `${lines.join("\n")}\n`;
}

export function renderJSON(plan, options = {}) {
  return JSON.stringify(plan, null, options.compact ? 0 : 2);
}

export function drawPreview(context, plan, options = {}) {
  const width = context.canvas.width;
  const height = context.canvas.height;
  const padding = Number(options.padding ?? 24);
  const scale = Math.min(
    (width - padding * 2) / plan.page.width,
    (height - padding * 2) / plan.page.height
  );
  const offsetX = (width - plan.page.width * scale) / 2;
  const offsetY = (height - plan.page.height * scale) / 2;
  context.clearRect(0, 0, width, height);
  context.fillStyle = options.paper || "#f7f4ec";
  context.fillRect(offsetX, offsetY, plan.page.width * scale, plan.page.height * scale);
  if (options.showTravel) {
    context.save();
    context.setLineDash([4, 4]);
    context.strokeStyle = options.travelColor || "rgba(222, 78, 55, .45)";
    context.lineWidth = 1;
    for (const move of plan.moves) {
      if (move.type !== "travel") continue;
      context.beginPath();
      context.moveTo(offsetX + move.from.x * scale, offsetY + move.from.y * scale);
      context.lineTo(offsetX + move.to.x * scale, offsetY + move.to.y * scale);
      context.stroke();
    }
    context.restore();
  }
  const toolMap = new Map(plan.tools.map((tool) => [tool.id, tool]));
  const progress = Math.max(0, Math.min(1, Number(options.progress ?? 1)));
  const drawMoves = plan.moves.filter((move) => move.type === "draw");
  const visibleCount = Math.ceil(drawMoves.length * progress);
  context.lineCap = "round";
  context.lineJoin = "round";
  for (let moveIndex = 0; moveIndex < visibleCount; moveIndex += 1) {
    const move = drawMoves[moveIndex];
    const tool = toolMap.get(move.toolId) || {};
    context.strokeStyle = tool.color || options.ink || "#151515";
    context.lineWidth = Math.max(0.75, Number(tool.width ?? 0.35) * scale);
    context.beginPath();
    for (let index = 0; index < move.points.length; index += 1) {
      const value = move.points[index];
      const x = offsetX + value.x * scale;
      const y = offsetY + value.y * scale;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
  }
}
