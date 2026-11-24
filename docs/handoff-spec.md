# ContextFlow handoff brief (v1)

A handoff brief is a Markdown document one coding agent leaves for the next. ContextFlow writes it to `.contextflow/handoffs/NNN-<from>-to-<to>.md` (and the latest copy to `.contextflow/handoff.md`) and sends it to the next agent as its prompt.

The format is plain Markdown so any agent can read it, and so other tools can produce or consume it.

## Sections

| Section | Contents |
|---|---|
| `# ContextFlow handoff` | One paragraph: which agent stopped and why. |
| `## Task` | The user's original request, verbatim. |
| `## Progress notes` | The contents of `.contextflow/progress.md`, which every agent keeps current with `## Plan`, `## Done` and `## Next`. |
| `## Commits so far` | `git log --oneline` since the session started, plus a diffstat. |
| `## Uncommitted changes` | `git diff HEAD` (truncated to about 8 KB). |
| `## Last actions of <agent>` | The last tool calls / files touched. |
| `## Last messages of <agent>` | The last few assistant messages, quoted. |
| `## Agent history` | One line per agent run with its outcome and reset time. |
| `## What to do now` | Fixed instructions: verify the state, continue from "Next", keep progress notes updated. |

The final line is a footer: `_Handoff N · session <id> · from <a> to <b>_`.

## The progress file

`.contextflow/progress.md` is the part agents write themselves:

```markdown
# Progress

## Plan
- Add /auth/github redirect and callback
- Store the user session
- Tests

## Done
- Redirect route (src/auth/github.ts)

## Next
- Callback: verify the `state` param (tests in test/auth.test.ts fail on this)
```

Because an agent can be cut off at any moment, the instruction is to update it after every meaningful step, not at the end.
