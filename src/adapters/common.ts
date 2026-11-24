import type { Outcome, RunObservation } from "./types.js";
import { parseResetTime } from "../core/resetTime.js";

export function parseJson(line: string): Record<string, any> | undefined {
  const t = line.trim();
  if (!t.startsWith("{")) return undefined;
  try {
    const v = JSON.parse(t);
    return v && typeof v === "object" ? v : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build a classifier from a list of "out of usage" patterns.
 * Only error channels are checked (error events, error results, stderr,
 * non-JSON stdout), never the agent's normal messages, so an agent that
 * writes code about "rate limits" does not trigger a handoff.
 */
export function makeClassifier(limitPatterns: RegExp[]) {
  return function classify(obs: RunObservation, now: Date = new Date()): Outcome {
    const errorTexts: string[] = [];
    for (const e of obs.events) {
      if (e.kind === "error") errorTexts.push(e.text);
      if (e.kind === "result" && e.isError) errorTexts.push(e.text);
    }
    if (obs.stderr.trim()) errorTexts.push(obs.stderr);
    errorTexts.push(...obs.plainStdout);

    for (const text of errorTexts) {
      if (limitPatterns.some((p) => p.test(text))) {
        const message = firstLine(text, limitPatterns);
        return { kind: "limit", message, resetAt: parseResetTime(text, now) };
      }
    }

    const result = [...obs.events].reverse().find((e) => e.kind === "result");
    if (result && result.kind === "result") {
      return result.isError
        ? { kind: "error", message: result.text || "agent reported an error" }
        : { kind: "completed", summary: result.text };
    }
    if (obs.exitCode === 0) {
      const last = [...obs.events].reverse().find((e) => e.kind === "message");
      return { kind: "completed", summary: last && last.kind === "message" ? last.text : undefined };
    }
    const msg = errorTexts.find((t) => t.trim()) ?? `exited with code ${obs.exitCode}`;
    return { kind: "error", message: msg.trim().slice(0, 2000) };
  };
}

function firstLine(text: string, patterns: RegExp[]): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  return (lines.find((l) => patterns.some((p) => p.test(l))) ?? lines[0] ?? text).trim().slice(0, 500);
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
