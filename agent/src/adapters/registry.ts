import { SourceAdapter } from "./types";

export class AdapterRegistry {
  private adapters: Map<string, SourceAdapter> = new Map();

  /**
   * Registers a new website source adapter.
   */
  public register(adapter: SourceAdapter): void {
    if (!adapter.id) {
      throw new Error("Cannot register adapter without a valid 'id' property.");
    }
    this.adapters.set(adapter.id.toLowerCase(), adapter);
  }

  /**
   * Retrieves an adapter by its unique source identifier (e.g. 'scribd', 'slideshare', 'archive_org').
   * Throws a descriptive error if no matching adapter is registered.
   */
  public get(sourceId: string): SourceAdapter {
    const key = sourceId.toLowerCase();
    const adapter = this.adapters.get(key);
    if (!adapter) {
      const available = this.listIds().join(", ") || "none";
      throw new Error(
        `No source adapter registered for '${sourceId}'. Registered adapters: [${available}]`
      );
    }
    return adapter;
  }

  /**
   * Checks whether an adapter is registered for the given source identifier.
   */
  public has(sourceId: string): boolean {
    return this.adapters.has(sourceId.toLowerCase());
  }

  /**
   * Returns all registered adapters.
   */
  public list(): SourceAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * Returns a list of all registered adapter identifiers.
   */
  public listIds(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Clears all registered adapters (useful for unit testing).
   */
  public clear(): void {
    this.adapters.clear();
  }
}

export const adapterRegistry = new AdapterRegistry();
