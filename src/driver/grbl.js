const scaleByUnit = { mm: 1, cm: 10, in: 25.4 };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function positive(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive.`);
  return value;
}

// DrawCore pen positions must be supplied for the installed pen mechanism.
export function compileDrawCorePlan(plan, options = {}) {
  const scale = scaleByUnit[plan.units];
  if (!scale || !Array.isArray(plan.moves)) throw new Error("A physical plot plan is required.");
  const { travel, penUp, penDown } = options;
  positive(travel?.width, "Travel width");
  positive(travel?.height, "Travel height");
  for (const [name, value] of [["penUp", penUp], ["penDown", penDown]]) {
    if (!Number.isFinite(value) || value < 0 || value > 10) throw new RangeError(`${name} must be an explicit Z position between 0 and 10.`);
  }
  if (penUp === penDown) throw new RangeError("Pen positions must differ.");
  const axes = options.axes;
  if (!axes || typeof axes.swapXY !== "boolean" || ![1, -1].includes(axes.xDirection) || ![1, -1].includes(axes.yDirection)) {
    throw new Error("Supply an explicit axes mapping: swapXY, xDirection and yDirection (+1 or -1).");
  }
  const drawFeed = positive(options.drawFeed ?? 1200, "Drawing feed");
  const travelFeed = positive(options.travelFeed ?? 1800, "Travel feed");
  const penFeed = positive(options.penFeed ?? 1000, "Pen feed");
  const number = value => Number(value.toFixed(4));
  const xy = point => {
    const x = point?.x * scale, y = point?.y * scale;
    if (![x, y].every(Number.isFinite) || x < 0 || y < 0 || x > travel.width || y > travel.height) throw new RangeError("A point falls outside the configured machine bounds.");
    const a = axes.swapXY ? y : x, b = axes.swapXY ? x : y;
    return `X${number(a * axes.xDirection)} Y${number(b * axes.yDirection)}`;
  };
  const up = `G1 Z${number(penUp)} F${penFeed}`;
  const down = `G1 Z${number(penDown)} F${penFeed}`;
  const commands = ["G21", "G90", "G94", up];
  const tools = new Set();
  for (const move of plan.moves) {
    if (move.type === "tool-change") {
      tools.add(move.toolId);
      if (tools.size > 1) throw new Error("DrawCore jobs currently support one pen.");
    } else if (move.type === "travel") {
      commands.push(up, `G1 ${xy(move.to)} F${travelFeed}`);
    } else if (move.type === "draw") {
      if (!Array.isArray(move.points) || move.points.length < 2) throw new Error("A drawing move needs at least two points.");
      commands.push(up, `G1 ${xy(move.points[0])} F${travelFeed}`, down);
      for (const point of move.points.slice(1)) commands.push(`G1 ${xy(point)} F${drawFeed}`);
      commands.push(up);
    } else throw new Error(`Unsupported move type: ${move.type}`);
  }
  commands.push(up);
  if (options.returnHome !== false) commands.push(`G1 X0 Y0 F${travelFeed}`);
  return { commands };
}

export function parseGrblStatus(reply) {
  const match = /^<([^|>]+)\|(.+)>$/.exec(reply.trim());
  if (!match) throw new Error(`Invalid GRBL status: ${reply}`);
  const fields = Object.fromEntries(match[2].split("|").map(field => {
    const at = field.indexOf(":");
    return [field.slice(0, at), field.slice(at + 1).split(",").map(Number)];
  }));
  const position = fields.WPos || (fields.MPos && fields.WCO ? fields.MPos.map((n, i) => n - fields.WCO[i]) : null);
  return { state: match[1], position, machinePosition: fields.MPos, offset: fields.WCO };
}

export class DrawCoreDriver {
  constructor(options = {}) {
    if (!options.transport) throw new TypeError("DrawCoreDriver needs a transport.");
    this.transport = options.transport;
    this.options = options;
    this.aborted = false;
    this.stopPromise = null;
  }
  abort() {
    this.aborted = true;
    this.stopPromise = this.transport.writeRealtime("!").then(() => true, () => false);
  }
  async safeStop() {
    this.abort();
    await this.stopPromise;
  }
  async emergencyStop() { await this.safeStop(); }
  async status() {
    const status = parseGrblStatus(await this.transport.send("?"));
    if (status.offset) this.offset = status.offset;
    if (!status.position && status.machinePosition && this.offset) status.position = status.machinePosition.map((n, i) => n - this.offset[i]);
    return status;
  }
  async waitIdle(timeoutMs) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (this.aborted) return;
      const status = await this.status();
      if (status.state === "Idle") return;
      if (status.state !== "Run") throw new Error(`Controller is ${status.state}; job cannot continue.`);
      await delay(100);
    }
    throw new Error("Timed out waiting for physical idle.");
  }
  async run(plan, options = {}) {
    if (options.confirmed !== true) throw new Error("A physical job requires confirmed: true.");
    if (this.busy) throw new Error("The DrawCore driver is already running.");
    const settings = { ...this.options, ...options };
    const compiled = compileDrawCorePlan(plan, settings);
    this.busy = true;
    this.aborted = false;
    this.offset = null;
    try {
      let initial = await this.status();
      // GRBL reports WCO intermittently, not necessarily on the first query.
      for (let attempt = 0; initial.state === "Idle" && !initial.position && attempt < 12; attempt++) {
        if (this.aborted) return { status: "aborted", holdRequested: await this.stopPromise };
        await delay(100);
        initial = await this.status();
      }
      if (initial.state !== "Idle") throw new Error(`Controller must be Idle, found ${initial.state}.`);
      if (!initial.position || initial.position.length < 2 || !initial.position.slice(0, 2).every(n => Number.isFinite(n) && Math.abs(n) < 0.05)) {
        throw new Error("Set the machine's work origin to X0 Y0 before plotting. No automatic homing or coordinate reset is performed.");
      }
      for (const command of compiled.commands) {
        if (this.aborted) break;
        await this.transport.send(command);
      }
      if (!this.aborted) await this.waitIdle(settings.idleTimeoutMs ?? 120000);
      if (this.aborted) {
        return { status: "aborted", holdRequested: await this.stopPromise };
      }
      return { status: "complete", commands: compiled.commands.length };
    } catch (error) {
      // Hold queued motion. Never reset, unlock or resume automatically.
      await this.safeStop();
      throw error;
    } finally { this.busy = false; }
  }
}
