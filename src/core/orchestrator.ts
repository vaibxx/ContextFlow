import fs from "node:fs";
import type { AgentAdapter, AgentEvent, Outcome } from "../adapters/types.js";
import { AdapterRegistry } from "../adapters/index.js";
import type { Config } from "./config.js";
import * as git from "./git.js";
import { buildBrief, initialPrompt, resumePrompt } from "./handoff.js";
import { runAgent, which } from "./process.js";
import {
  appendLog, loadSession, newSessionId, progressPath, readProgress, saveSession, stateDir, writeHandoff,
  type RunRecord, type Session,
} from "./state.js";
import type { Logger } from "./log.js";

export interface Deps {
  registry: AdapterRegistry;
  log: Logger;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  isInstalled: (a: AgentAdapter) => boolean;
  /** Called in ask mode at a handoff; return the agent id to use next. */
  choose?: (options: string[], reason: string) => Promise<string>;
}

export const defaultDeps = (log: Logger): Deps => ({
  registry: new AdapterRegistry(),
  log,
  now: () => new Date(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  isInstalled: (a) => which(a.binary) !== undefined,
});

/** Exit codes: 0 done, 1 failed, 75 waiting for a reset (run `cf resume` later). */
export type RunResult = { status: Session["status"]; exitCode: number };

export async function startSession(cwd: string, task: string, cfg: Config, deps: Deps): Promise<RunResult> {
  for (const id of cfg.chain) deps.registry.get(id); // validate early
  if (cfg.chain.length === 0) throw new Error("the agent chain is empty");

  const existing = loadSession(cwd);
  if (existing && (existing.status === "running" || existing.status === "waiting")) {
    throw new Error(`a session is already in progress here (${existing.id}). Use "cf resume" or "cf reset".`);
  }

  const now = deps.now();
  const session: Session = {
    version: 1,
    id: newSessionId(task, now),
    task,
    chain: [...cfg.chain],
    createdAt: now.toISOString(),
    status: "running",
    runs: [],
    limits: {},
    unavailable: [],
  };

  fs.mkdirSync(stateDir(cwd), { recursive: true });
  // Fresh progress file for this task.
  fs.writeFileSync(progressPath(cwd), `# Progress\n\n## Plan\n\n## Done\n\n## Next\n`);

  if (git.isGitRepo(cwd)) {
    git.excludeStateDir(cwd);
    if (cfg.branch && git.headCommit(cwd)) {
      session.branch = `contextflow/${session.id}`;
      git.useBranch(cwd, session.branch);
      deps.log.info(`Working on branch ${session.branch}`);
    }
    session.baseCommit = git.headCommit(cwd);
  } else {
    deps.log.warn("This folder is not a git repository. Checkpoints are off; handoffs will rely on progress notes only.");
  }

  saveSession(cwd, session);
  appendLog(cwd, { type: "session.start", id: session.id, chain: session.chain });
  return relay(cwd, session, cfg, deps);
}

export async function resumeSession(cwd: string, cfg: Config, deps: Deps): Promise<RunResult> {
  const session = loadSession(cwd);
  if (!session) throw new Error('no ContextFlow session in this folder. Start one with: cf run "<task>"');
  if (session.status === "completed") {
    deps.log.info("That session already completed.");
    return { status: "completed", exitCode: 0 };
  }
  // A chain passed on the command line (or a changed config) wins on resume.
  session.chain = [...cfg.chain];
  session.status = "running";
  const last = session.runs.at(-1);
  if (last && !last.outcome) {
    last.outcome = { kind: "error", message: "interrupted before it finished" };
    last.endedAt = deps.now().toISOString();
  }
  if (session.branch && git.isGitRepo(cwd)) git.useBranch(cwd, session.branch);
  saveSession(cwd, session);
  return relay(cwd, session, cfg, deps);
}

async function relay(cwd: string, session: Session, cfg: Config, deps: Deps): Promise<RunResult> {
  const { log } = deps;

  for (const id of session.chain) {
    const a = deps.registry.get(id);
    if (!deps.isInstalled(a) && !session.unavailable.includes(id)) {
      log.warn(`${a.displayName} ("${a.binary}") is not installed or not on PATH; skipping it.`);
      session.unavailable.push(id);
    }
  }
  const usable = () => session.chain.filter((id) => !session.unavailable.includes(id));
  if (usable().length === 0) {
    session.status = "failed";
    saveSession(cwd, session);
    log.error("None of the agents in the chain are installed.");
    return { status: "failed", exitCode: 1 };
  }

  while (true) {
    clearExpiredLimits(session, deps.now());
    const ready = usable().filter((id) => !session.limits[id]);
    const prev = session.runs.at(-1);

    if (ready.length === 0) {
      const waited = await waitForReset(cwd, session, cfg, deps);
      if (!waited) return { status: "waiting", exitCode: 75 };
      continue;
    }

    let agentId = pickNext(session, ready);
    if (cfg.ask && prev && deps.choose && ready.length > 1) {
      agentId = await deps.choose(ready, prev.outcome?.message ?? "handoff");
    }
    const adapter = deps.registry.get(agentId);

    // Same agent continuing its own session keeps its native context; anyone else gets a brief.
    const canResumeNatively = prev && prev.agent === agentId && prev.sessionId && prev.outcome?.kind === "limit";
    let prompt: string;
    let handoffFrom: string | undefined;
    if (!prev) {
      prompt = initialPrompt(session.task);
    } else if (canResumeNatively) {
      prompt = resumePrompt();
    } else {
      const from = lastRunWithOutcome(session) ?? prev;
      prompt = buildBrief({
        session, from, to: agentId,
        progress: readProgress(cwd),
        gitLog: git.isGitRepo(cwd) ? git.logSince(cwd, session.baseCommit) : "",
        diffStat: git.isGitRepo(cwd) ? git.diffStatSince(cwd, session.baseCommit) : "",
        uncommitted: git.isGitRepo(cwd) ? git.uncommittedDiff(cwd) : "",
      });
      const file = writeHandoff(cwd, session.runs.length, from.agent, agentId, prompt);
      handoffFrom = from.agent;
      log.handoff(from.agent, agentId, file);
    }

    const record: RunRecord = {
      agent: agentId,
      startedAt: deps.now().toISOString(),
      handoffFrom,
      lastMessages: [],
      tools: [],
    };
    session.runs.push(record);
    saveSession(cwd, session);
    log.start(adapter.displayName, canResumeNatively ? "resuming its session" : prev ? "taking over" : "starting");

    const agentCfg = cfg.agents[agentId] ?? {};
    const obs = await runAgent(
      adapter,
      {
        prompt, cwd,
        resumeSessionId: canResumeNatively ? prev!.sessionId : undefined,
        autoApprove: cfg.autoApprove,
        model: agentCfg.model,
        extraArgs: agentCfg.args,
      },
      {
        onEvent: (e) => {
          recordEvent(record, e);
          log.event(agentId, e);
          appendLog(cwd, { type: "agent.event", agent: agentId, event: e });
        },
      },
    );
    if (canResumeNatively && !record.sessionId) record.sessionId = prev!.sessionId;

    const outcome: Outcome = adapter.classify(obs, deps.now());
    record.endedAt = deps.now().toISOString();
    record.outcome = {
      kind: outcome.kind,
      message: outcome.kind === "completed" ? outcome.summary?.slice(0, 500) : outcome.message,
      resetAt: outcome.kind === "limit" ? outcome.resetAt?.toISOString() : undefined,
    };
    appendLog(cwd, { type: "agent.end", agent: agentId, exitCode: obs.exitCode, outcome: record.outcome, stderr: obs.stderr.slice(-4000) });

    if (cfg.checkpoints && git.isGitRepo(cwd)) {
      const label = outcome.kind === "completed" ? "done" : outcome.kind === "limit" ? "stopped by usage limit" : "stopped by error";
      record.checkpoint = git.checkpoint(cwd, `contextflow: ${agentId} ${label}\n\nTask: ${session.task.slice(0, 200)}`);
      if (record.checkpoint) log.info(`checkpoint ${record.checkpoint}`);
    }

    if (outcome.kind === "completed") {
      session.status = "completed";
      saveSession(cwd, session);
      log.done(session);
      return { status: "completed", exitCode: 0 };
    }

    if (outcome.kind === "error") {
      session.status = "failed";
      saveSession(cwd, session);
      log.error(`${adapter.displayName} failed: ${outcome.message}`);
      log.info('Fix the problem, then run "cf resume" to continue (or "cf resume --chain <other agents>").');
      return { status: "failed", exitCode: 1 };
    }

    const resetAt = outcome.resetAt ?? new Date(deps.now().getTime() + cfg.defaultWaitMinutes * 60_000);
    session.limits[agentId] = resetAt.toISOString();
    log.limit(adapter.displayName, outcome.message, outcome.resetAt);
    saveSession(cwd, session);
  }
}

/** Prefer the next agent after the one that just stopped, wrapping round the chain. */
function pickNext(session: Session, ready: string[]): string {
  const prev = session.runs.at(-1);
  if (!prev) return ready[0];
  if (ready.includes(prev.agent)) return prev.agent; // its limit reset; let it carry on
  const order = session.chain;
  const start = order.indexOf(prev.agent);
  for (let k = 1; k <= order.length; k++) {
    const id = order[(start + k) % order.length];
    if (ready.includes(id)) return id;
  }
  return ready[0];
}

function lastRunWithOutcome(s: Session): RunRecord | undefined {
  return [...s.runs].reverse().find((r) => r.outcome);
}

function clearExpiredLimits(s: Session, now: Date): void {
  for (const [id, iso] of Object.entries(s.limits)) {
    if (new Date(iso).getTime() <= now.getTime()) delete s.limits[id];
  }
}

async function waitForReset(cwd: string, session: Session, cfg: Config, deps: Deps): Promise<boolean> {
  const times = Object.entries(session.limits).sort((a, b) => a[1].localeCompare(b[1]));
  const [agent, iso] = times[0];
  const ms = new Date(iso).getTime() - deps.now().getTime();
  session.status = "waiting";
  saveSession(cwd, session);
  if (!cfg.wait) {
    deps.log.info(`Every agent is out of usage. ${agent} resets ${new Date(iso).toLocaleString()}. Run "cf resume" then.`);
    return false;
  }
  if (ms > cfg.maxWaitMinutes * 60_000) {
    deps.log.info(`Every agent is out of usage and the earliest reset (${agent}, ${new Date(iso).toLocaleString()}) is past the wait limit. Run "cf resume" later.`);
    return false;
  }
  deps.log.waiting(agent, new Date(iso));
  await deps.sleep(Math.max(0, ms) + 5_000);
  session.status = "running";
  saveSession(cwd, session);
  return true;
}

function recordEvent(r: RunRecord, e: AgentEvent): void {
  if (e.kind === "session") r.sessionId = e.sessionId;
  else if (e.kind === "result" && e.sessionId) r.sessionId = e.sessionId;
  else if (e.kind === "message") {
    r.lastMessages.push(e.text.slice(0, 1500));
    if (r.lastMessages.length > 4) r.lastMessages.shift();
  } else if (e.kind === "tool") {
    r.tools.push(e.detail ? `${e.name}: ${e.detail}` : e.name);
    if (r.tools.length > 40) r.tools.shift();
  }
}
