const TYPES = new Set(["optimizer", "effect", "renderer", "driver"]);

export class PluginHost {
  constructor() {
    this.registry = new Map();
    for (const type of TYPES) this.registry.set(type, new Map());
  }

  register(type, name, implementation) {
    if (!TYPES.has(type)) throw new Error(`Unknown plugin type: ${type}`);
    if (!name || typeof implementation !== "function") {
      throw new TypeError("A plugin registration needs a name and function.");
    }
    const collection = this.registry.get(type);
    if (collection.has(name)) throw new Error(`Plugin already registered: ${type}:${name}`);
    collection.set(name, implementation);
    return this;
  }

  use(plugin) {
    if (!plugin || typeof plugin.install !== "function") {
      throw new TypeError("A plugin needs an install(host) method.");
    }
    plugin.install(this);
    return this;
  }

  has(type, name) {
    return this.registry.get(type)?.has(name) || false;
  }

  get(type, name) {
    const implementation = this.registry.get(type)?.get(name);
    if (!implementation) throw new Error(`Unknown plugin: ${type}:${name}`);
    return implementation;
  }
}
