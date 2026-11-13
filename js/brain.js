// PG's memory of you: revelations, lessons and notes, sorted into folders and searchable.
import { S, save } from "./store.js";
import { today, uid } from "./util.js";
import { findBook, bookName, prep } from "./bible.js";

export const FOLDERS = {
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
export function classify(text, hint) {
  if (hint && FOLDERS[hint]) return hint;
  const t = text.toLowerCase();
  if (findBook(t) >= 0 && /\d/.test(t)) return "spiritual";
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
export function remove(id) { S.notes = notes().filter(n => n.id !== id); save(); }
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
