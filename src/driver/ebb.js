// EBB (EiBotBoard) driver: streams a PlotPlan straight to an AxiDraw-style
// CoreXY plotter, without an SVG in between.
//
// Machine facts for "idraw-hse-a2" were verified on the physical machine on
// 2026-09-21 (firmware EBB 3.0.2) and match axidraw_conf.py of the vendor's
// iDraw HSE Inkscape extension: motor1 = X + Y, motor2 = X - Y, 80 steps/mm at
// 16x microstepping, 594 x 432 mm travel. The EBB has no homing: the position
// of the carriage when run() or session() starts IS the origin (0,0).
//
// Motion is planned with acceleration. Every stroke (one pen-down path, or one
// pen-up travel) gets a speed profile: ramp up from rest, cruise, slow down
// into corners by how sharp they are, ramp down to rest. The profile is sent
// as LM commands for drawing (firmware 2.7+), with exact step counts per motor.
// Pen-up travel and older firmware use short constant-speed SM slices.

import { simplifyPath } from "../optimizer/index.js";

const UNIT_TO_MM = Object.freeze({ mm: 1, cm: 10, in: 25.4 });
const INTERVAL_S = 40e-6; // the EBB motion interrupt runs at 25 kHz
const RATE_SCALE = 2 ** 31; // LM accumulators step when they pass 2^31
const RATE_MAX = 2 ** 31 - 1;
const SLICE_S = 0.025; // SM fallback: longest constant-speed slice
const MIN_PHASE_S = 0.004; // a ramp shorter than this is folded into its neighbour
const SESSION = Symbol("EBB session state");

export const EBB_PROFILES = Object.freeze({
  "idraw-hse-a2": Object.freeze({
    id: "idraw-hse-a2",
    name: "iDraw HSE / A2 (EBB)",
    stepsPerMm: 80,
    travel: Object.freeze({ width: 594, height: 432 }),
    maxStepRate: 24.995, // steps per millisecond, per motor
    minStepRate: 1.31, // steps per second, per motor (SM only)
    // Operating settings: deliberately separate from the vendor defaults.
    drawSpeed: 40, // mm/s, pen down
    travelSpeed: 40, // mm/s, pen up
    acceleration: 800, // mm/s², pen down
    travelAcceleration: 300, // mm/s², pen up
    junctionDeviation: 0.05, // mm: how far a corner may be rounded by not stopping
    minSpeed: 2, // mm/s: a stroke starts, turns around and ends at this, never at zero
    simplifyTolerance: 0.02, // mm: chords within this of a straight line are merged before planning
    penDownDelay: 300, // ms
    penUpDelay: 300, // ms
    fifoDepth: 32, // motion commands queued on the board (firmware 3.0+)
    aheadMs: 250, // how much motion the host sends ahead of the acknowledgements
    usb: Object.freeze({ usbVendorId: 0x04d8, usbProductId: 0xfd92 }),
    manufacturerDefaults: Object.freeze({
      source: "https://idrawpenplotter.com/pages/downloads",
      package: "extensions-260620.zip; idraw_HSE.inx, axidraw_conf.py, axidraw.py, motion.py",
      model: 6,
      microstepping: 16,
      stepsPerMm: 80,
      drawSpeed: 25 * 8.6979 / 110 * 25.4,
      travelSpeed: 75 * 8.6979 / 110 * 25.4,
      acceleration: 40 * 0.75 * 25.4,
      travelAcceleration: 60 * 0.75 * 25.4
    }),
    penServo: Object.freeze({
      type: "standard",
      min: 9855,
      max: 27831,
      sweepMs: 200,
      periodMs: 24,
      up: 60,
      down: 30,
      raiseRate: 75,
      lowerRate: 50
    })
  })
});

