import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { claudeAdapter } from "../src/adapters/claude.js";
import { AdapterRegistry } from "../src/adapters/index.js";
import type { AgentAdapter } from "../src/adapters/types.js";
import { defaultConfig, type Config } from "../src/core/config.js";
import { silentLogger } from "../src/core/log.js";
import { resumeSession, startSession, type Deps } from "../src/core/orchestrator.js";
import { loadSession } from "../src/core/state.js";

// dist/test/ -> repo root -> test/fixtures
const FAKE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../test/fixtures/fake-agent.mjs");

/** A fake agent that behaves according to modes[id] at the time it is run. */
function fakeAdapter(id: string, modes: Record<string, string>): AgentAdapter {
  return {
    ...claudeAdapter,
    id,
    displayName: id,
    binary: "node",
    buildCommand: (req) => ({ command: process.execPath, args: [FAKE, id, modes[id]], stdin: req.prompt }),
  };
}

function tempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-test-"));
  const g = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  g("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "README.md"), "demo\n");
  g("add", ".");
  g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init");
  return dir;
}

function deps(modes: Record<string, string>, clock: { t: number }): Deps {
  return {
    registry: new AdapterRegistry([fakeAdapter("alpha", modes), fakeAdapter("beta", modes)]),
    log: silentLogger,
    now: () => new Date(clock.t),
    sleep: async (ms) => {
      clock.t += ms;
    },
    isInstalled: () => true,
  };
}

const cfg = (over: Partial<Config> = {}): Config => ({ ...structuredClone(defaultConfig), chain: ["alpha", "beta"], ...over });

test("hands off from an agent that hits its limit to the next one", async () => {
  const dir = tempRepo();
  const clock = { t: Date.now() };
  const res = await startSession(dir, "build a thing", cfg(), deps({ alpha: "limit", beta: "ok" }, clock));

  assert.equal(res.status, "completed");
  const s = loadSession(dir)!;
  assert.deepEqual(s.runs.map((r) => [r.agent, r.outcome?.kind]), [["alpha", "limit"], ["beta", "completed"]]);
  assert.ok(s.branch?.startsWith("contextflow/"));

  // beta got a brief that names the task, alpha's work and the limit
  const brief = fs.readFileSync(path.join(dir, "prompt-beta.txt"), "utf8");
  assert.match(brief, /ContextFlow handoff/);
  assert.match(brief, /build a thing/);
  assert.match(brief, /session limit/);
  assert.match(brief, /alpha wrote some code/);
  assert.ok(fs.existsSync(path.join(dir, ".contextflow/handoffs/001-alpha-to-beta.md")));

  // one checkpoint per run, and .contextflow is never committed
  const log = execFileSync("git", ["log", "--oneline"], { cwd: dir, encoding: "utf8" });
  assert.match(log, /alpha stopped by usage limit/);
  assert.match(log, /beta done/);
  const files = execFileSync("git", ["ls-files"], { cwd: dir, encoding: "utf8" });
  assert.doesNotMatch(files, /\.contextflow/);
});

test("waits for the earliest reset and lets the same agent resume its own session", async () => {
  const dir = tempRepo();
  const clock = { t: Date.now() };
  const modes = { alpha: "limit", beta: "limit" };
  const d = deps(modes, clock);
  const origSleep = d.sleep;
  d.sleep = async (ms) => {
    modes.beta = "ok"; // limits have reset by the time we wake
    await origSleep(ms);
  };
  const res = await startSession(dir, "long task", cfg(), d);
  assert.equal(res.status, "completed");
  const s = loadSession(dir)!;
  assert.deepEqual(s.runs.map((r) => r.agent), ["alpha", "beta", "beta"]);
  // beta was the last to work, so it continues its own native session without a brief
  assert.equal(s.runs[2].handoffFrom, undefined);
  assert.equal(s.runs[2].sessionId, "beta-session");
  assert.match(fs.readFileSync(path.join(dir, "prompt-beta.txt"), "utf8"), /paused by a usage limit/);
});

test("with --no-wait it saves and exits 75, then cf resume finishes", async () => {
  const dir = tempRepo();
  const clock = { t: Date.now() };
  const modes = { alpha: "limit", beta: "limit" };
  const res = await startSession(dir, "task", cfg({ wait: false }), deps(modes, clock));
  assert.deepEqual(res, { status: "waiting", exitCode: 75 });
  assert.equal(loadSession(dir)!.status, "waiting");

  clock.t += 3 * 3_600_000; // both limits ("resets in 2 hours") have passed
  modes.beta = "ok";
  modes.alpha = "limit";
  const again = await resumeSession(dir, cfg({ wait: false }), deps(modes, clock));
  assert.equal(again.status, "completed");
  const s = loadSession(dir)!;
  // beta ran last, its limit reset, so it continues its own native session
  assert.equal(s.runs.at(-1)!.agent, "beta");
  assert.equal(s.runs.at(-1)!.outcome?.kind, "completed");
});

test("a non-limit failure stops the relay", async () => {
  const dir = tempRepo();
  const res = await startSession(dir, "task", cfg(), deps({ alpha: "crash", beta: "ok" }, { t: Date.now() }));
  assert.deepEqual(res, { status: "failed", exitCode: 1 });
});

test("refuses to start a second session over a running one", async () => {
  const dir = tempRepo();
  const clock = { t: Date.now() };
  await startSession(dir, "task", cfg({ wait: false }), deps({ alpha: "limit", beta: "limit" }, clock));
  await assert.rejects(() => startSession(dir, "again", cfg(), deps({ alpha: "ok", beta: "ok" }, clock)), /already in progress/);
});
