import type { AgentAdapter } from "./types.js";
import { claudeAdapter } from "./claude.js";
import { codexAdapter } from "./codex.js";

/**
 * Every adapter ContextFlow knows about. To add an agent, write
 * src/adapters/<id>.ts (copy docs/adapter-template.ts) and add it here.
 */
export const builtinAdapters: AgentAdapter[] = [claudeAdapter, codexAdapter];

export class AdapterRegistry {
  private map = new Map<string, AgentAdapter>();
  constructor(adapters: AgentAdapter[] = builtinAdapters) {
    for (const a of adapters) this.register(a);
  }
  register(a: AgentAdapter): void {
    if (this.map.has(a.id)) throw new Error(`adapter "${a.id}" registered twice`);
    this.map.set(a.id, a);
  }
  get(id: string): AgentAdapter {
    const a = this.map.get(id);
    if (!a) throw new Error(`unknown agent "${id}". Known agents: ${this.ids().join(", ")}`);
    return a;
  }
  ids(): string[] {
    return [...this.map.keys()];
  }
}

export type { AgentAdapter } from "./types.js";
