// A simulated agent CLI for `npm run demo`. It speaks the same stream-json
// format as Claude Code, so ContextFlow's real adapter parses it.
// Usage: node agent.mjs <claude|codex>
import fs from "node:fs";

const name = process.argv[2];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const emit = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const say = (text) => emit({ type: "assistant", message: { content: [{ type: "text", text }] } });
const tool = (toolName, input) => emit({ type: "assistant", message: { content: [{ type: "tool_use", name: toolName, input }] } });

let prompt = "";
process.stdin.on("data", (d) => (prompt += d));
process.stdin.on("end", async () => {
  emit({ type: "system", subtype: "init", session_id: `${name}-demo-session` });
  fs.mkdirSync("src/auth", { recursive: true });
  fs.mkdirSync(".contextflow", { recursive: true });

  if (name === "claude") {
    await wait(500);
    tool("Write", { file_path: "src/auth/github.ts" });
    fs.writeFileSync("src/auth/github.ts", "export const login = () => redirect(GITHUB_AUTHORIZE_URL);\n");
    await wait(600);
    tool("Write", { file_path: "src/auth/callback.ts" });
    fs.writeFileSync("src/auth/callback.ts", "export const callback = (code, state) => exchange(code);\n");
    fs.writeFileSync(".contextflow/progress.md", "## Done\n- login + callback routes\n## Next\n- state check failing 3 tests\n");
    await wait(500);
    say("Login and callback routes are in. 3 tests still failing on the state check.");
    await wait(700);
    emit({ type: "result", subtype: "error_during_execution", is_error: true, result: "You've hit your session limit · resets in 3 hours", session_id: `${name}-demo-session` });
    process.exit(1);
  }

  // The next agent picks up from the handoff brief it was given.
  const gotBrief = /progress|handoff|callback/i.test(prompt);
  await wait(500);
  say(gotBrief ? "Read the handoff brief. Picking up at the failing state check." : "Starting fresh.");
  await wait(600);
  tool("Bash", { command: "npm test" });
  await wait(600);
  tool("Edit", { file_path: "src/auth/callback.ts" });
  fs.appendFileSync("src/auth/callback.ts", "// verify state before exchanging the code\n");
  await wait(600);
  say("Fixed the state check. All tests pass.");
  emit({ type: "result", subtype: "success", is_error: false, result: "Task complete", session_id: `${name}-demo-session` });
});
