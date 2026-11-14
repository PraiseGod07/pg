// One saved schedule powers the weekly table, daily checklist and spoken answers.
import { S, day, save } from "./store.js";
import { today, addDays, nowMin } from "./util.js";
import { firstGap } from "./scheduler.js";
import { CATS } from "./library.js";

export const weekOf = date => {
  const weekday = new Date(date + "T12:00:00Z").getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
};
const minutes = value => {
  if (Number.isInteger(value)) return value >= 0 && value <= 1440 ? value : null;
  const m = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m || +m[1] > 24 || +m[2] > 59 || +m[1] === 24 && +m[2]) return null;
  return +m[1] * 60 + +m[2];
};
const key = title => title.toLowerCase().replace(/\s+/g, " ").trim();
export function planWeek(input) {
  const week = String(input.weekStart || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || !Number.isFinite(Date.parse(week)) || weekOf(week) !== week)
    throw new Error("Which Monday should this weekly timetable start on?");
  const start = minutes(input.start), end = minutes(input.end);
  const focus = +input.focusMinutes, rest = +input.breakMinutes;
  if (start == null || end == null || end <= start) throw new Error("What start and finish time should I use each day?");
  if (!Number.isInteger(focus) || focus < 10 || focus > 120 || !Number.isInteger(rest) || rest < 1 || rest > 60)
    throw new Error("How many minutes should a work session and a rest break last?");
  if (!Array.isArray(input.tasks) || !input.tasks.length || input.tasks.length > 50)
    throw new Error("What tasks should I plan, and how many minutes does each need?");
  const dates = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const names = new Set();
  const tasks = input.tasks.map(t => {
    const title = String(t.title || "").trim().slice(0, 100), amount = +t.minutes;
    const days = [...new Set(t.days || [])].filter(d => dates.includes(d)).sort();
    if (!title || names.has(key(title))) throw new Error("Give each task a different name.");
    if (!Number.isInteger(amount) || amount < 1 || amount > 10080 || !days.length)
      throw new Error(`How many minutes does ${title} need, and on which days may I schedule it?`);
    names.add(key(title));
    return { title, minutes: amount, days, cat: CATS[t.cat] ? t.cat : "study" };
  });
  // Build off to the side. Validation/fitting never partially clears a week.
  const work = Object.fromEntries(dates.map(d => [d, day(d).blocks.filter(b =>
    b.src !== "weekly-plan" || b.done || d < today() || d === today() && b.start < nowMin()).map(b => ({ ...b }))]));
  const missing = [], placed = [];
  for (const task of tasks) {
    const taskKey = key(task.title);
    // Keep completed/already-started sessions, including their completion history.
    const kept = Object.values(work).flat().filter(b => b.src === "weekly-plan" && b.planTask === taskKey);
    let remaining = Math.max(0, task.minutes - kept.reduce((n, b) => n + b.end - b.start, 0)), part = 0;
    const eligible = task.days.filter(d => d >= today());
    let progress = true;
    while (remaining > 0 && progress) {
      progress = false;
      for (const date of eligible) {
        if (!remaining) break;
        const cursor = date === today() ? Math.max(start, Math.ceil(nowMin() / 5) * 5) : start;
        const duration = Math.min(remaining, focus);
        const at = firstGap(work[date], cursor, duration + rest, end);
        if (at == null) continue;
        let id;
        do { id = `week:${week}:${encodeURIComponent(taskKey)}:${part++}`; }
        while (Object.values(work).some(bs => bs.some(b => b.id === id)));
        const block = { id, title: task.title, cat: task.cat, start: at, end: at + duration,
          date, done: false, flex: true, src: "weekly-plan", planTask: taskKey };
        const pause = { id: id + ":rest", title: "Rest break", cat: "rest",
          start: block.end, end: block.end + rest, date, done: false, flex: true, src: "weekly-plan" };
        work[date].push(block, pause); placed.push(block); remaining -= duration; progress = true;
      }
    }
    if (remaining) missing.push({ title: task.title, minutes: remaining });
  }
  for (const date of dates) day(date).blocks = work[date];
  S.weekPlans ||= {};
  S.weekPlans[week] = { weekStart: week, start, end, focusMinutes: focus, breakMinutes: rest, tasks, missing, updated: Date.now() };
  save();
  return { week, placed, missing };
}
export const planSummary = result => `Saved the weekly timetable with ${result.placed.length} task session${result.placed.length === 1 ? "" : "s"} and rest breaks. Fixed commitments and completed items stayed in place.`
  + (result.missing.length ? " Not enough free time for " + result.missing.map(t => `${t.title} (${t.minutes} minutes left)`).join(", ") + ". These are shown as unallocated, not marked as scheduled." : "");
