// One saved schedule powers the weekly table, daily checklist and spoken answers.
import { S, day, save } from "./store.js";
import { today, addDays, nowMin } from "./util.js";
import { firstGap } from "./scheduler.js";
import { CATS } from "./library.js";
import { academic, add as addSchool } from "./school.js";

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
  const work = Object.fromEntries(dates.map(d => {
    const savedWindows = S.studyWindows?.[d] || [];
    const blocks = day(d).blocks.filter(b => !savedWindows.some(w => b.containerId === w.id)).filter(b =>
      b.src !== "weekly-plan" || b.done || d < today() || d === today() && b.start < nowMin()).map(b => ({ ...b }));
    for (const w of savedWindows) if (!blocks.some(b => b.id === w.id)) blocks.push({ ...w });
    return [d, blocks];
  }));
  const missing = [], placed = [];
  const windows = Object.fromEntries(dates.map(d => [d, work[d].filter(b => !b.done && (b.studyWindow || /^(?:assignments?|study|homework)$/i.test(b.title)))]));
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
        const containers = windows[date];
        const occupied = work[date].filter(b => !containers.some(w => w.id === b.id));
        let at = null;
        const studyTask = ["study", "work"].includes(task.cat);
        if (containers.length && studyTask) {
          for (const window of containers) {
            at = firstGap(occupied, Math.max(cursor, window.start), duration + rest, Math.min(end, window.end));
            if (at != null) break;
          }
        } else at = firstGap(work[date], cursor, duration + rest, end);
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
  if (missing.length) throw new Error("No, sir, this is not feasible. There is not enough time in the approved study windows for "
    + missing.map(t => `${t.title} (${t.minutes} minutes still needed)`).join(", ") + ". Nothing changed. Which duration or available time should change?");
  for (const date of dates) {
    // Keep the container as allocation metadata, not an overlapping appointment.
    // Display only its free remainders once subjects have been allocated.
    for (const window of windows[date]) {
      const inside = work[date].filter(b => b.src === "weekly-plan" && b.start >= window.start && b.end <= window.end);
      if (!inside.length) continue;
      window.studyWindow = true;
      let cursor = window.start;
      const remaining = [];
      for (const b of inside.sort((a, b) => a.start - b.start)) {
        if (b.start > cursor) remaining.push({ ...window, id: `${window.id}:free:${cursor}`, start: cursor, end: b.start, containerId: window.id });
        cursor = Math.max(cursor, b.end);
      }
      if (cursor < window.end) remaining.push({ ...window, id: `${window.id}:free:${cursor}`, start: cursor, containerId: window.id });
      S.studyWindows ||= {};
      S.studyWindows[date] ||= [];
      if (!S.studyWindows[date].some(w => w.id === window.id)) S.studyWindows[date].push({ ...window });
      work[date] = work[date].filter(b => b.id !== window.id).concat(remaining);
    }
    day(date).blocks = work[date];
  }
  S.weekPlans ||= {};
  for (const task of tasks) if (academic(task.title)) {
    const [record] = addSchool([{ title: task.title, kind: "assignment", due: null, dueMin: null, est: null }]);
    for (const blocks of Object.values(work)) for (const b of blocks)
      if (b.planTask === key(task.title)) b.tid = record.id;
  }
  S.weekPlans[week] = { weekStart: week, start, end, focusMinutes: focus, breakMinutes: rest, tasks, missing, updated: Date.now() };
  save();
  return { week, placed, missing };
}
export const planSummary = result => `Saved the weekly timetable with ${result.placed.length} task session${result.placed.length === 1 ? "" : "s"} and rest breaks. Fixed commitments and completed items stayed in place.`
  + (result.missing.length ? " Not enough free time for " + result.missing.map(t => `${t.title} (${t.minutes} minutes left)`).join(", ") + ". These are shown as unallocated, not marked as scheduled." : "");
