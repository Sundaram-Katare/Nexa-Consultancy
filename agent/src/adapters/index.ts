import { adapterRegistry } from "./registry";
import { SlideShareAdapter } from "./slideshare/slideshareAdapter";

// Initialize and register all built-in website adapters
export function initAdapters() {
  const slideshare = new SlideShareAdapter();
  adapterRegistry.register(slideshare);
  console.log(`[ADAPTERS] Initialized adapters: [${adapterRegistry.listIds().join(", ")}]`);
}

// Auto-initialize on import
initAdapters();

export { adapterRegistry };
export * from "./types";
export * from "./baseAdapter";
export * from "./slideshare/slideshareAdapter";
