import { test } from "node:test";
import assert from "node:assert/strict";
import { parseResetTime } from "../src/core/resetTime.js";

// Thursday 1 Oct 2026, 10:00 local time
const now = new Date(2026, 9, 1, 10, 0, 0);

test("relative durations", () => {
  assert.equal(parseResetTime("try again in 2 hours 13 minutes", now)?.getTime(), now.getTime() + (2 * 60 + 13) * 60_000);
  assert.equal(parseResetTime("Limit reached. Try again in 45m", now)?.getTime(), now.getTime() + 45 * 60_000);
  assert.equal(parseResetTime("resets in 3h 5m", now)?.getTime(), now.getTime() + (3 * 60 + 5) * 60_000);
});

test("clock time later today and tomorrow", () => {
  const today = parseResetTime("You've hit your session limit · resets 3:45pm", now)!;
  assert.deepEqual([today.getDate(), today.getHours(), today.getMinutes()], [1, 15, 45]);
  const tomorrow = parseResetTime("You've hit your session limit · resets 9am", now)!;
  assert.deepEqual([tomorrow.getDate(), tomorrow.getHours()], [2, 9]);
});

test("weekday", () => {
  const d = parseResetTime("You've hit your weekly limit · resets Mon 12:00am", now)!;
  assert.equal(d.getDay(), 1);
  assert.equal(d.getHours(), 0);
  assert.ok(d > now);
});

test("month and day", () => {
  const d = parseResetTime("You've hit your usage limit. Upgrade or try again at Oct 3rd, 2026 2:15 PM.", now)!;
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()], [2026, 9, 3, 14, 15]);
});

test("ISO with UTC", () => {
  const d = parseResetTime("spend limit reached (daily; resets 2026-08-09 00:00 UTC)", now)!;
  assert.equal(d.toISOString(), "2026-08-09T00:00:00.000Z");
});

test("nothing recognisable", () => {
  assert.equal(parseResetTime("Credit balance is too low", now), undefined);
});