// Research evidence, not automatic model detection or additional machine profiles.
export const EBB_COMPATIBILITY = Object.freeze([
  { name: "iDraw HSE / A2", status: "tested", profile: "idraw-hse-a2", source: "https://idrawpenplotter.com/pages/downloads" },
  { name: "iDraw HSE / A3", status: "likely", profile: null, source: "https://idrawpenplotter.com/pages/downloads" },
  { name: "AxiDraw V2, V3, V3/A3, SE/A3, SE/A2 and MiniKit (standard pen lift)", status: "likely", profile: null, source: "https://github.com/evil-mad/axidraw/blob/master/inkscape%20driver/axidraw_conf.py" },
  { name: "Bantam Tools NextDraw", status: "needs-profile", profile: null, source: "https://bantam.tools/nd_migrate/" },
  { name: "EggBot and WaterColorBot", status: "different-kinematics", profile: null, source: "https://evil-mad.github.io/EggBot/ebb.html" }
].map(Object.freeze));

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
  const floor = Math.min(settings.minSpeed ?? 0, speed);
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

  // Speed allowed at every vertex: the floor at both ends, and in between as
  // much as the corner allows (GRBL's junction deviation: a sharper corner is
  // a slower corner, a reversal drops to the floor, a straight line never
  // slows). Never exactly zero: a step rate of zero leaves the last step to
  // rounding luck, and the pen would sit on the paper waiting for it.
  const vertex = new Array(segments.length + 1).fill(floor);
  for (let index = 1; index < segments.length; index += 1) {
    const a = segments[index - 1];
    const b = segments[index];
    const cosTheta = -(a.ux * b.ux + a.uy * b.uy);
    const sinHalf = Math.sqrt(Math.max(0, 0.5 * (1 - cosTheta)));
    const corner = sinHalf >= 1 - 1e-9
      ? Infinity
      : Math.sqrt((acceleration * junctionDeviation * sinHalf) / (1 - sinHalf));
    vertex[index] = Math.max(floor, Math.min(corner, a.vmax, b.vmax));
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
  const minSpeed = positive(options.minSpeed, profile.minSpeed ?? 2);
  const simplifyTolerance = Math.max(0, Number(options.simplifyTolerance ?? profile.simplifyTolerance ?? 0));
  const commandSet = options.commandSet || "LM";
  if (commandSet !== "LM" && commandSet !== "SM") throw new RangeError(`Unknown command set: ${commandSet}`);
  const returnHome = options.returnHome !== false;
  // Resuming: the first skipDraws strokes are already on paper. The carriage
  // is parked at home again by hand, so the plot starts there and travels to
  // the first stroke still to do.
  const skipDraws = Math.max(0, Math.floor(Number(options.skipDraws ?? 0)));
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
  // SC stores pen parameters; the following SP performs the actual lift.
  // Opt in explicitly: the installed servo and pen mounting must be known.
  if (options.penLift !== undefined) {
    if (!options.penLift || typeof options.penLift !== "object" || Array.isArray(options.penLift)) {
      throw new TypeError("penLift must be an object with up, down, raiseRate and lowerRate percentages.");
    }
    const servo = profile.penServo;
    if (!servo || servo.type !== "standard") throw new Error("This profile has no standard pen-lift calibration.");
    const percent = (key) => {
      const value = Object.hasOwn(options.penLift, key) ? options.penLift[key] : servo[key];
      const minimum = key.endsWith("Rate") ? 1 : 0;
      if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > 100) {
        throw new RangeError(`penLift.${key} must be between ${minimum} and 100.`);
      }
      return value;
    };
    const range = servo.max - servo.min;
    const rateScale = range * (servo.periodMs / 100) / servo.sweepMs;
    const values = [
      [4, Math.round(servo.min + range * percent("up") / 100)],
      [5, Math.round(servo.min + range * percent("down") / 100)],
      [11, Math.round(rateScale * percent("raiseRate"))],
      [12, Math.round(rateScale * percent("lowerRate"))]
    ];
    for (const [parameter, value] of values) commands.push({ cmd: `SC,${parameter},${value}`, kind: "pen-setup", durationMs: 0 });
  }
  const stats = { drawMm: 0, travelMm: 0, penDowns: 0, durationMs: 0 };
  const session = options[SESSION];
  const position = { ...(session?.position ?? { x: 0, y: 0 }) };
  const steps = { ...(session?.steps ?? { a1: 0, a2: 0 }) };
  let penDown = null;
  let drawing = null; // index of the draw move the pen is down for

  const pen = (down) => {
    if (penDown === down) return;
    const delay = down ? profile.penDownDelay : profile.penUpDelay;
    const entry = { cmd: `SP,${down ? 0 : 1},${delay}`, kind: down ? "pen-down" : "pen-up", durationMs: delay };
    // The pen-up after a stroke marks that stroke as complete: what a page
    // remembers so an interrupted plot can go on from there.
    if (!down && drawing !== null) {
      entry.completes = drawing;
      drawing = null;
    }
    commands.push(entry);
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
      // Aim a quarter step past the target: rounding then makes the last
      // step land a tick early rather than leave it hanging after the end.
      const average = (RATE_SCALE * (Math.abs(d) + 0.25)) / intervals;
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

  const stroke = (rawPoints, speed, accel) => {
    // Chords within the tolerance of a straight line are one command, not
    // many: the board parses a command in a few milliseconds, and a circle
    // drawn as 360 chords of 0.2 mm would stutter 360 times.
    const points = simplifyTolerance > 0 && rawPoints.length > 2 ? simplifyPath(rawPoints, simplifyTolerance) : rawPoints;
    const phases = planStroke(points, {
      speed,
      acceleration: accel,
      junctionDeviation,
      minSpeed,
      stepsPerMm: profile.stepsPerMm,
      maxStepRate: profile.maxStepRate
    });
    let length = 0;
    for (const phase of phases) {
      length += phase.length;
      if (commandSet === "LM" && penDown) emitLowLevel(phase);
      else emitSlices(phase);
    }
    const last = points[points.length - 1];
    position.x = last.x;
    position.y = last.y;
    if (penDown) stats.drawMm += length;
    else stats.travelMm += length;
  };
  const travelTo = (target) => stroke([{ ...position }, target], travelSpeed, travelAcceleration);

  if (!session?.enabled) commands.push({ cmd: "EM,1,1", kind: "motors-on", durationMs: 0 });
  pen(false);

  let toolSeen = false;
  let draws = 0;
  for (const move of plan.moves) {
    if (move.type === "tool-change") {
      if (toolSeen) {
        pen(false);
        commands.push({ cmd: "", kind: "wait-idle", durationMs: 0 });
        commands.push({ cmd: "", kind: "tool-change", toolId: move.toolId, durationMs: 0 });
      }
      toolSeen = true;
    } else if (move.type === "travel") {
      // Each draw travels to its own first point anyway; a plan's explicit
      // travel is only honoured while nothing is being skipped.
      if (draws >= skipDraws) {
        pen(false);
        travelTo(point(move.to));
      }
    } else if (move.type === "draw") {
      const index = draws;
      draws += 1;
      if (index < skipDraws) continue;
      pen(false);
      travelTo(point(move.points[0]));
      drawing = index;
      pen(true);
      stroke(move.points.map(point), drawSpeed, acceleration);
    }
  }

  pen(false);
  if (returnHome) travelTo({ x: 0, y: 0 });
  commands.push({ cmd: "", kind: "wait-idle", durationMs: 0 });
  if (!session || returnHome) commands.push({ cmd: "EM,0,0", kind: "motors-off", durationMs: 0 });

  return {
    schema: "vanilla.penplotter/ebb@1",
    profile: profile.id,
    commandSet,
    settings: { drawSpeed, travelSpeed, acceleration, travelAcceleration, junctionDeviation, minSpeed, simplifyTolerance },
    draws,
    skipDraws,
    commands,
    stats,
    end: { ...position },
    endSteps: { ...steps }
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
    if (this.transport.faulted && this.transport.stop) {
      try { await this.transport.stop(); } catch { /* delivery is not guaranteed */ }
      return;
    }
    for (const cmd of ["ES", "SP,1", "EM,0,0"]) {
      try {
        await this.transport.send(cmd, { timeoutMs: 2000 });
      } catch {
        // keep going: the remaining commands matter more than the error
      }
    }
  }

  // For a page that is going away: no replies, one write, pen up first.
  async emergencyStop() {
    this.aborted = true;
    if (this.transport.stop) await this.transport.stop();
    else await this.safeStop();
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
    if (this.busy) throw new Error("The EBB driver is already running.");
    this.busy = true;
    try {
      return await this.#runJob(planOrCompiled, options);
    } finally {
      this.busy = false;
    }
  }

  // Experimental: one three-line hardware run; see tests/hardware/session-2026-10-03.json.
  async session(prepare, options = {}) {
    if (typeof prepare !== "function") throw new TypeError("session() needs a function.");
    if (options.confirmed !== true) throw new Error("A session requires { confirmed: true }: carriage at home, pen and paper checked.");
    if (this.busy) throw new Error("The EBB driver is already running.");
    this.busy = true;
    this.aborted = false;
    const state = { position: { x: 0, y: 0 }, steps: { a1: 0, a2: 0 }, enabled: false };
    let active = true;
    let pending = null;
    let failed = null;
    let jobs = 0;
    const session = {
      get position() { return { ...state.position }; },
      run: (plan, jobOptions = {}) => {
        if (!active || failed || this.aborted) return Promise.reject(new Error("This EBB session has ended."));
        if (pending) return Promise.reject(new Error("Wait for the current session job to finish."));
        if (plan?.schema === "vanilla.penplotter/ebb@1") return Promise.reject(new Error("Sessions need a PlotPlan, not compiled commands."));
        pending = this.#runJob(plan, { ...options, ...jobOptions, confirmed: true, returnHome: false, [SESSION]: state })
          .then(result => {
            if (result.status !== "complete") failed = new Error("The EBB session was stopped.");
            else jobs += 1;
            return result;
          })
          .catch(error => { failed = error; throw error; })
          .finally(() => { pending = null; });
        pending.catch(() => {});
        return pending;
      }
    };
    try {
      await prepare(session);
      active = false;
      if (pending) await pending;
      if (failed) throw failed;
      if (this.aborted) throw new Error("The EBB session was stopped.");
      if (state.enabled) {
        const result = await this.#runJob({ units: "mm", moves: [], options: {} }, {
          ...options, confirmed: true, returnHome: true, [SESSION]: state
        });
        if (result.status !== "complete") throw new Error("The EBB session was stopped while returning home.");
      }
      return { status: "complete", jobs };
    } catch (error) {
      active = false;
      this.aborted = true;
      if (pending) await pending.catch(() => {});
      await this.safeStop();
      throw error;
    } finally {
      active = false;
      this.busy = false;
    }
  }

  async #runJob(planOrCompiled, options = {}) {
    if (options.confirmed !== true) {
      throw new Error("Direct plotting requires { confirmed: true }: carriage at the home corner, pen and paper checked.");
    }
    if (!options[SESSION]) this.aborted = false;
    if (this.aborted) return { status: "aborted", commands: 0 };
    const session = options[SESSION];
    if (session) {
      const tools = new Set(planOrCompiled.moves.filter(move => move.type === "draw").map(move => move.toolId));
      if (session.toolKnown) tools.add(session.toolId);
      if (tools.size > 1) throw new Error("An EBB session currently supports one pen.");
      if (tools.size) {
        session.toolId = tools.values().next().value;
        session.toolKnown = true;
      }
    }

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
    const aheadMs = this.profile.aheadMs ?? 250;
    const inflight = []; // commands sent whose acknowledgement is still to come
    // An acknowledgement means queued, not completed. Keep the remaining
    // motion time even when many short commands follow an acknowledged long
    // move; a window of the last N commands can forget that move too early.
    let motionDeadline = performance.now();
    const queuedMs = () => inflight.reduce((sum, item) => sum + item.durationMs, 0);
    const settle = async (keep) => {
      while (inflight.length > keep) await inflight.shift().promise;
    };
    try {
      const depth = await this.openFifo(firmware);
      for (let index = 0; index < total; index += 1) {
        if (this.aborted) {
          await this.safeStop();
          return { status: "aborted", index, commands: index };
        }
        const entry = compiled.commands[index];
        if (entry.kind === "tool-change") {
          await settle(0);
          if (options.onToolChange) await options.onToolChange(entry.toolId);
        } else if (entry.kind === "wait-idle") {
          await settle(0);
          await this.waitIdle();
          motionDeadline = performance.now();
        } else {
          // Commands go out ahead of their acknowledgements, so a run of
          // short moves is never paced by the USB round trip: at least two
          // in flight, more while they add up to less than aheadMs of
          // motion, never more than the board's queue can hold. That bound
          // also keeps a stop quick: the ES behind them is parsed as soon
          // as they are. The EBB acknowledges a command once it is queued;
          // with a full queue that is when the oldest queued move finishes.
          while (inflight.length >= 2 && (inflight.length > depth || queuedMs() >= aheadMs)) await settle(inflight.length - 1);
          const now = performance.now();
          motionDeadline = Math.max(now, motionDeadline) + entry.durationMs;
          const timeoutMs = 5000 + motionDeadline - now;
          const promise = this.ask(entry.cmd, timeoutMs)
            .then(() => (options.onProgress ? options.onProgress(index, total, entry) : undefined));
          promise.catch(() => {}); // reported where it is awaited, never as an unhandled rejection
          inflight.push({ promise, durationMs: entry.durationMs });
          continue;
        }
        if (options.onProgress) await options.onProgress(index, total, entry);
      }
      await settle(0);
    } catch (error) {
      await this.safeStop();
      throw error;
    }
    if (this.aborted) {
      await this.safeStop();
      return { status: "aborted", commands: total };
    }
    if (options[SESSION]) {
      options[SESSION].position = { ...compiled.end };
      options[SESSION].steps = { ...compiled.endSteps };
      options[SESSION].enabled = options.returnHome === false;
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
    },
    async stop() {
      log.push("ES", "SP,1", "EM,0,0");
    }
  };
}

