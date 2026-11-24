import type { AgentAdapter, AgentEvent, RunRequest, SpawnSpec } from "./types.js";
import { makeClassifier, parseJson, truncate } from "./common.js";

/**
 * OpenAI Codex CLI, driven non-interactively:
 *   codex exec --json [--sandbox workspace-write] -           (new session)
 *   codex exec --json [...] resume <session-id> -             (continue one)
 * "-" makes Codex read the prompt from stdin.
 *
 * The JSONL event shape has changed between Codex releases, so parseLine
 * accepts the current shape ({"type":"thread.started"}, {"type":"item.completed"},
 * {"type":"turn.failed"}) and the older one ({"msg":{"type":...}}).
 *
 * Limit wording seen in the wild: "You've hit your usage limit. ... try again
 * in 2 hours 13 minutes" / "try again at 3:45 PM". Verify against the
 * version you run and add patterns here if it changes.
 */
const LIMIT_PATTERNS = [
  /hit your [\w' -]*limit/i,
  /usage limit/i,
  /rate[_ ]limit(?:ed| exceeded| reached)/i,
  /quota (?:exceeded|exhausted)/i,
  /insufficient[_ ]quota/i,
  /out of credits/i,
];

export const codexAdapter: AgentAdapter = {
  id: "codex",
  displayName: "Codex CLI",
  binary: "codex",

  buildCommand(req: RunRequest): SpawnSpec {
    const args = ["exec", "--json", "--skip-git-repo-check"];
    if (req.autoApprove) args.push("--dangerously-bypass-approvals-and-sandbox");
    else args.push("--sandbox", "workspace-write");
    if (req.model) args.push("--model", req.model);
    if (req.extraArgs) args.push(...req.extraArgs);
    if (req.resumeSessionId) args.push("resume", req.resumeSessionId);
    args.push("-");
    return { command: "codex", args, stdin: req.prompt };
  },

  parseLine(line: string): AgentEvent[] {
    const j = parseJson(line);
    if (!j) return [];
    const out: AgentEvent[] = [];

    // Current format
    switch (j.type) {
      case "thread.started":
        if (j.thread_id) out.push({ kind: "session", sessionId: String(j.thread_id) });
        return out;
      case "item.completed": {
        const it = j.item ?? {};
        if ((it.type === "agent_message" || it.item_type === "assistant_message") && it.text) {
          out.push({ kind: "message", text: String(it.text) });
        } else if (it.type === "command_execution" || it.item_type === "command_execution") {
          out.push({ kind: "tool", name: "shell", detail: truncate(String(it.command ?? ""), 120) });
        } else if (it.type === "file_change" || it.item_type === "file_change") {
          const paths = Array.isArray(it.changes) ? it.changes.map((c: any) => c?.path).filter(Boolean) : [];
          out.push({ kind: "tool", name: "edit", detail: truncate(paths.join(", "), 120) });
        } else if (it.type === "error" && it.message) {
          out.push({ kind: "error", text: String(it.message) });
        }
        return out;
      }
      case "turn.failed":
        out.push({ kind: "error", text: String(j.error?.message ?? JSON.stringify(j.error ?? j)) });
        return out;
      case "error":
        out.push({ kind: "error", text: String(j.message ?? j.error?.message ?? JSON.stringify(j)) });
        return out;
    }

    // Older format: {"id":..., "msg": {"type": ..., ...}}
    const msg = j.msg;
    if (msg && typeof msg === "object") {
      if (msg.type === "session_configured" && msg.session_id) out.push({ kind: "session", sessionId: String(msg.session_id) });
      else if (msg.type === "agent_message" && msg.message) out.push({ kind: "message", text: String(msg.message) });
      else if (msg.type === "exec_command_begin") out.push({ kind: "tool", name: "shell", detail: truncate([].concat(msg.command ?? []).join(" "), 120) });
      else if (msg.type === "error" || msg.type === "stream_error") out.push({ kind: "error", text: String(msg.message ?? "") });
    }
    return out;
  },

  classify: makeClassifier(LIMIT_PATTERNS),
};
