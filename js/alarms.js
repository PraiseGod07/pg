import { addDays, fmtTime } from "./util.js";
import { activeGoals, daysLeft } from "./goals.js";
import { onRoutineDay } from "./routines.js";
import { canCarry } from "./carryover.js";

export const alarmDefaults = () => ({
  enabled: false, tone: "chime", volume: 45, vibrate: true, speak: false,
  snooze: 10, repeat: 0, quietStart: "", quietEnd: "", assignmentLeads: [1440, 180, 60, 0],
  morning: false, morningTime: 390, morningSpeak: false, evening: false, eveningTime: 1260,
  goals: false, goalsSpeak: false, goalReviewDay: 0, goalReviewTime: 1080
});
export const hkAt = (date, min) => Date.parse(`${date}T00:00:00+08:00`) + min * 60000;
export const timeValue = n => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
export function readTime(text) {
  const m = String(text || "").match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return m ? +m[1] * 60 + +m[2] : null;
}
export function isQuiet(settings, minute) {
  const from = readTime(settings.quietStart), to = readTime(settings.quietEnd);
  if (from == null || to == null || from === to) return false;
  return from < to ? minute >= from && minute < to : minute >= from || minute < to;
}
export function assignmentAlarms(tasks, date, cfg, address = "sir") {
  return tasks.filter(t => !t.done && t.due && Number.isInteger(t.dueMin) && t.dueMin >= 0 && t.dueMin < 1440)
    .flatMap(t => cfg.assignmentLeads.map(lead => ({
      id: `assignment:${t.id}:${t.due}:${t.dueMin}:${lead}`, kind: "assignment", linkId: t.id,
      at: hkAt(t.due, t.dueMin) - lead * 60000, title: t.title,
      text: `${address}, ${t.title} is due ${t.due === date ? "today" : t.due} at ${fmtTime(t.dueMin)}.`,
      repeat: lead === 0 ? cfg.repeat || 0 : 0
    }))).filter(x => Number.isFinite(x.at));
}
export function occurrences(state, date, cfg) {
  if (!cfg.enabled) return [];
  return [
    ...assignmentAlarms(state.school?.tasks || [], date, cfg, state.profile?.address || "sir"),
    ...(state.collections || []).flatMap(c => c.items.filter(x => !x.done && x.date && Number.isInteger(x.remindMin) && x.remindMin >= 0 && x.remindMin < 1440)
      .map(x => ({ id: `collection:${x.id}:${x.date}:${x.remindMin}`, kind: "collection", linkId: c.id,
        title: x.text, text: `${c.name}: ${x.text}`, at: hkAt(x.date, x.remindMin) }))),
    ...(state.reminders || []).filter(r => !r.done && Number.isFinite(r.at)).map(r => ({ ...r, title: r.title || r.text })),
    ...(cfg.morning ? [{ id: `brief:${date}`, kind: "brief", title: "Morning briefing", at: hkAt(date, cfg.morningTime) }] : []),
    ...(cfg.evening ? [{ id: `review:${date}`, kind: "review", title: "Evening review", at: hkAt(date, cfg.eveningTime) }] : []),
    ...(cfg.goals ? goalAlarms(state, date, cfg) : [])
  ];
}
export function goalAlarms(state, date, cfg) {
  const list = activeGoals(state), reviewTime = cfg.goalReviewTime ?? 1080;
  const out = list.filter(g => {
    const age = daysLeft(date, g.made || date), period = g.remindEvery > 0 && age > 0 && age % g.remindEvery === 0;
    return period || g.due && [7, 3, 1, 0].includes(daysLeft(g.due, date));
  }).map(g => ({ id: `goal:${g.id}:${date}`, kind: "goal", linkId: g.id, title: g.text, at: hkAt(date, reviewTime),
    text: `Goal: ${g.text}.${g.due ? ` Due ${g.due}. ${daysLeft(g.due, date)} days left.` : ""}` }));
  if (list.length && +cfg.goalReviewDay === new Date(`${date}T12:00:00Z`).getUTCDay())
    out.push({ id: `goals:${date}`, kind: "goal", title: "Weekly goals check", at: hkAt(date, reviewTime), text: list.map(g => g.text).join("; ") });
  return out;
}
export function pendingAlarms(list, receipts, now) {
  return list.filter(x => {
    const record = receipts[x.id];
    if (record?.done) return false;
    const at = record?.until ?? x.at;
    const age = now - at;
    // Don’t play last week’s alarms after a long absence. The deadline remains pinned.
    return age >= 0 && age <= (x.kind === "custom" ? 86400e3 : 20 * 60000);
  }).sort((a, b) => (receipts[a.id]?.until ?? a.at) - (receipts[b.id]?.until ?? b.at));
}

