// The way to the pen, shared by every example page.
//
// mountPen(container, { getPlot, name, offset }) renders one panel: where the
// sheet lies on the bed, a dry run, connect, plot, stop, and, as a side door
// for anyone without an EBB plotter, the same plan as SVG, HPGL or G-code.
// The example itself only builds geometry; nothing here changes its plan.
import { millimetersPerUnit } from "../src/core/model.js";
import {
  EBB_PROFILES,
  EbbDriver,
  compileEbbPlan,
  createLogTransport,
  createWebSerialTransport
} from "../src/driver/ebb.js";

const profile = EBB_PROFILES["idraw-hse-a2"];

// The plan, moved so that the sheet's corner lies `offset` mm from home.
function shiftPlan(plan, offset) {
  const perUnit = millimetersPerUnit(plan.units);
  const dx = offset.x / perUnit;
  const dy = offset.y / perUnit;
  const move = (p) => ({ x: p.x + dx, y: p.y + dy });
  return {
    ...plan,
    moves: plan.moves.map((m) => {
      if (m.type === "travel") return { ...m, from: move(m.from), to: move(m.to) };
      if (m.type === "draw") return { ...m, points: m.points.map(move) };
      return m;
    })
  };
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
      <label>Sheet from home, X (mm)<input data-pen="x" type="number" value="${offset.x}" min="0" max="590" step="5"></label>
      <label>Sheet from home, Y (mm)<input data-pen="y" type="number" value="${offset.y}" min="0" max="430" step="5"></label>
    </div>
    <dl class="pen-stats">
      <div><dt>Commands</dt><dd data-pen="commands">—</dd></div>
      <div><dt>On the machine</dt><dd data-pen="time">—</dd></div>
    </dl>
    <p class="pen-status" role="status" data-pen="status">Not connected. Park the carriage in the home corner first.</p>
    <button type="button" class="secondary" data-pen="dry">Dry run (log only)</button>
    <button type="button" data-pen="connect">Connect plotter</button>
    <button type="button" data-pen="plot" disabled>Plot</button>
    <button type="button" class="secondary" data-pen="resume" hidden>Resume</button>
    <button type="button" class="stop" data-pen="stop" disabled>Stop — pen up</button>
    <p class="pen-side">No EBB plotter at hand? Take the same plan with you as
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
  const signature = (c) => `${c.draws}:${c.stats.drawMm.toFixed(1)}:${c.stats.penDowns + c.skipDraws}`;
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
    offset.x = Number($("x").value);
    offset.y = Number($("y").value);
    try {
      compiled = compileEbbPlan(shiftPlan(getPlot().plan(), offset), { profile });
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
    const started = performance.now();
    try {
      const job = skipDraws > 0 ? compileEbbPlan(shiftPlan(getPlot().plan(), offset), { profile, skipDraws }) : compiled;
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
    refresh();
  }

  $("x").addEventListener("input", refresh);
  $("y").addEventListener("input", refresh);
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
