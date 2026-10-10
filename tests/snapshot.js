import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PlotterEngine,
  Geometry,
  Optimizer,
  Planner,
  PluginHost,
  Renderer
} from "../vanilla.penplotter.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function testPipeline() {
  const plot = new PlotterEngine({
    units: "mm",
    page: { width: 210, height: 297 }
  });
  plot.line(10, 10, 20, 10, { id: "a" });
  plot.line(20, 10, 30, 10, { id: "b" });
  plot.line(10, 10, 20, 10, { id: "duplicate" });
  const optimized = plot.optimize({
    duplicateTolerance: 0.001,
    mergeTolerance: 0.001,
    simplifyTolerance: 0
  });
  assert.equal(optimized.layers[0].paths.length, 1);
  assert.equal(optimized.layers[0].paths[0].points.length, 3);
  const plan = plot.plan({ strategy: "nearest", drawSpeed: 10, travelSpeed: 20 });
  assert.equal(plan.stats.paths, 1);
  assert.equal(plan.stats.drawDistance, 20);
  assert.ok(plan.stats.travelDistance > 14 && plan.stats.travelDistance < 15);
  assert.ok(plan.stats.estimatedSeconds > 2);
  assert.match(plot.exportSVG(), /data-path="a"/);
  assert.match(plot.exportHPGL(), /^IN;SP1;/);
  assert.match(plot.exportGCode(), /G1 X20 Y10/);
  assert.equal(JSON.parse(plot.exportJSON()).schema, "vanilla.penplotter/plan@1");
}

function testPatterns() {
  const a = new PlotterEngine({ units: "mm" });
  const b = new PlotterEngine({ units: "mm" });
  const polygon = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 0, y: 30 }];
  a.hatch(polygon, { spacing: 3, angle: Math.PI / 4 });
  assert.ok(a.document.layers[0].paths.length > 8);
  a.stipple(polygon, { count: 25, minDistance: 2, seed: 99 });
  b.stipple(polygon, { count: 25, minDistance: 2, seed: 99 });
  const aPoints = a.document.layers[0].paths.slice(-25).map((value) => value.points);
  const bPoints = b.document.layers[0].paths.map((value) => value.points);
  assert.deepEqual(aPoints, bPoints);
}

function testEditsAfterPlanning() {
  const polygon = [{ x: 30, y: 30 }, { x: 50, y: 30 }, { x: 50, y: 50 }];
  const edits = {
    line: (plot) => plot.line(30, 30, 50, 30),
    polyline: (plot) => plot.polyline(polygon),
    polygon: (plot) => plot.polygon(polygon),
    rect: (plot) => plot.rect(30, 30, 20, 20),
    circle: (plot) => plot.circle(40, 40, 10),
    arc: (plot) => plot.arc(40, 40, 10, 0, Math.PI),
    hatch: (plot) => plot.hatch(polygon, { spacing: 5 }),
    crossHatch: (plot) => plot.crossHatch(polygon, { spacing: 5 }),
    stipple: (plot) => plot.stipple(polygon, { count: 3, seed: 7 }),
    tool: (plot) => plot.tool({ id: "pen-1", color: "#ff0000", width: 1 }),
    layer: (plot) => plot.layer("extra", {
      paths: [{ id: "extra-path", points: polygon }]
    })
  };

  for (const [name, edit] of Object.entries(edits)) {
    const plot = new PlotterEngine();
    plot.line(10, 10, 20, 10);
    const previousPlan = plot.plan();
    const previousSnapshot = JSON.stringify(previousPlan);
    edit(plot);
    const sourceSnapshot = JSON.stringify(plot.document);
    const expected = Planner.planDocument(Optimizer.optimizeDocument(plot.document));

    // Export first: consumers must not need an explicit replan after an edit.
    assert.deepEqual(JSON.parse(plot.exportJSON()), expected, `${name}: export after edit`);
    assert.deepEqual(plot.plan(), expected, `${name}: replan after edit`);
    assert.equal(JSON.stringify(previousPlan), previousSnapshot, `${name}: old plan stays intact`);
    assert.equal(JSON.stringify(plot.document), sourceSnapshot, `${name}: source stays intact`);
  }
}

