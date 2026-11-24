// `npm run demo`: watch a real ContextFlow handoff in ~10 seconds, without
// installing or logging in to any agent. The orchestrator, adapters, git
// checkpoints and handoff brief are all real; only the two agents are simulated.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { claudeAdapter } from "./adapters/claude.js";
import { AdapterRegistry } from "./adapters/index.js";
import type { AgentAdapter } from "./adapters/types.js";
import { defaultConfig } from "./core/config.js";
import { consoleLogger } from "./core/log.js";
import { defaultDeps, startSession } from "./core/orchestrator.js";

const AGENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../demo/agent.mjs");

function simulated(id: string, displayName: string): AgentAdapter {
  return {
    ...claudeAdapter,
    id,
    displayName: `${displayName} (simulated)`,
    binary: "node",
    buildCommand: (req) => ({ command: process.execPath, args: [AGENT, id], stdin: req.prompt }),
  };
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contextflow-demo-"));
const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
git("init", "-q", "-b", "main");
fs.writeFileSync(path.join(dir, "README.md"), "# demo app\n");
git("add", ".");
git("-c", "user.name=demo", "-c", "user.email=demo@example.com", "commit", "-q", "-m", "init");

const log = consoleLogger();
console.log(`\n$ cf run "add GitHub OAuth login" --chain claude,codex\n`);

const deps = {
  ...defaultDeps(log),
  registry: new AdapterRegistry([simulated("claude", "Claude Code"), simulated("codex", "Codex CLI")]),
  isInstalled: () => true,
};
const cfg = { ...structuredClone(defaultConfig), chain: ["claude", "codex"] };

const res = await startSession(dir, "add GitHub OAuth login", cfg, deps);

const handoffs = path.join(dir, ".contextflow", "handoffs");
const brief = fs.existsSync(handoffs) ? fs.readdirSync(handoffs)[0] : undefined;
console.log(`\nDemo repo: ${dir}`);
if (brief) console.log(`Handoff brief the second agent received: ${path.join(handoffs, brief)}`);
process.exitCode = res.exitCode;
