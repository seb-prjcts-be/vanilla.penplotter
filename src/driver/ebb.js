// EBB (EiBotBoard) driver: streams a PlotPlan straight to an AxiDraw-style
// CoreXY plotter, without an SVG in between.
//
// Machine facts for "idraw-hse-a2" were verified on the physical machine on
// 2026-09-21 (firmware EBB 3.0.2) and match axidraw_conf.py of the vendor's
// iDraw HSE Inkscape extension: motor1 = X + Y, motor2 = X - Y, 80 steps/mm at
// 16x microstepping, 594 x 432 mm travel. The EBB has no homing: the position
// of the carriage when run() starts IS the plan origin (0,0), the home corner.

const UNIT_TO_MM = Object.freeze({ mm: 1, cm: 10, in: 25.4 });

export const EBB_PROFILES = Object.freeze({
  "idraw-hse-a2": Object.freeze({
    id: "idraw-hse-a2",
    name: "iDraw HSE / A2 (EBB)",
    stepsPerMm: 80,
    travel: Object.freeze({ width: 594, height: 432 }),
    maxStepRate: 24.995, // steps per millisecond, per motor
    minStepRate: 1.31, // steps per second, per motor
    // Conservative constant speeds: there is no acceleration planning yet.
    drawSpeed: 15, // mm/s
    travelSpeed: 30, // mm/s
    penDownDelay: 300, // ms
    penUpDelay: 300, // ms
    usb: Object.freeze({ usbVendorId: 0x04d8, usbProductId: 0xfd92 })
  })
});

export function mixCoreXY(x, y, stepsPerMm) {
  return {
    a1: Math.round((x + y) * stepsPerMm),
    a2: Math.round((x - y) * stepsPerMm)
  };
}

function resolveProfile(profile) {
  if (profile && typeof profile === "object") return profile;
  const found = EBB_PROFILES[profile || "idraw-hse-a2"];
  if (!found) throw new RangeError(`Unknown EBB profile: ${profile}`);
  return found;
}

function positive(value, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number <= 0) throw new RangeError(`Expected a positive number, got ${value}`);
  return number;
}

