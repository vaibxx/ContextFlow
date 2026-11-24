import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { AgentAdapter, AgentEvent, RunObservation, RunRequest } from "../adapters/types.js";

const isWindows = process.platform === "win32";

/** Find an executable on PATH (handles Windows .cmd/.exe shims). */
export function which(bin: string): string | undefined {
  const exts = isWindows ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, bin + ext.toLowerCase());
      if (existsSync(p)) return p;
      const P = path.join(dir, bin + ext);
      if (existsSync(P)) return P;
    }
  }
  return undefined;
}

export interface RunHandlers {
  onEvent?: (e: AgentEvent) => void;
  onStderr?: (chunk: string) => void;
  signal?: AbortSignal;
}

/** Spawn an agent, stream its stdout through the adapter's parser, and collect what happened. */
export function runAgent(adapter: AgentAdapter, req: RunRequest, h: RunHandlers = {}): Promise<RunObservation> {
  const spec = adapter.buildCommand(req);
  return new Promise((resolve) => {
    const obs: RunObservation = { exitCode: null, events: [], stderr: "", plainStdout: [] };
    // npm-installed CLIs are .cmd shims on Windows, which only start through a shell.
    const resolved = isWindows && !path.isAbsolute(spec.command) ? which(spec.command) : undefined;
    const viaShell = Boolean(resolved && /\.(cmd|bat)$/i.test(resolved));
    const command = viaShell ? quoteWin(resolved!) : resolved ?? spec.command;
    const args = viaShell ? spec.args.map(quoteWin) : spec.args;
    const child = spawn(command, args, {
      cwd: req.cwd,
      env: { ...process.env, ...spec.env },
      shell: viaShell,
      stdio: ["pipe", "pipe", "pipe"],
      signal: h.signal,
    });

    let buf = "";
    const handleLine = (line: string) => {
      if (!line.trim()) return;
      let events: AgentEvent[] = [];
      try {
        events = adapter.parseLine(line);
      } catch {
        events = [];
      }
      if (events.length === 0 && !line.trim().startsWith("{")) obs.plainStdout.push(line);
      for (const e of events) {
        obs.events.push(e);
        h.onEvent?.(e);
      }
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        handleLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      obs.stderr += chunk;
      if (obs.stderr.length > 200_000) obs.stderr = obs.stderr.slice(-100_000);
      h.onStderr?.(chunk);
    });

    child.on("error", (err) => {
      obs.stderr += `\n${err.message}`;
    });
    child.on("close", (code) => {
      if (buf) handleLine(buf);
      obs.exitCode = code;
      resolve(obs);
    });

    child.stdin.on("error", () => {}); // agent may exit before reading stdin
    if (spec.stdin !== undefined) child.stdin.end(spec.stdin);
    else child.stdin.end();
  });
}

function quoteWin(a: string): string {
  return /[\s"&|<>^()]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a;
}
