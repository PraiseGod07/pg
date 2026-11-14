// Gym and band coaching logic.
import { S, save } from "./store.js";
import { SPLITS, EXERCISES, INSTRUMENTS, GYM_WARMUP, stageOf } from "./library.js";
import { today, addDays, uid } from "./util.js";
export { EXERCISES };

// ---------- Gym ----------
export function split() { return SPLITS[S.gym.split] || SPLITS.ppl; }
// ---- Exercises PG adds or removes for you (kept on top of the built-in plan) ----
export function custom() { S.gym.custom = S.gym.custom || { ex: {}, days: {} }; S.gym.custom.ex ||= {}; S.gym.custom.days ||= {}; return S.gym.custom; }
export function syncCustom() { Object.entries(custom().ex).forEach(([k, v]) => { EXERCISES[k] = { muscles: "", cues: [], video: null, ...v, custom: true }; }); }
function withCustom(d) {
  if (!d) return d;
  const c = custom().days[d.key]; if (!c) return d;
  const drop = c.drop || [];
  return { ...d, plan: [...d.plan.filter(p => !drop.includes(p.ex)), ...(c.add || []).filter(p => EXERCISES[p.ex] && !drop.includes(p.ex))] };
}
const slug = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").map((w, i) => i ? w[0].toUpperCase() + w.slice(1) : w).join("") || "ex" + Date.now();
// Find an exercise by key or by name ("cable fly", "the dips")
export function findEx(q) {
  if (!q) return null; if (EXERCISES[q]) return q;
  const t = String(q).toLowerCase().replace(/^(the|a|an|my)\s+/, "").trim();
  const words = t.split(" ").filter(w => w.length > 3);
  const hit = Object.entries(EXERCISES).find(([k, e]) => e.name.toLowerCase() === t)
    || Object.entries(EXERCISES).find(([k, e]) => e.name.toLowerCase().includes(t) || t.includes(e.name.toLowerCase()))
    || (words.length >= 2 && Object.entries(EXERCISES).find(([k, e]) => words.every(w => e.name.toLowerCase().includes(w))));
  return hit ? hit[0] : null;
}
export function dayKeyFor(word) {
  const sp = split(), w = String(word || "").toLowerCase();
  if (!w) return null;
  const query = w.replace(/\s+(?:day|workout|routine)$/, "").replace(/^leg$/, "legs");
  const d = sp.days.find(x => x.key.toLowerCase() === query || x.name.toLowerCase().startsWith(query)) || null;
  return d ? d.key : null;
}
// Add an exercise to a workout day. info: { name, muscles, cues[], search, sets, reps, rest }
export function addExercise(info, dayKey) {
  const dk = dayKeyFor(dayKey) || (!dayKey ? workoutFor().key : null);
  if (!dk) throw new Error("Which gym day should I use?");
  // Adding a named exercise must not fuzzy-match an unrelated existing exercise.
  let key = info.key && EXERCISES[info.key] ? info.key
    : Object.entries(EXERCISES).find(([, e]) => e.name.toLowerCase() === String(info.name).trim().toLowerCase())?.[0];
  if (!key) {
    key = slug(info.name);
    custom().ex[key] = { name: (s => s.charAt(0).toUpperCase() + s.slice(1))(String(info.name).trim().slice(0, 60)), muscles: String(info.muscles || "").slice(0, 80), cues: (info.cues || []).map(String).slice(0, 6), search: String(info.search || info.name + " proper form").slice(0, 100),
      ...(/^[\w-]{11}$/.test(info.videoId || "") ? { video: { id: info.videoId, by: String(info.videoBy || "YouTube demonstration").slice(0, 80) } } : {}) };
    syncCustom();
  }
  const c = custom().days[dk] = custom().days[dk] || { add: [], drop: [] };
  c.drop = (c.drop || []).filter(x => x !== key);
  const already = split().days.find(x => x.key === dk)?.plan.some(p => p.ex === key);
  const existing = already || (c.add || []).some(p => p.ex === key);
  if (!existing) (c.add = c.add || []).push({ ex: key, sets: Math.max(1, Math.min(8, +info.sets || 3)), reps: String(info.reps || "10–12"), rest: +info.rest || 60 });
  save();
  return { key, day: split().days.find(x => x.key === dk), existing };
}
export function removeExercise(q, dayKey) {
  const key = findEx(q); if (!key) return null;
  const days = dayKey ? [dayKeyFor(dayKey)].filter(Boolean) : split().days.filter(d => withCustom(d).plan.some(p => p.ex === key)).map(d => d.key);
  if (!days.length) return null;
  days.forEach(dk => { const c = custom().days[dk] = custom().days[dk] || { add: [], drop: [] }; c.add = (c.add || []).filter(p => p.ex !== key); if (!(c.drop ||= []).includes(key)) c.drop.push(key); });
  save();
  return { key, days };
}
export function planOf(dayKey) { return withCustom(split().days.find(x => x.key === dayKey)); }

