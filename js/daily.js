// Daily companion: goals, "what have I done" reports, reminders of plans he forgot,
// a morning Bible verse and evening Cantonese when the call ends.
import { S, save, sortedBlocks } from "./store.js";
import { today, addDays, nowMin, uid, sayTime, sayDur, fmtDay } from "./util.js";
import { VERSES } from "./verses.js";
import { CANTO, sayLike } from "./canto.js";
import * as BS from "./bass.js";
import * as B from "./bible.js";
import * as SC from "./school.js";
import * as M from "./brain.js";
import * as LN from "./learn.js";
import * as F from "./food.js";
import { SPLITS } from "./library.js";
import { activeGoals, parseGoal } from "./goals.js";

const dl = () => (S.daily = S.daily || { reminded: {}, verses: [] });
export const goals = () => activeGoals(S);
export function addGoal(text, qualifier) {
  const draft = parseGoal(text, today(), S.profile.termEnd, S.profile.goalRemindEvery, qualifier);
  if (!draft.text) return null;
  const ex = goals().find(g => g.text.toLowerCase() === draft.text.toLowerCase());
  if (ex) return ex;
  const g = { id: uid(), ...draft }; S.goals.push(g); save(); return g;
}
export function finishGoal(id, status) {
  const g = goals().find(x => x.id === id);
  if (!g) return null;
  g.status = status;
  (S.goalHistory ||= []).push({ id, text: g.text, status, date: today() });
  save(); return g;
}

const list = a => a.length <= 1 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a.at(-1);
const at = b => `${b.title} at ${sayTime(b.start)}`;
// Plans he told PG in the last few hours aren't "forgotten".
const fresh = new Map();

// ---- plans he already had but didn't mention ----
// before: Set of block ids that existed before this turn. Returns a reminder line or "".
export function forgotten(before, dates) {
  const r = dl().reminded, n = nowMin(), out = [];
  for (const d of dates) {
    const bl = sortedBlocks(d);
    const added = bl.filter(b => !before.has(b.id));
    if (!added.length) continue;
    added.forEach(b => fresh.set(b.id, Date.now()));
    const seen = new Set(r[d] || []);
    const old = bl.filter(b => before.has(b.id) && !b.done && !b.skipped && !seen.has(b.id) && !(Date.now() - (fresh.get(b.id) || 0) < 3 * 3600e3) && (d > today() || b.end > n))
      .filter(b => !added.some(a => a.title.toLowerCase() === b.title.toLowerCase()));
    if (!old.length) continue;
    r[d] = [...seen, ...old.map(b => b.id)];
    const when = d === today() ? "" : d === addDays(today(), 1) ? " tomorrow" : " on " + fmtDay(d);
    out.push(`Also, don't forget you already had ${list(old.slice(0, 5).map(at))}${when}.`);
  }
  // keep the record small
  Object.keys(r).forEach(k => { if (k < addDays(today(), -3)) delete r[k]; });
  if (out.length) save(true);
  return out.join(" ");
}

