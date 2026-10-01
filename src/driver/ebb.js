// EBB (EiBotBoard) driver: streams a PlotPlan straight to an AxiDraw-style
// CoreXY plotter, without an SVG in between.
//
// Machine facts for "idraw-hse-a2" were verified on the physical machine on
// 2026-09-21 (firmware EBB 3.0.2) and match axidraw_conf.py of the vendor's
// iDraw HSE Inkscape extension: motor1 = X + Y, motor2 = X - Y, 80 steps/mm at
// 16x microstepping, 594 x 432 mm travel. The EBB has no homing: the position
// of the carriage when run() starts IS the plan origin (0,0), the home corner.
//
// Motion is planned with acceleration. Every stroke (one pen-down path, or one
// pen-up travel) gets a speed profile: ramp up from rest, cruise, slow down
// into corners by how sharp they are, ramp down to rest. The profile is sent
// as LM commands (firmware 2.7+): one command per constant-acceleration phase,
// with exact step counts per motor. Older firmware gets the same profile cut
// into short constant-speed SM slices.

const UNIT_TO_MM = Object.freeze({ mm: 1, cm: 10, in: 25.4 });
const INTERVAL_S = 40e-6; // the EBB motion interrupt runs at 25 kHz
const RATE_SCALE = 2 ** 31; // LM accumulators step when they pass 2^31
const RATE_MAX = 2 ** 31 - 1;
const SLICE_S = 0.025; // SM fallback: longest constant-speed slice
const MIN_PHASE_S = 0.004; // a ramp shorter than this is folded into its neighbour

