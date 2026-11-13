// Bible reading plans: pick a book, read up to N chapters a day, track verses read.
import { BOOKS } from "./bibledata.js";
import { S, save } from "./store.js";
import { today, addDays } from "./util.js";

export { BOOKS };
const ORD = { first: "1", second: "2", third: "3", "1st": "1", "2nd": "2", "3rd": "3", one: "1", two: "2", three: "3", i: "1", ii: "2", iii: "3" };
const ALIAS = { psalm: "Psalms", "song of songs": "Song of Solomon", songs: "Song of Solomon", revelations: "Revelation", "the revelation": "Revelation", phil: "Philippians", eph: "Ephesians", rom: "Romans", gen: "Genesis", matt: "Matthew", prov: "Proverbs", heb: "Hebrews", gal: "Galatians", col: "Colossians", isa: "Isaiah", jer: "Jeremiah", ecc: "Ecclesiastes", deut: "Deuteronomy" };
const KEYS = (() => {
  const k = [];
  BOOKS.forEach(([n], i) => k.push([n.toLowerCase(), i]));
  Object.entries(ALIAS).forEach(([a, n]) => k.push([a, BOOKS.findIndex(b => b[0] === n)]));
  return k.sort((a, b) => b[0].length - a[0].length);
})();

const NW = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50 };
export function prep(t) {
  t = " " + String(t || "").toLowerCase().replace(/[.,!?]/g, " ") + " ";
  t = t.replace(/\b(first|second|third|1st|2nd|3rd)\s+(?=(samuel|kings|chronicles|corinthians|thessalonians|timothy|peter|john)\b)/g, (_, o) => ORD[o] + " ");
  t = t.replace(/\b(twenty|thirty|forty|fifty) (one|two|three|four|five|six|seven|eight|nine)\b/g, (_, a, b) => String(NW[a] + NW[b]));
  t = t.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty)\b/g, w => NW[w]);
  t = t.replace(/\b(\d+)\s+(?:through|thru|until|till|-)\s+(\d+)\b/g, "$1 to $2").replace(/(\d)-(\d)/g, "$1 to $2");
  return t.replace(/\s+/g, " ");
}
export function findBook(t) {
  t = prep(t);
  for (const [k, i] of KEYS) {
    const re = new RegExp(`(?:^|\\s)${k.replace(/ /g, "\\s")}(?=\\s|$)`);
    if (re.test(t)) {
      // "John" shouldn't win over "1 John" etc.; longer keys come first so this holds
      return i;
    }
  }
  return -1;
}
export const bookName = i => BOOKS[i][0];
const chs = i => BOOKS[i][1];
export const totalVerses = i => chs(i).reduce((a, b) => a + b, 0);
// Absolute verse index (verses read) for position {ch, v} where v = last verse read in ch
const abs = (i, p) => chs(i).slice(0, p.ch - 1).reduce((a, b) => a + b, 0) + p.v;
const fromAbs = (i, n) => { const c = chs(i); let ch = 1; while (ch <= c.length && n > c[ch - 1]) { n -= c[ch - 1]; ch++; } if (ch > c.length) return { ch: c.length, v: c[c.length - 1] }; return { ch, v: n }; };

export function bible() {
  if (!S.bible) S.bible = { plan: null, max: 3, version: "NKJV", history: [] };
  return S.bible;
}
export function setPlan(bookIdx, max) {
  const b = bible();
  if (max) b.max = max;
  if (b.plan && !b.plan.finished) b.history.push(b.plan);
  b.plan = { book: bookIdx, start: today(), read: 0, log: [], day: { date: today(), from: 0 }, finished: false };
  save();
  return b.plan;
}
export function setMax(n) { bible().max = Math.max(1, Math.min(50, n)); save(); }

function dayStart() {
  const p = bible().plan;
  if (!p) return 0;
  if (!p.day || p.day.date !== today()) p.day = { date: today(), from: p.read };
  return p.day.from;
}
// Today's reading: from day start, up to max chapters (a partly read chapter counts as one)
export function todays() {
  const b = bible(), p = b.plan; if (!p) return null;
  const from = dayStart(), i = p.book, tot = totalVerses(i);
  if (from >= tot) return { done: true, i };
  const s = fromAbs(i, from + 1); // first verse to read
  const endCh = Math.min(chs(i).length, s.ch + b.max - 1);
  const endAbs = abs(i, { ch: endCh, v: chs(i)[endCh - 1] });
  return { i, s, endCh, endAbs, doneToday: p.read >= endAbs, left: Math.max(0, endAbs - p.read) };
}
export function refText(r) {
  if (!r || r.done) return "";
  const n = bookName(r.i);
  if (r.s.v > 1) return `${n} ${r.s.ch}:${r.s.v}–${r.endCh === r.s.ch ? chs(r.i)[r.s.ch - 1] : r.endCh + ":" + chs(r.i)[r.endCh - 1]}`;
  return r.endCh === r.s.ch ? `${n} ${r.s.ch}` : `${n} ${r.s.ch}–${r.endCh}`;
}
export function link(ref) { return `https://www.biblegateway.com/passage/?search=${encodeURIComponent(ref)}&version=${bible().version || "NKJV"}`; }

