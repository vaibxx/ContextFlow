# Contributing to ContextFlow

Thanks for helping. The most valuable contribution is **support for another agent** (Antigravity CLI, Aider, OpenCode, Cursor CLI, Copilot CLI, whatever ships next). Each one is a single adapter file.

## Setup

```sh
git clone https://github.com/vaibxx/ContextFlow && cd ContextFlow
npm install
npm test
```

Node 22+ and git are the only requirements. Tests use a fake agent, so you don't need any agent CLI installed or logged in to run them.

## Adding an agent

An adapter tells ContextFlow four things about an agent CLI: how to start it, how to read its output, how to resume it, and how to tell "out of usage" from other failures. The contract is in [`src/adapters/types.ts`](src/adapters/types.ts).

1. **Collect real output first.** Run the agent headless with JSON output and save a few runs: a normal one, one that fails, and, most importantly, one that hits a usage limit. The exact limit wording is what your adapter has to recognise. Redact anything private.
2. **Copy the template:** `cp docs/adapter-template.ts src/adapters/<id>.ts` and fill it in. [`claude.ts`](src/adapters/claude.ts) and [`codex.ts`](src/adapters/codex.ts) are working examples.
   - `buildCommand`: the non-interactive command. Prefer sending the prompt on stdin (`stdin: req.prompt`), because handoff briefs can be long. Respect `autoApprove`, `model`, `resumeSessionId` and `extraArgs`.
   - `parseLine`: turn one stdout line into zero or more `AgentEvent`s. Emit a `session` event with the agent's session id so ContextFlow can resume it later. Never throw; return `[]` for lines you don't understand.
   - `classify`: usually just `makeClassifier(LIMIT_PATTERNS)` from `common.ts`. It only looks at error output (error events, error results, stderr, non-JSON stdout), so an agent *talking* about rate limits doesn't trigger a handoff. If the message includes a reset time, `parseResetTime` picks it up; add a case to [`src/core/resetTime.ts`](src/core/resetTime.ts) if your agent uses a new format.
3. **Register it** in [`src/adapters/index.ts`](src/adapters/index.ts) by adding it to `builtinAdapters`.
4. **Test it.** Add cases to `test/adapters.test.ts` using the real output you collected in step 1: a normal run classifies as `completed`, the limit run as `limit` with the right reset time, and an unrelated failure as `error`.
5. **Document it.** Add a row to the agents table in the README.
6. **Try it for real** if you can: `cf run "create hello.txt" --chain <your-id>`.

## Other contributions

- **Limit wording changed?** Update the patterns in that agent's adapter and add the new text as a test case.
- **Handoff brief improvements** go in `src/core/handoff.ts`; keep [`docs/handoff-spec.md`](docs/handoff-spec.md) in sync.
- **Bugs:** include `cf status` output and the relevant lines of `.contextflow/log.jsonl` (redacted).

## Pull requests

- Keep each PR to one change, with tests.
- `npm test` must pass. CI runs it on Linux, macOS and Windows.
- No new runtime dependencies without discussing it in an issue first. ContextFlow has none today, and that keeps installs fast and safe.
