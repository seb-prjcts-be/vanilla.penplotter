"""Build single-file screen examples from the actual drawing sources."""
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[1]
WAVES='https://cdn.jsdelivr.net/gh/seb-prjcts-be/vanilla.waves@4fad55570d9dab243e99f40181f12b5aede2c5be/waves-core.js'

def load_core(names):
    return '''const response = await fetch(`https://api.github.com/repos/seb-prjcts-be/vanilla.penplotter/commits/main?t=${Date.now()}`, { cache: "no-store" });
if (!response.ok) throw new Error(`Cannot resolve vanilla.penplotter/main: HTTP ${response.status}`);
const { sha } = await response.json();
if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Invalid vanilla.penplotter commit");
const core = `https://cdn.jsdelivr.net/gh/seb-prjcts-be/vanilla.penplotter@${sha}`;
console.info("penplotter source", { core });
const { '''+names+''' } = await import(`${core}/vanilla.penplotter.js`);'''

def source(name,file):
    text=(ROOT/'examples'/name/file).read_text(encoding='utf-8')
    text=re.sub(r'^import .*?;\n','',text,flags=re.M|re.S)
    return text.replace('export function','function')

for name,file,call in [
    ('first_job','composition.js','buildFirstJob()'),
    ('two_pens','composition.js','buildTwoPens()'),
    ('route_lab','composition.js','buildRouteLab()'),
    ('waves_pen','drawing.js','createWaveDrawing(VanillaWaves)'),
    ('wave_hatch','drawing.js','createWaveHatch(VanillaWaves)')
]:
    body=source(name,file)+'\nconst plot = '+call+';\n'
    if name=='route_lab':
        body+='plot.optimize({ mergeTolerance: 0.05, duplicateTolerance: 0.01, simplifyTolerance: 0.05 });\n'
    wave_script=f'  <script src="{WAVES}"></script>\n' if name in ('waves_pen','wave_hatch') else ''
    wrapper=f'''<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{name.replace('_',' ')}</title></head>
<body>
  <canvas id="preview" width="600" height="760" style="max-width:100%;height:auto"></canvas>
  <a id="save" download="{name}.svg">Save SVG</a>
{wave_script}  <script type="module">
{load_core('PlotterEngine')}
{body}
plot.drawRoute(document.getElementById("preview").getContext("2d"), {{ showTravel: true }});
document.getElementById("save").href = URL.createObjectURL(new Blob([plot.exportSVG()], {{ type: "image/svg+xml" }}));
  </script>
</body>
</html>
'''
    (ROOT/'examples'/name/'standalone.html').write_text(wrapper,encoding='utf-8')

# Frame and wave shares its drawing statements with the physical example.
text=(ROOT/'examples/direct_plot/sketch.js').read_text(encoding='utf-8')
body=text[text.index('const plot ='):text.index('const plan =')]
wrapper=wrapper.replace(name.replace('_',' '),'frame and wave').replace(name+'.svg','frame-and-wave.svg')
start=wrapper.index('const response =');end=wrapper.index('plot.drawRoute(')
wrapper=wrapper[:start]+load_core('PlotterEngine')+'\n'+body+wrapper[end:]
wrapper=re.sub(r'  <script src="[^"]+"></script>\n','',wrapper)
(ROOT/'examples/direct_plot/standalone.html').write_text(wrapper,encoding='utf-8')

# The SVG example retains the supplied file and the same fitting calculation.
text=(ROOT/'examples/svg_to_pen/sketch.js').read_text(encoding='utf-8')
sample=text[text.index('const SAMPLE ='):text.index('// An empty plot')]
body=sample+'''const imported = Geometry.importSVG(SAMPLE, { curveSteps: 24, arcSteps: 48 });
const bounds = documentBounds(imported);
const width = 120;
const scale = width / (bounds.maxX - bounds.minX);
const height = (bounds.maxY - bounds.minY) * scale;
const matrix = Geometry.Matrix.multiply(
  Geometry.Matrix.translate(-bounds.minX * scale, -bounds.minY * scale),
  Geometry.Matrix.scale(scale)
);
const fitted = Geometry.transformDocument(imported, matrix);
const plot = new PlotterEngine({ units: "mm", page: { width, height, margin: 0 } });
for (const layer of fitted.layers) plot.layer(layer.id).paths = layer.paths;
plot.optimize({ mergeTolerance: 0.05, duplicateTolerance: 0.01, simplifyTolerance: 0.03 });
'''
wrapper=wrapper.replace('frame and wave','SVG drawing').replace('frame-and-wave.svg','drawing.svg')
start=wrapper.index('const response =');end=wrapper.index('plot.drawRoute(')
wrapper=wrapper[:start]+load_core('PlotterEngine, Geometry, documentBounds')+'\n'+body+wrapper[end:]
(ROOT/'examples/svg_to_pen/standalone.html').write_text(wrapper,encoding='utf-8')

session=(ROOT/'examples/object_by_object/sketch.js').read_text(encoding='utf-8')
session=session.replace('import { PlotterEngine } from "../../vanilla.penplotter.js";',load_core('PlotterEngine'))
session=session.replace('import {\n  EbbDriver, createLogTransport, createWebSerialTransport\n} from "../../src/driver/ebb.js";', 'const { EbbDriver, createLogTransport, createWebSerialTransport } = await import(`${core}/src/driver/ebb.js`);')
wrapper='''<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Three lines, one at a time</title></head>
<body>
<canvas id="preview" width="600" height="400" style="max-width:100%;height:auto"></canvas>
<button id="demo">Run screen demo</button>
<p>Paper corner's distance from the machine origin:</p>
<label>X (mm) <input id="paper-x" type="number" value="0" min="0" max="570"></label>
<label>Y (mm) <input id="paper-y" type="number" value="0" min="0" max="405"></label>
<p id="status" role="status">Ready for the screen demo.</p>
<button id="connect">Connect plotter</button>
<button id="plot" disabled>Plot three lines</button>
<button id="stop" disabled>Stop</button>
<script type="module">
'''+session+'''</script>
</body>
</html>
'''
(ROOT/'examples/object_by_object/standalone.html').write_text(wrapper,encoding='utf-8')

for name in ('direct_plot','first_job','waves_pen','wave_hatch','two_pens','route_lab','svg_to_pen','object_by_object'):
    p=ROOT/'examples'/name/'index.html'
    text=p.read_text(encoding='utf-8')
    if 'data-src="standalone.html"' in text: continue
    block='''<details class="copyable-page"><summary>Copy index.html</summary>
<p>This complete page draws the example on screen and offers an SVG file. Save it as <code>index.html</code> and open it through localhost or HTTPS.</p>
<pre><code class="language-markup" data-src="standalone.html">Loading index.html...</code></pre>
<a href="standalone.html">Open the single-file example</a>
</details>
'''
    if name=='object_by_object':
        block=block.replace('This complete page draws the example on screen and offers an SVG file.','This complete page includes the screen demo and plotter controls.')
    text=text.replace('</main>',block+'</main>')
    p.write_text(text,encoding='utf-8')
