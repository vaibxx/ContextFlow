import type { AgentEvent } from "../adapters/types.js";
import type { Session } from "./state.js";

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  start(agent: string, how: string): void;
  event(agentId: string, e: AgentEvent): void;
  limit(agent: string, message: string, resetAt?: Date): void;
  handoff(from: string, to: string, file: string): void;
  waiting(agent: string, until: Date): void;
  done(s: Session): void;
}

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string, s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = (s: string) => c("2", s);
const one = (s: string, n = 160) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
};

export function consoleLogger(opts: { verbose?: boolean } = {}): Logger {
  const out = (s: string) => process.stdout.write(s + "\n");
  return {
    info: (m) => out(dim(`  ${m}`)),
    warn: (m) => out(c("33", `⚠ ${m}`)),
    error: (m) => out(c("31", `✗ ${m}`)),
    start: (agent, how) => out(c("1;34", `▸ ${agent}`) + dim(` ${how}`)),
    event: (id, e) => {
      const tag = c("34", `  ${id.padEnd(7)}`);
      if (e.kind === "message") out(`${tag} ${opts.verbose ? e.text : one(e.text)}`);
      else if (e.kind === "tool") out(`${tag} ${dim(`${e.name}${e.detail ? " " + one(e.detail, 100) : ""}`)}`);
      else if (e.kind === "error") out(`${tag} ${c("31", one(e.text, 300))}`);
    },
    limit: (agent, message, resetAt) =>
      out(c("33", `⚠ ${agent}: ${one(message, 200)}`) + (resetAt ? dim(` (back ${resetAt.toLocaleString()})`) : "")),
    handoff: (from, to, file) => out(c("1;35", `⇢ handing off ${from} → ${to}`) + dim(`  brief: ${file}`)),
    waiting: (agent, until) =>
      out(c("33", `⏸ every agent is out of usage; waiting for ${agent} at ${until.toLocaleString()}`) + dim("  (Ctrl+C to stop, then cf resume)")),
    done: (s) => {
      const agents = [...new Set(s.runs.map((r) => r.agent))];
      const handoffs = s.runs.filter((r) => r.handoffFrom).length;
      out(c("1;32", `✓ done`) + dim(` · ${agents.length} agent${agents.length > 1 ? "s" : ""} (${agents.join(", ")}) · ${handoffs} handoff${handoffs === 1 ? "" : "s"}${s.branch ? ` · branch ${s.branch}` : ""}`));
    },
  };
}

export const silentLogger: Logger = {
  info() {}, warn() {}, error() {}, start() {}, event() {}, limit() {}, handoff() {}, waiting() {}, done() {},
};