function testPlanConsumersAfterEditing() {
  const consumers = {
    stats: (plot, expected) => assert.deepEqual(plot.stats(), expected.stats),
    svg: (plot, expected) => assert.equal(plot.exportSVG(), Renderer.renderSVG(expected)),
    hpgl: (plot, expected) => assert.equal(plot.exportHPGL(), Renderer.renderHPGL(expected)),
    gcode: (plot, expected) => assert.equal(plot.exportGCode(), Renderer.renderGCode(expected)),
    plan: (plot, expected) => assert.deepEqual(plot.plan(), expected),
    preview: (plot, expected) => {
      // Record canvas commands in Node; this checks plan consumption, not browser rendering.
      const commands = [];
      const context = { canvas: { width: 600, height: 800 } };
      for (const name of ["clearRect", "fillRect", "beginPath", "moveTo", "lineTo", "stroke"]) {
        context[name] = (...args) => commands.push([name, ...args]);
      }
      plot.drawPreview(context);
      const actual = commands.splice(0);
      Renderer.drawPreview(context, expected);
      assert.deepEqual(actual, commands);
    }
  };
  for (const consume of Object.values(consumers)) {
    const plot = new PlotterEngine();
    plot.line(10, 10, 20, 10);
    plot.plan();
    plot.line(10, 30, 20, 30);
    const expected = Planner.planDocument(Optimizer.optimizeDocument(plot.document));
    assert.equal(expected.stats.paths, 2);
    consume(plot, expected);
  }

  const plot = new PlotterEngine();
  plot.line(10, 10, 20, 10);
  plot.optimize();
  plot.line(10, 30, 20, 30);
  assert.equal(plot.plan().stats.paths, 2, "edits after optimization also invalidate the snapshot");

  const plan = plot.plan({ drawSpeed: 7 });
  plot.layer("default");
  plot.exportSVG();
  assert.equal(plot.planned, plan, "selecting an existing layer preserves the configured plan");
}

function testImportAfterPlanning() {
  // Supply a parsed DOM fixture through the supported parser injection point.
  // XML parsing itself remains a separate browser/package integration check.
  const line = {
    nodeType: 1,
    tagName: "line",
    getAttribute: (name) => ({ x1: "30", y1: "30", x2: "50", y2: "30" })[name] ?? null
  };
  class FixtureParser {
    parseFromString() {
      return {
        querySelector: () => null,
        documentElement: {
          nodeType: 1,
          tagName: "svg",
          getAttribute: () => null,
          children: [line]
        }
      };
    }
  }
  const plot = new PlotterEngine();
  plot.line(10, 10, 20, 10);
  const previous = plot.plan();
  plot.importSVG('<svg><line x1="30" y1="30" x2="50" y2="30"/></svg>', {
    DOMParser: FixtureParser
  });
  assert.equal(JSON.parse(plot.exportJSON()).stats.paths, 2);
  assert.equal(previous.stats.paths, 1);
}

function testSVGParser() {
  const paths = Geometry.parseSVGPath("M0 0 L10 0 C10 0 15 10 20 10 A5 5 0 0 1 25 15 Z", {
    curveSteps: 6,
    arcSteps: 24
  });
  assert.equal(paths.length, 1);
  assert.equal(paths[0].closed, true);
  assert.ok(paths[0].points.length > 10);
  assert.deepEqual(paths[0].points[0], paths[0].points[paths[0].points.length - 1]);
}