// ---- "what have I done today?" ----
export function report(d = today()) {
  const n = nowMin(), bl = sortedBlocks(d);
  const done = bl.filter(b => b.done);
  const missed = d === today() ? bl.filter(b => !b.done && !b.skipped && b.end <= n) : [];
  const left = d === today() ? bl.filter(b => !b.done && !b.skipped && b.end > n) : [];
  const lines = [];
  if (done.length) lines.push(`You finished ${done.length === 1 ? "one thing" : done.length + " things"}: ${list(done.map(at))}.`);
  const gym = (S.gym?.log || []).find(l => l.date === d);
  if (gym) { const day = Object.values(SPLITS).flatMap(s => s.days).find(x => x.key === gym.key); lines.push(`At the gym you did ${day ? day.name.toLowerCase() : "your workout"}${(() => { const k = gym.sets && typeof gym.sets === "object" ? Object.values(gym.sets).filter(Boolean).length : +gym.sets || 0; return k ? `, with ${k} sets checked off` : ""; })()}.`); }
  const bass = (S.bass?.log || []).filter(l => l.date === d && !l.repeat);
  if (bass.length) lines.push(`On bass you completed ${list(bass.map(l => `lesson ${l.idx + 1}, ${BS.lesson(l.idx)?.t || ""}`.trim()))}.`);
  const band = (S.band?.log || []).filter(l => l.date === d);
  if (band.length) { const m = band.reduce((a, l) => a + (l.minutes || 0), 0); lines.push(`You practised with the band${m ? ` for ${sayDur(m)}` : ""}${band[0].focus ? `, working on ${band[0].focus}` : ""}.`); }
  const p = S.bible?.plan, read = (p?.log || []).filter(l => l.date === d);
  if (read.length) { const v = read.reduce((a, l) => a + (l.to - l.from), 0); const st = B.stats(); lines.push(`You read ${v} verse${v === 1 ? "" : "s"} of ${st?.book || "the Bible"}${st ? `, so you're ${st.pct} percent through` : ""}.`); }
  const sch = SC.tasks().filter(t => t.doneOn === d);
  if (sch.length) lines.push(`For school you finished ${list(sch.map(t => t.title))}.`);
  const learnt = LN.tracks().flatMap(t => (t.log || []).filter(l => l.date === d).map(l => `${t.steps[l.idx]?.t || "a step"} in ${t.topic}`));
  if (learnt.length) lines.push(`You learned ${list(learnt)}.`);
  const notes = M.notes().filter(x => x.date === d && x.folder !== "about");
  if (notes.length) lines.push(`You saved ${notes.length === 1 ? "a note" : notes.length + " notes"}${notes.length === 1 ? `: ${notes[0].text.slice(0, 90)}` : ""}.`);
  const canto = (S.canto?.learned || []).filter(x => x.date === d).length;
  if (canto) lines.push(`You learned ${canto} Cantonese sentence${canto === 1 ? "" : "s"}.`);
  if (!lines.length) lines.push(d === today() ? "Nothing is checked off yet today." : "Nothing was checked off that day.");
  if (left.length) lines.push(`Still to come: ${list(left.slice(0, 5).map(at))}.`);
  return { text: lines.join(" "), missed };
}
export function goalsLine() {
  const g = goals().map(x => x.text);
  const bits = [];
  if (g.length) bits.push(`Remember your goal${g.length > 1 ? "s" : ""}: ${list(g.slice(0, 5))}.`);
  const st = B.stats(); if (st && !st.finished) bits.push(`You're on track to finish ${st.book} by ${fmtDay(st.finish)}.`);
  const due = SC.pending()[0]; if (due) bits.push(`Next deadline: ${due.title}${due.due ? `, due ${fmtDay(due.due)}` : ""}.`);
  const tr = LN.active(); if (tr && tr.idx < tr.steps.length) bits.push(`In ${tr.topic}, next up is ${tr.steps[tr.idx].t}.`);
  try { const t = F.target(); if (t) bits.push(`And aim for ${t} grams of protein today.`); } catch {}
  if (!g.length) bits.push("You haven't told me your goals yet. Just say, my goal is, and I'll keep you on it.");
  return bits.join(" ");
}

// ---- end-of-call extras ----
export function verse() {
  const date = today();
  const days = dl().verseDays || (dl().verseDays = {});
  // Date-seeded shuffle is stable on phone/laptop and does not require a paid API.
  let hash = 2166136261;
  for (const c of date) { hash ^= c.charCodeAt(0); hash = Math.imul(hash, 16777619) >>> 0; }
  const i = days[date] ?? (hash % VERSES.length);
  if (days[date] == null) { days[date] = i; save(); }
  return { ref: VERSES[i][0], text: VERSES[i][1] };
}
export const canto = () => (S.canto = S.canto || { learned: [] });
// Two sentences he hasn't learned yet; once all are learned, start again.
export function teachTwo() {
  const have = new Set(canto().learned.map(x => x.i));
  let pool = CANTO.map((_, i) => i).filter(i => !have.has(i));
  if (pool.length < 2) pool = CANTO.map((_, i) => i).filter(i => !canto().learned.slice(-2).some(x => x.i === i));
  const pick = [];
  while (pick.length < 2 && pool.length) pick.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  pick.forEach(i => canto().learned.push({ i, date: today() }));
  save();
  return pick.map(i => ({ i, zh: CANTO[i][0], jp: sayLike(CANTO[i][1]), en: CANTO[i][2] }));
}
export function dailyCanto(date = today(), offset = 0) {
  const ordinal = Math.floor((Date.parse(date + "T00:00:00Z") - Date.UTC(2026, 10, 19)) / 86400000);
  const i = ((ordinal + offset) % CANTO.length + CANTO.length) % CANTO.length;
  const [zh, jp, en] = CANTO[i];
  return { i, zh, jp: sayLike(jp), en };
}
export function markCanto(i) {
  if (!CANTO[i] || canto().learned.some(x => x.i === i)) return;
  canto().learned.push({ i, date: today() }); save();
}
export const teachDaily = () => dailyCanto();
export function learned() {
  const seen = new Set(), out = [];
  for (const x of [...canto().learned].reverse()) { if (seen.has(x.i) || !CANTO[x.i]) continue; seen.add(x.i); out.push({ i: x.i, date: x.date, zh: CANTO[x.i][0], jp: sayLike(CANTO[x.i][1]), en: CANTO[x.i][2] }); }
  return out;
}
export const CANTO_N = CANTO.length;

// ---- Things he keeps asking about ----
// Each AI reply labels its topic. Asked 3+ times on 2+ different days = PG saves it as something to learn about him.
const SKIP_TOPIC = /^(?:|small talk|greeting|greetings|chat|app|app command|schedule|time|thanks|help|other|general|misc)$/;
export function noteTopic(topic, M) {
  const t = String(topic || "").toLowerCase().replace(/[^a-z0-9 '&+-]/g, "").replace(/\s+/g, " ").trim().slice(0, 30);
  if (!t || SKIP_TOPIC.test(t) || t.split(" ").length > 3) return;
  const all = S.interests || (S.interests = {});
  const it = all[t] || (all[t] = { n: 0, days: [], saved: 0 });
  it.n++; const d = today();
  if (!it.days.includes(d)) it.days = [...it.days, d].slice(-30);
  if (!it.saved && it.n >= 3 && it.days.length >= 2) { it.saved = 1; M.add(`You often ask about ${t}.`, { folder: "about" }); }
  else if (it.saved === 1 && it.n >= 10 && it.days.length >= 4) { it.saved = 2; M.add(`${t} is one of your big interests. You ask about it a lot.`, { folder: "about" }); }
  save();
}
