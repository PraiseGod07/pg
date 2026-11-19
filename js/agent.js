// PG's hands: lets the AI read the app's data and make changes, safely.
// The AI never sees or touches the API key or other private settings.
import { S, save, day, replace, beginDraft, endDraft, inDraft } from "./store.js";
import { today, addDays, uid } from "./util.js";
import { CATS, DEFAULT_MIN } from "./library.js";
import * as C from "./coach.js";
import * as M from "./brain.js";
import * as SC from "./school.js";
import { weekOf, planWeek, planSummary } from "./timetable.js";
import { changes, validateChanges, reconcileWindows } from "./commands.js";
import { calendarDate } from "./dates.js";
import { activityKey } from "./scheduler.js";

// Anything under these is off limits, both for reading and for writing.
const PRIVATE = /^(?:ai|v|alwaysOn|dev|t)(?:\.|$)|(?:^|\.)(?:__proto__|constructor|prototype|key|apiKey|api_key|token|secret|password|credential|base|account)(?:\.|$)/i;
export const isPrivate = path => PRIVATE.test(String(path || ""));

function toMin(v) {
  if (typeof v === "number") return Number.isInteger(v) && v >= 0 && v <= 1440 ? v : null;
  const m = String(v || "").trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = +m[1]; const mi = +(m[2] || 0);
  if (h > 24 || mi > 59 || h === 24 && mi || m[3] && (h < 1 || h > 12)) return null;
  if (m[3] === "pm" && h < 12) h += 12; if (m[3] === "am" && h === 12) h = 0;
  return h * 60 + mi;
}
function toDate(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s || s === "today") return today();
  if (s === "tomorrow") return addDays(today(), 1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return calendarDate(s, today());
  return null;
}

function findBlock(id) {
  for (const d of Object.keys(S.days)) { const b = (S.days[d].blocks || []).find(x => x.id === id); if (b) return { d, b }; }
  return null;
}
function walk(path, create) {
  const parts = String(path).split(".").filter(Boolean);
  let o = S;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = /^\d+$/.test(parts[i]) ? +parts[i] : parts[i];
    if (o[k] == null) { if (!create) return null; o[k] = /^\d+$/.test(parts[i + 1]) ? [] : {}; }
    o = o[k]; if (typeof o !== "object") return null;
  }
  return { o, k: /^\d+$/.test(parts.at(-1)) ? +parts.at(-1) : parts.at(-1) };
}

