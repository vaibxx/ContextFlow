/**
 * The adapter contract. Every agent CLI ContextFlow can drive (Claude Code,
 * Codex, and whatever comes next) is one object implementing this interface.
 *
 * Adding a new agent = one new file in src/adapters/ + one line in
 * src/adapters/index.ts. See CONTRIBUTING.md.
 */

/** What ContextFlow asks an adapter to run. */
export interface RunRequest {
  /** The prompt to send (the task itself, or a handoff brief). */
  prompt: string;
  /** Working directory (the user's repo). */
  cwd: string;
  /** If set, continue this agent's own native session instead of starting fresh. */
  resumeSessionId?: string;
  /** Let the agent edit files and run commands without asking. */
  autoApprove: boolean;
  /** Optional model override, passed through to the CLI. */
  model?: string;
  /** Extra CLI args from the user's config, appended verbatim. */
  extraArgs?: string[];
}

/** The command line an adapter wants ContextFlow to spawn. */
export interface SpawnSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
  /** Text to write to the agent's stdin (then stdin is closed). */
  stdin?: string;
}

/**
 * A normalised event parsed from one line of the agent's output.
 * Adapters turn their CLI's own JSON into these.
 */
export type AgentEvent =
  | { kind: "session"; sessionId: string }
  | { kind: "message"; text: string }
  | { kind: "tool"; name: string; detail?: string }
  | { kind: "error"; text: string }
  | { kind: "result"; text: string; isError: boolean; sessionId?: string };

/** How a run ended, as decided by the adapter. */
export type Outcome =
  | { kind: "completed"; summary?: string }
  /** Out of usage/credits. resetAt is when the agent can work again, if known. */
  | { kind: "limit"; message: string; resetAt?: Date }
  | { kind: "error"; message: string };

/** Everything ContextFlow observed during one run, given back to the adapter to classify. */
export interface RunObservation {
  exitCode: number | null;
  events: AgentEvent[];
  stderr: string;
  /** Raw stdout lines that were not valid JSON (some CLIs print plain text errors). */
  plainStdout: string[];
}

export interface AgentAdapter {
  /** Short id used in chains and config, e.g. "claude", "codex". */
  id: string;
  /** Human name for logs. */
  displayName: string;
  /** Executable to look for on PATH (used by `cf agents` / availability checks). */
  binary: string;
  /** Build the command for a run. */
  buildCommand(req: RunRequest): SpawnSpec;
  /** Parse one stdout line. Return [] for lines that carry nothing useful. */
  parseLine(line: string): AgentEvent[];
  /** Decide whether the run completed, hit a usage limit, or failed. */
  classify(obs: RunObservation, now?: Date): Outcome;
}
