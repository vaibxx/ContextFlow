import { test } from "node:test";
import assert from "node:assert/strict";
import { claudeAdapter } from "../src/adapters/claude.js";
import { codexAdapter } from "../src/adapters/codex.js";
import type { AgentAdapter, RunObservation } from "../src/adapters/types.js";

function observe(a: AgentAdapter, lines: string[], exitCode: number, stderr = ""): RunObservation {
  const events = lines.flatMap((l) => a.parseLine(l));
  const plainStdout = lines.filter((l) => l.trim() && !l.trim().startsWith("{"));
  return { exitCode, events, stderr, plainStdout };
}

test("claude: command uses headless stream-json and resume", () => {
  const spec = claudeAdapter.buildCommand({ prompt: "hi", cwd: ".", autoApprove: false, resumeSessionId: "abc" });
  assert.equal(spec.command, "claude");
  assert.deepEqual(spec.args.slice(0, 4), ["-p", "--output-format", "stream-json", "--verbose"]);
  assert.ok(spec.args.includes("--resume") && spec.args.includes("abc"));
  assert.ok(spec.args.includes("acceptEdits"));
  assert.equal(spec.stdin, "hi");
  assert.ok(claudeAdapter.buildCommand({ prompt: "", cwd: ".", autoApprove: true }).args.includes("--dangerously-skip-permissions"));
});

test("claude: session limit is a limit with reset time", () => {
  const obs = observe(claudeAdapter, [
    JSON.stringify({ type: "system", subtype: "init", session_id: "s1" }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Working on it" }] } }),
    JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, result: "You've hit your session limit · resets 3:45pm", session_id: "s1" }),
  ], 1);
  assert.deepEqual(obs.events[0], { kind: "session", sessionId: "s1" });
  const o = claudeAdapter.classify(obs, new Date(2026, 9, 1, 10));
  assert.equal(o.kind, "limit");
  assert.equal(o.kind === "limit" && o.resetAt?.getHours(), 15);
});

test("claude: talking about rate limits in normal output is not a limit", () => {
  const obs = observe(claudeAdapter, [
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "I added a usage limit reached banner and rate limit exceeded handler" }] } }),
    JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Done. Added the usage limit reached banner." }),
  ], 0);
  assert.equal(claudeAdapter.classify(obs).kind, "completed");
});

test("claude: other errors are errors", () => {
  const obs = observe(claudeAdapter, [], 1, "Error: Invalid API key");
  assert.equal(claudeAdapter.classify(obs).kind, "error");
});

test("codex: command and resume order", () => {
  const spec = codexAdapter.buildCommand({ prompt: "p", cwd: ".", autoApprove: false, resumeSessionId: "t-1" });
  assert.equal(spec.command, "codex");
  assert.equal(spec.args[0], "exec");
  assert.ok(spec.args.includes("--json"));
  assert.deepEqual(spec.args.slice(-3), ["resume", "t-1", "-"]);
});

test("codex: current event format", () => {
  const obs = observe(codexAdapter, [
    JSON.stringify({ type: "thread.started", thread_id: "t-9" }),
    JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "npm test" } }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Tests pass" } }),
    JSON.stringify({ type: "turn.completed", usage: {} }),
  ], 0);
  assert.deepEqual(obs.events.map((e) => e.kind), ["session", "tool", "message"]);
  assert.equal(codexAdapter.classify(obs).kind, "completed");
});

test("codex: usage limit in turn.failed", () => {
  const now = new Date(2026, 9, 1, 10);
  const obs = observe(codexAdapter, [
    JSON.stringify({ type: "thread.started", thread_id: "t-9" }),
    JSON.stringify({ type: "turn.failed", error: { message: "You've hit your usage limit. Upgrade to Pro or try again in 1 hour 30 minutes." } }),
  ], 1);
  const o = codexAdapter.classify(obs, now);
  assert.equal(o.kind, "limit");
  assert.equal(o.kind === "limit" && o.resetAt?.getTime(), now.getTime() + 90 * 60_000);
});

test("codex: older msg format and plain-text stderr limit", () => {
  const obs = observe(codexAdapter, [
    JSON.stringify({ id: "0", msg: { type: "session_configured", session_id: "old-1" } }),
    JSON.stringify({ id: "1", msg: { type: "agent_message", message: "hello" } }),
  ], 1, "ERROR: exceeded retry limit, last status: 429 Too Many Requests, usage limit reached");
  assert.deepEqual(obs.events[0], { kind: "session", sessionId: "old-1" });
  assert.equal(codexAdapter.classify(obs).kind, "limit");
});