// Turns a PlotPlan into the exact list of EBB commands. Pure: nothing is sent.
export function compileEbbPlan(plan, options = {}) {
  const profile = resolveProfile(options.profile);
  const toMm = UNIT_TO_MM[plan.units];
  if (!toMm) {
    throw new RangeError(`Direct plotting needs physical units (mm, cm or in); this plan uses "${plan.units}".`);
  }
  const drawSpeed = positive(options.drawSpeed, profile.drawSpeed);
  const travelSpeed = positive(options.travelSpeed, profile.travelSpeed);
  const returnHome = options.returnHome !== false;
  const { width, height } = profile.travel;
  const point = (p) => ({ x: p.x * toMm, y: p.y * toMm });

  for (const move of plan.moves) {
    const points = move.type === "draw" ? move.points : move.type === "travel" ? [move.from, move.to] : [];
    for (const raw of points) {
      const p = point(raw);
      if (!(p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height)) {
        throw new RangeError(
          `Point (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) mm is outside the machine travel of ${width} x ${height} mm.`
        );
      }
    }
  }

  const commands = [];
  const stats = { drawMm: 0, travelMm: 0, penDowns: 0, durationMs: 0 };
  const position = { x: 0, y: 0 };
  const steps = { a1: 0, a2: 0 }; // steps actually commanded so far
  let penDown = null;

  const pen = (down) => {
    if (penDown === down) return;
    const delay = down ? profile.penDownDelay : profile.penUpDelay;
    commands.push({ cmd: `SP,${down ? 0 : 1},${delay}`, kind: down ? "pen-down" : "pen-up", durationMs: delay });
    stats.durationMs += delay;
    if (down) stats.penDowns += 1;
    penDown = down;
  };

  const moveTo = (target, speed) => {
    const length = Math.hypot(target.x - position.x, target.y - position.y);
    // Absolute step targets: rounding never accumulates into drift.
    const goal = mixCoreXY(target.x, target.y, profile.stepsPerMm);
    let d1 = goal.a1 - steps.a1;
    let d2 = goal.a2 - steps.a2;
    position.x = target.x;
    position.y = target.y;
    if (d1 === 0 && d2 === 0) return;
    const duration = Math.max(
      1,
      Math.round((length / speed) * 1000),
      Math.ceil(Math.max(Math.abs(d1), Math.abs(d2)) / profile.maxStepRate)
    );
    // The firmware rejects an axis slower than minStepRate. Hold those steps
    // back; the absolute target picks them up in a later move.
    const tooSlow = (d) => d !== 0 && Math.abs(d) / (duration / 1000) < profile.minStepRate;
    if (tooSlow(d1)) d1 = 0;
    if (tooSlow(d2)) d2 = 0;
    if (d1 === 0 && d2 === 0) return;
    steps.a1 += d1;
    steps.a2 += d2;
    commands.push({ cmd: `SM,${duration},${d1},${d2}`, kind: penDown ? "draw" : "travel", durationMs: duration });
    stats.durationMs += duration;
    if (penDown) stats.drawMm += length;
    else stats.travelMm += length;
  };

  commands.push({ cmd: "EM,1,1", kind: "motors-on", durationMs: 0 });
  pen(false);

  let toolSeen = false;
  for (const move of plan.moves) {
    if (move.type === "tool-change") {
      if (toolSeen) {
        pen(false);
        commands.push({ cmd: "", kind: "tool-change", toolId: move.toolId, durationMs: 0 });
      }
      toolSeen = true;
    } else if (move.type === "travel") {
      pen(false);
      moveTo(point(move.to), travelSpeed);
    } else if (move.type === "draw") {
      pen(false);
      moveTo(point(move.points[0]), travelSpeed);
      pen(true);
      for (let index = 1; index < move.points.length; index += 1) moveTo(point(move.points[index]), drawSpeed);
    }
  }

  pen(false);
  if (returnHome) moveTo({ x: 0, y: 0 }, travelSpeed);
  commands.push({ cmd: "", kind: "wait-idle", durationMs: 0 });
  commands.push({ cmd: "EM,0,0", kind: "motors-off", durationMs: 0 });

  return { schema: "vanilla.penplotter/ebb@1", profile: profile.id, commands, stats, end: { ...position } };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class EbbDriver {
  constructor(options = {}) {
    if (!options.transport) throw new TypeError("EbbDriver needs a transport, e.g. createWebSerialTransport().");
    this.transport = options.transport;
    this.profile = resolveProfile(options.profile);
    this.aborted = false;
  }

  abort() {
    this.aborted = true;
  }

  async ask(cmd, timeoutMs) {
    const reply = await this.transport.send(cmd, { timeoutMs });
    if (reply.startsWith("!")) throw new Error(`EBB refused "${cmd}": ${reply}`);
    return reply;
  }

  async safeStop() {
    for (const cmd of ["ES", "SP,1", "EM,0,0"]) {
      try {
        await this.transport.send(cmd, { timeoutMs: 2000 });
      } catch {
        // keep going: the remaining commands matter more than the error
      }
    }
  }

  async waitIdle() {
    for (;;) {
      const reply = await this.ask("QM");
      if (/^QM,0,0,0,0/.test(reply) || this.aborted) return;
      await delay(100);
    }
  }

  async run(planOrCompiled, options = {}) {
    if (options.confirmed !== true) {
      throw new Error("Direct plotting requires { confirmed: true }: carriage at the home corner, pen and paper checked.");
    }
    const compiled = planOrCompiled.schema === "vanilla.penplotter/ebb@1"
      ? planOrCompiled
      : compileEbbPlan(planOrCompiled, { ...options, profile: this.profile });
    this.aborted = false;

    const version = await this.transport.send("V", { timeoutMs: 2000 });
    if (!/EBB/i.test(version)) throw new Error(`The connected device is not an EBB board: "${version}".`);

    const total = compiled.commands.length;
    let previousMs = 0;
    try {
      for (let index = 0; index < total; index += 1) {
        if (this.aborted) {
          await this.safeStop();
          return { status: "aborted", index, commands: index };
        }
        const entry = compiled.commands[index];
        if (entry.kind === "tool-change") {
          if (options.onToolChange) await options.onToolChange(entry.toolId);
        } else if (entry.kind === "wait-idle") {
          await this.waitIdle();
        } else {
          // The EBB answers once the command is queued; with a full queue that
          // is only after the previous move has finished.
          await this.ask(entry.cmd, 5000 + previousMs + entry.durationMs);
          previousMs = entry.durationMs;
        }
        if (options.onProgress) await options.onProgress(index, total, entry);
      }
    } catch (error) {
      await this.safeStop();
      throw error;
    }
    return { status: "complete", commands: total, durationMs: compiled.stats.durationMs };
  }
}

export function createLogTransport(options = {}) {
  const version = options.version ?? "EBBv13_and_above EB Firmware Version 3.0.2";
  const log = [];
  return {
    log,
    async open() {},
    async close() {},
    async send(cmd) {
      log.push(cmd);
      const failure = options.failOn ? options.failOn(cmd) : null;
      if (failure) return failure;
      if (cmd === "V") return version;
      if (cmd === "QM") return "QM,0,0,0,0";
      return "";
    }
  };
}

// Commands whose reply is a single line without a trailing OK (firmware 3.x).
const NO_OK = new Set(["V", "QM"]);

// Browser transport over Web Serial. Pass an already granted SerialPort, or
// call open() from a user gesture to let the browser show its port picker.
export function createWebSerialTransport(port = null, options = {}) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let reader = null;
  let writer = null;
  let buffer = "";
  let active = false;
  let chain = Promise.resolve();

  async function pump() {
    try {
      while (active) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) buffer += decoder.decode(value);
      }
    } catch {
      // expected when close() cancels the reader
    }
  }

  function takeReply(name) {
    const lines = buffer.split(/[\r\n]+/);
    const complete = /[\r\n]$/.test(buffer) ? lines : lines.slice(0, -1);
    const found = complete.filter(Boolean);
    const error = found.find((line) => line.startsWith("!"));
    if (error) return error;
    const ok = found.indexOf("OK");
    if (ok >= 0) return found.slice(0, ok).join("\n");
    if (NO_OK.has(name) && found.length > 0) return found[0];
    return null;
  }

  async function exchange(cmd, timeoutMs) {
    buffer = "";
    await writer.write(encoder.encode(`${cmd}\r`));
    const name = cmd.split(",")[0];
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const reply = takeReply(name);
      if (reply !== null) {
        buffer = "";
        return reply.trim();
      }
      await delay(2);
    }
    throw new Error(`No reply to "${cmd}" within ${timeoutMs} ms.`);
  }

  return {
    async open() {
      if (!port) {
        if (!globalThis.navigator?.serial) throw new Error("Web Serial is not available in this browser/context.");
        port = await navigator.serial.requestPort({ filters: options.filters ?? [EBB_PROFILES["idraw-hse-a2"].usb] });
      }
      if (!port.readable) await port.open({ baudRate: options.baudRate ?? 115200 });
      reader = port.readable.getReader();
      writer = port.writable.getWriter();
      active = true;
      pump();
    },
    // Calls are serialized: replies can never be attributed to the wrong command.
    send(cmd, sendOptions = {}) {
      const result = chain.then(() => {
        if (!active) throw new Error("Open the transport first.");
        return exchange(cmd, sendOptions.timeoutMs ?? 3000);
      });
      chain = result.catch(() => {});
      return result;
    },
    async close() {
      active = false;
      if (reader) {
        try { await reader.cancel(); } catch { /* already closed */ }
        reader.releaseLock();
        reader = null;
      }
      if (writer) {
        writer.releaseLock();
        writer = null;
      }
      if (port) await port.close();
    }
  };
}