// Apply the AI's changes. Returns short lines saying what happened.
export function apply(ops, { onDone } = {}) {
  if (!inDraft()) {
    const before = JSON.parse(JSON.stringify(S));
    beginDraft();
    try {
      const lines = apply(ops);
      const result = endDraft();
      reconcileWindows(before, result);
      validateChanges(before, result, changes(before, result));
      for (const k of Object.keys(S)) if (!(k in result)) delete S[k];
      Object.assign(S, result); C.syncCustom(); save();
      onDone?.(() => replace(before));
      return lines;
    } catch (e) { if (inDraft()) endDraft(); C.syncCustom(); throw e; }
  }
  if (!Array.isArray(ops) || ops.length > 25) throw new Error("Please split this into batches of no more than 25 changes.");
  const before = JSON.stringify(S);
  const said = [];
  for (const op of (ops || []).slice(0, 25)) {
    try {
      if (!op || typeof op !== "object") throw new Error("The proposed command is invalid.");
      if (op.path && isPrivate(op.path)) throw new Error("I can't change private settings.");
      switch (op.op) {
        case "plan_week": said.push(planSummary(planWeek(op))); break;
        case "add_block": {
          const d = toDate(op.date);
          let s = toMin(op.start), e = toMin(op.end);
          const cat = CATS[op.cat] ? op.cat : "other";
          if (!d || !op.title || s == null || e == null || e <= s) throw new Error("Nothing saved. What date, start and end time should I use?");
          const clash = day(d).blocks.find(b => !b.skipped && !b.studyWindow && b.start < e && s < b.end);
          if (day(d).blocks.some(b => !b.skipped && b.start === s && b.end === e && activityKey(b.title) === activityKey(op.title))) { said.push("Already on your timetable."); break; }
          day(d).blocks.push({ id: uid(), title: String(op.title || "Untitled").slice(0, 80), cat, start: s, end: e, flex: false, done: false, date: d, src: "pg" });
          if (SC.academic(op.title)) {
            const [task] = SC.add([{ title: String(op.title).slice(0, 80), kind: "assignment", due: null, dueMin: null, est: null }]);
            day(d).blocks.at(-1).tid = task.id;
          }
          said.push(`Added ${op.title}${d === today() ? "" : d === addDays(today(), 1) ? " tomorrow" : " on " + d}.`);
          if (clash) said.push(`Overlaps ${clash.title}.`);
          break;
        }
        case "delete_block": {
          const f = findBlock(op.id); if (!f) throw new Error("That timetable item no longer exists. Which item should I remove?");
          S.days[f.d].blocks = S.days[f.d].blocks.filter(x => x.id !== op.id);
          said.push(`Removed ${f.b.title}.`);
          break;
        }
        case "update_block": {
          const f = findBlock(op.id); if (!f) throw new Error("That timetable item no longer exists. Which item should I change?");
          const b = f.b, len = b.end - b.start;
          if (op.title) b.title = String(op.title).slice(0, 80);
          if (op.cat && CATS[op.cat]) b.cat = op.cat;
          const s = toMin(op.start), e = toMin(op.end);
          if (op.start != null && s == null || op.end != null && e == null || (e ?? b.end) <= (s ?? b.start))
            throw new Error("Nothing saved. The end time must be later than the start time.");
          if (s != null) { b.start = s; b.end = e != null && e > s ? e : Math.min(1440, s + len); b.flex = false; }
          else if (e != null && e > b.start) b.end = e;
          if (op.done != null) b.done = !!op.done;
          const nd = op.date == null ? null : toDate(op.date);
          if (nd && nd !== f.d) { S.days[f.d].blocks = S.days[f.d].blocks.filter(x => x !== b); b.date = nd; day(nd).blocks.push(b); }
          said.push(`Updated ${b.title}.`);
          break;
        }
        case "clear_day": { const d = toDate(op.date); if (!d) throw new Error("Which day should I clear?"); day(d).blocks = day(d).blocks.filter(b => b.routine); said.push(`Cleared one-off entries on ${d}. Daily routines remain.`); break; }
        case "move_day": {
          const from = toDate(op.from), to = toDate(op.to);
          if (!from || !to || from === to) { said.push("Not moved. Tell me the source and destination day."); break; }
          const source = day(from).blocks.filter(b => !b.routine);
          if (!source.length) { said.push(`There are no timetable items to move from ${from}.`); break; }
          const dest = day(to).blocks;
          for (const b of source) if (!dest.some(x => x.id === b.id || x.title === b.title && x.start === b.start && x.end === b.end))
            dest.push({ ...b, date: to });
          S.days[from].blocks = day(from).blocks.filter(b => b.routine);
          said.push(`Moved ${source.length} items from ${from} to ${to} and removed them from the original day. Daily reminders stayed in place.`);
          break;
        }
        case "add_assignment": {
          if (!String(op.title || "").trim()) throw new Error("What is the assignment called?");
          if (op.due && !/^\d{4}-\d{2}-\d{2}$/.test(op.due)) throw new Error("What date is the assignment due?");
          const [t] = SC.add([{ title: String(op.title).trim().slice(0, 200), kind: "assignment", due: op.due || null,
            dueMin: Number.isFinite(op.dueMin) ? op.dueMin : null, est: Number.isFinite(op.minutes) ? op.minutes : null }]);
          said.push(`Saved ${t.title} in School${t.due ? `, due ${t.due}` : ". What date is it due?"}.`);
          break;
        }
        case "add_routine": {
          if (!String(op.title || "").trim()) break;
          const routines = S.routines || (S.routines = []);
          const existing = routines.find(r => r.title.toLowerCase() === op.title.trim().toLowerCase());
          const r = existing || { id: uid(), title: String(op.title).trim().slice(0, 100), from: today() };
          r.start = op.start == null ? null : toMin(op.start); r.minutes = Math.max(1, Math.min(120, +op.minutes || 5));
          r.cat = CATS[op.cat] ? op.cat : "other"; r.disabled = false;
          if (!existing) routines.push(r);
          said.push(`Saved ${r.title} as a daily reminder${r.start == null ? " in your daily checklist" : ""}. It stays until you ask me to stop it.`);
          break;
        }
        case "remove_routine": {
          const r = (S.routines || []).find(r => r.id === op.id);
          if (!r) { said.push("I couldn't find that daily reminder."); break; }
          S.routines = S.routines.filter(x => x.id !== r.id);
          for (const [date, v] of Object.entries(S.days)) if (date >= today()) v.blocks = v.blocks.filter(b => b.routine !== r.id || b.done);
          said.push(`Stopped the daily reminder for ${r.title}.`); break;
        }
        case "add_exercise": {
          if (!op.name) break;
          const r = C.addExercise(op, op.day);
          said.push(`${r.existing ? "Already saved" : "Added"}: ${C.EXERCISES[r.key].name} on ${r.day?.name || "your workout"}. ${C.planOf(r.day.key).plan.length} exercises are now on that day. Instructions and the video button are on the exercise card.`);
          break;
        }
        case "remove_exercise": {
          const r = C.removeExercise(op.exercise || op.ex || op.name, op.day);
          if (r) said.push(`Removed ${C.EXERCISES[r.key].name} from your workout.`);
          break;
        }
        case "attach_video": {
          const key = C.findEx(op.exercise);
          if (!key || !/^[\w-]{11}$/.test(op.videoId || "")) throw new Error("Which existing exercise and YouTube video should I use?");
          C.custom().ex[key] = { ...C.EXERCISES[key], ...C.custom().ex[key],
            video: { id: op.videoId, by: String(op.videoBy || "YouTube demonstration").slice(0, 80) } };
          C.syncCustom(); said.push(`Attached the video to ${C.EXERCISES[key].name}.`); break;
        }
        case "note": { if (op.text) { M.add(String(op.text), op.folder ? { folder: op.folder } : {}); said.push("Saved that note."); } break; }
        case "set": {
          const w = walk(op.path, true); if (!w) break;
          w.o[w.k] = op.value; said.push("Done.");
          break;
        }
        case "push": {
          const w = walk(op.path, true); if (!w) break;
          if (!Array.isArray(w.o[w.k])) w.o[w.k] = [];
          const v = op.value && typeof op.value === "object" && !Array.isArray(op.value) ? { id: uid(), ...op.value } : op.value;
          w.o[w.k].push(v); said.push("Added.");
          break;
        }
        case "remove": {
          const w = walk(op.path, false); if (!w) break;
          const arr = w.o[w.k];
          if (Array.isArray(arr)) w.o[w.k] = arr.filter((x, i) => !(op.id != null ? x && x.id === op.id : op.index != null ? i === +op.index : op.value != null && JSON.stringify(x) === JSON.stringify(op.value)));
          else if (w.o && w.k in w.o) delete w.o[w.k];
          said.push("Removed.");
          break;
        }
        default: throw new Error("That command is not supported yet. Nothing saved.");
      }
    } catch (e) {
      for (const k of Object.keys(S)) delete S[k];
      Object.assign(S, JSON.parse(before)); C.syncCustom();
      throw new Error(e.message || "I couldn't complete the whole command. Nothing saved.");
    }
  }
  if (said.length) {
    C.syncCustom(); save();
    onDone?.(() => replace(JSON.parse(before)));
  }
  // Keep only the specific lines; drop generic "Done." if anything specific was said.
  const specific = said.filter(x => !/^(?:Done|Added|Removed)\.$/.test(x));
  return specific.length ? specific : said.slice(0, 1);
}
