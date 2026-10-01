export * from "./ebb.js";

export const MACHINE_PROFILES = Object.freeze({
  "generic-grbl": {
    id: "generic-grbl",
    name: "Generic GRBL + servo",
    renderer: "gcode",
    page: { width: 210, height: 297 },
    drawSpeed: 30,
    travelSpeed: 70,
    direct: "experimental-web-serial"
  },
  "generic-hpgl": {
    id: "generic-hpgl",
    name: "Generic HP-GL plotter",
    renderer: "hpgl",
    page: { width: 210, height: 297 },
    drawSpeed: 25,
    travelSpeed: 55,
    direct: "experimental-web-serial"
  },
  axidraw: {
    id: "axidraw",
    name: "AxiDraw / EBB",
    renderer: "svg",
    page: { width: 279.4, height: 215.9 },
    drawSpeed: 35,
    travelSpeed: 80,
    direct: false,
    note: "Requires a dedicated EBB protocol driver; SVG export is available now."
  },
  idraw: {
    id: "idraw",
    name: "iDraw",
    renderer: "svg",
    page: { width: 420, height: 297 },
    drawSpeed: 35,
    travelSpeed: 80,
    direct: false,
    note: "Protocol support varies by model. The iDraw HSE / A2 has its own profile; iDraw 2.0 uses a different board and is not supported."
  },
  "idraw-hse-a2": {
    id: "idraw-hse-a2",
    name: "iDraw HSE / A2 (EBB)",
    renderer: "svg",
    page: { width: 594, height: 432 },
    drawSpeed: 40,
    travelSpeed: 120,
    direct: "ebb-web-serial",
    note: "Plots directly through EbbDriver; machine facts live in EBB_PROFILES."
  }
});

export class SimulationDriver {
  constructor(options = {}) {
    this.options = options;
    this.aborted = false;
  }

  abort() {
    this.aborted = true;
  }

  async run(plan, handlers = {}) {
    this.aborted = false;
    const total = plan.moves.length;
    for (let index = 0; index < total; index += 1) {
      if (this.aborted) return { status: "aborted", index };
      const move = plan.moves[index];
      if (handlers.onMove) await handlers.onMove(move, index, total);
    }
    return { status: "complete", moves: total };
  }
}

export class WebSerialTextDriver {
  constructor(options = {}) {
    this.options = { baudRate: 115200, lineDelay: 0, ...options };
    this.port = null;
    this.writer = null;
    this.aborted = false;
  }

  async connect(filters = []) {
    if (!globalThis.navigator?.serial) {
      throw new Error("Web Serial is not available in this browser/context.");
    }
    this.port = await navigator.serial.requestPort({ filters });
    await this.port.open({ baudRate: this.options.baudRate });
    this.writer = this.port.writable.getWriter();
  }

  abort() {
    this.aborted = true;
  }

  async send(text, options = {}) {
    if (!this.writer) throw new Error("Connect the serial driver first.");
    if (options.confirmed !== true) {
      throw new Error("Direct plotting requires { confirmed: true } after a physical dry run.");
    }
    this.aborted = false;
    const encoder = new TextEncoder();
    const lines = String(text).split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (this.aborted) return { status: "aborted", line: index };
      await this.writer.write(encoder.encode(`${lines[index]}\n`));
      if (this.options.lineDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.options.lineDelay));
      }
    }
    return { status: "complete", lines: lines.length };
  }

  async disconnect() {
    if (this.writer) {
      this.writer.releaseLock();
      this.writer = null;
    }
    if (this.port) {
      await this.port.close();
      this.port = null;
    }
  }
}