export function workoutFor(date = today()) { return withCustom(baseWorkout(date)); }
function baseWorkout(date) {
  const sp = split();
  const logged = S.gym.log.find(l => l.date === date);
  if (S.gym.override && S.gym.overrideDate === date) {
    const d = sp.days.find(x => x.key === S.gym.override); if (d) return d;
  }
  if (logged) { const d = sp.days.find(x => x.key === logged.key); if (d) return d; }
  return sp.days[S.gym.idx % sp.days.length];
}
export function switchDay(word) {
  const sp = split();
  const map = { leg: ["legs", "lower"], push: ["push", "upper"], pull: ["pull", "upper"], upper: ["upper"], lower: ["lower", "legs"], "full body": ["fullA"] };
  const keys = map[word] || [word];
  const d = sp.days.find(x => keys.includes(x.key)) || Object.values(SPLITS).flatMap(s => s.days).find(x => keys.includes(x.key));
  if (!d) return null;
  if (!sp.days.includes(d)) { S.gym.split = Object.keys(SPLITS).find(k => SPLITS[k].days.includes(d)); S.gym.idx = SPLITS[S.gym.split].days.indexOf(d); }
  S.gym.override = d.key; S.gym.overrideDate = today(); save();
  return d;
}
export function lastLog(exKey) { return S.gym.weights[exKey] || null; }
export function setWeight(exKey, w, reps) { S.gym.weights[exKey] = { w, reps, date: today() }; save(); }
export function completeWorkout(date = today(), checked = {}) {
  const d = workoutFor(date), sp = split();
  if (!S.gym.log.find(l => l.date === date)) S.gym.log.push({ date, key: d.key, sets: checked });
  S.gym.idx = (sp.days.findIndex(x => x.key === d.key) + 1) % sp.days.length;
  S.gym.override = null; save();
  return d;
}
export function gymStreak() {
  const days = new Set(S.gym.log.map(l => l.date));
  let n = 0; for (let i = 0; i < 7; i++) if (days.has(addDays(today(), -i))) n++;
  return n;
}
export function gymBrief(date = today(), short = false) {
  const d = workoutFor(date);
  if (short) return `Today is ${d.name.toLowerCase()}, ${d.focus}. Start with ${d.plan.slice(0, 3).map(p => EXERCISES[p.ex].name.toLowerCase()).join(", ")}. Videos are on your screen.`;
  const all = d.plan.map(p => `${EXERCISES[p.ex].name}, ${p.sets} sets of ${String(p.reps).replace("–", " to ")}`);
  return `Today is ${d.name.toLowerCase()}, ${d.focus}. Warm up with ${GYM_WARMUP.charAt(0).toLowerCase() + GYM_WARMUP.slice(1)} Then: ${all.join(". ")}.`;
}
export function exerciseBrief(key) {
  const e = EXERCISES[key]; if (!e) return "";
  return `${e.name}. Works your ${e.muscles.toLowerCase()}. ${e.cues.map((c, i) => (i === 0 ? "First, " : i === e.cues.length - 1 ? "Finally, " : "Then, ") + c.charAt(0).toLowerCase() + c.slice(1)).join(". ")}. The video is on your screen.`;
}

