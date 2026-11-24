import type { RunRecord, Session } from "./state.js";
import { STATE_DIR } from "./state.js";

/**
 * Prompts and the handoff brief. The brief format is documented in
 * docs/handoff-spec.md; keep the two in sync.
 */

const PROGRESS_RULE = `While you work, keep \`${STATE_DIR}/progress.md\` up to date with three short sections: "## Plan", "## Done" and "## Next". Update it after every meaningful step. You may run out of usage at any moment, and another coding agent will continue from that file and the git history, so it must always say exactly where things stand. Do not commit files inside \`${STATE_DIR}/\`.`;

export function initialPrompt(task: string): string {
  return `${task}

---
${PROGRESS_RULE}`;
}

/** Used when the same agent continues its own native session (it already has full context). */
export function resumePrompt(): string {
  return `You were paused by a usage limit and can continue now. Pick up exactly where you left off. Check \`${STATE_DIR}/progress.md\` and \`git status\` first in case anything changed, then finish the task.`;
}

export interface BriefInput {
  session: Session;
  from: RunRecord;
  to: string;
  progress: string;
  gitLog: string;
  diffStat: string;
  uncommitted: string;
}

export function buildBrief(i: BriefInput): string {
  const { session, from } = i;
  const history = session.runs
    .map((r, n) => `${n + 1}. ${r.agent}: ${describeOutcome(r)}`)
    .join("\n");
  const lastWords = from.lastMessages.length
    ? from.lastMessages.map((m) => `> ${m.replace(/\n/g, "\n> ")}`).join("\n\n")
    : "_(no messages captured)_";
  const tools = from.tools.length ? from.tools.slice(-15).map((t) => `- ${t}`).join("\n") : "_(none captured)_";

  return `# ContextFlow handoff

You are taking over a coding task from another AI coding agent (**${from.agent}**), which stopped because: ${from.outcome?.message ?? "unknown reason"}.
The code is already in this repository. Do not start over: check what is done, then continue.

## Task
${session.task}

## Progress notes (from ${STATE_DIR}/progress.md)
${i.progress || "_The previous agent did not write progress notes. Work out the state from the git history and diff below._"}

## Commits so far${session.branch ? ` (branch ${session.branch})` : ""}
\`\`\`
${i.gitLog || "(none)"}
\`\`\`
${i.diffStat ? `\n\`\`\`\n${i.diffStat}\n\`\`\`\n` : ""}
## Uncommitted changes
${i.uncommitted ? "```diff\n" + i.uncommitted + "\n```" : "_(none)_"}

## Last actions of ${from.agent}
${tools}

## Last messages of ${from.agent}
${lastWords}

## Agent history
${history}

## What to do now
1. Read \`${STATE_DIR}/progress.md\` and run \`git status\` / \`git log\` to confirm the state above.
2. Continue from the "Next" step. Don't redo finished work.
3. ${PROGRESS_RULE}

_Handoff ${session.runs.length} · session ${session.id} · from ${from.agent} to ${i.to}_
`;
}

function describeOutcome(r: RunRecord): string {
  if (!r.outcome) return "running";
  const reset = r.outcome.resetAt ? ` (resets ${new Date(r.outcome.resetAt).toLocaleString()})` : "";
  if (r.outcome.kind === "limit") return `stopped by usage limit${reset}`;
  if (r.outcome.kind === "error") return `failed: ${r.outcome.message ?? "error"}`;
  return "completed";
}