// A very small XML reader for the SVG fixtures below: tags, attributes and
// nesting, nothing else. It stands in for the browser's DOMParser.
class MiniXmlParser {
  parseFromString(text) {
    const root = { nodeType: 1, tagName: "#root", attrs: {}, children: [] };
    const stack = [root];
    for (const match of String(text).matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>/g)) {
      const [, closing, name, attributes, selfClosing] = match;
      if (closing) {
        stack.pop();
        continue;
      }
      const attrs = {};
      for (const attribute of attributes.matchAll(/([\w:.-]+)="([^"]*)"/g)) attrs[attribute[1]] = attribute[2];
      const node = {
        nodeType: 1,
        tagName: name,
        attrs,
        id: attrs.id || "",
        children: [],
        getAttribute: (key) => (key in attrs ? attrs[key] : null)
      };
      stack[stack.length - 1].children.push(node);
      if (!selfClosing) stack.push(node);
    }
    return { querySelector: () => null, documentElement: root.children[0] };
  }
}

// What p5.gysin's plotter SVG looks like: a clipPath, one Inkscape layer per
// pen, and a data-pen number on each layer.
const LAYERED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="148mm" height="210mm" viewBox="0 0 148 210">
  <title>layered</title>
  <metadata>{}</metadata>
  <clipPath id="page"><rect x="10" y="10" width="128" height="190" /></clipPath>
  <g id="layer-1-black" data-pen="1" inkscape:groupmode="layer" inkscape:label="1 black" clip-path="url(#page)">
    <path d="M 20 20 L 60 20" stroke="#111111" />
    <path d="M 20 30 L 60 30" stroke="#111111" />
  </g>
  <g id="layer-2-red" data-pen="2" inkscape:groupmode="layer" inkscape:label="2 red" clip-path="url(#page)">
    <path d="M 20 40 L 60 40" stroke="#cc0000" />
  </g>
