import { adapterRegistry } from "./registry";
import { SlideShareAdapter } from "./slideshare/slideshareAdapter";
import { ScribdAdapter } from "./scribd/scribdAdapter";

// Initialize and register all built-in website adapters
export function initAdapters() {
  const slideshare = new SlideShareAdapter();
  adapterRegistry.register(slideshare);

  const scribd = new ScribdAdapter();
  adapterRegistry.register(scribd);

  console.log(`[ADAPTERS] Initialized adapters: [${adapterRegistry.listIds().join(", ")}]`);
}

// Auto-initialize on import
initAdapters();

export { adapterRegistry };
export * from "./types";
export * from "./baseAdapter";
export * from "./slideshare/slideshareAdapter";
export * from "./scribd/scribdAdapter";