// ---------- Band ----------
export const inst = () => INSTRUMENTS[S.band.instrument] || INSTRUMENTS.bass;
export function addSong(name) {
  name = name.replace(/\s+/g, " ").trim().replace(/\b\w/g, c => c.toUpperCase());
  if (!name) return null;
  const ex = S.band.songs.find(s => s.name.toLowerCase() === name.toLowerCase());
  if (ex) return ex;
  const s = { id: uid(), name, progress: 10, notes: "", last: "" };
  S.band.songs.push(s); save(); return s;
}
export function bandPlan(minutes = 60) {
  const i = inst();
  const songs = S.band.songs.slice();
  const tech = i.tech[S.band.techIdx % i.tech.length];
  const open = songs.filter(s => s.progress < 90).sort((a, b) => a.progress - b.progress || (a.last || "").localeCompare(b.last || ""));
  const focus = open[0] || songs.sort((a, b) => (a.last || "").localeCompare(b.last || ""))[0] || null;
  const run = songs.filter(s => s !== focus).sort((a, b) => (a.last || "").localeCompare(b.last || "")).slice(0, 2);
  const warm = minutes >= 45 ? 10 : 5, techMin = minutes >= 45 ? 10 : 5, wrap = 5;
  const runMin = run.length ? Math.max(5, Math.round((minutes - warm - techMin - wrap) * 0.35 / 5) * 5) : 0;
  const focusMin = Math.max(10, minutes - warm - techMin - wrap - runMin);
  const steps = [
    { t: "Warm-up", min: warm, d: i.warmTitle, video: i.warmup },
    { t: "Technique", min: techMin, d: tech },
    focus ? { t: "Focus song: " + focus.name, min: focusMin, d: focus.progress < 40 ? "Learn it section by section. Loop the hardest part slowly, then build to full speed." : focus.progress < 70 ? "Play it start to finish. Mark where you slip and loop just those bars." : "Full-speed run-throughs. Polish transitions, dynamics and the ending.", song: focus.id }
      : { t: "Build your setlist", min: focusMin, d: "Add the songs your band is working on so PG can track your progress and pick what to focus on." },
    ...(run.length ? [{ t: "Run-through", min: runMin, d: run.map(s => s.name).join(" and ") + ", full speed, no stopping." }] : []),
    { t: "Log progress", min: wrap, d: "Rate how each song felt so tomorrow's plan adapts." }
  ];
  return { focus, run, steps, tech, minutes };
}
export function bandBrief(minutes = 60) {
  const p = bandPlan(minutes);
  if (!p.focus) return `Band practice is on. You don't have any songs in your setlist yet. Warm up for ${p.steps[0].min} minutes, then work on technique: ${p.tech.toLowerCase()}. Add your songs in the band coach and I'll track your progress.`;
  const st = stageOf(p.focus.progress);
  return `Band practice is on. Today's focus is ${p.focus.name}. You're at ${p.focus.progress} percent, ${st.label.toLowerCase()}. Warm up for ${p.steps[0].min} minutes, then technique: ${p.tech.toLowerCase()}. Then ${p.steps[2].min} minutes on ${p.focus.name}.` + (p.run.length ? ` Finish with a run-through of ${p.run.map(s => s.name).join(" and ")}.` : "");
}
export function completeBand(updates = {}, minutes = 60) {
  const p = bandPlan(minutes);
  Object.entries(updates).forEach(([id, v]) => { const s = S.band.songs.find(x => x.id === id); if (s) { s.progress = Math.max(0, Math.min(100, +v)); s.last = today(); } });
  if (p.focus) p.focus.last = today();
  S.band.log.push({ date: today(), focus: p.focus?.name || "", minutes });
  S.band.techIdx++; save();
}
export function bandStreak() {
  const days = new Set(S.band.log.map(l => l.date));
  let n = 0; for (let i = 0; i < 7; i++) if (days.has(addDays(today(), -i))) n++;
  return n;
}
