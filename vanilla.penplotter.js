import {
  addLayer,
  createDocument,
  createTool,
  getLayer
} from "./src/core/model.js";
import * as Geometry from "./src/geometry/index.js";
import { optimizeDocument } from "./src/optimizer/index.js";
import { planDocument } from "./src/planner/index.js";
import {
  drawPreview,
  renderGCode,
  renderHPGL,
  renderJSON,
  renderSVG
} from "./src/renderer/index.js";
import { PluginHost } from "./src/plugins/index.js";

// Adapters such as p5.penplotter read this to refuse a core that is too old.
export const VERSION = "0.3.1";

export class PlotterEngine {
  static version = VERSION;

  constructor(options = {}) {
    this.plugins = options.plugins || new PluginHost();
    this.document = createDocument(options);
    this.activeLayer = addLayer(this.document, {
      id: options.layerId || "default",
      name: options.layerName || "Default",
      toolId: options.toolId || "pen-1"
    });
    this.optimized = null;
    this.planned = null;
    this._documentSnapshot = JSON.stringify(this.document);
    this._optimizationOptions = {};
    this._planOptions = {};
  }

  // Paths, layers and tools can also be edited through the public document.
  // Check its contents before reusing derived geometry or a machine plan.
  _syncDocument() {
    const snapshot = JSON.stringify(this.document);
    if (snapshot !== this._documentSnapshot) {
      this.optimized = null;
      this.planned = null;
      this._documentSnapshot = snapshot;
    }
  }

  _currentPlan(options = this._planOptions) {
    this._syncDocument();
    return this.planned || this.plan(options);
  }

  tool(options = {}) {
    const tool = createTool(options);
    const existing = this.document.tools.findIndex((value) => value.id === tool.id);
    if (existing >= 0) this.document.tools[existing] = tool;
    else this.document.tools.push(tool);
    return tool;
  }

  layer(id, options = {}) {
    let layer = getLayer(this.document, id);
    if (!layer) layer = addLayer(this.document, { ...options, id, name: options.name || id });
    this.activeLayer = layer;
    return layer;
  }

  line(x1, y1, x2, y2, options) {
    return Geometry.line(this.activeLayer, x1, y1, x2, y2, options);
  }

  polyline(points, options) {
    return Geometry.polyline(this.activeLayer, points, options);
  }

  polygon(points, options) {
    return Geometry.polygon(this.activeLayer, points, options);
  }

  rect(x, y, width, height, options) {
    return Geometry.rectangle(this.activeLayer, x, y, width, height, options);
  }

  circle(x, y, radius, options) {
    return Geometry.circle(this.activeLayer, x, y, radius, options);
  }

  arc(x, y, radius, startAngle, endAngle, options) {
    return Geometry.arc(this.activeLayer, x, y, radius, startAngle, endAngle, options);
  }

  hatch(points, options) {
    return Geometry.hatchPolygon(this.activeLayer, points, options);
  }

  crossHatch(points, options) {
    return Geometry.crossHatchPolygon(this.activeLayer, points, options);
  }

  stipple(points, options) {
    return Geometry.stipplePolygon(this.activeLayer, points, options);
  }

  use(plugin) {
    this.plugins.use(plugin);
    return this;
  }

  importSVG(svg, options = {}) {
    const imported = Geometry.importSVG(svg, options);
    for (const layer of imported.layers) {
      const target = addLayer(this.document, {
        ...layer,
        id: getLayer(this.document, layer.id) ? `${layer.id}-${this.document.layers.length}` : layer.id
      });
      target.paths = layer.paths;
    }
    return imported;
  }

  optimize(options = {}) {
    this._syncDocument();
    this.optimized = optimizeDocument(this.document, options, this.plugins);
    this._optimizationOptions = { ...options };
    this.planned = null;
    return this.optimized;
  }

  plan(options = {}) {
    this._syncDocument();
    const source = options.useRaw ? this.document : (this.optimized || this.optimize(options.optimize || this._optimizationOptions));
    this.planned = planDocument(source, options);
    this._planOptions = { ...options };
    return this.planned;
  }

  stats(options = this._planOptions) {
    return this._currentPlan(options).stats;
  }

  exportSVG(options = {}) {
    return renderSVG(this._currentPlan(options.plan), options);
  }

  exportHPGL(options = {}) {
    return renderHPGL(this._currentPlan(options.plan), options);
  }

  exportGCode(options = {}) {
    return renderGCode(this._currentPlan(options.plan), options);
  }

  exportJSON(options = {}) {
    return renderJSON(this._currentPlan(options.plan), options);
  }

  drawPreview(context, options = {}) {
    return drawPreview(context, this._currentPlan(options.plan), options);
  }
}

export * from "./src/core/model.js";
export * as Geometry from "./src/geometry/index.js";
export * as Optimizer from "./src/optimizer/index.js";
export * as Planner from "./src/planner/index.js";
export * as Renderer from "./src/renderer/index.js";
export * as Driver from "./src/driver/index.js";
export * from "./src/plugins/index.js";
