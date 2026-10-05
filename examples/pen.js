// The way to the pen, shared by every example page.
//
// mountPen(container, { getPlot, name, offset }) renders one panel: where the
// sheet lies on the bed, a dry run, connect, plot, stop, and, as a side door
// for other workflows, the same plan as SVG, HPGL or G-code.
// The example itself only builds geometry; nothing here changes its plan.
import { millimetersPerUnit, describePaper, paperSize } from "../src/core/model.js";
import { placePlan } from "../src/planner/index.js";
import { drawBed as renderBed } from "../src/renderer/index.js";
import {
  EBB_PROFILES,
  EbbDriver,
  compileEbbPlan,
  createLogTransport
} from "../src/driver/ebb.js";

import { createAutoSerialTransport, detectDriver } from "../src/driver/auto.js";
import { compileDrawCorePlan } from "../src/driver/grbl.js";

const profile = EBB_PROFILES["idraw-hse-a2"];
// Settings recorded in tests/hardware/drawcore-a3-h-2026-10-05.json.
export const DRAWCORE_A3_H = {
  travel: { width: 420, height: 297 },
  axes: { swapXY: true, xDirection: -1, yDirection: -1 },
  penUp: 0.5, penDown: 5, penFeed: 1000, drawFeed: 600, travelFeed: 900
};

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
function drawBed(canvas, plan, offset, placed, travel = profile.travel) {
  const perUnit = millimetersPerUnit(plan.units);
  renderBed(canvas.getContext("2d"), placed, {
    bed: travel,
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
      <label>Machine<select data-pen="machine">
        <option value="ebb">iDraw HSE / A2 — EBB</option>
        <option value="drawcore">iDraw A3 H — DrawCore</option>
      </select></label>
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
      <div><dt>Bed</dt><dd data-pen="bed-size">594 × 432 mm</dd></div>
      <div><dt>Sheet fit</dt><dd data-pen="sheet-fit">—</dd></div>
      <div><dt>Commands</dt><dd data-pen="commands">—</dd></div>
      <div><dt>On the machine</dt><dd data-pen="time">—</dd></div>
    </dl>
    <p class="pen-status" role="status" data-pen="status">Not connected. Park the carriage in the home corner first.</p>
    <button type="button" class="secondary" data-pen="dry">Dry run (log only)</button>
    <button type="button" data-pen="connect">Connect plotter</button>
    <button type="button" data-pen="plot" disabled>Plot</button>
    <button type="button" class="secondary" data-pen="resume" hidden>Resume</button>
    <button type="button" class="stop" data-pen="stop" disabled>Stop</button>
    <p class="pen-side">Export the drawing at its original page size, before bed placement:
      <a href="#" data-pen="svg">SVG</a>, <a href="#" data-pen="hpgl">HPGL</a> or <a href="#" data-pen="gcode">G-code</a>.</p>
    <div class="pen-log" role="log" aria-live="polite" data-pen="log">Ready.</div>`;

  const $ = (key) => container.querySelector(`[data-pen="${key}"]`);
  let compiled = null;
  let transport = null;
  let driver = null;
  let busy = false;
  const isDrawCore = () => $("machine").value === "drawcore";
  const travel = () => isDrawCore() ? DRAWCORE_A3_H.travel : profile.travel;

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
      return !isDrawCore() && record && compiled && record.signature === signature(compiled) && record.done > 0 && record.done < compiled.draws ? record : null;
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
    for (const key of ["x", "y", "turn", "format", "center", "machine"]) $(key).disabled = busy;
    $("machine").disabled = busy || Boolean(transport);
    const record = readResume();
    $("plot").disabled = !driver || !compiled || busy;
    $("connect").disabled = Boolean(transport) || busy;
    $("dry").disabled = !compiled || busy;
    $("stop").disabled = !busy;
    $("resume").hidden = !record;
    $("resume").disabled = !driver || !compiled || busy;
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
      $("bed-size").textContent = `${travel().width} × ${travel().height} mm`;
      $("x").max = String(travel().width);
      $("y").max = String(travel().height);
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
      $("sheet-fit").textContent = offset.x >= 0 && offset.y >= 0 && offset.x + sheet.width <= travel().width && offset.y + sheet.height <= travel().height ? "Inside the bed" : "Paper extends beyond the bed";
      $("drawing-size").textContent = Number.isFinite(minX) ? `${size((maxX - minX) * mm)} × ${size((maxY - minY) * mm)} mm` : "No strokes";
      drawBed($("bed"), getPlot().plan(), offset, onBed, travel());
      if (offset.x < 0 || offset.y < 0 || offset.x + sheet.width > travel().width || offset.y + sheet.height > travel().height) {
        throw new RangeError("Paper extends beyond the bed. Turn it, move it or choose a smaller sheet.");
      }
      if (Number.isFinite(minX) && (minX * mm < offset.x - 1e-6 || minY * mm < offset.y - 1e-6 || maxX * mm > offset.x + sheet.width + 1e-6 || maxY * mm > offset.y + sheet.height + 1e-6)) {
        throw new RangeError("Drawing extends beyond the paper. Choose a larger sheet or reduce the drawing in the sketch.");
      }
      compiled = isDrawCore() ? compileDrawCorePlan(onBed, DRAWCORE_A3_H) : compileEbbPlan(onBed, { profile });
      const seconds = isDrawCore() ? null : compiled.stats.durationMs / 1000;
      $("commands").textContent = String(compiled.commands.length);
      $("time").textContent = seconds === null ? "Waits for controller Idle" : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
      const record = readResume();
      if (!busy && record) {
        status(`An earlier plot of this drawing stopped after stroke ${record.done} of ${compiled.draws}. Park the carriage at home again and resume, or plot from the start.`);
      } else if (!busy) {
        status(transport ? "Connected. Ready when you are." : "Not connected. Park the carriage in the home corner first.");
      }
    } catch (error) {
      compiled = null;
      try { drawBed($("bed"), getPlot().plan(), offset, placed(), travel()); } catch { /* the bed can wait */ }
      $("commands").textContent = "—";
      $("time").textContent = "—";
      status(`Not plottable as it is: ${error.message}`);
    }
    buttons();
  }

  async function dryRun() {
    if (isDrawCore()) {
      log(`Dry run: ${compiled.commands.length} DrawCore commands, nothing was sent.`);
      log(`${compiled.commands.slice(0, 6).join("  ")}  …  ${compiled.commands.slice(-3).join("  ")}`);
      return;
    }
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
    let candidate = null;
    try {
      const granted = navigator.serial ? await navigator.serial.getPorts() : [];
      candidate = createAutoSerialTransport(granted[0] ?? null);
      await candidate.open();
      const detected = await detectDriver(candidate, { profile, drawcore: DRAWCORE_A3_H });
      // These example panels support the two named, configured machines.
      // Match the panel to the detected controller before validating placement.
      $("machine").value = detected.identity.protocol;
      transport = candidate;
      driver = detected;
      log(`Connected: ${driver.identity.response}`);
      if (isDrawCore()) log("A3 H: 420 × 297 mm; pen up Z0.5, down Z5. Set XY work origin before plotting. Stop holds motion and may leave the pen down.");
      refresh();
    } catch (error) {
      if (candidate) { try { await candidate.close(); } catch {} }
      transport = null;
      driver = null;
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
      (isDrawCore() ? "• XY work origin is set at the parked carriage" : "• The carriage is parked in the home corner (next to the board)") + (skipDraws > 0 ? ", again, by hand" : "") + ".\n" +
      "• Paper is in place and no magnet lies on the drawing or on the way to it.\n" +
      "• Hands are clear of the arm."
    );
    if (!ok) return;
    busy = true;
    buttons();
    lockLinks(container, true);
    const started = performance.now();
    try {
      const job = isDrawCore() ? placed() : skipDraws > 0 ? compileEbbPlan(placed(), { profile, skipDraws }) : compiled;
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
      log(`Plot stopped: ${error.message}`);
    }
    busy = false;
    lockLinks(container, false);
    refresh();
  }

  $("machine").addEventListener("change", refresh);
  $("x").addEventListener("input", refresh);
  $("y").addEventListener("input", refresh);
  $("turn").addEventListener("change", refresh);
  $("format").addEventListener("change", refresh);
  $("center").addEventListener("click", () => {
    const plan = getPlot().plan();
    const sheet = describePaper(preparePlacement(plan, { x: 0, y: 0 }, turn, $("format").value).page, plan.units);
    if (sheet.width > travel().width || sheet.height > travel().height) {
      status("Paper is larger than the bed in this orientation. Turn it or choose a smaller sheet.");
      return;
    }
    $("x").value = String(Number(((travel().width - sheet.width) / 2).toFixed(3)));
    $("y").value = String(Number(((travel().height - sheet.height) / 2).toFixed(3)));
    refresh();
  });
  $("dry").addEventListener("click", dryRun);
  $("connect").addEventListener("click", connect);
  $("plot").addEventListener("click", () => run(0));
  $("resume").addEventListener("click", () => { const record = readResume(); if (record) run(record.done); });
  $("stop").addEventListener("click", () => {
    if (driver) driver.abort();
    log(isDrawCore() ? "Feed-hold requested. The pen may remain down; queued moves may remain paused." : "Stop requested: pen up, motors off.");
  });
  $("svg").addEventListener("click", (event) => { event.preventDefault(); download(`${name}.svg`, getPlot().exportSVG(), "image/svg+xml"); });
  $("hpgl").addEventListener("click", (event) => { event.preventDefault(); download(`${name}.hpgl`, getPlot().exportHPGL(), "text/plain"); });
  $("gcode").addEventListener("click", (event) => { event.preventDefault(); download(`${name}.gcode`, getPlot().exportGCode(), "text/plain"); });
  // Leaving mid-plot requests the connected driver's emergency stop.
  // DrawCore uses feed-hold; EBB stops, lifts the pen and disables motors.
  window.addEventListener("beforeunload", (event) => {
    if (!busy) return;
    event.preventDefault();
    event.returnValue = isDrawCore() ? "A plot is running. Leaving requests feed-hold; the pen may remain down." : "A plot is running. Leaving stops it with the pen up; you can resume later.";
  });
  window.addEventListener("pagehide", () => {
    if (busy && driver) driver.emergencyStop();
    else if (transport) transport.close();
  });

  refresh();
  return { refresh };
}