export function stats() {
  const b = bible(), p = b.plan; if (!p) return null;
  const tot = totalVerses(p.book), nCh = chs(p.book).length;
  const pos = fromAbs(p.book, p.read);
  const chDone = p.read >= tot ? nCh : (pos.v >= chs(p.book)[pos.ch - 1] ? pos.ch : pos.ch - 1);
  const chLeft = nCh - chDone;
  const daysLeft = Math.ceil(chLeft / b.max);
  return { book: bookName(p.book), read: p.read, tot, pct: Math.round(p.read / tot * 100), chDone, nCh, chLeft, daysLeft, finish: addDays(today(), Math.max(0, daysLeft - 1)), pos, finished: p.read >= tot };
}

// Parse "I read Ephesians 1 to 2", "up to chapter 2 verse 10", "I read 30 verses", "2 chapters", "today's reading"
export function parseRead(raw) {
  const t = prep(raw);
  if (/\b(?:today'?s (?:reading|chapters|portion)|(?:all|everything) (?:for today|of it|you gave me)|my reading|the reading)\b/.test(t)) return { kind: "today" };
  if (/\b(?:whole|entire|the rest of the) book\b|\bfinished (?:the book|reading)\b/.test(t)) return { kind: "book" };
  let m;
  if ((m = t.match(/\b(\d+)\s*:\s*(\d+)\b/))) return { kind: "to", ch: +m[1], v: +m[2] };
  if ((m = t.match(/\bchapter (\d+)(?: and)? verses? (?:\d+ to )?(\d+)\b/))) return { kind: "to", ch: +m[1], v: +m[2] };
  if ((m = t.match(/\bverses? (?:\d+ to )?(\d+) (?:of|in) (?:chapter )?(\d+)\b/))) return { kind: "to", ch: +m[2], v: +m[1] };
  if ((m = t.match(/\b(\d+) verses?\b/))) return { kind: "verses", n: +m[1] };
  if ((m = t.match(/\bverses? (?:\d+ to )?(\d+)\b/))) return { kind: "toV", v: +m[1] };
  if ((m = t.match(/\b(\d+) (?:more )?chapters?\b/)) && !/\bchapters? \d/.test(t)) return { kind: "chapters", n: +m[1] };
  if ((m = t.match(/\bchapters? (\d+)(?: to| and|,) (\d+)\b/)) || (m = t.match(/\b[a-z]+ (\d+) to (\d+)\b/))) return { kind: "toCh", ch: Math.max(+m[1], +m[2]) };
  if ((m = t.match(/\b(?:up to|through|until|finished|done with|completed?)? ?chapter (\d+)\b/)) || (m = t.match(/\b[a-z]+ (\d+)\b(?!\s*(?:am|pm|minutes?|hours?))/))) return { kind: "toCh", ch: +m[1] };
  return null;
}
export function record(r) {
  const b = bible(), p = b.plan; if (!p || !r) return null;
  const i = p.book, tot = totalVerses(i), c = chs(i);
  const before = p.read; let n = before;
  const pos = fromAbs(i, before);
  const curCh = before === 0 ? 1 : (pos.v >= c[pos.ch - 1] ? Math.min(c.length, pos.ch + 1) : pos.ch);
  if (r.kind === "today") { const td = todays(); n = td && !td.done ? td.endAbs : tot; }
  if (r.kind === "book") n = tot;
  if (r.kind === "to") { const ch = Math.min(c.length, Math.max(1, r.ch)); n = abs(i, { ch, v: Math.min(r.v, c[ch - 1]) }); }
  if (r.kind === "toV") n = abs(i, { ch: curCh, v: Math.min(r.v, c[curCh - 1]) });
  if (r.kind === "toCh") { const ch = Math.min(c.length, Math.max(1, r.ch)); n = abs(i, { ch, v: c[ch - 1] }); }
  if (r.kind === "verses") n = before + r.n;
  if (r.kind === "chapters") { const ch = Math.min(c.length, curCh + r.n - 1); n = abs(i, { ch, v: c[ch - 1] }); }
  n = Math.max(0, Math.min(tot, n));
  if (n < before && r.kind !== "to" && r.kind !== "toCh") n = before;
  p.read = n;
  p.log.push({ date: today(), from: before, to: n });
  if (n >= tot) p.finished = today();
  save();
  return { added: n - before, ...stats() };
}

export const STUDY = [
  { t: "Pray", d: "Ask God to open your eyes to what you read." },
  { t: "Read", d: "Read slowly. Read it twice if you can." },
  { t: "Observe", d: "What does it say? Note the words and promises that stand out." },
  { t: "Apply", d: "What does it mean for you today?" },
  { t: "Save it", d: "Tell PG anything God shows you. Say: save a revelation, then say it." }
];

export function brief() {
  const b = bible();
  if (!b.plan) return "You don't have a reading plan yet. Tell me which book you want to read, for example: my plan is to read Ephesians.";
  const s = stats(), td = todays();
  if (s.finished) return `You've finished ${s.book}. Tell me the next book you want to read.`;
  if (td.doneToday) return `You've done today's reading in ${s.book}. You're ${s.pct}% through. ${s.chLeft} ${s.chLeft === 1 ? "chapter" : "chapters"} left.`;
  return `Today's reading is ${refText(td)}. You're ${s.pct}% through ${s.book}, with ${s.chLeft} ${s.chLeft === 1 ? "chapter" : "chapters"} left. At ${b.max} a day you'll finish ${s.daysLeft <= 1 ? "today" : "in " + s.daysLeft + " days"}.`;
}
