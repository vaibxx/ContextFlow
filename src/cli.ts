#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { parseArgs } from "node:util";
import { loadConfig, writeDefaultConfig, CONFIG_FILE, type Config } from "./core/config.js";
import { consoleLogger } from "./core/log.js";
import { defaultDeps, resumeSession, startSession } from "./core/orchestrator.js";
import { which } from "./core/process.js";
import { loadSession, stateDir, saveSession } from "./core/state.js";

const VERSION = "0.1.0";

const HELP = `ContextFlow ${VERSION}: keep a coding task going when an agent runs out of usage.

Usage
  cf run "<task>" [options]   Start a task with the first agent in the chain
  cf resume [options]         Continue the session in this folder
  cf status                   Show the current session
  cf agents                   List supported agents and whether they're installed
  cf init                     Write ${CONFIG_FILE} with the defaults
  cf reset                    Forget the session in this folder (keeps your code)

Options
  -c, --chain <a,b>      Agents in handoff order (default: claude,codex)
  -a, --ask              Ask which agent goes next at each handoff
  -y, --yes              Let agents edit files and run commands without asking
      --no-branch        Work on the current branch instead of contextflow/<session>
      --no-checkpoints   Don't commit after each agent run
      --no-wait          When every agent is out, save and exit instead of waiting
  -C, --cwd <dir>        Project folder (default: current folder)
  -v, --verbose          Print full agent messages
  -h, --help             Show this help
      --version          Show the version

Exit codes: 0 done · 1 failed · 75 every agent is out of usage (run cf resume later)
`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      chain: { type: "string", short: "c" },
      ask: { type: "boolean", short: "a" },
      yes: { type: "boolean", short: "y" },
      "no-branch": { type: "boolean" },
      "no-checkpoints": { type: "boolean" },
      "no-wait": { type: "boolean" },
      cwd: { type: "string", short: "C" },
      verbose: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean" },
    },
  });

  if (values.version) return print(VERSION);
  const [cmd, ...rest] = positionals;
  if (values.help || !cmd || cmd === "help") return print(HELP);

  const cwd = path.resolve(values.cwd ?? process.cwd());
  const log = consoleLogger({ verbose: values.verbose });
  const deps = defaultDeps(log);

  const configured = (): Config => {
    const cfg = loadConfig(cwd);
    if (values.chain) cfg.chain = values.chain.split(",").map((s) => s.trim()).filter(Boolean);
    if (values.ask) cfg.ask = true;
    if (values.yes) cfg.autoApprove = true;
    if (values["no-branch"]) cfg.branch = false;
    if (values["no-checkpoints"]) cfg.checkpoints = false;
    if (values["no-wait"]) cfg.wait = false;
    return cfg;
  };

  const withAsk = (cfg: Config) => {
    if (!cfg.ask) return;
    if (!process.stdin.isTTY) {
      log.warn("--ask needs an interactive terminal; following the chain instead.");
      return;
    }
    deps.choose = async (options, reason) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try {
        process.stdout.write(`\nHandoff needed (${reason}). Which agent should continue?\n`);
        options.forEach((o, i) => process.stdout.write(`  ${i + 1}) ${o}${i === 0 ? "  (default)" : ""}\n`));
        const a = (await rl.question("Pick a number [1]: ")).trim();
        const n = Number(a || "1");
        return options[n >= 1 && n <= options.length ? n - 1 : 0];
      } finally {
        rl.close();
      }
    };
  };

  switch (cmd) {
    case "run": {
      const task = rest.join(" ").trim();
      if (!task) {
        log.error('Give the task in quotes, e.g. cf run "add a dark mode toggle"');
        return 2;
      }
      const cfg = configured();
      withAsk(cfg);
      if (!cfg.autoApprove) {
        log.info("Agents may only edit files in this project (no unattended shell commands). Use --yes for full autonomy.");
      }
      return (await startSession(cwd, task, cfg, deps)).exitCode;
    }
    case "resume": {
      const cfg = configured();
      const s = loadSession(cwd);
      if (s && !values.chain) cfg.chain = s.chain;
      withAsk(cfg);
      return (await resumeSession(cwd, cfg, deps)).exitCode;
    }
    case "status":
      return status(cwd);
    case "agents": {
      for (const id of deps.registry.ids()) {
        const a = deps.registry.get(id);
        const p = which(a.binary);
        print(`${id.padEnd(8)} ${a.displayName.padEnd(14)} ${p ? `installed (${p})` : "not found on PATH"}`);
      }
      return 0;
    }
    case "init":
      print(`Wrote ${writeDefaultConfig(cwd)}`);
      return 0;
    case "reset": {
      const s = loadSession(cwd);
      if (s && (s.status === "running" || s.status === "waiting")) {
        s.status = "stopped";
        saveSession(cwd, s);
      }
      fs.rmSync(stateDir(cwd), { recursive: true, force: true });
      print("Session cleared. Your code and commits are untouched.");
      return 0;
    }
    default:
      log.error(`Unknown command "${cmd}". Run cf --help.`);
      return 2;
  }
}

function status(cwd: string): number {
  const s = loadSession(cwd);
  if (!s) return print("No ContextFlow session in this folder.");
  print(`Session  ${s.id}`);
  print(`Task     ${s.task}`);
  print(`Status   ${s.status}`);
  print(`Chain    ${s.chain.join(" → ")}${s.unavailable.length ? `  (not installed: ${s.unavailable.join(", ")})` : ""}`);
  if (s.branch) print(`Branch   ${s.branch}`);
  for (const [id, iso] of Object.entries(s.limits)) print(`Limit    ${id} back at ${new Date(iso).toLocaleString()}`);
  print("Runs");
  s.runs.forEach((r, i) => {
    const o = r.outcome ? `${r.outcome.kind}${r.outcome.message ? `: ${r.outcome.message.replace(/\s+/g, " ").slice(0, 100)}` : ""}` : "running";
    print(`  ${i + 1}. ${r.agent.padEnd(7)} ${o}${r.checkpoint ? `  [${r.checkpoint}]` : ""}`);
  });
  return 0;
}

function print(s: string): number {
  process.stdout.write(s + "\n");
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
