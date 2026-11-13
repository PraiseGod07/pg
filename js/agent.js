// PG's hands: lets the AI read the app's data and make changes, safely.
// The AI never sees or touches the API key or other private settings.
import { S, save, day, replace } from "./store.js";
import { today, addDays, uid } from "./util.js";
import { CATS, DEFAULT_MIN } from "./library.js";
import * as C from "./coach.js";
import * as M from "./brain.js";

// Anything under these is off limits, both for reading and for writing.
const PRIVATE = /^(?:ai|v|alwaysOn|dev|t)(?:\.|$)|(?:^|\.)(?:key|apiKey|api_key|token|secret|password|credential|base|account)(?:\.|$)/i;
export const isPrivate = path => PRIVATE.test(String(path || ""));

const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
function toMin(v) {
  if (typeof v === "number") return Math.max(0, Math.min(1440, Math.round(v)));
  const m = String(v || "").trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = +m[1]; const mi = +(m[2] || 0);
  if (m[3] === "pm" && h < 12) h += 12; if (m[3] === "am" && h === 12) h = 0;
  return h * 60 + mi;
}
function toDate(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s || s === "today") return today();
  if (s === "tomorrow") return addDays(today(), 1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

// A compact picture of the app for the AI, without private settings.
export function snapshot() {
  const days = {};
  for (let i = -1; i < 8; i++) {
    const d = addDays(today(), i), bl = (S.days[d]?.blocks || []);
    if (bl.length) days[d] = bl.slice().sort((a, b) => a.start - b.start).map(b => ({ id: b.id, title: b.title, cat: b.cat, start: hhmm(b.start), end: hhmm(b.end), ...(b.done ? { done: true } : {}) }));
  }
  const sp = C.split();
  const gym = { split: sp.label, today: C.workoutFor().key, days: sp.days.map(d => ({ key: d.key, name: d.name, exercises: C.planOf(d.key).plan.map(p => ({ ex: p.ex, name: C.EXERCISES[p.ex]?.name, sets: p.sets, reps: p.reps })) })) };
  const strip = o => JSON.parse(JSON.stringify(o ?? null, (k, v) => (isPrivate(k) ? undefined : v)));
  const out = {
    profile: strip(S.profile),
    voice: { speak: S.voice.speak !== false, rate: S.voice.rate, alerts: S.voice.alerts, heads: S.voice.heads, handsFree: S.voice.handsFree, keepAwake: S.voice.keepAwake },
    days, inbox: strip(S.inbox).slice(0, 20), gym,
    band: strip({ instrument: S.band.instrument, songs: S.band.songs }),
    bass: { lesson: (S.bass?.idx || 0) + 1 },
    bible: strip({ plan: S.bible.plan, max: S.bible.max, version: S.bible.version }),
    learn: strip((S.learn?.tracks || []).map(t => ({ id: t.id, topic: t.topic || t.title, step: t.idx }))),
    food: strip({ kg: S.food?.kg, prefs: S.food?.prefs, list: (S.food?.list || []).slice(0, 40).map(i => ({ id: i.id, name: i.name || i.t, got: i.got })) }),
    school: strip({ tasks: (S.school?.tasks || []).filter(t => !t.done).slice(0, 15).map(t => ({ id: t.id, title: t.title, due: t.due, est: t.est })), pref: S.school?.pref, cap: S.school?.cap }),
    notes: (S.notes || []).slice(-30).map(n => ({ id: n.id, folder: n.folder, text: String(n.text).slice(0, 160) }))
  };
  let j = JSON.stringify(out);
  if (j.length > 14000) { out.notes = out.notes.slice(-10); j = JSON.stringify(out); }
  return j.slice(0, 16000);
}

// Explain the edit tools to the AI.
export const TOOLS = `"ops" is a list of direct changes to the app. Use the ids and keys from APP DATA. Available ops:
- {"op":"add_block","date":"YYYY-MM-DD|today|tomorrow","title":"...","cat":"${Object.keys(CATS).join("|")}","start":"HH:MM","end":"HH:MM"}
- {"op":"delete_block","id":"..."}   (delete one timetable item; one op per item)
- {"op":"update_block","id":"...","title":"...","start":"HH:MM","end":"HH:MM","date":"YYYY-MM-DD","done":true}  (only the fields that change)
- {"op":"clear_day","date":"YYYY-MM-DD"}
- {"op":"add_exercise","day":"<gym day key>","name":"Cable crossover","muscles":"Inner chest, front delts","cues":["cue 1","cue 2","cue 3"],"search":"cable crossover proper form","sets":3,"reps":"12-15","rest":60}
- {"op":"remove_exercise","day":"<gym day key, optional>","exercise":"<ex key or name>"}
- {"op":"set","path":"dot.path","value":...}, {"op":"push","path":"dot.path","value":...}, {"op":"remove","path":"dot.path","id":"..."}  (for anything else in APP DATA, e.g. "profile.address", "voice.rate", "bible.max", "band.songs", "food.kg")
- {"op":"note","text":"...","folder":"spiritual|about|bass|fitness|learning|life"}
Never use paths for API keys or private settings; they are not available.`;

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
  const before = JSON.stringify(S);
  const said = [];
  for (const op of (ops || []).slice(0, 25)) {
    try {
      if (!op || typeof op !== "object") continue;
      if (op.path && isPrivate(op.path)) { said.push("I can't change private settings."); continue; }
      switch (op.op) {
        case "add_block": {
          const d = toDate(op.date) || today();
          let s = toMin(op.start), e = toMin(op.end);
          const cat = CATS[op.cat] ? op.cat : "other";
          if (s == null) s = 18 * 60;
          if (e == null || e <= s) e = Math.min(1440, s + (DEFAULT_MIN[cat] || 30));
          day(d).blocks.push({ id: uid(), title: String(op.title || "Untitled").slice(0, 80), cat, start: s, end: e, flex: false, done: false, date: d, src: "pg" });
          said.push(`Added ${op.title}${d === today() ? "" : d === addDays(today(), 1) ? " tomorrow" : " on " + d}.`);
          break;
        }
        case "delete_block": {
          const f = findBlock(op.id); if (!f) break;
          S.days[f.d].blocks = S.days[f.d].blocks.filter(x => x.id !== op.id);
          said.push(`Removed ${f.b.title}.`);
          break;
        }
        case "update_block": {
          const f = findBlock(op.id); if (!f) break;
          const b = f.b, len = b.end - b.start;
          if (op.title) b.title = String(op.title).slice(0, 80);
          if (op.cat && CATS[op.cat]) b.cat = op.cat;
          const s = toMin(op.start), e = toMin(op.end);
          if (s != null) { b.start = s; b.end = e != null && e > s ? e : Math.min(1440, s + len); b.flex = false; }
          else if (e != null && e > b.start) b.end = e;
          if (op.done != null) b.done = !!op.done;
          const nd = toDate(op.date);
          if (nd && nd !== f.d) { S.days[f.d].blocks = S.days[f.d].blocks.filter(x => x !== b); b.date = nd; day(nd).blocks.push(b); }
          said.push(`Updated ${b.title}.`);
          break;
        }
        case "clear_day": { const d = toDate(op.date) || today(); day(d).blocks = []; said.push(`Cleared ${d === today() ? "today" : d}.`); break; }
        case "add_exercise": {
          if (!op.name) break;
          const r = C.addExercise(op, op.day);
          said.push(`Added ${C.EXERCISES[r.key].name} to ${r.day?.name || "your workout"}.`);
          break;
        }
        case "remove_exercise": {
          const r = C.removeExercise(op.exercise || op.ex || op.name, op.day);
          if (r) said.push(`Removed ${C.EXERCISES[r.key].name} from your workout.`);
          break;
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
      }
    } catch (e) { console.warn("op failed", op, e); }
  }
  if (said.length) {
    C.syncCustom(); save();
    onDone?.(() => replace(JSON.parse(before)));
  }
  // Keep only the specific lines; drop generic "Done." if anything specific was said.
  const specific = said.filter(x => !/^(?:Done|Added|Removed)\.$/.test(x));
  return specific.length ? specific : said.slice(0, 1);
}
