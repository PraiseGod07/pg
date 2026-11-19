export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const onRoutineDay = (r, date) => !r.disabled && (!r.from || r.from <= date)
  && (!r.days?.length || r.days.includes(new Date(`${date}T12:00:00Z`).getUTCDay()));

export function exactClock(text) {
  const s = String(text).trim().toLowerCase();
  if (s === "noon" || s === "midnight") return s === "noon" ? 720 : 0;
  const m = s.match(/^(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?$/);
  if (!m || !m[2] && !m[3] || (m[3] ? +m[1] < 1 || +m[1] > 12 : +m[1] > 23)) return null;
  return (m[3] ? +m[1] % 12 + (m[3] === "pm" ? 12 : 0) : +m[1]) * 60 + +(m[2] || 0);
}
export function anchorCommand(text) {
  const m = String(text).match(/^(?:(?:add|schedule|put) )?(.+?) (?:from )?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|noon|midnight)\s*(?:to|–|-) ?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|noon|midnight) (every day|daily|(?:on )?weekdays|(?:on )?weekends)[.!?]?$/i);
  if (!m) return null;
  const start = exactClock(m[2]), end = exactClock(m[3]);
  if (start == null || end == null) throw new Error("Give both times with AM/PM or in 24-hour format.");
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > 1440) throw new Error("The end must be after the start, on the same day.");
  return { title: m[1].trim(), start, minutes: end - start, days: /weekdays/i.test(m[4]) ? [1,2,3,4,5] : /weekends/i.test(m[4]) ? [0,6] : [0,1,2,3,4,5,6] };
}
export function clearFutureInstances(state, id, date, now) {
  for (const [d, value] of Object.entries(state.days)) if (d >= date) {
    value.blocks = value.blocks.filter(b => b.routine !== id || b.done || b.skipped || (d === date && b.start <= now));
  }
}
