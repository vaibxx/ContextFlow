import fs from "node:fs";
import path from "node:path";

export const STATE_DIR = ".contextflow";

export interface RunRecord {
  agent: string;
  sessionId?: string;
  startedAt: string;
  endedAt?: string;
  /** Was this run started as a handoff from another agent? */
  handoffFrom?: string;
  outcome?: { kind: "completed" | "limit" | "error"; message?: string; resetAt?: string };
  /** The last few things the agent said (for the next brief). */
  lastMessages: string[];
  /** Tool calls / files touched, most recent last. */
  tools: string[];
  checkpoint?: string;
}

export interface Session {
  version: 1;
  id: string;
  task: string;
  chain: string[];
  branch?: string;
  baseCommit?: string;
  createdAt: string;
  status: "running" | "waiting" | "completed" | "failed" | "stopped";
  runs: RunRecord[];
  /** agent id -> ISO time it can work again. */
  limits: Record<string, string>;
  /** Agents that are not installed or were removed from the chain. */
  unavailable: string[];
}

export function stateDir(cwd: string): string {
  return path.join(cwd, STATE_DIR);
}

export function sessionPath(cwd: string): string {
  return path.join(stateDir(cwd), "session.json");
}

export function progressPath(cwd: string): string {
  return path.join(stateDir(cwd), "progress.md");
}

export function loadSession(cwd: string): Session | undefined {
  try {
    return JSON.parse(fs.readFileSync(sessionPath(cwd), "utf8")) as Session;
  } catch {
    return undefined;
  }
}

export function saveSession(cwd: string, s: Session): void {
  fs.mkdirSync(stateDir(cwd), { recursive: true });
  const tmp = sessionPath(cwd) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, sessionPath(cwd));
}

export function readProgress(cwd: string): string {
  try {
    return fs.readFileSync(progressPath(cwd), "utf8").trim();
  } catch {
    return "";
  }
}

/** Append one JSON line to .contextflow/log.jsonl (full event log for debugging). */
export function appendLog(cwd: string, entry: Record<string, unknown>): void {
  fs.mkdirSync(stateDir(cwd), { recursive: true });
  fs.appendFileSync(path.join(stateDir(cwd), "log.jsonl"), JSON.stringify({ t: new Date().toISOString(), ...entry }) + "\n");
}

export function writeHandoff(cwd: string, index: number, from: string, to: string, body: string): string {
  const dir = path.join(stateDir(cwd), "handoffs");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${String(index).padStart(3, "0")}-${from}-to-${to}.md`);
  fs.writeFileSync(file, body);
  fs.writeFileSync(path.join(stateDir(cwd), "handoff.md"), body);
  return file;
}

export function newSessionId(task: string, now = new Date()): string {
  const slug = task.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "task";
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, "");
  return `${slug}-${stamp}`;
}