// Commands whose reply is a single line without a trailing OK (firmware 3.x).
const NO_OK = new Set(["V", "QM"]);

// Browser transport over Web Serial. Pass an already granted SerialPort, or
// call open() from a user gesture to let the browser show its port picker.
//
// Several commands may be in flight at once. The EBB answers in the order it
// receives, so replies are handed to the waiting callers in send order: a
// line starting with "!" is an error reply, everything before an OK line is
// the reply, and for V and QM, which firmware 3.x answers without OK, the
// first line is.
export function createWebSerialTransport(port = null, options = {}) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let reader = null;
  let writer = null;
  let buffer = "";
  let active = false;
  let writes = Promise.resolve();
  const pending = []; // { cmd, name, lines, resolve, reject, timer } in send order

  function finish(item, reply, error) {
    const at = pending.indexOf(item);
    if (at >= 0) pending.splice(at, 1);
    clearTimeout(item.timer);
    if (error) item.reject(error);
    else item.resolve(reply.trim());
  }

  function failAll(error) {
    while (pending.length) finish(pending[0], null, error);
  }

  function deliver() {
    for (;;) {
      const newline = buffer.search(/[\r\n]/);
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const head = pending[0];
      if (!head) continue; // nobody asked: leftover from before open()
      if (line.startsWith("!") || line === "OK") finish(head, line === "OK" ? head.lines.join("\n") : line);
      else if (NO_OK.has(head.name)) finish(head, line);
      else head.lines.push(line);
    }
  }

  async function pump() {
    try {
      while (active) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          deliver();
        }
      }
    } catch {
      // expected when close() cancels the reader
    }
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
      buffer = "";
      active = true;
      pump();
    },
    send(cmd, sendOptions = {}) {
      if (!active) return Promise.reject(new Error("Open the transport first."));
      const timeoutMs = sendOptions.timeoutMs ?? 3000;
      return new Promise((resolve, reject) => {
        const item = { cmd, name: cmd.split(",")[0], lines: [], resolve, reject, timer: null };
        pending.push(item);
        // A reply that never comes breaks the order of everything behind it.
        item.timer = setTimeout(() => failAll(new Error(`No reply to "${cmd}" within ${timeoutMs} ms.`)), timeoutMs);
        writes = writes
          .then(() => writer.write(encoder.encode(`${cmd}\r`)))
          .catch((error) => finish(item, null, error));
      });
    },
    // The page is going away: no time for replies. One write with stop, pen
    // up and motors off, and the transport is dead from here on.
    async stop() {
      if (!active) return;
      active = false;
      failAll(new Error("The plot was stopped: pen up, motors off."));
      try {
        await writes;
        if (writer) await writer.write(encoder.encode("ES\rSP,1\rEM,0,0\r"));
      } catch {
        // the port may already be gone; nothing more to do
      }
    },
    async close() {
      active = false;
      failAll(new Error("The transport was closed."));
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
