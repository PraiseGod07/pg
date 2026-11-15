// School: assignments in, a realistic study timetable out.
// Rules come from research (see RULES): pad estimates, 50-minute sessions with breaks,
// spread work over days, cap focused work near 4 hours a day, finish a day early, protect sleep.
import { S, save, day, sortedBlocks } from "./store.js";
import { today, addDays, uid, nowMin, sayTime, sayDur, dayName, cap, fmtTime } from "./util.js";
import { firstGap } from "./scheduler.js";
import { calendarDate } from "./dates.js";

export const RULES = [
  { t: "Plan more time than you think", d: "People finish school work later than they predict. Students guessed 34 days for a thesis and took 55. PG adds 50% until it learns your real pace.", url: "https://doi.apa.org/doi/10.1037/0022-3514.67.3.366" },
  { t: "Spread it out", d: "Short sessions over several days beat one long night. Spacing is one of the two best study methods in a review of ten.", url: "https://www.aft.org/ae/fall2013/dunlosky" },
  { t: "About 4 hours of hard focus a day", d: "Studies of practice find little gain past 4 hours a day, and less past 2.", url: "https://blogs.ischool.berkeley.edu/i225s14/files/2014/04/Ericsson-1993-article.pdf" },
  { t: "50 minutes, then a break", d: "Short breaks lower tiredness and lift energy.", url: "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0272460" },
  { t: "Finish a day early", d: "Planning back from the deadline makes your time guesses more accurate.", url: "https://www.cambridge.org/core/journals/judgment-and-decision-making/article/backward-planning-effects-of-planning-direction-on-predictions-of-task-completion-time/92802E42B5A5D987CAADA7F582C2AE0F" },
  { t: "Protect your sleep", d: "Adults need 7 or more hours. Too little hurts focus and memory, so PG stops study an hour before bed.", url: "https://jcsm.aasm.org/doi/full/10.5664/jcsm.4758" }
];

const KINDS = [
  [/\b(?:exam|final|finals|midterm|test)s?\b/, "exam", 360, "exam"],
  [/\bquiz(?:zes)?\b/, "quiz", 120, "quiz"],
  [/\b(?:essay|paper|write ?up|dissertation|thesis)s?\b/, "essay", 360, "essay"],
  [/\b(?:lab report|report|lab)s?\b/, "report", 300, "report"],
  [/\b(?:presentation|slides|deck|pitch|speech)s?\b/, "presentation", 240, "presentation"],
  [/\b(?:project|portfolio|prototype)s?\b/, "project", 480, "project"],
  [/\b(?:problem set|pset|worksheet|exercises|homework|questions|tutorial)s?\b/, "homework", 150, "homework"],
  [/\b(?:reading|chapters?)\b/, "reading", 120, "reading"],
  [/\b(?:assignment|coursework|task|work)s?\b/, "assignment", 180, "assignment"]
];
const SUBJECTS = ["computer science", "art history", "business studies", "physical education", "history", "english", "math", "maths", "mathematics", "physics", "chemistry", "biology", "economics", "business", "design", "engineering", "art", "music", "geography", "psychology", "statistics", "accounting", "marketing", "finance", "literature", "philosophy", "french", "spanish", "chinese", "mandarin", "cantonese", "japanese", "calculus", "algebra", "science", "sociology", "law", "media", "film", "drama", "ict", "it", "solidworks", "cad", "programming", "coding", "python"];
const UPPER = { ict: "ICT", it: "IT", cad: "CAD", solidworks: "SolidWorks", python: "Python" };
const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, "forty five": 45, ninety: 90, half: 0.5, couple: 2, few: 3 };
const WD = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MON = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const SESSION = 50, BREAK = 10, LONG_BREAK = 20;

export function sch() {
  S.school = S.school || {};
  const s = S.school;
  s.tasks = s.tasks || []; s.log = s.log || []; s.hours = s.hours || {};
  s.cap = s.cap || 240; s.window = s.window || { wk: 960, we: 600 };
  return s;
}
export const tasks = () => sch().tasks;
export const nonAcademic = text => /\b(?:gym|workout|fitness|shopping|grocer(?:y|ies)|cooking|recipes?|meals?|church|bible|prayer|bass|rehearsal|vitamins?)\b/i.test(text)
  && !/\b(?:school|college|university|course|class|homework|coursework)\b/i.test(text);