export const EBB_PROFILES = Object.freeze({
  "idraw-hse-a2": Object.freeze({
    id: "idraw-hse-a2",
    name: "iDraw HSE / A2 (EBB)",
    stepsPerMm: 80,
    travel: Object.freeze({ width: 594, height: 432 }),
    maxStepRate: 24.995, // steps per millisecond, per motor
    minStepRate: 1.31, // steps per second, per motor (SM only)
    // The vendor's configuration plots at 55 mm/s pen-down, 166 mm/s pen-up,
    // with 40 in/s² (1016 mm/s²) of acceleration. These stay under that.
    drawSpeed: 40, // mm/s, pen down
    travelSpeed: 120, // mm/s, pen up
    acceleration: 800, // mm/s², pen down
    travelAcceleration: 1200, // mm/s², pen up
    junctionDeviation: 0.05, // mm: how far a corner may be rounded by not stopping
    penDownDelay: 300, // ms
    penUpDelay: 300, // ms
    fifoDepth: 32, // motion commands queued on the board (firmware 3.0+)
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

// Speed profile of one stroke: a list of constant-acceleration phases, each
// from one point to another with a start and an end speed (mm, mm/s).
export function planStroke(points, settings) {
  const { speed, acceleration, junctionDeviation, stepsPerMm, maxStepRate } = settings;
  const segments = [];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length < 1e-9) continue;
    const ux = (to.x - from.x) / length;
    const uy = (to.y - from.y) / length;
    // Both motors must stay under the board's step rate; on CoreXY a motor
    // sees |vx| + |vy|.
    const stepLimit = (maxStepRate * 1000) / (stepsPerMm * (Math.abs(ux) + Math.abs(uy)));
    segments.push({ from, to, length, ux, uy, vmax: Math.min(speed, stepLimit) });
  }
  if (segments.length === 0) return [];

  // Speed allowed at every vertex: rest at both ends, and in between as much
  // as the corner allows (GRBL's junction deviation: a sharper corner is a
  // slower corner, a reversal is a full stop, a straight line never slows).
  const vertex = new Array(segments.length + 1).fill(0);
  for (let index = 1; index < segments.length; index += 1) {
    const a = segments[index - 1];
    const b = segments[index];
    const cosTheta = -(a.ux * b.ux + a.uy * b.uy);
    const sinHalf = Math.sqrt(Math.max(0, 0.5 * (1 - cosTheta)));
    const corner = sinHalf >= 1 - 1e-9
      ? Infinity
      : Math.sqrt((acceleration * junctionDeviation * sinHalf) / (1 - sinHalf));
    vertex[index] = Math.min(corner, a.vmax, b.vmax);
  }
  // What the ramps can actually reach, forwards and backwards.
  for (let index = 1; index <= segments.length; index += 1) {
    const reach = Math.sqrt(vertex[index - 1] ** 2 + 2 * acceleration * segments[index - 1].length);
    vertex[index] = Math.min(vertex[index], reach);
  }
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const reach = Math.sqrt(vertex[index + 1] ** 2 + 2 * acceleration * segments[index].length);
    vertex[index] = Math.min(vertex[index], reach);
  }

  const phases = [];
  segments.forEach((segment, index) => {
    const v0 = vertex[index];
    const v1 = vertex[index + 1];
    const { length, vmax } = segment;
    let accelDistance = (vmax ** 2 - v0 ** 2) / (2 * acceleration);
    let brakeDistance = (vmax ** 2 - v1 ** 2) / (2 * acceleration);
    let peak = vmax;
    if (accelDistance + brakeDistance > length) {
      // Too short to reach cruise speed: a triangle instead of a trapezoid.
      peak = Math.sqrt((2 * acceleration * length + v0 ** 2 + v1 ** 2) / 2);
      accelDistance = Math.max(0, (peak ** 2 - v0 ** 2) / (2 * acceleration));
      brakeDistance = Math.max(0, length - accelDistance);
    }
    const at = (distance) => ({
      x: segment.from.x + segment.ux * distance,
      y: segment.from.y + segment.uy * distance
    });
    let parts = [
      { start: 0, end: accelDistance, vs: v0, ve: peak },
      { start: accelDistance, end: length - brakeDistance, vs: peak, ve: peak },
      { start: length - brakeDistance, end: length, vs: peak, ve: v1 }
    ].filter((part) => part.end - part.start > 1e-9);
    // A ramp of a few ticks, say from 39.9 to 40 mm/s, is not worth its own
    // command: its neighbour takes over the distance and the speed makes
    // that tiny jump at the boundary instead (at most acceleration times
    // MIN_PHASE_S). Short segments stay short; that is the geometry's call.
    const seconds = (part) => (2 * (part.end - part.start)) / (part.vs + part.ve);
    for (let index = 0; parts.length > 1 && index < parts.length;) {
      if (seconds(parts[index]) >= MIN_PHASE_S) {
        index += 1;
        continue;
      }
      const into = parts[index + 1 < parts.length ? index + 1 : index - 1];
      into.start = Math.min(into.start, parts[index].start);
      into.end = Math.max(into.end, parts[index].end);
      parts.splice(index, 1);
    }
    for (const { start, end, vs, ve } of parts) {
      phases.push({ from: at(start), to: end >= length - 1e-12 ? segment.to : at(end), length: end - start, vs, ve });
    }
  });
  return phases;
}

function parseVersion(text) {
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(text || "");
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)] : null;
}

function atLeast(version, [major, minor, patch]) {
  if (!version) return false;
  if (version[0] !== major) return version[0] > major;
  if (version[1] !== minor) return version[1] > minor;
  return version[2] >= patch;
}

