import { EbbDriver } from "./ebb.js";
import { DrawCoreDriver } from "./grbl.js";

export function identifyController(response) {
  const text = String(response).trim();
  if (/^EBB(?:\b|v\d)/i.test(text)) return { protocol: "ebb", response: text };
  if (/\bDrawCore\s+V[\d.]+/i.test(text)) return { protocol: "drawcore", response: text };
  if (/^Grbl\b/i.test(text) || /\[VER:1\.1/.test(text)) return { protocol: "grbl", response: text };
  return { protocol: "unknown", response: text };
}

export async function detectDriver(transport, options = {}) {
  let identity = transport.identity;
  if (!identity || identity.protocol === "unknown") {
    try { identity = identifyController(await transport.send("V")); }
    catch (error) {
      // An explicit GRBL error to V allows a read-only $I probe. A timeout
      // makes response order uncertain and must never trigger another probe.
      if (!/^GRBL error:/.test(error.message)) throw error;
      identity = identifyController(await transport.send("$I"));
    }
  }
  if (identity.protocol === "unknown") throw new Error(`Unknown controller: ${identity.response}`);
  if (identity.protocol === "grbl") throw new Error("GRBL detected; a machine-specific pen driver is required. This driver supports DrawCore only.");
  transport.protocol = identity.protocol;
  const driver = identity.protocol === "ebb"
    ? new EbbDriver({ transport, profile: options.profile })
    : new DrawCoreDriver({ ...options.drawcore, transport });
  driver.identity = identity;
  return driver;
}

// GRBL uses one outstanding request; EBB retains its ordered FIFO protocol.
// A timeout, read failure or controller reset invalidates the connection.
export function createAutoSerialTransport(port = null, options = {}) {
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  let reader, writer, active = false, pending = null, buffer = "", fault = null;
  const requests = [];
  let writes = Promise.resolve();
  const transport = {
    identity: null,
    protocol: null,
    get faulted() { return Boolean(fault); },
    async open() {
      if (!port) {
        if (!globalThis.navigator?.serial) throw new Error("Web Serial is not available.");
        port = await navigator.serial.requestPort({ filters: [] });
      }
      if (!port.readable) await port.open({ baudRate: options.baudRate ?? 115200 });
      reader = port.readable.getReader();
      writer = port.writable.getWriter();
      active = true;
      pump();
    },
    async writeRealtime(text) {
      if (!writer) throw new Error("The serial port is closed.");
      // Bypass request acknowledgements, but preserve byte-write ordering.
      writes = writes.catch(() => {}).then(() => writer.write(encoder.encode(text)));
      await writes;
    },
    send(command, sendOptions = {}) {
      if (!active || fault) return Promise.reject(fault || new Error("Open the serial transport first."));
      if (pending && transport.protocol !== "ebb") return Promise.reject(new Error("Another serial request is pending."));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => fail(new Error(`No reply to ${command}.`)), sendOptions.timeoutMs ?? options.timeoutMs ?? 3000);
        requests.push({ command, lines: [], resolve, reject, timer });
        pending = requests[0];
        writes = writes.then(() => {
          if (fault) throw fault;
          return writer.write(encoder.encode(command === "?" ? "?" : `${command}\r`));
        });
        writes.catch(fail);
      });
    },
    async stop() {
      fail(new Error("The controller connection was stopped."));
      if (transport.protocol === "ebb") await transport.writeRealtime("ES\rSP,1\rEM,0,0\r");
      else if (transport.protocol === "drawcore" || transport.protocol === "grbl") await transport.writeRealtime("!");
    },
    async close() {
      active = false;
      fail(new Error("The serial port was closed."));
      if (reader) { try { await reader.cancel(); } catch {} reader.releaseLock(); }
      try { await writes; } catch {}
      if (writer) { writer.releaseLock(); writer = null; }
      if (port) await port.close();
    }
  };
  function finish(error, response) {
    if (!pending) return;
    const item = pending;
    requests.shift();
    pending = requests[0] || null;
    clearTimeout(item.timer);
    if (error) item.reject(error); else item.resolve(response);
  }
  function fail(error) { fault = error; while (pending) finish(error); }
  function deliver(line) {
    const identity = identifyController(line);
    if (identity.protocol !== "unknown") {
      const previousIdentity = transport.identity;
      transport.identity = identity;
      transport.protocol = identity.protocol;
      if (pending?.command === "V") { finish(null, line); return; }
      if (/^Grbl\b/i.test(line) && (pending || previousIdentity)) { fail(new Error("Controller restarted; reconnect before continuing.")); return; }
    }
    if (/^(?:error:|ALARM:)/i.test(line)) {
      const error = new Error(`GRBL error: ${line}`);
      if (/^ALARM:/i.test(line)) fail(error); else finish(error);
      return;
    }
    if (!pending) return;
    if (pending.command === "?" && line.startsWith("<")) { finish(null, line); return; }
    if (line === "ok" || line === "OK") { finish(null, pending.lines.join("\n")); return; }
    if (line.startsWith("!")) { finish(new Error(`EBB error: ${line}`)); return; }
    if (["V", "QM"].includes(pending.command)) { finish(null, line); return; }
    if (line.startsWith("<")) return;
    pending.lines.push(line);
  }
  async function pump() {
    try {
      while (active) {
        const { value, done } = await reader.read();
        if (done) { if (active) fail(new Error("Serial connection ended.")); return; }
        buffer += decoder.decode(value, { stream: true });
        for (;;) {
          const at = buffer.search(/[\r\n]/);
          if (at < 0) break;
          const line = buffer.slice(0, at).trim();
          buffer = buffer.slice(at + 1);
          if (line) deliver(line);
        }
      }
    } catch (error) { if (active) fail(error); }
  }
  return transport;
}
