// Missed tasks use free time on Today without changing yesterday's timetable.
import { firstGap } from "./scheduler.js";
const TASK_CATS = new Set(["study", "work", "gym", "bass", "bible", "learn", "other"]);
const APPOINTMENT = /\b(?:appointment|meeting|interview|reservation|flight|ceremony)\b|^(?:lecture|class|exam|test|quiz|presentation|shift)\b/i;
export const canCarry = b => !b.routine && !b.group && !b.partial && TASK_CATS.has(b.cat) && (b.tid || !APPOINTMENT.test(b.title));

export function carriedTasks(state, date, since) {
  return Object.entries(state.days).filter(([d]) => d >= since && d < date).flatMap(([d, day]) =>
    day.blocks.filter(b => !b.done && !b.skipped && b.src !== "routine" && !b.carryResolved && canCarry(b)
      && (!b.tid || (state.school?.tasks || []).some(t => t.id === b.tid && !t.done)))
      .map(b => ({ id: `carry:${d}:${b.id}`, title: b.title, date: d, cat: b.cat, venue: b.venue, dur: b.end - b.start, source: b }))
  ).sort((a, b) => a.date.localeCompare(b.date));
}

export function untimedTasks(state, date, current, since) {
  return state.inbox.filter(t => !t.done && !t.skipped && (t.date === date || date === current && (!t.date || t.date >= since && t.date < date)));
}

export function planCarryover(state, date, since, blocks, now) {
  const due = new Map((state.school?.tasks || []).map(t => [t.id, t]));
  const from = Math.max(state.profile.dayStart, Math.ceil(now / 5) * 5), until = state.profile.dayEnd;
  const displaced = [];
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.src !== "carryover" || b.fixed || !b.flex || b.done || b.start < now || b.skipped) continue;
    const collision = blocks.some(x => x !== b && !x.skipped && x.src !== "carryover" && x.start < b.end && x.end > b.start);
    if (!collision) continue;
    blocks.splice(i, 1);
    displaced.push({ id: b.carryOrigin, title: b.title, cat: b.cat, date: b.carriedFrom, venue: b.venue, tid: b.tid, dur: b.end - b.start, priority: b.priority, retry: true });
  }
  const candidates = [...displaced, ...carriedTasks(state, date, since), ...untimedTasks(state, date, date, since).filter(t => t.date && (t.date < date || t.carryOnDate && t.date === date))]
    .sort((a, b) => (a.source?.priority || a.priority || 2) - (b.source?.priority || b.priority || 2)
      || (due.get(a.source?.tid || a.tid)?.due || "9999").localeCompare(due.get(b.source?.tid || b.tid)?.due || "9999")
      || a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const added = [];
  let changed = displaced.length > 0;
  for (const t of candidates) {
    const origin = t.source?.carryOrigin || t.source?.id || t.id;
    const id = `carry-day:${date}:${origin}`;
    if (blocks.some(b => b.id === id)) continue;
    const dur = Number.isInteger(t.dur) && t.dur > 0 ? t.dur : 60;
    const link = t.source?.tid || t.tid;
    const deadline = due.get(link);
    if (deadline?.done) continue;
    const endBy = deadline?.due === date && deadline.dueMin > from ? Math.min(until, deadline.dueMin) : until;
    const start = firstGap(blocks, from, dur, endBy);
    if (start == null) {
      if (t.retry && !state.inbox.some(x => x.id === t.id)) { const { retry, ...item } = t; state.inbox.push(item); }
      continue;
    }
    const b = { id, title: t.title, cat: t.cat, date, start, end: start + dur, done: false, fixed: false, flex: true,
      priority: t.source?.priority || t.priority || 2, venue: t.venue || "", src: "carryover", carriedFrom: t.date, carryOrigin: origin };
    if (link) b.tid = link;
    blocks.push(b); added.push(b); changed = true;
    if (t.source) t.source.carryResolved = true;
    else state.inbox = state.inbox.filter(x => x !== t);
  }
  return { added, changed };
}