</svg>`;

function testSVGLayers() {
  const imported = Geometry.importSVG(LAYERED_SVG, { DOMParser: MiniXmlParser });
  assert.deepEqual(imported.layers.map((layer) => layer.id), ["layer-1-black", "layer-2-red"], "each Inkscape layer is a layer; the empty catch-all is dropped");
  assert.deepEqual(imported.layers.map((layer) => layer.paths.length), [2, 1], "the clipPath rectangle is not geometry");
  assert.deepEqual(imported.layers.map((layer) => layer.toolId), ["pen-1", "pen-2"]);
  assert.equal(imported.layers[0].name, "1 black");
  const pens = Object.fromEntries(imported.tools.map((tool) => [tool.id, tool]));
  assert.equal(pens["pen-1"].id, "pen-1", "pen 1 is the default pen, not a second one");
  assert.equal(imported.tools.filter((tool) => tool.id === "pen-1").length, 1);
  assert.equal(pens["pen-2"].name, "Pen 2");
  assert.equal(pens["pen-2"].color, "#cc0000", "the pen wears the ink it draws");
  assert.deepEqual(imported.page, { width: 148, height: 210, margin: 0, origin: "top-left" });

  // Through the engine: both pens survive into the plan, in layer order.
  const plot = new PlotterEngine({ units: "mm", page: { width: 148, height: 210, margin: 0 } });
  plot.importSVG(LAYERED_SVG, { DOMParser: MiniXmlParser });
  assert.ok(plot.document.tools.some((tool) => tool.id === "pen-2"), "the engine receives the imported pens");
  const plan = plot.plan({ strategy: "drawn" });
  assert.equal(plan.stats.paths, 3);
  assert.equal(plan.stats.toolChanges, 2);
  assert.deepEqual(plan.moves.filter((move) => move.type === "tool-change").map((move) => move.toolId), ["pen-1", "pen-2"]);

  // Layers that open with the same number share one physical pen.
  const shared = Geometry.importSVG(
    `<svg xmlns:inkscape="x" width="100" height="100"><g id="a" inkscape:groupmode="layer" inkscape:label="1 outline"><line x1="0" y1="0" x2="5" y2="0"/></g><g id="b" inkscape:groupmode="layer" inkscape:label="1 detail"><line x1="0" y1="2" x2="5" y2="2"/></g></svg>`,
    { DOMParser: MiniXmlParser }
  );
  assert.deepEqual(shared.layers.map((layer) => layer.toolId), ["pen-1", "pen-1"]);
  assert.equal(shared.tools.length, 1);

  // A layer without a number is a pen of its own, named by its label.
  const named = Geometry.importSVG(
    `<svg xmlns:inkscape="x" width="100" height="100"><g id="blue" inkscape:groupmode="layer" inkscape:label="Blue"><line x1="0" y1="0" x2="5" y2="0" stroke="#0000ff"/></g></svg>`,
    { DOMParser: MiniXmlParser }
  );
  assert.equal(named.layers[0].toolId, "pen-blue");
  const bluePen = named.tools.find((tool) => tool.id === "pen-blue");
  assert.equal(bluePen.name, "Blue");
  assert.equal(bluePen.color, "#0000ff");

  // Loose geometry next to layers keeps its own layer.
  const mixed = Geometry.importSVG(
    `<svg xmlns:inkscape="x" width="100" height="100"><line x1="0" y1="0" x2="9" y2="0"/><g id="p" inkscape:groupmode="layer" inkscape:label="2 red"><line x1="0" y1="2" x2="5" y2="2"/></g></svg>`,
    { DOMParser: MiniXmlParser }
  );
  assert.deepEqual(mixed.layers.map((layer) => layer.id), ["svg", "p"]);

  // layers: "single" is the old behaviour, with the same clean geometry.
  const single = Geometry.importSVG(LAYERED_SVG, { DOMParser: MiniXmlParser, layers: "single" });
  assert.deepEqual(single.layers.map((layer) => [layer.id, layer.paths.length]), [["svg", 3]]);
  assert.throws(() => Geometry.importSVG(LAYERED_SVG, { DOMParser: MiniXmlParser, layers: "pens" }), /auto" or "single/);

  // A plain SVG is unchanged: one layer, and definitions are not drawn.
  const plain = Geometry.importSVG(
    `<svg width="50" height="50"><defs><path d="M 0 0 L 9 9"/></defs><line x1="0" y1="0" x2="5" y2="0"/></svg>`,
    { DOMParser: MiniXmlParser }
  );
  assert.deepEqual(plain.layers.map((layer) => [layer.id, layer.paths.length]), [["svg", 1]]);
  assert.equal(plain.tools.length, 1);
}

function testPlugin() {
  const host = new PluginHost();
  host.use({
    install(pluginHost) {
      pluginHost.register("optimizer", "identity-test", function identity(paths) {
        return paths;
      });
    }
  });
  assert.equal(host.has("optimizer", "identity-test"), true);
  assert.equal(host.get("optimizer", "identity-test")([1])[0], 1);
}

function testRenderer() {
  const plot = new PlotterEngine({ units: "mm" });
  plot.circle(50, 50, 10, { segments: 16 });
  const plan = plot.plan();
  const svg = Renderer.renderSVG(plan, { showTravel: true });
  assert.match(svg, /<svg/);
  assert.match(svg, /class="pen-up"/);
}

// docs/architecture.html and docs/roadmap.html are rendered from Markdown;
// a stale page is a failing test, not a surprise on GitHub Pages.
async function testGeneratedDocs() {
  const { buildDocs } = await import("../tools/build-docs.js");
  assert.deepEqual(buildDocs(false), [], "run `npm run docs` and commit the result");
}

// Every example that has a pure composition must build a plan headlessly.
async function testExampleCompositions() {
  const { buildFirstJob } = await import("../examples/first_job/composition.js");
  const { buildTwoPens } = await import("../examples/two_pens/composition.js");
  const { buildRouteLab } = await import("../examples/route_lab/composition.js");
  assert.ok(buildFirstJob().plan().stats.paths > 10);
  const twoPens = buildTwoPens().plan();
  assert.equal(twoPens.stats.toolChanges, 2, "two pens, two tool picks");
  assert.match(buildTwoPens().exportHPGL({ penMap: { black: 1, red: 2 } }), /SP2/, "pen map reaches HPGL");
  const lab = buildRouteLab();
  lab.optimize({ passes: [] });
  const raw = lab.plan({ strategy: "input" });
  lab.optimize({ mergeTolerance: 0.05, duplicateTolerance: 0.01, simplifyTolerance: 0.05 });
  const planned = lab.plan({ strategy: "nearest" });
  assert.ok(planned.stats.paths < raw.stats.paths / 5, "route lab: merge and dedupe collapse the fragments");
  assert.ok(planned.stats.travelDistance < raw.stats.travelDistance / 10, "route lab: nearest order cuts travel");
}

// The site's live previews are ordinary consumers of the engine: run every
// builder with a recording canvas. The wave builders need vanilla.waves and
// are skipped offline (see tests/waves-integration.js).
// SVG import needs a DOM parser; those previews are covered in the browser.
function tryBuild(build) {
  try {
    return build();
  } catch (error) {
    if (/DOMParser/.test(error.message)) return null;
    throw error;
  }
}
function recordingContext() {
  const context = { canvas: { width: 520, height: 220 }, strokes: 0 };
  for (const name of ["clearRect", "fillRect", "beginPath", "moveTo", "lineTo", "save", "restore", "setLineDash"]) context[name] = () => {};
  context.stroke = () => { context.strokes += 1; };
  return context;
}
async function testSitePreviews() {
  const possibilities = await import("../docs/possibilities-builders.js");
  for (const [name, build] of Object.entries(possibilities.builders)) {
    const context = recordingContext();
    const plan = tryBuild(build);
    if (!plan) continue;
    Renderer.drawPreview(context, plan, { showTravel: true });
    assert.ok(context.strokes > 0, `possibility ${name} draws something`);
  }
  assert.match(possibilities.programs(), /HPGL[\s\S]*G-code[\s\S]*EBB[\s\S]*SM,/);
  const examples = await import("../docs/examples-builders.js");
  for (const [name, build] of Object.entries(examples.builders)) {
    if (name === "waves_pen" || name === "wave_hatch") continue;
    const context = recordingContext();
    const plot = tryBuild(build);
    if (!plot) continue;
    plot.drawPreview(context, { showTravel: true });
    assert.ok(context.strokes > 0, `example preview ${name} draws something`);
  }
}

function testStaticLinks() {
  const files = [
    "index.html",
    "docs/guide.html",
    "docs/examples.html",
    "docs/possibilities.html",
    "docs/about.html",
    "docs/architecture.html",
    "docs/roadmap.html",
    ...fs.readdirSync(path.join(root, "examples"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `examples/${entry.name}/index.html`)
  ];
  for (const relative of files) {
    const full = path.join(root, relative);
    assert.equal(fs.existsSync(full), true, `Missing ${relative}`);
    const html = fs.readFileSync(full, "utf8");
    const pageMarkup = html.replace(/<pre[\s\S]*?<\/pre>/g, "");
    for (const match of pageMarkup.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const target = match[1];
      if (/^(?:https?:|#)/.test(target)) continue;
      const resolved = path.resolve(path.dirname(full), target.split(/[#?]/)[0]);
      assert.equal(fs.existsSync(resolved), true, `Broken link ${target} in ${relative}`);
    }
  }
}

testPipeline();
testEditsAfterPlanning();
testPlanConsumersAfterEditing();
testImportAfterPlanning();
testPatterns();
testSVGParser();
testSVGLayers();
testPlugin();
testRenderer();
testStaticLinks();
await testGeneratedDocs();
await testExampleCompositions();
await testSitePreviews();
console.log("vanilla.penplotter snapshot: ok");