export const academic = text => !nonAcademic(text) && /\b(?:assignments?|homework|coursework|essays?|exams?|quizzes?|worksheets?|lab reports?|school (?:reports?|projects?|presentations?)|(?:math|physics|chemistry|history|english|solidworks|core subject|data analytics).*(?:projects?|reports?|presentations?))\b/i.test(text);
export const pending = () => tasks().filter(t => !t.done).sort((a, b) => (a.due + pad4(a.dueMin)).localeCompare(b.due + pad4(b.dueMin)));
const pad4 = n => String(n ?? 1439).padStart(4, "0");

// ---------- Parsing ----------
function dateIn(s, base) {
  const explicit = calendarDate(s, base);
  if (explicit) return explicit;
  let m;
  if (/\b(?:tomorrow|tmr|tmrw)\b/.test(s)) return addDays(base, 1);
  if (/\b(?:today|tonight|this evening)\b/.test(s)) return base;
  if ((m = s.match(/\bin (\d+|a|one|two|three|four|five|six|seven|ten) (days?|weeks?)\b/))) { const n = +m[1] || NUM[m[1]]; return addDays(base, /^w/.test(m[2]) ? n * 7 : n); }
  if (/\bend of (?:the |this )?week\b/.test(s)) return nextWd(base, 5, false);
  if (/\bnext week\b/.test(s) && !new RegExp("\\b(?:" + WD.join("|") + ")\\b").test(s)) return nextWd(base, 1, true);
  if ((m = s.match(new RegExp("\\b(this |next |on )?(" + WD.join("|") + ")\\b")))) return nextWd(base, WD.indexOf(m[2]), /next/.test(m[1] || ""));
  const mm = "(" + MON.join("|") + "|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)";
  if ((m = s.match(new RegExp("\\b" + mm + " (\\d{1,2})(?:st|nd|rd|th)?\\b"))) || (m = s.match(new RegExp("\\b(\\d{1,2})(?:st|nd|rd|th)? (?:of )?" + mm + "\\b")))) {
    const mon = isNaN(+m[1]) ? m[1] : m[2], dd = isNaN(+m[1]) ? +m[2] : +m[1];
    const mi = MON.findIndex(x => x.startsWith(mon.slice(0, 3)));
    return ymdNext(base, mi, dd);
  }
  if ((m = s.match(/\b(?:on )?the (\d{1,2})(?:st|nd|rd|th)\b/))) { const b = new Date(base + "T00:00"); let mi = b.getMonth(); if (+m[1] < b.getDate()) mi++; return ymdNext(base, mi % 12, +m[1]); }
  if ((m = s.match(/\b(\d{1,2})\/(\d{1,2})\b/))) return ymdNext(base, +m[2] - 1, +m[1]); // HK style day/month
  return null;
}
function nextWd(base, wd, next) {
  const d = new Date(base + "T00:00");
  let diff = (wd - d.getDay() + 7) % 7 || 7;
  if (next && diff < 7 && d.getDay() !== 0 && wd > d.getDay()) diff += 7;
  return addDays(base, diff);
}
function ymdNext(base, mi, dd) {
  const b = new Date(base + "T00:00");
  let y = b.getFullYear();
  if (new Date(y, mi, dd) < new Date(b.getFullYear(), b.getMonth(), b.getDate())) y++;
  return y + "-" + String(mi + 1).padStart(2, "0") + "-" + String(dd).padStart(2, "0");
}
export function timeIn(s) {
  if (/\bmidnight\b/.test(s)) return 1439;
  if (/\bnoon|midday\b/.test(s)) return 720;
  if (/\bend of (?:the )?day\b/.test(s)) return 1439;
  const m = s.match(/\b(?:at|by|before|for)\s+(\d{1,2})(?::(\d{2}))?\s?(am|pm|a\.m\.|p\.m\.)?\b/) || s.match(/\b(\d{1,2})(?::(\d{2}))?\s?(am|pm|a\.m\.|p\.m\.)\b/);
  if (!m) return null;
  let h = +m[1]; const mi = +(m[2] || 0); const ap = (m[3] || "").replace(/\./g, "");
  if (h > 23) return null;
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (!ap && h >= 1 && h <= 7) h += 12;
  return h * 60 + mi;
}
export function estIn(s) {
  const m = s.match(/\b(\d+(?:\.\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|thirty|forty five|forty|ninety|half an?|a couple of|a few|couple of|few)\s*(?:and a half\s*)?(hours?|hrs?|h|minutes?|mins?)\b/);
  if (!m) return null;
  let n = +m[1]; if (isNaN(n)) n = NUM[m[1].replace(/^a /, "").replace(/ of$/, "").replace(/^half an?$/, "half")] ?? 1;
  if (/and a half/.test(m[0])) n += 0.5;
  return Math.round(/^h/.test(m[2]) ? n * 60 : n);
}
function kindOf(s) { for (const [re, k, def] of KINDS) if (re.test(s)) return { k, def }; return null; }
function subjectOf(s) { for (const x of SUBJECTS) if ((x !== "it" || /\bit\s+(?:assignment|coursework|exam|project|class|subject)\b|\b(?:subject|course)\s+(?:is\s+)?it\b/.test(s)) && new RegExp("\\b" + x + "\\b").test(s)) return UPPER[x] || x.replace(/\b\w/g, c => c.toUpperCase()); return null; }
function titleOf(seg, kind, subj) {
  const exact = seg.replace(/^(?:(?:please|pg)\s+)*(?:(?:add|save|record)\s+(?:an?\s+)?|i\s+(?:have|have got)\s+(?:an?\s+)?)/, "")
    .split(/\s+(?:due|deadline|by)\b/)[0]
    .replace(/\s+(?:(?:on|this|next)\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.*$|\s+(?:from|at)\s+\d.*$/i, "")
    .replace(/[.!?]+$/, "").trim();
  if (/\b(?:assignment|homework|essay|report|project|test|exam|quiz|worksheet|presentation|coursework|paper|lab)s?\b/.test(exact))
    return exact.charAt(0).toUpperCase() + exact.slice(1);
  const noun = (seg.match(KINDS.find(k => k[1] === kind)[0]) || [kind])[0].replace(/s$/, "");
  let topic = (seg.match(/\b(?:on|about)\s+([a-z0-9' ]{3,40}?)(?=\s+(?:due|for|by|on|which|that|and|it)\b|$)/) || [])[1] || "";
  if (WD.some(w => topic.startsWith(w)) || /^(?:the \d|\d|tomorrow|today|next|this|a |an |one |two |three |four |five |half)|\b(?:hours?|minutes?|mins?|hrs?)\b/.test(topic)) topic = "";
  if (subj) return cap(`${subj} ${noun}${topic ? " on " + topic : ""}`);
  if (topic) return cap(`${noun} on ${topic}`);
  // fall back to the words before the type word ("my design history essay")
  const pre = seg.split(noun)[0].replace(/\b(?:i|have|got|ve|'ve|a|an|my|the|another|also|and|plus|there's|there is|need to|do|finish|submit|write|big|small|short|long|new|one|to)\b/g, " ").replace(/\s+/g, " ").trim();
  return cap((pre && pre.split(" ").length <= 3 ? pre + " " : "") + noun);
}

// Take a clause from what he said, with his own capitals, as the task's name
function nameFrom(raw, seg) {
  let x = seg.replace(/^(?:it'?s|it is|this is|that is|called|named|titled|the topic is|topic|about|on|which is|that's)\s+/, "").replace(/\s+(?:which|that|and it|it)(?:'s| is)?$/, "").trim();
  if (x.split(" ").length < 2 && x.length < 4) return "";
  const i = String(raw).toLowerCase().replace(/[“”"]/g, "").replace(/\s+/g, " ").indexOf(x);
  const orig = i >= 0 ? String(raw).replace(/[“”"]/g, "").replace(/\s+/g, " ").slice(i, i + x.length) : x;
  return orig.charAt(0).toUpperCase() + orig.slice(1);
}
// "I have a history essay due Friday at 5pm, about 3 hours, and a math test next Tuesday"
export function parse(raw, base = today()) {
  // "an assignment called Code AI is a tool for language learning due Monday"
  const called = String(raw).replace(/[“”"]/g, "").match(/\b(?:called|named|titled)\s+(.+?)(?=,|\s+(?:which |that |and )?(?:is |it's |it is )?(?:due|by|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|next|this|tomorrow)\b|[.!?]?$)/i);
  const t = String(raw).toLowerCase().replace(/[“”"]/g, "").replace(/\s+/g, " ").trim();
  const segs = t.split(/\s*(?:[;.!?]\s+|,\s*(?:and\s+|plus\s+|also\s+|then\s+)?|\s+and\s+(?=(?:a|an|my|the|another|also|then|i have|i've got|there's)\b)|\s+(?:also|plus|then)\s+)/).filter(Boolean);
  const out = [];
  for (const seg of segs) {
    const deadline = seg.match(/\b(?:due|deadline|by|submit|hand in)\b\s*(.*)/)?.[1];
    const studyRange = /\b(?:from\s+)?\d{1,2}(?::\d\d)?\s*(?:am|pm)?\s+(?:to|until|till)\s+\d/i.test(seg);
    const dateText = deadline ?? (studyRange ? "" : seg);
    const k = kindOf(seg), date = dateIn(dateText, base), tm = timeIn(dateText), est = estIn(seg), subj = subjectOf(seg);
    const isDur = est != null && !k && !date;
    if (isDur && out.length) { out.at(-1).est = est; continue; }
    if (k || (subj && date)) {
      const kind = k ? k.k : "assignment";
      const nm = !out.length && called && called[1].trim().length > 2 ? called[1].trim() : "";
      out.push({ title: nm ? (nm.charAt(0).toUpperCase() + nm.slice(1)).slice(0, 60) : titleOf(seg, kind, subj), named: !!nm, kind, due: date, dueMin: tm, est: est != null && !(est >= 600 && kind !== "project") ? est : null });
      continue;
    }
    // "an assignment, Code AI is a tool for language learning, due Monday": the plain clause is its name
    if (!k && !date && tm == null && est == null && out.length && !out.at(-1).named) {
      const name = nameFrom(raw, seg);
      if (name) { const o = out.at(-1); o.title = name.length > 60 ? name.slice(0, 57).replace(/\s+\S*$/, "") + "…" : name; o.named = true; }
      continue;
    }
    if ((date || tm != null) && out.length) { const o = out.at(-1); if (!o.due && date) o.due = date; if (o.dueMin == null && tm != null) o.dueMin = tm; if (est != null && o.est == null) o.est = est; }
  }
  const original = String(raw).replace(/[“”"]/g, "").replace(/\s+/g, " ");
  for (const task of out) {
    const at = original.toLowerCase().indexOf(task.title.toLowerCase());
    if (at >= 0) task.title = original.slice(at, at + task.title.length);
  }
  return out;
}
export const looksLikeSchool = raw => {
  const s = raw.toLowerCase();
  if (/^(?:(?:can|could) you |please |pg[, ]+)*(?:add|create|save|register|record)\b.*\b(?:assignment|homework|essay|report|exam|test|quiz)\b/.test(s)) return true;
  return /^(?:so |and |also |oh |okay |ok )*(?:i (?:have|'ve got|got|still have|need to do|need to finish)|i've got|there's) (?:a|an|my|another|one more|this|two|three|some)\b.*\b(?:essay|report|project|presentation|assignment|homework|problem set|lab report|coursework|paper|worksheet)s?\b/.test(s) && !/\b(?:at|from) \d/.test(s)
    || !!(/\b(?:due|deadline|submit|hand(?:ed)? in|turn(?:ed)? in)\b/.test(s) && kindOf(s)
    || /\b(?:exam|test|midterm|final|quiz)\b.*\b(?:on|next|this|tomorrow|in \d)/.test(s) && !/\b(?:at|from) \d{1,2}(?::\d\d)?\s?(?:am|pm)? (?:to|until|till|-)/.test(s));
};

// ---------- Learning ----------
// Your real pace vs your guesses. Starts at 1.5x (planning fallacy); after 2 finished tasks it uses yours.
export function ratio() {
  const xs = sch().log.filter(l => l.guess && l.actual).map(l => l.actual / l.guess);
  if (xs.length < 2) return { r: 1.5, learned: false, n: xs.length };
  const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
  return { r: Math.min(3, Math.max(1, Math.round(avg * 10) / 10)), learned: true, n: xs.length };
}
function kindAdj(kind) {
  const xs = sch().log.filter(l => l.kind === kind && l.actual && l.planned && !l.guess);
  if (!xs.length) return 1;
  return Math.min(2.5, Math.max(0.5, xs.reduce((a, l) => a + l.actual / l.planned, 0) / xs.length));
}
export function prefTime() {
  const s = sch();
  if (s.pref) return s.pref;
  const h = s.hours, tot = Object.values(h).reduce((a, b) => a + b, 0);
  if (tot < 4) return null;
  const eve = Object.entries(h).filter(([k]) => +k >= 17).reduce((a, [, v]) => a + v, 0);
  const morn = Object.entries(h).filter(([k]) => +k < 12).reduce((a, [, v]) => a + v, 0);
  return eve / tot >= 0.6 ? "evening" : morn / tot >= 0.6 ? "morning" : null;
}
export function noteDone(b) { const s = sch(); const h = Math.floor(b.start / 60); s.hours[h] = (s.hours[h] || 0) + 1; const t = s.tasks.find(x => x.id === b.tid); if (t) t.doneMin = (t.doneMin || 0) + (b.end - b.start); save(); }
export function setPref(p) { sch().pref = p; save(); }
export function setCap(min) { sch().cap = Math.max(60, Math.min(480, min)); save(); }
export function setWindow(min, which) { const w = sch().window; if (which !== "we") w.wk = min; if (which === "we") w.we = min; save(); }

// ---------- Tasks ----------
function planned(t) {
  if (t.guess) { const r = ratio(); return round15(t.guess * r.r); }
  return round15(t.def * kindAdj(t.kind));
}
const round15 = n => Math.max(SESSION, Math.round(n / 15) * 15);
export function add(list) {
  if (list.some(a => nonAcademic(a.title))) throw new Error("School is only for schoolwork. Tell me a day and time to add that personal activity to the timetable instead.");
  const s = sch(), added = [];
  list.forEach(a => {
    const k = KINDS.find(x => x[1] === a.kind) || KINDS.at(-1);
    const ex = s.tasks.find(t => !t.done && t.title.toLowerCase() === a.title.toLowerCase());
    if (ex) { Object.assign(ex, { due: a.due || ex.due, dueMin: a.dueMin ?? ex.dueMin, guess: a.est ?? ex.guess }); ex.plan = planned(ex); added.push(ex); return; }
    const t = { id: uid(), title: a.title, kind: a.kind, due: a.due, dueMin: a.dueMin, guess: a.est, def: k[2], doneMin: 0, done: false, made: today() };
    t.plan = planned(t);
    s.tasks.push(t); added.push(t);
  });
  save();
  return added;
}
export function find(q) {
  const w = String(q || "").toLowerCase().split(/\s+/).filter(x => x.length > 2 && !/^(?:the|my|assignment|homework|for|and|with)$/.test(x));
  let best = null, bs = 0;
  pending().concat(tasks().filter(t => t.done)).forEach(t => { const tt = (t.title + " " + t.kind).toLowerCase(); const sc = w.filter(x => tt.includes(x) || tt.includes(x.replace(/s$/, ""))).length; if (sc > bs) { bs = sc; best = t; } });
  return best;
}
export function finish(t) { t.done = true; t.doneOn = today(); clearFuture(t.id); save(); }
export function logActual(t, actual) {
  const s = sch();
  s.log.push({ kind: t.kind, guess: t.guess || null, planned: t.plan, actual, on: today() });
  save();
  const off = t.guess ? actual / t.guess : actual / t.plan;
  return off;
}
export function remove(id) { const s = sch(); s.tasks = s.tasks.filter(t => t.id !== id); clearFuture(id); save(); }
function clearFuture(tid) {
  const t0 = today(), n = nowMin();
  Object.entries(S.days).forEach(([d, v]) => { if (d < t0) return; v.blocks = v.blocks.filter(b => !((tid ? b.tid === tid : b.src === "school") && !b.done && (d > t0 || b.start >= n))); });
}

// ---------- Planning ----------
const late = () => Math.min((S.profile.dayEnd || 1380) - 60, 1350); // an hour before bed, never past 10:30 PM
const isWeekend = d => [0, 6].includes(new Date(d + "T00:00").getDay());
function studyLoad(d) { return day(d).blocks.filter(b => b.cat === "study" && !b.skipped).reduce((a, b) => a + (b.end - b.start), 0); }
function startOf(d) {
  const s = sch(), p = prefTime();
  let st = isWeekend(d) ? s.window.we : s.window.wk;
  if (p === "morning" && isWeekend(d)) st = Math.min(st, 540);
  if (p === "evening") st = Math.max(st, isWeekend(d) ? 840 : 1080);
  st = Math.max(st, S.profile.dayStart || 420);
  if (d === today()) st = Math.max(st, Math.ceil((nowMin() + 10) / 15) * 15);
  return st;
}
// Put one session into a day; leaves a short break after each session and a longer one after two in a row.
function placeSession(d, len, title, t, idx) {
  const blocks = day(d).blocks;
  const busy = blocks.map(b => ({ start: b.start - (b.src === "school" ? BREAK : 0), end: b.end + (b.src === "school" ? (runLen(blocks, b) >= 2 * SESSION ? LONG_BREAK : BREAK) : 0), skipped: b.skipped }));
  const s = firstGap(busy, startOf(d), len, late());
  if (s == null) return null;
  const b = { id: uid(), title, cat: "study", start: s, end: s + len, flex: true, done: false, date: d, src: "school", tid: t.id };
  blocks.push(b);
  return b;
}
function runLen(blocks, b) {
  let len = b.end - b.start, cur = b;
  for (;;) { const prev = blocks.find(x => x.src === "school" && x.end <= cur.start && cur.start - x.end <= BREAK + 1); if (!prev) break; len += prev.end - prev.start; cur = prev; }
  return len;
}

// Rebuild the study timetable for every unfinished assignment. Returns a summary for PG to say.
export function plan() {
  const s = sch(), t0 = today();
  clearFuture();
  const list = pending().filter(t => t.due && t.due >= t0);
  const res = { placed: [], short: [], tight: [], days: new Set(), undated: pending().filter(t => !t.due) };
  const left = new Map(list.map(t => [t.id, Math.max(0, (t.plan || planned(t)) - (t.doneMin || 0))]));
  const done = new Map(list.map(t => [t.id, 0]));
  const total = new Map(list.map(t => [t.id, Math.ceil(left.get(t.id) / SESSION)]));
  const name = (t, i, n) => t.kind === "exam" || t.kind === "quiz" ? `${t.title} · ${i === n ? "practice test" : "review " + i}` : `${t.title} · ${i}/${n}`;
  // pass 1: finish a day early, normal cap. pass 2: use the due day (before the deadline) and allow 1 extra hour.
  for (const pass of [1, 2]) {
    const lastDay = list.reduce((m, t) => t.due > m ? t.due : m, t0);
    for (let d = t0; d <= lastDay; d = addDays(d, 1)) {
      const capLeft = () => s.cap + (pass === 2 ? 60 : 0) - studyLoad(d);
      for (const t of list) {
        if (left.get(t.id) <= 0) continue;
        const target = pass === 1 ? (t.due > t0 ? addDays(t.due, -1) : t.due) : t.due;
        if (d > target) continue;
        if (d === t.due && pass === 2 && t.dueMin != null && t.dueMin < 600) continue;
        const daysLeft = Math.max(1, Math.round((new Date(target) - new Date(d)) / 864e5) + 1);
        const need = Math.ceil(left.get(t.id) / SESSION);
        let today_ = Math.min(pass === 1 ? 3 : 4, Math.max(1, Math.ceil(need / daysLeft)));
        while (today_-- > 0 && left.get(t.id) > 0 && capLeft() >= 30) {
          const len = Math.min(SESSION, Math.max(25, left.get(t.id)), capLeft());
          const i = done.get(t.id) + 1;
          const b = placeSession(d, len, name(t, i, total.get(t.id)), t, i);
          if (!b) break;
          if (d === t.due && t.dueMin != null && b.end > t.dueMin - 30) { day(d).blocks = day(d).blocks.filter(x => x.id !== b.id); break; }
          if (pass === 2) res.tight.includes(t) || res.tight.push(t);
          left.set(t.id, left.get(t.id) - len); done.set(t.id, i); res.placed.push(b); res.days.add(d);
        }
      }
    }
  }
  // fix numbering now that we know the real count
  list.forEach(t => {
    const bl = res.placed.filter(b => b.tid === t.id).sort((a, b) => (a.date + pad4(a.start)).localeCompare(b.date + pad4(b.start)));
    bl.forEach((b, i) => { b.title = name(t, i + 1, bl.length); });
    if (left.get(t.id) > 0) res.short.push({ t, min: left.get(t.id) });
  });
  save();
  return res;
}

// ---------- Talk ----------
const when = d => d === today() ? "today" : d === addDays(today(), 1) ? "tomorrow" : dayName(d);
const dueText = t => `${when(t.due)}${t.dueMin != null && t.dueMin < 1439 ? " at " + sayTime(t.dueMin) : ""}`;
export function whyTime(t) {
  const r = ratio();
  if (t.guess) return r.learned
    ? `You usually take ${r.r} times your guess, so I planned ${sayDur(t.plan)} instead of ${sayDur(t.guess)}.`
    : `You said ${sayDur(t.guess)}. Most people take longer than they think, so I planned ${sayDur(t.plan)}.`;
  return `${/^[aeiou]/.test(t.kind) ? "An" : "A"} ${t.kind} usually takes about ${sayDur(t.plan)}${kindAdj(t.kind) !== 1 ? " for you" : ""}.`;
}
export function addedBrief(added, res) {
  const head = added.length === 1 ? `Got it. ${added[0].title}, due ${dueText(added[0])}.` : `Got it, ${added.length} assignments. ${andList(added.map(t => `${t.title} due ${when(t.due)}`))}.`;
  const why = added.length === 1 ? " " + whyTime(added[0]) : "";
  return head + why + " " + planBrief(res);
}
export function planBrief(res) {
  if (!res.placed.length && !res.short.length) return res.undated.length ? `When is ${res.undated[0].title} due?` : "You have no assignments left. Tell me what's due and when.";
  const days = [...res.days].sort();
  const first = res.placed.slice().sort((a, b) => (a.date + pad4(a.start)).localeCompare(b.date + pad4(b.start)))[0];
  let out = `I spread ${res.placed.length} study session${res.placed.length > 1 ? "s" : ""} of about 50 minutes over ${days.length} day${days.length > 1 ? "s" : ""}, with breaks, and kept each day under ${sayDur(sch().cap)} of focus${res.tight.length ? "" : ". Everything finishes a day early"}.`;
  if (first) out += ` First up: ${first.title.split(" · ")[0]}, ${when(first.date)} at ${sayTime(first.start)}.`;
  if (res.tight.length) out += ` ${res.tight.map(t => t.title).join(" and ")} ${res.tight.length > 1 ? "are" : "is"} tight, so I used the due day too.`;
  if (res.short.length) out += ` Heads up: I couldn't fit ${res.short.map(x => `${sayDur(Math.round(x.min / 5) * 5)} of ${x.t.title}`).join(" or ")} before the deadline. Start now, free up time, or ask for an extension.`;
  if (res.undated.length) out += ` When is ${res.undated[0].title} due?`;
  return out;
}
export function brief() {
  const p = pending();
  if (!p.length) return "No assignments right now. Tell me what's due, like: I have a history essay due Friday.";
  const nx = upcomingStudy();
  return `${p.length} assignment${p.length > 1 ? "s" : ""}. Next due: ${p[0].title}, ${dueText(p[0])}.${nx ? ` Your next study session is ${nx.title.split(" · ")[0]}, ${when(nx.date)} at ${sayTime(nx.start)}.` : ""}`;
}
export function upcomingStudy() {
  const t0 = today(), n = nowMin();
  for (let i = 0; i < 30; i++) { const d = addDays(t0, i); const b = sortedBlocks(d).find(x => x.src === "school" && !x.done && (i > 0 || x.end > n)); if (b) return b; }
  return null;
}
export function sessionsOf(t) {
  const out = [];
  Object.entries(S.days).forEach(([d, v]) => v.blocks.forEach(b => { if (b.tid === t.id) out.push(b); }));
  return out.sort((a, b) => (a.date + pad4(a.start)).localeCompare(b.date + pad4(b.start)));
}
export function learnedLines() {
  const out = [], r = ratio(), p = prefTime();
  if (r.learned) out.push(`your assignments take about ${r.r} times what you guess`);
  if (p) out.push(`you study best in the ${p}`);
  if (sch().cap !== 240) out.push(`you want at most ${sayDur(sch().cap)} of study a day`);
  return out;
}

// ---------- Reality check for any day you planned yourself ----------
export function check(d) {
  const bl = sortedBlocks(d).filter(b => !b.skipped), issues = [];
  const study = bl.filter(b => b.cat === "study");
  const load = study.reduce((a, b) => a + (b.end - b.start), 0);
  if (load > sch().cap + 30) issues.push(`${sayDur(load)} of study is more than your brain can use well. Gains level off around 4 hours a day`);
  const long = study.find(b => b.end - b.start > 120);
  if (long) issues.push(`${long.title} runs ${sayDur(long.end - long.start)} straight. Breaks every 50 minutes or so keep you fresh`);
  const lateB = bl.find(b => b.end > (S.profile.dayEnd || 1380) && b.cat !== "sleep");
  if (lateB) issues.push(`${lateB.title} goes until ${sayTime(lateB.end)}, which cuts into sleep`);
  let packed = 0; for (let i = 1; i < bl.length; i++) if (bl[i].start - bl[i - 1].end <= 0) packed++;
  if (packed >= 5) issues.push(`there are no gaps between ${packed + 1} things, so one delay breaks the whole day`);
  return issues;
}
// Make a day realistic: split long study into 50-minute sessions with breaks, move overflow and late study to other days.
export function fix(d) {
  const blocks = day(d).blocks, moved = [];
  const study = blocks.filter(b => b.cat === "study" && !b.done).sort((a, b) => a.start - b.start);
  let changed = 0;
  // 1) split
  study.forEach(b => {
    const len = b.end - b.start;
    if (len <= 120) return;
    const parts = Math.ceil(len / SESSION);
    day(d).blocks = day(d).blocks.filter(x => x.id !== b.id);
    for (let i = 0; i < parts; i++) {
      const plen = Math.min(SESSION, len - i * SESSION);
      day(d).blocks.push({ ...b, id: uid(), title: `${b.title.split(" · ")[0]} · ${i + 1}/${parts}`, start: 0, end: plen, flex: true, _place: true });
    }
    changed++;
  });
  // 2) re-place split pieces with breaks, starting where the original began
  const pieces = day(d).blocks.filter(b => b._place);
  const first = study.length ? study[0].start : startOf(d);
  let cursor = first, run = 0;
  pieces.forEach(p => {
    day(d).blocks = day(d).blocks.filter(x => x.id !== p.id);
    const len = p.end - p.start;
    const s = firstGap(day(d).blocks, cursor, len, late());
    delete p._place;
    if (s == null) { moved.push(p); return; }
    p.start = s; p.end = s + len; day(d).blocks.push(p);
    run += len; cursor = p.end + (run >= 2 * SESSION ? (run = 0, LONG_BREAK) : BREAK);
  });
  // 3) cap and sleep: anything over the cap or past the late line moves to the next free day
  let load = 0;
  day(d).blocks.filter(b => b.cat === "study" && !b.done).sort((a, b) => a.start - b.start).forEach(b => {
    load += b.end - b.start;
    if (load > sch().cap || b.end > late()) { day(d).blocks = day(d).blocks.filter(x => x.id !== b.id); moved.push(b); }
  });
  const placedTo = [];
  moved.forEach(b => {
    const len = b.end - b.start;
    const tk = b.tid && tasks().find(t => t.id === b.tid);
    for (let i = 1; i <= 7; i++) {
      const nd = addDays(d, i);
      if (tk && tk.due && nd >= tk.due) break;
      if (studyLoad(nd) + len > sch().cap) continue;
      const s = firstGap(day(nd).blocks, startOf(nd), len, late());
      if (s == null) continue;
      day(nd).blocks.push({ ...b, id: uid(), start: s, end: s + len, date: nd, flex: true });
      placedTo.push(nd); break;
    }
  });
  save();
  return { split: changed, moved: moved.length, to: [...new Set(placedTo)].map(when) };
}
export const fmt = { when, dueText, time: fmtTime };

function andList(a) { return a.length < 2 ? (a[0] || "") : a.slice(0, -1).join(", ") + " and " + a.at(-1); }

export function facts() {
  const out = [], r = ratio(), p = prefTime(), s = sch();
  if (r.learned) out.push({ k: "pace", t: `Your assignments usually take about ${r.r} times what you first guess. I worked this out from ${r.n} finished assignments, so I plan with your real pace.` });
  if (p) out.push({ k: "study_time", t: `You study best in the ${p}${s.pref ? ", you told me" : ", from when you actually finish your sessions"}.` });
  if (s.cap !== 240) out.push({ k: "study_cap", t: `You want at most ${sayDur(s.cap)} of study a day.` });
  if (s.window.wk !== 960) out.push({ k: "study_start", t: `On school days you like to start studying around ${fmtTime(s.window.wk)}.` });
  if (s.window.we !== 600) out.push({ k: "study_start_we", t: `On weekends you like to start studying around ${fmtTime(s.window.we)}.` });
  const kinds = {}; s.log.filter(l => l.actual && l.kind).forEach(l => { (kinds[l.kind] = kinds[l.kind] || []).push(l.actual); });
  Object.entries(kinds).forEach(([k, xs]) => { if (xs.length >= 2) out.push({ k: "kind_" + k, t: `${k.charAt(0).toUpperCase() + k.slice(1)}s take you about ${sayDur(Math.round(xs.reduce((a, b) => a + b, 0) / xs.length / 15) * 15)} in total.` }); });
  return out;
}
