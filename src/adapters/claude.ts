import type { AgentAdapter, AgentEvent, RunRequest, SpawnSpec } from "./types.js";
import { makeClassifier, parseJson, truncate } from "./common.js";

/**
 * Claude Code, driven in headless mode:
 *   claude -p --output-format stream-json --verbose [--resume <id>]
 * The prompt goes in on stdin so long handoff briefs never hit argv limits.
 *
 * Limit messages (from https://code.claude.com/docs/en/errors):
 *   "You've hit your session limit · resets 3:45pm"
 *   "You've hit your weekly limit · resets Mon 12:00am"
 *   "You've hit your monthly spend limit ..."
 *   "Credit balance is too low"
 * In headless mode these end the run with an error, reported in the
 * `result` field of the final stream-json event.
 */
const LIMIT_PATTERNS = [
  /hit your [\w' -]*limit/i,
  /usage limit (?:reached|exceeded)/i,
  /credit balance is too low/i,
  /spend limit reached/i,
  /shared budget/i,
];

export const claudeAdapter: AgentAdapter = {
  id: "claude",
  displayName: "Claude Code",
  binary: "claude",

  buildCommand(req: RunRequest): SpawnSpec {
    const args = ["-p", "--output-format", "stream-json", "--verbose"];
    if (req.resumeSessionId) args.push("--resume", req.resumeSessionId);
    if (req.autoApprove) args.push("--dangerously-skip-permissions");
    else args.push("--permission-mode", "acceptEdits");
    if (req.model) args.push("--model", req.model);
    if (req.extraArgs) args.push(...req.extraArgs);
    return { command: "claude", args, stdin: req.prompt };
  },

  parseLine(line: string): AgentEvent[] {
    const j = parseJson(line);
    if (!j) return [];
    const out: AgentEvent[] = [];
    if (j.type === "system" && j.subtype === "init" && j.session_id) {
      out.push({ kind: "session", sessionId: String(j.session_id) });
    } else if (j.type === "assistant" && Array.isArray(j.message?.content)) {
      for (const c of j.message.content) {
        if (c?.type === "text" && c.text) out.push({ kind: "message", text: String(c.text) });
        if (c?.type === "tool_use") out.push({ kind: "tool", name: String(c.name), detail: toolDetail(c.input) });
      }
    } else if (j.type === "result") {
      const isError = Boolean(j.is_error) || (typeof j.subtype === "string" && j.subtype.startsWith("error"));
      const text = typeof j.result === "string" ? j.result : Array.isArray(j.errors) ? j.errors.join("\n") : "";
      out.push({ kind: "result", text, isError, sessionId: j.session_id ? String(j.session_id) : undefined });
    } else if (j.type === "error") {
      out.push({ kind: "error", text: String(j.message ?? j.error ?? JSON.stringify(j)) });
    }
    return out;
  },

  classify: makeClassifier(LIMIT_PATTERNS),
};

function toolDetail(input: any): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const v = input.file_path ?? input.path ?? input.command ?? input.pattern ?? input.url;
  return v === undefined ? undefined : truncate(String(v), 120);
}
