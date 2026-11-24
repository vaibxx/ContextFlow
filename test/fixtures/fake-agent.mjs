// A stand-in agent CLI for tests. Emits Claude-style stream-json.
// Usage: node fake-agent.mjs <name> <mode>   mode: ok | limit | crash
import fs from "node:fs";
const [name, mode] = process.argv.slice(2);
let prompt = "";
process.stdin.on("data", (d) => (prompt += d));
process.stdin.on("end", () => {
  const emit = (o) => process.stdout.write(JSON.stringify(o) + "\n");
  emit({ type: "system", subtype: "init", session_id: `${name}-session` });
  fs.appendFileSync(`${name}.txt`, `work by ${name}\n`);
  fs.writeFileSync(`prompt-${name}.txt`, prompt);
  emit({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: `${name}.txt` } }, { type: "text", text: `${name} wrote some code` }] } });
  if (mode === "limit") {
    emit({ type: "result", subtype: "error_during_execution", is_error: true, result: "You've hit your session limit · resets in 2 hours", session_id: `${name}-session` });
    process.exit(1);
  } else if (mode === "crash") {
    process.stderr.write("segfault in the agent\n");
    process.exit(3);
  } else {
    emit({ type: "result", subtype: "success", is_error: false, result: `${name} finished the task`, session_id: `${name}-session` });
  }
});
