// The way to the pen, shared by every example page.
//
// mountPen(container, { getPlot, name, offset }) renders one panel: where the
// sheet lies on the bed, a dry run, connect, plot, stop, and, as a side door
// for anyone without an EBB plotter, the same plan as SVG, HPGL or G-code.
// The example itself only builds geometry; nothing here changes its plan.
import { millimetersPerUnit, describePaper, paperSize } from "../src/core/model.js";
import { placePlan } from "../src/planner/index.js";
import { drawBed as renderBed } from "../src/renderer/index.js";
import {
  EBB_PROFILES,
  EbbDriver,
  compileEbbPlan,
  createLogTransport,
  createWebSerialTransport
} from "../src/driver/ebb.js";

const profile = EBB_PROFILES["idraw-hse-a2"];

// The plan as it lies on the bed: turned by 0, 90, 180 or 270 degrees around
// the sheet, then moved so that the sheet's corner lies `offset` mm from
// home. The machine's X runs along the long rail, so a portrait sheet drawn
// on screen lands sideways on a portrait sheet on the bed unless it is
// turned; this is where you say which way it goes.
export { placePlan };

// Change the sheet around the drawing, preserving stroke lengths and source.
export function preparePlacement(plan, offset, turn = 0, format = "drawing") {
  const page = format === "drawing" ? plan.page : { ...plan.page, ...paperSize(format, "portrait", plan.units) };
  if (!Number.isFinite(offset.x) || !Number.isFinite(offset.y)) throw new RangeError("Enter a finite sheet position in millimetres.");
  return placePlan({ ...plan, page }, offset, turn);
}

// While a plot runs, every link that leaves the page is greyed out and
// unclickable: the navigation, GitHub, the rest of the site. The panel's own
// links stay, they only download. Restored when the plot ends.
const locked = new Map();
export function lockLinks(container, on) {
  if (on) {
    for (const link of document.querySelectorAll("a[href]")) {
      const href = link.getAttribute("href") || "";
      if (container.contains(link) || href.startsWith("#") || locked.has(link)) continue;
      locked.set(link, { tabindex: link.getAttribute("tabindex"), title: link.getAttribute("title"), style: link.getAttribute("style") });
      link.setAttribute("tabindex", "-1");
      link.setAttribute("aria-disabled", "true");
      link.setAttribute("title", "A plot is running; this link comes back when it is done.");
      link.style.pointerEvents = "none";
      link.style.opacity = "0.3";
    }
    return;
  }
  for (const [link, was] of locked) {
    link.removeAttribute("aria-disabled");
    for (const [name, value] of Object.entries(was)) {
      if (value === null) link.removeAttribute(name);
      else link.setAttribute(name, value);
    }
  }
  locked.clear();
}

// The bed as the machine sees it: X along the long rail, home in the corner
// by the board, the sheet where the offsets put it, the drawing inside.
function drawBed(canvas, plan, offset, placed) {
  const perUnit = millimetersPerUnit(plan.units);
  renderBed(canvas.getContext("2d"), placed, {
    bed: profile.travel,
    sheet: { x: offset.x, y: offset.y, width: placed.page.width * perUnit, height: placed.page.height * perUnit }
  });
}

