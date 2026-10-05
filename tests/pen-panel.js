import assert from 'node:assert/strict';
import { PlotterEngine } from '../vanilla.penplotter.js';
import { mountPen } from '../examples/pen.js';

const fields = new Map();
const defaults = { x: '0', y: '0', turn: '0', format: 'A4', machine: 'ebb' };
const context = new Proxy({ canvas: { width: 594, height: 432 } }, { get: (target, key) => target[key] ?? (() => {}) });
const container = {
  classList: { add() {} }, contains: () => false,
  querySelector(selector) {
    const key = selector.match(/"(.*?)"/)[1];
    if (!fields.has(key)) fields.set(key, { value: defaults[key] ?? '', textContent: '', handlers: {},
      addEventListener(event, handler) { this.handlers[event] = handler; }, getContext: () => context });
    return fields.get(key);
  }
};
const sent = [];
let controller;
const encode = text => new TextEncoder().encode(text);
const port = {
  readable: new ReadableStream({ start(c) { controller = c; } }),
  writable: new WritableStream({ write(bytes) {
    const text = new TextDecoder().decode(bytes); sent.push(text);
    controller.enqueue(encode(text === 'V\r' ? "DrawCore V2.09.20230318\r\n" : text === '?' ? '<Idle|WPos:0,0,0>\r\n' : 'ok\r\n'));
  } }), async close() {}
};
globalThis.document = { querySelectorAll: () => [] };
globalThis.window = { addEventListener() {}, confirm: () => true };
globalThis.localStorage = { getItem: () => null, removeItem() {} };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serial: { getPorts: async () => [port] } } });
const plot = new PlotterEngine({ units: 'mm', page: { width: 100, height: 100 } });
plot.line(12, 12, 22, 12);
mountPen(container, { getPlot: () => plot });
fields.get('machine').value = 'drawcore';
fields.get('machine').handlers.change();
assert.equal(fields.get('bed-size').textContent, '420 × 297 mm');
assert.equal(fields.get('resume').hidden, true);
await fields.get('dry').handlers.click();
assert.equal(sent.length, 0, 'dry run never touches the device');
assert.match(fields.get('log').textContent, /G21.*G90.*G94/);
// Connecting from the default EBB selection must select the DrawCore preset.
fields.get('machine').value = 'ebb';
fields.get('machine').handlers.change();
await fields.get('connect').handlers.click();
assert.equal(fields.get('machine').value, 'drawcore');
assert.equal(fields.get('bed-size').textContent, '420 × 297 mm');
assert.equal(fields.get('plot').disabled, false, fields.get('log').textContent);
await fields.get('plot').handlers.click();
assert(sent.includes('G1 X-12 Y-22 F600\r'), 'example uses DrawCore axis mapping and feed');
assert(!sent.some(command => /^(?:SP|EM|LM|SM),/.test(command)), 'example sends no EBB movement commands');
assert.match(fields.get('log').textContent, /Plot complete/);
assert.equal(fields.get('resume').hidden, true);
console.log('Example panel: DrawCore detection, dry run, bounds and complete serial plot verified; no hardware used.');

// The A4 examples start 60 mm below home on the larger EBB bed.
// Switching to the A3 H must fit untouched defaults without scaling strokes.
fields.clear();
defaults.x = '100'; defaults.y = '60';
const a4 = new PlotterEngine({ units: 'mm', page: { width: 210, height: 297 } });
a4.line(12, 12, 22, 12);
mountPen(container, { getPlot: () => a4, offset: { x: 100, y: 60 } });
fields.get('machine').value = 'drawcore';
fields.get('machine').handlers.change();
assert.equal(fields.get('x').value, '100');
assert.equal(fields.get('y').value, '0');
assert.equal(fields.get('dry').disabled, false, fields.get('status').textContent);
assert.equal(fields.get('sheet-size').textContent, '210 × 297 mm (X × Y)');
fields.get('machine').value = 'ebb'; fields.get('machine').handlers.change();
fields.get('y').value = '60'; fields.get('y').handlers.input();
fields.get('machine').value = 'drawcore'; fields.get('machine').handlers.change();
assert.equal(fields.get('y').value, '60', 'preserve a manually entered placement');
assert.equal(fields.get('dry').disabled, true, 'manual out-of-bounds placement stays blocked');
assert.match(fields.get('status').textContent, /210 × 297 mm at X=100, Y=60 exceeds the 420 × 297 mm bed/);
const beforeReset = sent.length;
fields.get('a4-origin').handlers.click();
assert.equal(fields.get('x').value, '0');
assert.equal(fields.get('y').value, '0');
assert.equal(fields.get('turn').value, '0');
assert.equal(fields.get('format').value, 'A4');
assert.equal(fields.get('dry').disabled, false);
assert.equal(sent.length, beforeReset, 'paper reset never moves the plotter');
console.log('Example placement: A4 default fits A3 H; manual offsets are preserved.');

// Every shared-panel composition uses A4 without changing its geometry.
await import('./fixtures/vanilla-waves-core.js');
const { builders } = await import('../docs/examples-builders.js');
for (const [name, build] of Object.entries(builders)) {
  fields.clear(); defaults.x = '0'; defaults.y = '0';
  // SVG parsing needs a browser DOMParser; exercise its fitted default bounds here.
  const example = name === 'svg_to_pen'
    ? new PlotterEngine({ units: 'mm', page: { width: 120, height: 90 } })
    : build(globalThis.VanillaWaves);
  if (name === 'svg_to_pen') example.rect(0, 0, 120, 90);
  mountPen(container, { getPlot: () => example, name });
  assert.equal(fields.get('sheet-size').textContent, '210 × 297 mm (X × Y)', name);
  assert.equal(fields.get('sheet-fit').textContent, 'Inside the bed', name);
  assert.equal(fields.get('dry').disabled, false, `${name}: ${fields.get('status').textContent}`);
}
console.log('Six example compositions and the SVG default bounds fit A4 at the work origin; SVG DOM parsing requires a browser.');