// Turns a PlotPlan into the exact list of EBB commands. Pure: nothing is sent.
export function compileEbbPlan(plan, options = {}) {
  const profile = resolveProfile(options.profile);
  const toMm = UNIT_TO_MM[plan.units];
  if (!toMm) {
    throw new RangeError(`Direct plotting needs physical units (mm, cm or in); this plan uses "${plan.units}".`);
  }
  const planned = plan.options || {};
  const drawSpeed = positive(options.drawSpeed ?? planned.drawSpeed, profile.drawSpeed);
  const travelSpeed = positive(options.travelSpeed ?? planned.travelSpeed, profile.travelSpeed);
  const acceleration = positive(options.acceleration, profile.acceleration);
  const travelAcceleration = positive(options.travelAcceleration, profile.travelAcceleration ?? profile.acceleration);
  const junctionDeviation = positive(options.junctionDeviation, profile.junctionDeviation);
  const commandSet = options.commandSet || "LM";
  if (commandSet !== "LM" && commandSet !== "SM") throw new RangeError(`Unknown command set: ${commandSet}`);
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

  // Absolute step targets: rounding never accumulates into drift.
  const stepsTo = (target) => {
    const goal = mixCoreXY(target.x, target.y, profile.stepsPerMm);
    const d1 = goal.a1 - steps.a1;
    const d2 = goal.a2 - steps.a2;
    steps.a1 = goal.a1;
    steps.a2 = goal.a2;
    return [d1, d2];
  };
  const push = (cmd, durationMs) => {
    commands.push({ cmd, kind: penDown ? "draw" : "travel", durationMs });
    stats.durationMs += durationMs;
  };

  // One LM per phase: rate and acceleration per motor in the board's own
  // units (2^31 x 40 µs per step/s), ending exactly on the phase's steps.
  const rateLimit = Math.min(RATE_MAX, profile.maxStepRate * 1000 * RATE_SCALE * INTERVAL_S);
  const emitLowLevel = (phase) => {
    const [d1, d2] = stepsTo(phase.to);
    if (d1 === 0 && d2 === 0) return;
    const seconds = (2 * phase.length) / (phase.vs + phase.ve);
    let intervals = Math.max(1, Math.round(seconds / INTERVAL_S));
    const axis = (d) => {
      if (d === 0) return { rate: 0, accel: 0, start: 0, end: 0 };
      const average = (RATE_SCALE * Math.abs(d)) / intervals;
      const start = (average * 2 * phase.vs) / (phase.vs + phase.ve);
      const end = (average * 2 * phase.ve) / (phase.vs + phase.ve);
      let rate = Math.round(start);
      let accel = Math.round((end - start) / intervals);
      if (rate === 0 && accel === 0) accel = 1; // the firmware needs some motion on a moving axis
      return { rate, accel, start, end };
    };
    let a1 = axis(d1);
    let a2 = axis(d2);
    const top = Math.max(a1.start, a1.end, a2.start, a2.end);
    if (top > rateLimit) {
      // Integer step counts on a very short phase can round past the step
      // rate limit; stretch the phase a hair instead of overflowing.
      intervals = Math.ceil((intervals * top) / rateLimit);
      a1 = axis(d1);
      a2 = axis(d2);
    }
    push(`LM,${a1.rate},${d1},${a1.accel},${a2.rate},${d2},${a2.accel},3`, intervals * INTERVAL_S * 1000);
  };

  // SM fallback: the phase as a staircase of short constant-speed slices.
  const emitSlices = (phase) => {
    const seconds = (2 * phase.length) / (phase.vs + phase.ve);
    const count = Math.max(1, Math.ceil(seconds / SLICE_S));
    const rate = (phase.ve - phase.vs) / seconds;
    for (let index = 1; index <= count; index += 1) {
      const t = (seconds * index) / count;
      const distance = index === count ? phase.length : phase.vs * t + 0.5 * rate * t * t;
      const fraction = distance / phase.length;
      const target = index === count
        ? phase.to
        : { x: phase.from.x + (phase.to.x - phase.from.x) * fraction, y: phase.from.y + (phase.to.y - phase.from.y) * fraction };
      const [d1, d2] = stepsTo(target);
      if (d1 === 0 && d2 === 0) continue;
      let ms = Math.max(1, Math.round((seconds / count) * 1000));
      ms = Math.max(ms, Math.ceil(Math.max(Math.abs(d1), Math.abs(d2)) / profile.maxStepRate));
      push(`SM,${ms},${d1},${d2}`, ms);
    }
  };

  const stroke = (points, speed, accel) => {
    const phases = planStroke(points, {
      speed,
      acceleration: accel,
      junctionDeviation,
      stepsPerMm: profile.stepsPerMm,
      maxStepRate: profile.maxStepRate
    });
    let length = 0;
    for (const phase of phases) {
      length += phase.length;
      if (commandSet === "LM") emitLowLevel(phase);
      else emitSlices(phase);
    }
    const last = points[points.length - 1];
    position.x = last.x;
    position.y = last.y;
    if (penDown) stats.drawMm += length;
    else stats.travelMm += length;
  };
  const travelTo = (target) => stroke([{ ...position }, target], travelSpeed, travelAcceleration);

  commands.push({ cmd: "EM,1,1", kind: "motors-on", durationMs: 0 });
  pen(false);

  let toolSeen = false;
  for (const move of plan.moves) {
    if (move.type === "tool-change") {
      if (toolSeen) {
        pen(false);
        commands.push({ cmd: "", kind: "wait-idle", durationMs: 0 });
        commands.push({ cmd: "", kind: "tool-change", toolId: move.toolId, durationMs: 0 });
      }
      toolSeen = true;
    } else if (move.type === "travel") {
      pen(false);
      travelTo(point(move.to));
    } else if (move.type === "draw") {
      pen(false);
      travelTo(point(move.points[0]));
      pen(true);
      stroke(move.points.map(point), drawSpeed, acceleration);
    }
  }

  pen(false);
  if (returnHome) travelTo({ x: 0, y: 0 });
  commands.push({ cmd: "", kind: "wait-idle", durationMs: 0 });
  commands.push({ cmd: "EM,0,0", kind: "motors-off", durationMs: 0 });

  return {
    schema: "vanilla.penplotter/ebb@1",
    profile: profile.id,
    commandSet,
    settings: { drawSpeed, travelSpeed, acceleration, travelAcceleration, junctionDeviation },
    commands,
    stats,
    end: { ...position }
  };
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

  // Firmware 3.0+ can queue more than one motion command. Ask how many, use
  // them all: the host then stays well ahead and the machine never waits.
  async openFifo(firmware) {
    const wanted = this.profile.fifoDepth ?? 1;
    if (!atLeast(firmware, [3, 0, 0]) || wanted <= 1) return 1;
    const reply = await this.ask("QU,2", 2000);
    const maximum = Number(reply.split(",").pop());
    const depth = Math.min(wanted, Number.isFinite(maximum) && maximum > 0 ? maximum : 1);
    if (depth > 1) await this.ask(`CU,4,${depth}`, 2000);
    return depth;
  }

  async run(planOrCompiled, options = {}) {
    if (options.confirmed !== true) {
      throw new Error("Direct plotting requires { confirmed: true }: carriage at the home corner, pen and paper checked.");
    }
    this.aborted = false;

    const version = await this.transport.send("V", { timeoutMs: 2000 });
    if (!/EBB/i.test(version)) throw new Error(`The connected device is not an EBB board: "${version}".`);
    const firmware = parseVersion(version);
    const lowLevel = atLeast(firmware, [2, 7, 0]);

    let compiled;
    if (planOrCompiled.schema === "vanilla.penplotter/ebb@1") {
      compiled = planOrCompiled;
      if (compiled.commandSet !== "SM" && !lowLevel) {
        throw new Error(`This EBB runs firmware ${version.trim()}; LM moves need 2.7.0 or newer. Compile with { commandSet: "SM" } or pass the plan.`);
      }
    } else {
      compiled = compileEbbPlan(planOrCompiled, { ...options, profile: this.profile, commandSet: lowLevel ? "LM" : "SM" });
    }

    const total = compiled.commands.length;
    const recent = []; // durations of the commands that may still be queued
    try {
      const depth = await this.openFifo(firmware);
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
          recent.length = 0;
        } else {
          // The EBB answers once the command is queued; with a full queue
          // that is only after the oldest queued move has finished.
          recent.push(entry.durationMs);
          while (recent.length > depth + 2) recent.shift();
          await this.ask(entry.cmd, 5000 + recent.reduce((sum, ms) => sum + ms, 0));
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
  const fifoMax = options.fifoMax ?? 32;
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
      if (cmd === "QU,2") return `QU,2,${fifoMax}`;
      if (cmd === "QU,3") return "QU,3,1";
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
  let waiter = null; // called as soon as bytes arrive
  let chain = Promise.resolve();

  async function pump() {
    try {
      while (active) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          if (waiter) waiter();
        }
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
    return new Promise((resolve, reject) => {
      let timer = null;
      const check = () => {
        const reply = takeReply(name);
        if (reply === null) return false;
        clearTimeout(timer);
        waiter = null;
        buffer = "";
        resolve(reply.trim());
        return true;
      };
      if (check()) return;
      waiter = check;
      timer = setTimeout(() => {
        waiter = null;
        reject(new Error(`No reply to "${cmd}" within ${timeoutMs} ms.`));
      }, timeoutMs);
    });
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
