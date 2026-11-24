import fs from "node:fs";
import path from "node:path";

export const CONFIG_FILE = "contextflow.config.json";

export interface AgentConfig {
  model?: string;
  /** Extra CLI args appended to every run of this agent. */
  args?: string[];
}

export interface Config {
  /** Agents in the order they take over, e.g. ["claude", "codex"]. */
  chain: string[];
  /** Let agents edit and run commands without asking (they run unattended). */
  autoApprove: boolean;
  /** Work on a separate git branch (contextflow/<session>). */
  branch: boolean;
  /** Commit a checkpoint after every agent run. */
  checkpoints: boolean;
  /** Ask which agent goes next at each handoff instead of following the chain. */
  ask: boolean;
  /** When every agent is out, wait for the earliest reset (false = save and exit). */
  wait: boolean;
  /** Give up waiting if the earliest reset is further away than this. */
  maxWaitMinutes: number;
  /** Wait used when a limit message has no readable reset time. */
  defaultWaitMinutes: number;
  agents: Record<string, AgentConfig>;
}

export const defaultConfig: Config = {
  chain: ["claude", "codex"],
  autoApprove: false,
  branch: true,
  checkpoints: true,
  ask: false,
  wait: true,
  maxWaitMinutes: 60 * 24 * 7,
  defaultWaitMinutes: 60,
  agents: {},
};

/** Load contextflow.config.json from the repo (if any) on top of the defaults. */
export function loadConfig(cwd: string): Config {
  const file = path.join(cwd, CONFIG_FILE);
  if (!fs.existsSync(file)) return structuredClone(defaultConfig);
  let raw: Partial<Config>;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${CONFIG_FILE} is not valid JSON: ${(e as Error).message}`);
  }
  return { ...structuredClone(defaultConfig), ...raw, agents: { ...(raw.agents ?? {}) } };
}

export function writeDefaultConfig(cwd: string): string {
  const file = path.join(cwd, CONFIG_FILE);
  if (fs.existsSync(file)) throw new Error(`${CONFIG_FILE} already exists`);
  const { agents: _a, ...rest } = defaultConfig;
  fs.writeFileSync(file, JSON.stringify({ ...rest, agents: { claude: {}, codex: {} } }, null, 2) + "\n");
  return file;
}
