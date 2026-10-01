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

// The plan as it lies on the bed: turned by 0, 90, 180 or 270 degrees around
// the sheet, then moved so that the sheet's corner lies `offset` mm from
// home. The machine's X runs along the long rail, so a portrait sheet drawn
// on screen lands sideways on a portrait sheet on the bed unless it is
// turned; this is where you say which way it goes.
export function placePlan(plan, offset, turn = 0) {
  const perUnit = millimetersPerUnit(plan.units);
  const { width, height } = plan.page;
  const dx = offset.x / perUnit;
  const dy = offset.y / perUnit;
  const rotate = {
    0: (p) => ({ x: p.x, y: p.y }),
    90: (p) => ({ x: height - p.y, y: p.x }),
    180: (p) => ({ x: width - p.x, y: height - p.y }),
    270: (p) => ({ x: p.y, y: width - p.x })
  }[((Number(turn) % 360) + 360) % 360];
  if (!rotate) throw new RangeError(`Turn by 0, 90, 180 or 270 degrees, not ${turn}`);
  const place = (p) => {
    const r = rotate(p);
    return { x: r.x + dx, y: r.y + dy };
  };
  const sideways = Number(turn) % 180 !== 0;
  return {
    ...plan,
    page: { ...plan.page, width: sideways ? height : width, height: sideways ? width : height },
    moves: plan.moves.map((m) => {
      if (m.type === "travel") return { ...m, from: place(m.from), to: place(m.to) };
      if (m.type === "draw") return { ...m, points: m.points.map(place) };
      return m;
    })
  };
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
  const context = canvas.getContext("2d");
  const { width: bedW, height: bedH } = profile.travel;
  const scale = canvas.width / bedW;
  const perUnit = millimetersPerUnit(plan.units);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, bedW * scale, bedH * scale);
  context.strokeStyle = "#000";
  context.lineWidth = 1;
  context.strokeRect(0.5, 0.5, bedW * scale - 1, bedH * scale - 1);
  // the sheet
  context.fillStyle = "rgba(0,0,0,.05)";
  context.fillRect(offset.x * scale, offset.y * scale, placed.page.width * perUnit * scale, placed.page.height * perUnit * scale);
  context.strokeStyle = "rgba(0,0,0,.4)";
  context.strokeRect(offset.x * scale + 0.5, offset.y * scale + 0.5, placed.page.width * perUnit * scale, placed.page.height * perUnit * scale);
  // the drawing
  context.strokeStyle = "#000";
  context.lineWidth = 0.8;
  context.beginPath();
  for (const move of placed.moves) {
    if (move.type !== "draw") continue;
    move.points.forEach((p, index) => {
      const x = p.x * perUnit * scale;
      const y = p.y * perUnit * scale;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
  }
  context.stroke();
  // home
  context.fillStyle = "#000";
  context.beginPath();
  context.arc(0, 0, 5, 0, Math.PI * 2);
  context.fill();
  context.font = "12px Inter, Arial, sans-serif";
  context.fillText("home · X along the long rail →", 10, 16);
  context.save();
  context.translate(14, 30);
  context.rotate(Math.PI / 2);
  context.fillText("Y along the arm →", 0, 0);
  context.restore();
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
      <label>Turn on the bed<select data-pen="turn">
        <option value="0">0° — as on screen, X along the long rail</option>
        <option value="90">90°</option>
        <option value="180">180°</option>
        <option value="270">270°</option>
      </select></label>
    </div>
    <canvas data-pen="bed" width="594" height="432" style="display:block;width:100%;height:auto;margin:0 0 12px;border:1px solid rgba(0,0,0,.15);background:#fff" aria-label="The bed: where the sheet and the drawing lie"></canvas>
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
  let turn = 0;
  const placed = () => placePlan(getPlot().plan(), offset, turn);
  const signature = (c) => `${c.draws}:${c.stats.drawMm.toFixed(1)}:${c.stats.penDowns + c.skipDraws}:${offset.x},${offset.y},${turn}`;
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
    turn = Number($("turn").value);
    try {
      const onBed = placed();
      compiled = compileEbbPlan(onBed, { profile });
      drawBed($("bed"), getPlot().plan(), offset, onBed);
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
