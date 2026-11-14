// PG's memory of you: revelations, lessons and notes, sorted into folders and searchable.
import { S, save } from "./store.js";
import { today, uid } from "./util.js";
import { findBook, bookName, prep } from "./bible.js";

export const FOLDERS = {
  about:     { label: "Learned things about PraiseGod", short: "About PraiseGod", color: "#D9B36C" },
  spiritual: { label: "Spiritual", color: "#C9A45C" },
  bass:      { label: "Bass",      color: "#B592E0" },
  fitness:   { label: "Fitness",   color: "#E08A6D" },
  learning:  { label: "Learning",  color: "#7CC4A4" },
  life:      { label: "Life",      color: "#8FB0E0" }
};
const KW = {
  spiritual: /\b(god|jesus|christ|lord|holy spirit|spirit|faith|pray\w*|grace|church|scripture|bible|gospel|worship|sin|salvation|saved|heaven|kingdom|revelation|blessed?|bless\w*|psalm|verse|pastor|sermon|fasting|holy|righteous\w*|mercy|love of god|father|anoint\w*|apostle|amen|word of god|devotion\w*|ministry|testimony)\b/,
  bass: /\b(bass|groove|fret\w*|pluck\w*|slap|scales?|chords?|metronome|bpm|riffs?|pocket|band|songs?|music|rhythm|tempo|mut\w*|strings?|pickup|thumb|tuning|tune)\b/,
  fitness: /\b(gym|workout|lift\w*|squat|bench|protein|muscle|cardio|run\w*|reps?|sets?|diet|sleep|stretch\w*)\b/,
  learning: /\b(study|studying|exam|class|course|solidworks|code|coding|math|physics|engineering|learn\w*|lecture|homework|cad)\b/
};
// Facts about you, e.g. "I prefer studying at night", "my favourite food is jollof"
const ABOUT = /^(?:i(?:'m| am)? (?:like|love|enjoy|hate|dislike|prefer|usually|always|never|can't|cannot|don't|do not|am allergic|'m allergic|am a |'m a |am from|'m from|live|work|go to|study at|wake|sleep|get up|feel best|focus best|learn best)|my (?:favou?rite|birthday|goal|dream|name|school|major|course|church|teacher|coach|band|family|mum|mom|dad|brother|sister|friend|weakness|strength))\b/;
export function classify(text, hint) {
  if (hint && FOLDERS[hint]) return hint;
  const t = text.toLowerCase();
  if (findBook(t) >= 0 && /\d/.test(t)) return "spiritual";
  if (ABOUT.test(t) && !KW.spiritual.test(t)) return "about";
  for (const f of ["spiritual", "bass", "fitness", "learning"]) if (KW[f].test(t)) return f;
  return "life";
}
// Scripture references mentioned in the text, e.g. "Ephesians 2:8"
export function refsIn(text) {
  const t = prep(text), out = [];
  const m = t.match(/\b((?:[123] )?[a-z]+(?: of [a-z]+)?) (\d+)(?: ?: ?(\d+))?/g) || [];
  m.forEach(s => { const i = findBook(s); if (i >= 0) { const n = s.match(/(\d+)(?: ?: ?(\d+))?\s*$/); if (n) out.push(bookName(i) + " " + n[1] + (n[2] ? ":" + n[2] : "")); } });
  return [...new Set(out)];
}

export function notes() { if (!S.notes) S.notes = []; return S.notes; }
export function add(text, opts = {}) {
  text = String(text).trim().replace(/^[:,\s-]+/, "");
  text = text.charAt(0).toUpperCase() + text.slice(1);
  const n = { id: uid(), text, folder: classify(text, opts.folder), refs: refsIn(text), ctx: opts.ctx || "", date: today(), ts: Date.now() };
  if (opts.ctx && !n.refs.length && n.folder === "spiritual") n.refs = [opts.ctx];
  notes().unshift(n); save();
  return n;
}
export function remove(id) { const n = notes().find(x => x.id === id); if (n && n.key) hidden().push(n.key); S.notes = notes().filter(n => n.id !== id); save(); }
export function update(id, text) { const n = notes().find(x => x.id === id); if (n) { n.text = text; n.folder = classify(text); n.refs = refsIn(text).length ? refsIn(text) : n.refs; save(); } }