function download(name, text, type) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export function mountPen(container, options) {
  const { getPlot, name = "plot" } = options;
  const offset = { x: 0, y: 0, ...(options.offset || {}) };
  container.classList.add("pen");
  container.innerHTML = `
    <p class="pen-title">To the pen</p>
    <div class="pen-fields">
      <label>Paper size<select data-pen="format">
        <option value="drawing">Use the drawing's page</option>
        ${["A0", "A1", "A2", "A3", "A4", "A5", "A6"].map((format) => `<option value="${format}">${format}</option>`).join("")}
      </select></label>
      <label>Sheet position from the corner, X (mm)<input data-pen="x" type="number" value="${offset.x}" min="0" max="590" step="5"></label>
      <label>Sheet position from the corner, Y (mm)<input data-pen="y" type="number" value="${offset.y}" min="0" max="430" step="5"></label>
      <label>Turn on the bed<select data-pen="turn">
        <option value="0">0° — as on screen, X along the long rail</option>
        <option value="90">90°</option>
        <option value="180">180°</option>
        <option value="270">270°</option>
      </select></label>
    </div>
    <p class="pen-side">Paper size keeps the strokes at their original scale. A formats start in portrait; a 90° or 270° turn places them in landscape. X and Y locate the paper corner nearest home.</p>
    <button type="button" class="secondary" data-pen="center">Centre paper on the bed</button>
    <canvas data-pen="bed" width="594" height="432" style="display:block;width:100%;height:auto;margin:0 0 12px;border:1px solid rgba(0,0,0,.15);background:#fff" aria-label="The bed: where the sheet and the drawing lie"></canvas>
    <dl class="pen-stats">
      <div><dt>Paper</dt><dd data-pen="paper">—</dd></div>
      <div><dt>On the bed</dt><dd data-pen="sheet-size">—</dd></div>
      <div><dt>Drawing</dt><dd data-pen="drawing-size">—</dd></div>
      <div><dt>Bed</dt><dd>594 × 432 mm</dd></div>
      <div><dt>Sheet fit</dt><dd data-pen="sheet-fit">—</dd></div>
      <div><dt>Commands</dt><dd data-pen="commands">—</dd></div>
      <div><dt>On the machine</dt><dd data-pen="time">—</dd></div>
    </dl>
    <p class="pen-status" role="status" data-pen="status">Not connected. Park the carriage in the home corner first.</p>
    <button type="button" class="secondary" data-pen="dry">Dry run (log only)</button>
    <button type="button" data-pen="connect">Connect plotter</button>
    <button type="button" data-pen="plot" disabled>Plot</button>
    <button type="button" class="secondary" data-pen="resume" hidden>Resume</button>
    <button type="button" class="stop" data-pen="stop" disabled>Stop — pen up</button>
    <p class="pen-side">Export the drawing at its original page size, before bed placement:
      <a href="#" data-pen="svg">SVG</a>, <a href="#" data-pen="hpgl">HPGL</a> or <a href="#" data-pen="gcode">G-code</a>.</p>
    <div class="pen-log" role="log" aria-live="polite" data-pen="log">Ready.</div>`;

  const $ = (key) => container.querySelector(`[data-pen="${key}"]`);
  let compiled = null;
  let transport = null;
  let driver = null;
  let busy = false;

  // An interrupted plot is remembered per drawing: how many strokes were
  // acknowledged complete, and a signature of the drawing so a changed
  // sketch never resumes into the wrong lines.
  const RESUME_KEY = `vanilla.penplotter:resume:${name}`;
  let turn = 0;
  const placed = () => preparePlacement(getPlot().plan(), offset, turn, $("format").value);
  const signature = (c) => `${c.draws}:${c.stats.drawMm.toFixed(1)}:${c.stats.penDowns + c.skipDraws}:${offset.x},${offset.y},${turn}${$("format").value === "drawing" ? "" : `:${$("format").value}`}`;
  const readResume = () => {
    try {
      const record = JSON.parse(localStorage.getItem(RESUME_KEY));
      return record && compiled && record.signature === signature(compiled) && record.done > 0 && record.done < compiled.draws ? record : null;
    } catch {
      return null;
    }
  };
  const saveResume = (done) => {
    try { localStorage.setItem(RESUME_KEY, JSON.stringify({ done, signature: signature(compiled), offset: { ...offset }, savedAt: Date.now() })); } catch { /* storage may be off */ }
  };
  const clearResume = () => { try { localStorage.removeItem(RESUME_KEY); } catch { /* storage may be off */ } };

  const status = (message) => { $("status").textContent = message; };
  const log = (message) => {
    status(message);
    const box = $("log");
    box.textContent += `\n${message}`;
    box.scrollTop = box.scrollHeight;
  };
  const buttons = () => {
    for (const key of ["x", "y", "turn", "format", "center"]) $(key).disabled = busy;
    const record = readResume();
    $("plot").disabled = !transport || !compiled || busy;
    $("connect").disabled = Boolean(transport) || busy;
    $("dry").disabled = !compiled || busy;
    $("stop").disabled = !busy;
    $("resume").hidden = !record;
    $("resume").disabled = !transport || !compiled || busy;
    if (record) $("resume").textContent = `Resume at stroke ${record.done + 1} of ${compiled.draws}`;
  };
  const toolName = (toolId) => {
    const tool = getPlot().document.tools.find((t) => t.id === toolId);
    return tool ? tool.name || tool.id : toolId;
  };

  function refresh() {
    if (busy) return;
    offset.x = $("x").value.trim() === "" ? NaN : Number($("x").value);
    offset.y = $("y").value.trim() === "" ? NaN : Number($("y").value);
    turn = Number($("turn").value);
    try {
      const onBed = placed();
      const sheet = describePaper(onBed.page, onBed.units);
      const mm = millimetersPerUnit(onBed.units);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const move of onBed.moves) {
        if (move.type !== "draw") continue;
        for (const point of move.points) {
          minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
        }
      }
      const size = (value) => Number(value.toFixed(1));
      $("paper").textContent = `${sheet.format} · ${sheet.orientation}`;
      $("sheet-size").textContent = `${size(sheet.width)} × ${size(sheet.height)} mm (X × Y)`;
      $("sheet-fit").textContent = offset.x >= 0 && offset.y >= 0 && offset.x + sheet.width <= profile.travel.width && offset.y + sheet.height <= profile.travel.height ? "Inside the bed" : "Paper extends beyond the bed";
      $("drawing-size").textContent = Number.isFinite(minX) ? `${size((maxX - minX) * mm)} × ${size((maxY - minY) * mm)} mm` : "No strokes";
      drawBed($("bed"), getPlot().plan(), offset, onBed);
      if (offset.x < 0 || offset.y < 0 || offset.x + sheet.width > profile.travel.width || offset.y + sheet.height > profile.travel.height) {
        throw new RangeError("Paper extends beyond the bed. Turn it, move it or choose a smaller sheet.");
      }
      if (Number.isFinite(minX) && (minX * mm < offset.x - 1e-6 || minY * mm < offset.y - 1e-6 || maxX * mm > offset.x + sheet.width + 1e-6 || maxY * mm > offset.y + sheet.height + 1e-6)) {
        throw new RangeError("Drawing extends beyond the paper. Choose a larger sheet or reduce the drawing in the sketch.");
      }
      compiled = compileEbbPlan(onBed, { profile });
      const seconds = compiled.stats.durationMs / 1000;
      $("commands").textContent = String(compiled.commands.length);
      $("time").textContent = `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
      const record = readResume();
      if (!busy && record) {
        status(`An earlier plot of this drawing stopped after stroke ${record.done} of ${compiled.draws}. Park the carriage at home again and resume, or plot from the start.`);
      } else if (!busy) {
        status(transport ? "Connected. Ready when you are." : "Not connected. Park the carriage in the home corner first.");
      }
    } catch (error) {
      compiled = null;
      try { drawBed($("bed"), getPlot().plan(), offset, placed()); } catch { /* the bed can wait */ }
      $("commands").textContent = "—";
      $("time").textContent = "—";
      status(`Not plottable as it is: ${error.message}`);
    }
    buttons();
  }

  async function dryRun() {
    const dry = createLogTransport();
    const result = await new EbbDriver({ transport: dry, profile }).run(compiled, {
      confirmed: true,
      onToolChange: (toolId) => log(`(here the plot would pause for the ${toolName(toolId)})`)
    });
    log(`Dry run: ${result.status}, ${dry.log.length} commands, nothing was sent.`);
    log(`${dry.log.slice(0, 6).join("  ")}  …  ${dry.log.slice(-3).join("  ")}`);
  }

  async function connect() {
    status("Waiting for you to pick the plotter in the browser's list…");
    try {
      const granted = navigator.serial ? await navigator.serial.getPorts() : [];
      const candidate = createWebSerialTransport(granted[0] ?? null, { filters: [] });
      await candidate.open();
      transport = candidate;
      driver = new EbbDriver({ transport, profile });
      log(`Connected: ${await transport.send("V")}`);
    } catch (error) {
      log(/No port selected/i.test(error.message)
        ? "No plotter was chosen. If no list appeared at all, open this page in Chrome or Edge itself."
        : `Connect failed: ${error.message}`);
    }
    buttons();
  }

  // skipDraws > 0 resumes: the strokes already on paper are left out, and the
  // plot starts from home again, where you parked the carriage by hand.
  async function run(skipDraws = 0) {
    const ok = window.confirm(
      (skipDraws > 0 ? `Resume at stroke ${skipDraws + 1} of ${compiled.draws}?\n\n` : "Plot now?\n\n") +
      "• The carriage is parked in the home corner (next to the board)" + (skipDraws > 0 ? ", again, by hand" : "") + ".\n" +
      "• Paper is in place and no magnet lies on the drawing or on the way to it.\n" +
      "• Hands are clear of the arm."
    );
    if (!ok) return;
    busy = true;
    buttons();
    lockLinks(container, true);
    const started = performance.now();
    try {
      const job = skipDraws > 0 ? compileEbbPlan(placed(), { profile, skipDraws }) : compiled;
      const result = await driver.run(job, {
        confirmed: true,
        onProgress: (index, total, entry) => {
          if (entry.completes !== undefined) saveResume(entry.completes + 1);
          if (index % 20 === 0 || index === total - 1) log(`${index + 1} / ${total}`);
        },
        // The pen is up and the motors hold; the plot waits until you press OK.
        onToolChange: (toolId) => {
          log(`Pen change: put in the ${toolName(toolId)}.`);
          window.confirm(`Pen change.\n\nPut in the ${toolName(toolId)}, then press OK to continue.`);
        }
      });
      if (result.status === "complete") clearResume();
      log(`Plot ${result.status} after ${((performance.now() - started) / 1000).toFixed(0)} s.`);
    } catch (error) {
      log(`Stopped safely: ${error.message}`);
    }
    busy = false;
    lockLinks(container, false);
    refresh();
  }

  $("x").addEventListener("input", refresh);
  $("y").addEventListener("input", refresh);
  $("turn").addEventListener("change", refresh);
  $("format").addEventListener("change", refresh);
  $("center").addEventListener("click", () => {
    const plan = getPlot().plan();
    const sheet = describePaper(preparePlacement(plan, { x: 0, y: 0 }, turn, $("format").value).page, plan.units);
    if (sheet.width > profile.travel.width || sheet.height > profile.travel.height) {
      status("Paper is larger than the bed in this orientation. Turn it or choose a smaller sheet.");
      return;
    }
    $("x").value = String(Number(((profile.travel.width - sheet.width) / 2).toFixed(3)));
    $("y").value = String(Number(((profile.travel.height - sheet.height) / 2).toFixed(3)));
    refresh();
  });
  $("dry").addEventListener("click", dryRun);
  $("connect").addEventListener("click", connect);
  $("plot").addEventListener("click", () => run(0));
  $("resume").addEventListener("click", () => { const record = readResume(); if (record) run(record.done); });
  $("stop").addEventListener("click", () => {
    if (driver) driver.abort();
    log("Stop requested: pen up, motors off.");
  });
  $("svg").addEventListener("click", (event) => { event.preventDefault(); download(`${name}.svg`, getPlot().exportSVG(), "image/svg+xml"); });
  $("hpgl").addEventListener("click", (event) => { event.preventDefault(); download(`${name}.hpgl`, getPlot().exportHPGL(), "text/plain"); });
  $("gcode").addEventListener("click", (event) => { event.preventDefault(); download(`${name}.gcode`, getPlot().exportGCode(), "text/plain"); });
  // Leaving the page mid-plot: the browser asks first, and if the page goes
  // anyway the machine gets stop, pen up, motors off in one last write.
  window.addEventListener("beforeunload", (event) => {
    if (!busy) return;
    event.preventDefault();
    event.returnValue = "A plot is running. Leaving stops it with the pen up; you can resume later.";
  });
  window.addEventListener("pagehide", () => {
    if (busy && driver) driver.emergencyStop();
    else if (transport) transport.close();
  });

  refresh();
  return { refresh };
}
