/**
 * Best-effort parsing of "when can I work again" out of limit messages, e.g.
 *   "You've hit your session limit · resets 3:45pm"
 *   "You've hit your weekly limit · resets Mon 12:00am"
 *   "spend limit reached (daily; resets 2026-08-09 00:00 UTC)"
 *   "You've hit your usage limit ... try again in 2 hours 13 minutes"
 *   "... or try again at Oct 3rd, 2026 2:15 PM."
 * Returns undefined when nothing recognisable is found; callers then fall
 * back to a default wait.
 */

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function parseResetTime(text: string, now: Date = new Date()): Date | undefined {
  return parseRelative(text, now) ?? parseIso(text) ?? parseClock(text, now);
}

function parseRelative(text: string, now: Date): Date | undefined {
  const m = text.match(
    /\b(?:in|after)\s+((?:\d+(?:\.\d+)?\s*(?:days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b[\s,]*(?:and\s+)?)+)/i,
  );
  if (!m) return undefined;
  let ms = 0;
  for (const part of m[1].matchAll(/(\d+(?:\.\d+)?)\s*([a-z]+)/gi)) {
    const n = Number(part[1]);
    const unit = part[2].toLowerCase();
    if (unit.startsWith("d")) ms += n * 86_400_000;
    else if (unit.startsWith("h")) ms += n * 3_600_000;
    else if (unit.startsWith("m")) ms += n * 60_000;
    else if (unit.startsWith("s")) ms += n * 1000;
  }
  return ms > 0 ? new Date(now.getTime() + ms) : undefined;
}

function parseIso(text: string): Date | undefined {
  const m = text.match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?\s*(UTC|Z)?/i);
  if (!m) return undefined;
  const iso = `${m[1]}T${m[2]}:${m[3] ?? "00"}${m[4] ? "Z" : ""}`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? undefined : d;
}

function parseClock(text: string, now: Date): Date | undefined {
  // Look only after a "resets" / "try again at" / "available at" style anchor.
  const anchor = text.match(/\b(?:resets?|reset at|try again at|available (?:again )?at|until)\b\s*(?:at\s+)?(.{0,60})/i);
  if (!anchor) return undefined;
  const tail = anchor[1];

  const time = tail.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(\d{1,2}):(\d{2})\b/i);
  if (!time) return undefined;
  let hour: number;
  let minute: number;
  if (time[1] !== undefined) {
    hour = Number(time[1]) % 12;
    minute = Number(time[2] ?? 0);
    if (time[3].toLowerCase() === "pm") hour += 12;
  } else {
    hour = Number(time[4]);
    minute = Number(time[5]);
  }
  if (hour > 23 || minute > 59) return undefined;

  const before = tail.slice(0, time.index ?? 0).toLowerCase();
  const d = new Date(now);
  d.setSeconds(0, 0);
  d.setHours(hour, minute);

  const month = before.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/);
  if (month) {
    d.setFullYear(month[3] ? Number(month[3]) : now.getFullYear(), MONTHS.indexOf(month[1]), Number(month[2]));
    if (!month[3] && d.getTime() < now.getTime() - 86_400_000) d.setFullYear(d.getFullYear() + 1);
    return d;
  }

  const wd = before.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/);
  if (wd) {
    let add = (WEEKDAYS.indexOf(wd[1]) - now.getDay() + 7) % 7;
    if (add === 0 && d.getTime() <= now.getTime()) add = 7;
    d.setDate(d.getDate() + add);
    return d;
  }

  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d;
}