// ---- Retrieval ----
const STOP = new Set("a an the and or but if of to in on at for with by from is are was were be been am i me my mine you your we our it its this that these those what which who whom how why when where should can could would will do does did have has had about into than then so not no yes just also there here learn learned learnt taught teach know tell remind say said thing things something anything pg please today time".split(" "));
const SYN = { worry: ["anxious", "anxiety", "fear", "afraid", "stress"], anxious: ["worry", "anxiety", "fear"], fear: ["afraid", "worry", "anxious"], money: ["finance", "finances", "giving", "tithe", "provision"], pray: ["prayer", "praying"], prayer: ["pray"], faith: ["believe", "trust"], trust: ["faith"], love: ["loving", "loved"], forgive: ["forgiveness", "forgiving"], tired: ["rest", "weary"], sad: ["joy", "hope", "comfort"], purpose: ["calling", "destiny"] };
const stem = w => w.replace(/(?:ing|ed|es|ly|s)$/, "").replace(/e$/, "").replace(/(.)\1$/, "$1");
const words = t => prep(t).split(/[^a-z0-9']+/).filter(w => w.length > 2 && !STOP.has(w));
export function search(q, limit = 3, folder) {
  const qs = new Set(); words(q).forEach(w => { qs.add(stem(w)); (SYN[w] || []).forEach(s => qs.add(stem(s))); });
  const bi = findBook(q), book = bi >= 0 ? bookName(bi) : null;
  const all = notes().filter(n => !folder || n.folder === folder);
  if (!qs.size && !book) return [];
  const df = {}; all.forEach(n => new Set(words(n.text).map(stem)).forEach(w => { df[w] = (df[w] || 0) + 1; }));
  const N = all.length || 1;
  return all.map(n => {
    const ws = words(n.text + " " + n.refs.join(" ")).map(stem);
    let sc = 0; qs.forEach(w => { const hit = ws.filter(x => x === w || (w.length > 4 && x.startsWith(w.slice(0, 5)))).length; if (hit) sc += (1 + Math.log(N / (df[w] || 1))) * Math.min(2, hit); });
    if (book && n.refs.some(r => r.startsWith(book))) sc += 3;
    return { n, sc };
  }).filter(x => x.sc >= 1).sort((a, b) => b.sc - a.sc || b.n.ts - a.n.ts).slice(0, limit).map(x => x.n);
}
export const fmtDate = d => new Date(d + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
export function answer(q, found) {
  if (!found.length) return null;
  const [a, ...rest] = found;
  let t = `You taught me this on ${fmtDate(a.date)}: “${a.text}”${a.refs.length && !a.text.includes(a.refs[0]) ? ` (${a.refs[0]})` : ""}.`;
  if (rest.length) t += ` You also noted: “${rest[0].text}”.`;
  if (!/^(?:what did i|what have i|remind me)/i.test(q.trim())) t += " Hold on to that and apply it here.";
  return t;
}
export function counts() { const c = {}; notes().forEach(n => { c[n.folder] = (c[n.folder] || 0) + 1; }); return c; }

// ---- Learned things about PraiseGod: PG writes these itself ----
export const facts = () => notes().filter(n => n.folder === "about");

// Clear autobiographical statements are saved before asking the language model.
// A call ending, model failure, or short conversation window cannot erase them.
export function capturePersonal(raw) {
  const text = String(raw || "").trim().replace(/[.!]+$/, "");
  if (/\?|\b(?:if|suppose|imagine|pretend|for example|what if)\b/i.test(text)) return null;
  let t = text.replace(/^(?:(?:pg|sir|okay|ok|also|and|by the way)[, ]+)+/i, "");
  t = t.replace(/^(?:remember (?:that )?|please remember (?:that )?|actually[, ]+)/i, "");
  let fact = "";
  if (/^i (?:love|am in love with) (?:someone|her|him|them)$/i.test(t)) {
    S.personalPending = { relation: "love", at: Date.now() }; save(); return null;
  }
  const name = t.match(/^(?:(?:his|her|their) name is|(?:she|he) is called|the person is) ([a-z][a-z '-]{1,70})$/i);
  if (name && S.personalPending?.relation === "love" && Date.now() - S.personalPending.at < 3600000) {
    fact = "You love " + name[1]; delete S.personalPending;
  } else if (/^i (?:love|am in love with|have a crush on|like|enjoy|hate|dislike|prefer|live in|live at|study at|work at|am allergic to|don't eat|do not eat|usually|always)\b/i.test(t)
      && !/\b(?:right now|today|tonight|this morning)\b/i.test(t)
      && !/^i (?:love|like|prefer) to (?:know|ask|see|hear|find out)\b/i.test(t)) {
    fact = t.replace(/^i don't /i, "You don't ").replace(/^i do not /i, "You do not ")
      .replace(/^i am /i, "You are ").replace(/^i /i, "You ");
  } else if (/^my (?:name|birthday|school|church|mother|father|mum|mom|dad|brother|sister|friend|girlfriend|boyfriend|partner|wife|husband|favou?rite)\b/i.test(t)) {
    fact = t.replace(/^my /i, "Your ");
  }
  if (!fact || /^You (?:love|like) (?:someone|her|him|them|you)$/i.test(fact)) return null;
  fact = fact.slice(0, 600).replace(/\b(?:someone|a (?:girl|boy|person)) (?:named|called|whose name is) /i, "");
  const old = facts().find(n => n.text.replace(/[.!]+$/, "").toLowerCase() === fact.toLowerCase());
  return old || add(fact + ".", { folder: "about" });
}
export function personalAnswer(question) {
  if (/\bwho (?:do|am) i (?:love|in love with)\b/i.test(question)) {
    const fact = facts().find(n => /^You (?:love|are in love with) /i.test(n.text) && !/\b(?:someone|her|him|them)\.?$/i.test(n.text));
    if (fact) return fact.text;
  }
  return null;
}
function hidden() { S.factsHidden = S.factsHidden || []; return S.factsHidden; }
// Write or update one thing PG learned. Same key = same fact, so it updates instead of repeating.
export function learnFact(key, text) {
  if (hidden().includes(key)) return null;
  let n = notes().find(x => x.key === key);
  if (n) { if (n.text === text) return n; n.text = text; n.date = today(); n.ts = Date.now(); n.updated = true; }
  else { n = { id: uid(), key, text, folder: "about", refs: [], ctx: "", by: "pg", date: today(), ts: Date.now() }; notes().unshift(n); }
  save(); return n;
}
// Keep PG's facts in step with what it currently knows. Your own notes are never touched.
export function syncFacts(list) {
  const keys = new Set(list.map(f => f.k));
  let changed = false;
  list.forEach(f => { const before = notes().find(x => x.key === f.k)?.text; learnFact(f.k, f.t); if (before !== f.t) changed = true; });
  const stale = notes().filter(n => n.by === "pg" && n.key && !keys.has(n.key));
  if (stale.length) { S.notes = notes().filter(n => !stale.includes(n)); save(); changed = true; }
  return changed;
}
