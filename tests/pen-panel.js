import assert from 'node:assert/strict';
import { PlotterEngine } from '../vanilla.penplotter.js';
import { mountPen } from '../examples/pen.js';

const fields = new Map();
const defaults = { x: '0', y: '0', turn: '0', format: 'drawing', machine: 'ebb' };
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
await fields.get('connect').handlers.click();
assert.equal(fields.get('plot').disabled, false, fields.get('log').textContent);
await fields.get('plot').handlers.click();
assert(sent.includes('G1 X-12 Y-22 F600\r'), 'example uses DrawCore axis mapping and feed');
assert(!sent.some(command => /^(?:SP|EM|LM|SM),/.test(command)), 'example sends no EBB movement commands');
assert.match(fields.get('log').textContent, /Plot complete/);
assert.equal(fields.get('resume').hidden, true);
console.log('Example panel: DrawCore detection, dry run, bounds and complete serial plot verified; no hardware used.');
