// Template for a new agent adapter. Copy to src/adapters/<id>.ts, fill in
// the TODOs, then add it to builtinAdapters in src/adapters/index.ts.
// See CONTRIBUTING.md for the full walkthrough.

import type { AgentAdapter, AgentEvent, RunRequest, SpawnSpec } from "./types.js";
import { makeClassifier, parseJson, truncate } from "./common.js";

/**
 * TODO: describe the agent and the headless command, and link the docs you
 * used. Paste the exact usage-limit message(s) you observed here.
 */
const LIMIT_PATTERNS: RegExp[] = [
  // TODO: patterns matching the agent's "out of usage / quota" errors, e.g.
  // /quota exceeded/i,
];

export const myAgentAdapter: AgentAdapter = {
  id: "myagent", // TODO: short id used in --chain
  displayName: "My Agent", // TODO
  binary: "myagent", // TODO: executable name on PATH

  buildCommand(req: RunRequest): SpawnSpec {
    // TODO: non-interactive mode with machine-readable (JSON lines) output.
    const args = ["--headless", "--output-format", "stream-json"];
    if (req.resumeSessionId) args.push("--resume", req.resumeSessionId);
    if (req.autoApprove) args.push("--yolo"); // TODO: the agent's auto-approve flag
    if (req.model) args.push("--model", req.model);
    if (req.extraArgs) args.push(...req.extraArgs);
    return { command: "myagent", args, stdin: req.prompt };
  },

  parseLine(line: string): AgentEvent[] {
    const j = parseJson(line);
    if (!j) return [];
    // TODO: map the agent's JSON events. Emit at least:
    //  - { kind: "session", sessionId } once the session id is known
    //  - { kind: "message", text } for assistant text
    //  - { kind: "tool", name, detail } for commands / file edits
    //  - { kind: "error", text } for error events
    //  - { kind: "result", text, isError } for the final result, if there is one
    if (j.type === "message" && j.text) return [{ kind: "message", text: String(j.text) }];
    if (j.type === "tool") return [{ kind: "tool", name: String(j.name), detail: truncate(String(j.input ?? ""), 120) }];
    if (j.type === "error") return [{ kind: "error", text: String(j.message) }];
    return [];
  },

  classify: makeClassifier(LIMIT_PATTERNS),
};
