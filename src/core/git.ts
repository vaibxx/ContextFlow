import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function git(cwd: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim() || (r.stderr ?? "").trim() };
}

export function isGitRepo(cwd: string): boolean {
  return git(cwd, ["rev-parse", "--is-inside-work-tree"]).out === "true";
}

export function headCommit(cwd: string): string | undefined {
  const r = git(cwd, ["rev-parse", "HEAD"]);
  return r.ok ? r.out : undefined;
}

export function currentBranch(cwd: string): string | undefined {
  const r = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return r.ok ? r.out : undefined;
}

/** Create (or switch to) the working branch. Uncommitted changes come along. */
export function useBranch(cwd: string, branch: string): void {
  if (currentBranch(cwd) === branch) return;
  const exists = git(cwd, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).ok;
  const r = git(cwd, exists ? ["checkout", branch] : ["checkout", "-b", branch]);
  if (!r.ok) throw new Error(`git could not switch to ${branch}: ${r.out}`);
}

/** Commit everything (except .contextflow/) as a checkpoint. Returns the short hash, or undefined if nothing changed. */
export function checkpoint(cwd: string, message: string): string | undefined {
  git(cwd, ["add", "-A", "--", ".", ":(exclude).contextflow"]);
  if (git(cwd, ["diff", "--cached", "--quiet"]).ok) return undefined;
  const r = git(cwd, [
    "-c", "user.name=ContextFlow", "-c", "user.email=contextflow@localhost",
    "commit", "--no-verify", "-q", "-m", message,
  ]);
  if (!r.ok) return undefined;
  return git(cwd, ["rev-parse", "--short", "HEAD"]).out;
}

export function logSince(cwd: string, base: string | undefined, max = 30): string {
  const range = base ? [`${base}..HEAD`] : ["-n", String(max)];
  return git(cwd, ["log", "--oneline", "--no-decorate", `--max-count=${max}`, ...range]).out;
}

export function diffStatSince(cwd: string, base: string | undefined): string {
  if (!base) return "";
  return git(cwd, ["diff", "--stat", base, "HEAD", "--", ".", ":(exclude).contextflow"]).out;
}

export function uncommittedDiff(cwd: string, maxChars = 8000): string {
  const out = git(cwd, ["diff", "HEAD", "--", ".", ":(exclude).contextflow"]).out;
  return out.length > maxChars ? out.slice(0, maxChars) + "\n… (diff truncated)" : out;
}

/** Keep .contextflow/ out of the user's commits without touching their .gitignore. */
export function excludeStateDir(cwd: string): void {
  const r = git(cwd, ["rev-parse", "--git-path", "info/exclude"]);
  if (!r.ok) return;
  const p = path.resolve(cwd, r.out);
  const cur = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
  if (!cur.split(/\r?\n/).includes(".contextflow/")) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, (cur && !cur.endsWith("\n") ? "\n" : "") + ".contextflow/\n");
  }
}