const icsEscape = value => String(value || "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
const stamp = at => new Date(at).toISOString().replace(/[-:]|\.\d{3}/g, "");
function fold(line) {
  const encoder = new TextEncoder(), chunks = [];
  let piece = "", length = 0;
  for (const c of line) {
    const add = encoder.encode(c).length;
    if (length + add > 73) { chunks.push(piece); piece = " "; length = 1; }
    piece += c; length += add;
  }
  chunks.push(piece); return chunks.join("\r\n");
}
export function calendarFile({ id, title, text, at, leads = [0] }, now = Date.now()) {
  if (!Number.isFinite(at)) throw new Error("Set a date and time first.");
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PG//Reminders//EN", "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT", `UID:${String(id).replace(/[^a-z0-9-]/gi, "-")}@pg`, `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(at)}`, `DTEND:${stamp(at + 60000)}`, `SUMMARY:${icsEscape(title)}`, `DESCRIPTION:${icsEscape(text)}`,
    ...[...new Set(leads)].filter(n => Number.isInteger(n) && n >= 0).flatMap(n => ["BEGIN:VALARM", "ACTION:DISPLAY",
      n ? `TRIGGER:-PT${n}M` : "TRIGGER:PT0M", `DESCRIPTION:${icsEscape(title)}`, "END:VALARM"]),
    "END:VEVENT", "END:VCALENDAR", ""].map(fold).join("\r\n");
}

export function reviewDay(state, date) {
  const all = (state.days[date]?.blocks || []).map(b => ({
    id: b.id, title: b.title, cat: b.cat, start: b.start, kind: b.routine ? "routine" : "block", linkId: b.routine, movable: !!canCarry(b),
    done: b.done && (!b.completedOn || b.completedOn === date), moved: !!b.carryResolved && !b.completedOn, skipped: !!b.skipped
  }));
  const ids = new Set(all.map(x => x.id));
  for (const r of state.routines || []) {
    const id = `routine:${r.id}:${date}`;
    if (!ids.has(id) && onRoutineDay(r, date)) {
      all.push({ id, title: r.title, cat: r.cat || "other", kind: "routine", linkId: r.id, done: !!state.routineDone?.[`${r.id}:${date}`], skipped: !!state.routineSkip?.[`${r.id}:${date}`] });
    }
  }
  for (const t of state.inbox || []) if (t.date === date) all.push({ id: t.id, title: t.title, cat: t.cat, kind: "inbox", movable: true, done: !!t.done && (!t.completedOn || t.completedOn === date), skipped: !!t.skipped, moved: !!t.movedByReview });
  return { planned: all, done: all.filter(x => x.done), missed: all.filter(x => !x.done && !x.skipped && !x.moved), moved: all.filter(x => x.moved) };
}
export function archiveDays(state, date, stampToday = false) {
  const cutoff = addDays(date, -730);
  const history = state.history ||= {};
  let changed = false;
  const dates = new Set([...Object.keys(state.days), ...(state.inbox || []).map(x => x.date).filter(Boolean)]);
  // Preserve history already captured before routines were later edited or removed.
  for (const d of Object.keys(history)) if (d < cutoff) { delete history[d]; changed = true; }
  const elapsed = state.historyThrough && state.historyThrough >= cutoff ? addDays(state.historyThrough, 1) : cutoff;
  for (let d = elapsed; d < date; d = addDays(d, 1)) {
    if ((state.routines || []).some(r => r.from && onRoutineDay(r, d))) dates.add(d);
  }
  if (state.historyThrough !== addDays(date, -1)) { state.historyThrough = addDays(date, -1); changed = true; }
  dates.add(addDays(date, -1)); if (stampToday) dates.add(date);
  for (const d of dates) if (d >= cutoff && (d < date || stampToday && d === date) && (!history[d] || d === date)) {
    const snapshot = reviewDay(state, d);
    if (!snapshot.planned.length) continue;
    const row = Object.fromEntries(Object.entries(snapshot).map(([k, v]) => [k, v.map(({ id, title, cat }) => ({ id, title, cat }))]));
    if (JSON.stringify(row) !== JSON.stringify(history[d])) { history[d] = row; changed = true; }
  }
  return changed;
}
