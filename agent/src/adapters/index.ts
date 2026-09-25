import { adapterRegistry } from "./registry";
import { SlideShareAdapter } from "./slideshare/slideshareAdapter";
import { ScribdAdapter } from "./scribd/scribdAdapter";
import { ArchiveOrgAdapter } from "./archiveOrg/archiveOrgAdapter";
import { ZenodoAdapter } from "./zenodo/zenodoAdapter";
import { StuDocuAdapter } from "./studocu/studocuAdapter";

// Initialize and register all 5 built-in website adapters
export function initAdapters() {
  const slideshare = new SlideShareAdapter();
  adapterRegistry.register(slideshare);

  const scribd = new ScribdAdapter();
  adapterRegistry.register(scribd);

  const archiveOrg = new ArchiveOrgAdapter();
  adapterRegistry.register(archiveOrg);

  const zenodo = new ZenodoAdapter();
  adapterRegistry.register(zenodo);

  const studocu = new StuDocuAdapter();
  adapterRegistry.register(studocu);

  console.log(`[ADAPTERS] Initialized adapters: [${adapterRegistry.listIds().join(", ")}]`);
}

// Auto-initialize on import
initAdapters();

export { adapterRegistry };
export * from "./types";
export * from "./baseAdapter";
export * from "./slideshare/slideshareAdapter";
export * from "./scribd/scribdAdapter";
export * from "./archiveOrg/archiveOrgAdapter";
export * from "./zenodo/zenodoAdapter";
export * from "./studocu/studocuAdapter";
