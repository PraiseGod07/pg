import { looksLikeSchool, estIn } from "./school.js";
// PG language understanding: wake word, intents, and spoken-schedule parsing.
// Works fully on-device. Built for messy speech-to-text (no punctuation, mis-heard words, wrong AM/PM).
import { DEFAULT_MIN } from "./library.js";

// ---------- Wake word ----------
// Speech engines hear "Hi PG" many ways. Accept common variants, but only after a greeting word.
const WAKE_RE = /\b(?:hi|hey|hay|high|hiya|okay|ok|hello|yo|oi)[\s,.!]*(?:pg|p\.?\s?g\.?|pee\s?gee|pea\s?gee|pj|p\.?\s?j\.?|bg|b\.?\s?g\.?|petey|pg's|pgs|pidgey|piji|pee\s?jay)(?=$|[\s,.!?])/i;
export function findWake(text) {
  const m = text.match(WAKE_RE);
  if (!m) return null;
  return { index: m.index, end: m.index + m[0].length, after: text.slice(m.index + m[0].length).replace(/^[\s,.!?]+/, "") };
}
export const stripWake = t => t.replace(WAKE_RE, " ").replace(/\s+/g, " ").trim();

// ---------- Normalisation ----------
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const MINW = { "o five": 5, oh: 0, ten: 10, fifteen: 15, twenty: 20, "twenty five": 25, thirty: 30, "thirty five": 35, forty: 40, "forty five": 45, fifty: 50, "fifty five": 55 };
const DURW = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, "forty five": 45, fortyfive: 45, ninety: 90, couple: 2, "a couple of": 2, "a couple": 2, few: 3 };

export function normalize(raw) {
  let t = " " + String(raw || "").toLowerCase() + " ";
  t = t.replace(/[“”"]/g, " ").replace(/[’`]/g, "'");
  t = t.replace(/\b([ap])\s?\.\s?m\b\.?/g, "$1m");             // a.m. p.m.
  t = t.replace(/(\d)\s?([ap])m\b/g, "$1 $2m");
  t = t.replace(/\b(\d{1,2})\.(\d{2})\b(?!\s*(?:hours?|hrs?))/g, "$1:$2"); // 8.30 -> 8:30
  t = t.replace(/\b(\d{1,2}):00\b/g, "$1:00");
  t = t.replace(/\bo'?\s?clock\b/g, " ");
  // Word times: "half past eight", "quarter to nine", "eight thirty"
  const nw = Object.keys(NUM).join("|");
  t = t.replace(new RegExp(`\\bhalf past (${nw}|\\d{1,2})\\b`, "g"), (_, h) => (NUM[h] || h) + ":30");
  t = t.replace(new RegExp(`\\bquarter past (${nw}|\\d{1,2})\\b`, "g"), (_, h) => (NUM[h] || h) + ":15");
  t = t.replace(new RegExp(`\\bquarter to (${nw}|\\d{1,2})\\b`, "g"), (_, h) => { const n = (NUM[h] || +h) - 1 || 12; return n + ":45"; });
  t = t.replace(new RegExp(`\\b(${nw}) (o five|thirty five|forty five|fifty five|twenty five|fifteen|twenty|thirty|forty|fifty)\\b`, "g"), (_, h, m) => NUM[h] + ":" + String(MINW[m]).padStart(2, "0"));
  t = t.replace(new RegExp(`\\b(at|from|to|until|till|by|around|between|and) (${nw})\\b`, "g"), (_, p, h) => p + " " + NUM[h]);
  t = t.replace(new RegExp(`\\b(${nw}) ?(am|pm)\\b`, "g"), (_, h, ap) => NUM[h] + " " + ap);
  t = t.replace(/\b(to|till|til|until|through|and|-)\s+midnight\b/g, "$1 24:00");
  t = t.replace(/\bnoon\b|\bmidday\b/g, "12 pm").replace(/\bmidnight\b/g, "12 am");
  // Day-part words become am/pm markers on the preceding time
  t = t.replace(/(\d)\s+(?:in the morning|this morning)\b/g, "$1 am");
  t = t.replace(/(\d)\s+(?:in the afternoon|this afternoon|in the evening|this evening|at night|tonight)\b/g, "$1 pm");
  // Durations in words
  t = t.replace(/\b(?:an |one )?hour and (?:a )?half\b/g, "90 minutes");
  t = t.replace(/\b(\d+) and (?:a )?half hours?\b/g, (_, n) => (+n * 60 + 30) + " minutes");
  t = t.replace(/\bhalf (?:an |a )?hour\b/g, "30 minutes");
  t = t.replace(/\b(?:a )?quarter of an hour\b/g, "15 minutes");
  t = t.replace(/\b(a couple of|a couple|couple of|a few|few|an|a|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty five|forty|ninety)\s+(hours?|hrs?|minutes?|mins?)\b/g,
    (_, n, u) => (DURW[n.replace(/ of$/, "")] ?? DURW[n] ?? 1) + " " + u);
  t = t.replace(/(\d+(?:\.\d+)?)\s*(?:hrs?|h)\b/g, "$1 hours").replace(/(\d+)\s*mins?\b/g, "$1 minutes");
  // Common mis-hearings
  t = t.replace(/\bsolid ?works?\b/g, "solidworks");
  t = t.replace(/\b(?:i'?ve |i have |i got |i'?ll have )?(?:based|base|bassist|bas|bus) (lessons?|practice|class|session|guitar)\b/g, "i have bass $1");
  t = t.replace(/\bbible study\b|\bbible studies\b/g, "bible study");
  t = t.replace(/\b(?:work|walking|walk|working)\s+(?:back\s+)?(?:to|2)\s+(my\s+|the\s+)?(dorm|room|hostel|apartment|flat|house|home|place|residence|hall)\b/g, "walk to my $2");
  t = t.replace(/\bpool day\b/g, "pull day").replace(/\bpole day\b/g, "pull day").replace(/\bpush they\b/g, "push day");
  t = t.replace(/\bband (?:practise|practice)\b/g, "band practice").replace(/\bpractise\b/g, "practice");
  t = t.replace(/\bgonna\b/g, "going to").replace(/\bwanna\b/g, "want to").replace(/\bgotta\b/g, "have to");
  // Fillers
  t = t.replace(/\b(?:um+|uh+|erm+|er|ah+|hmm+|you know|you get it|you get me|basically|actually|i mean|kind of|sort of|okay so|alright so|right\?|right,)\b/g, " ");
  t = t.replace(/\blike\s+(?=\d|a |an |about|around)/g, " ");
  t = t.replace(/\b(about|around|roughly|approximately)\s+(?=\d+\s+(?:hours?|minutes?))/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

// ---------- Time mentions ----------
const T_RE_SRC = "(\\d{1,2})(?::(\\d{2}))?\\s?(am|pm)?";
function mention(h, m, mer) {
  h = +h; m = +(m || 0);
  if (h === 24 && !m) return { h: 24, m: 0, mer: null };
  if (h > 23 || m > 59) return null;
  return { h, m, mer: mer || null };
}

function extractTimes(seg) {
  let r = " " + seg + " ";
  const o = { start: null, end: null, by: null, dur: null };
  const cut = m => { r = r.replace(m[0], " "); };
  let m;
  // durations first so "30 minutes" isn't read as a clock time
  m = r.match(/\b(?:for\s+)?(\d+(?:\.\d+)?)\s+(hours?|minutes?)\b/);
  if (m) { o.dur = Math.round(/^h/.test(m[2]) ? +m[1] * 60 : +m[1]); cut(m); }
  m = r.match(/\b(?:for\s+)?(\d+)\s+hours?\s+(?:and\s+)?(\d+)\s+minutes?\b/);
  if (m) { o.dur = +m[1] * 60 + +m[2]; cut(m); }
  // ranges
  m = r.match(new RegExp(`\\b(?:from|between|starting)?\\s*${T_RE_SRC}\\s*(?:to|until|till|til|through|-|–|and)\\s*${T_RE_SRC}\\b`));
  if (m && (m[2] || m[3] || m[5] || m[6] || /\b(from|between)\b/.test(m[0]) || /\bto\b/.test(m[0]))) {
    const a = mention(m[1], m[2], m[3]), b = mention(m[4], m[5], m[6]);
    if (a && b) { o.start = a; o.end = b; if (!a.mer && b.mer) a.inherit = b.mer; cut(m); }
  }
  if (!o.end) {
    m = r.match(new RegExp(`\\b(?:until|till|til|up to)\\s+${T_RE_SRC}\\b`));
    if (m) { o.end = mention(m[1], m[2], m[3]); cut(m); }
  }
  m = r.match(new RegExp(`\\bby\\s+${T_RE_SRC}\\b`));
  if (m) { o.by = mention(m[1], m[2], m[3]); cut(m); }
  if (!o.start) {
    m = r.match(new RegExp(`\\b(?:at|from|around|starting at|starting|start at|begins at|from about)\\s+${T_RE_SRC}\\b`));
    if (m) { o.start = mention(m[1], m[2], m[3]); cut(m); }
  }
  if (!o.start) { // bare time only if it looks like a time (has colon or am/pm)
    m = r.match(/\b(\d{1,2})(?::(\d{2}))\s?(am|pm)?\b|\b(\d{1,2})\s?(am|pm)\b/);
    if (m) { o.start = m[1] ? mention(m[1], m[2], m[3]) : mention(m[4], 0, m[5]); cut(m); }
  }
  o.rest = r.replace(/\s+/g, " ").trim();
  return o;
}

// ---------- Activities ----------
const SUBJECT = /^(?:so |and |then |also |well |now |ok |okay |but |plus )*(?:i(?:'m| am)? (?:going|planning|hoping|about) to |i (?:want|need|have|plan|hope|would like|'d like|wish|got|will have|'ll have|should|must|gotta|may|might) to |i(?:'ll| will) (?:be )?|i(?:'ve| have) got |i have |i got |i(?:'m| am) |i |we have |we(?:'re| are) |let me |let's |gonna |going to |want to |need to |have to )+/;
const ACTIVITY = [
  { cat: "gym",     re: /\b(gym|work ?out|lifting|lift weights|weights|weight training|strength training|leg day|push day|pull day|upper day|lower day|full body)\b/, title: () => "Gym" },
  { cat: "bass",    re: /\b(bass(?: guitar)?(?: lessons?| practice| session| class)?|practi[cs]e (?:my |the )?bass)\b/, title: () => "Bass lesson" },
  { cat: "bible",   re: /\b(bible(?: study| reading| time)?|scripture|devotions?|devotional|quiet time|read(?:ing)? (?:the |my )?(?:word|bible))\b/, title: () => "Bible study" },
  { cat: "church",  re: /\b(church|service|prayer meeting|prayer|fellowship|choir|cell group|small group)\b/, title: null },
  { cat: "band",    re: /\b(band|rehears\w*|jam session|jamming|guitar practice|drum practice|music practice|practice (?:my |the )?(?:guitar|drums|songs?|instrument|setlist))\b/, title: () => "Band practice" },
  { cat: "learn",   re: /\b(?:learn|learning)\s+(?!(?:the |about )?(?:bass|bible)\b)([a-z][a-z0-9 +#.]{1,40}?)(?=\s+(?:for|from|at|until|till|by|then|and|today|tonight|tomorrow)\b|$)/, title: m => "Learn " + m[1].replace(/^(?:how to|about|the|some|more)\s+/, "").split(" ").map(w => PROPER[w] || w).join(" ") },
  { cat: "commute", re: /\b(walk|drive|commute|ride|bus|train|head|go|going|get|travel)\b.*\b(?:to|back to)\b.*\b(dorm|home|room|campus|class|school|office|hostel|apartment|flat|place|library|house|hall)\b/,
    title: m => { const place = m[2]; return (/walk/.test(m[0]) ? "Walk to " : /drive/.test(m[0]) ? "Drive to " : "Head to ") + (place === "home" ? "home" : place); } },
  { cat: "class",   re: /\b(class(?:es)?|lecture|lab|seminar|tutorial|course|school|lesson)\b/, title: null },
  { cat: "study",   re: /\b(study|studying|revise|revision|homework|assignments?|reading|read|review|exam prep|prep for)\b/, title: null },
  { cat: "work",    re: /\b(solidworks|cad|project|coding|code|programming|design|essay|report|work on|working on|shift|job|work)\b/, title: null },
  { cat: "meal",    re: /\b(breakfast|lunch|dinner|brunch|eat|meal|supper)\b/, title: null },
  { cat: "meeting", re: /\b(meeting|call with|zoom|interview|office hours|appointment)\b/, title: null },
  { cat: "social",  re: /\b(friends?|hang ?out|party|date|movie|game night|family)\b/, title: null },
  { cat: "rest",    re: /\b(nap|rest|sleep|break|chill|relax|shower)\b/, title: null }
];
const ARRIVAL = /\b(?:i'?ll be|i will be|i'?d be|i should be|be back|be in|be at|get back|arrive|reach|i'?m in|i'?ll get there)\b/;
const PROPER = { solidworks: "SolidWorks", cad: "CAD", matlab: "MATLAB", python: "Python", math: "Math", maths: "Maths", physics: "Physics", chemistry: "Chemistry", biology: "Biology", english: "English", calculus: "Calculus" };

function cleanTitle(rest) {
  let t = rest.trim().replace(/[—–-]+/g, " ");
  t = t.replace(SUBJECT, "");
  t = t.replace(/\b(?:today|tonight|tomorrow|this morning|this afternoon|this evening|(?:on |this |next )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/g, " ");
  t = t.replace(/^\s*(?:do|doing|go to|go|attend|have|be|start|get|some|a|an|the|my)\b\s*/g, " ");
  t = t.replace(/^\s*(?:do|doing|go to|go|attend|have|some|a|an|the|my)\b\s*/g, " ");
  t = t.replace(/\b(?:for|from|at|until|till|by|then|and|so|also|that is|which means|please|right|okay)\s*$/g, " ");
  t = t.replace(/\b(?:my|the)\b/g, " ").replace(/[,.!?]+/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(/^(?:a|an|some)\s+/, "");
  t = t.split(" ").map(w => PROPER[w] || w).join(" ");
  return t;
}

function classify(rest) {
  for (const a of ACTIVITY) {
    const m = rest.match(a.re);
    if (m) {
      let title;
      if (a.title) title = a.title(m);
      else {
        title = cleanTitle(rest);
        if (!title || title.split(" ").length > 6) title = m[1];
      }
      return { cat: a.cat, title: title.charAt(0).toUpperCase() + title.slice(1) };
    }
  }
  const t = cleanTitle(rest);
  if (t && t.length > 2 && !/^(?:that|this|it|be|in|the dorm|there|so|ok|okay|yes|no|and|then)$/.test(t)) return { cat: "other", title: t.charAt(0).toUpperCase() + t.slice(1) };
  return null;
}

// ---------- Segmenting ----------
function segments(t) {
  const SPLIT = /[.!?;]+\s+|\s*,\s*(?=(?:then|and then|after that|so|next|later)\b)|\b(?:and then|then|after that|afterwards|after which|followed by|later on|that is|which means|meaning|and also|also)\b|\bso\b(?=\s+(?:i|i'm|i'll|today|tomorrow|tonight)\b)/;
  let parts = t.split(SPLIT).map(s => (s || "").trim()).filter(Boolean);
  // split before a new subject clause ("... 11 pm i'm going to walk ...")
  const SUBJ = /\s+(?=(?:i have|i've got|i got|i want to|i need to|i'm going to|i am going to|i'll|i will|i have to|i should|i must|i plan to|let me|we have|i'm heading|i'm doing)\b)/;
  parts = parts.flatMap(p => p.split(SUBJ)).map(s => s.trim()).filter(Boolean);
  // split "X from 1 to 3 and Y at 5"
  parts = parts.flatMap(p => {
    const bits = p.split(/\s+and\s+/);
    if (bits.length < 2) return [p];
    const timed = bits.map(b => /\d/.test(b));
    return timed.every(Boolean) ? bits : [p];
  });
  return parts;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
function dateFrom(seg, base) {
  if (/\btomorrow\b/.test(seg)) return addDaysStr(base, 1);
  if (/\b(?:today|tonight|this morning|this afternoon|this evening)\b/.test(seg)) return base;
  const m = seg.match(/\b(?:on |this |next )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (m) {
    const d = new Date(base + "T00:00");
    const diff = (WEEKDAYS.indexOf(m[1]) - d.getDay() + 7) % 7 || 7;
    return addDaysStr(base, /next/.test(m[0]) && diff < 7 ? diff + 7 : diff);
  }
  return null;
}
function addDaysStr(s, n) { const d = new Date(s + "T00:00"); d.setDate(d.getDate() + n); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

// ---------- AM/PM resolution ----------
// Speech-to-text often gets AM/PM wrong. Choose the reading that makes the day flow forward,
// with sensible hours and lengths. Explicit AM/PM is respected unless it breaks the timeline.
function resolve(items, ctx) {
  const ms = [];
  items.forEach(it => ["start", "end", "by"].forEach(k => { if (it[k]) ms.push(it[k]); }));
  const amb = ms.filter(x => x.h >= 1 && x.h <= 12);
  const val = (x, pm) => {
    if (x.h === 0 || x.h > 12) return x.h * 60 + x.m;
    const h = x.h % 12 + (pm ? 12 : 0);
    return h * 60 + x.m;
  };
  const cost = choice => {
    let c = 0;
    amb.forEach((x, i) => {
      const pm = choice[i];
      const want = x.mer || x.inherit;
      if (x.mer && (x.mer === "pm") !== pm) c += 2;
      else if (!x.mer && x.inherit && (x.inherit === "pm") !== pm) c += 0.3;
      if (!want) { const v = val(x, pm); if (v < 360) c += 3; }
      else if (x.mer === "am" && !pm) { /* fine */ }
      else { const v = val(x, pm); if (v < 360 && !(x.mer === "am")) c += 3; }
    });
    const get = x => x ? (amb.includes(x) ? val(x, choice[amb.indexOf(x)]) : val(x, false)) : null;
    let prevEnd = null;
    items.forEach(it => {
      const s = get(it.start), e = get(it.end), b = get(it.by);
      if (s != null && e != null) {
        if (e <= s) c += 20;
        else if (e - s > 600) c += 4;
      }
      const first = s ?? b ?? e;
      if (first != null) {
        if (s != null && s >= 1320) c += 0.4;
        if (s != null && s >= 1140 && /^(class|study|meeting|meal)$/.test(it.cat || "")) c += 1.2;
        if (s != null && ctx.isToday && s < ctx.now - 30) c += 0.6;
        if (prevEnd != null && first < prevEnd - 10) c += 8;
      }
      const end = e ?? b ?? (s != null ? s + (it.dur || 0) : null);
      if (end != null) prevEnd = end;
    });
    return c;
  };
  let best = null, bestC = Infinity;
  if (amb.length <= 14) {
    const n = 1 << amb.length;
    for (let mask = 0; mask < n; mask++) {
      const ch = amb.map((_, i) => !!(mask & (1 << i)));
      const c = cost(ch);
      if (c < bestC) { bestC = c; best = ch; }
    }
  } else {
    best = amb.map(x => x.mer ? x.mer === "pm" : x.h < 7 || x.h === 12);
  }
  const out = x => x ? (amb.includes(x) ? val(x, best[amb.indexOf(x)]) : val(x, false)) : null;
  items.forEach(it => { it.s = out(it.start); it.e = out(it.end); it.b = out(it.by); });
}

// ---------- Public: schedule parsing ----------
// Returns ordered items: {kind:'event'|'anchor', title, cat, s, e, b, dur, date}
export function parseSchedule(raw, ctx) {
  const t = normalize(stripWake(raw));
  const segs = segments(t);
  let date = ctx.date;
  const items = [];
  let pending = null; // time-only fragment waiting for its activity
  for (const seg of segs) {
    const d = dateFrom(seg, ctx.today);
    if (d) date = d;
    const tm = extractTimes(seg);
    const hasTime = tm.start || tm.end || tm.by;
    const isArrival = ARRIVAL.test(tm.rest) && !/\b(study|class|gym|band|work|practice)\b/.test(tm.rest);
    const act = isArrival ? null : classify(tm.rest);
    if (isArrival) {
      if (tm.by || tm.start || pending?.by || pending?.start) items.push({ kind: "anchor", by: tm.by || tm.start || pending?.by || pending?.start, date });
      pending = null; continue;
    }
    if (!act) {
      if (hasTime && !tm.dur) { pending = { start: tm.start, end: tm.end, by: tm.by }; continue; }
      if (tm.dur && !hasTime) {
        const prev = [...items].reverse().find(i => i.kind === "event");
        if (prev && !prev.end) { prev.dur = tm.dur; prev.corrected = true; }
        continue;
      }
      if (hasTime && tm.dur && pending == null) { pending = { start: tm.start, end: tm.end, by: tm.by, dur: tm.dur }; continue; }
      continue;
    }
    const it = { kind: "event", title: act.title, cat: act.cat, start: tm.start, end: tm.end, by: null, dur: tm.dur, date };
    if (pending) { it.start = it.start || pending.start; it.end = it.end || pending.end; if (!it.end && pending.by) it.end = pending.by; it.dur = it.dur || pending.dur; pending = null; }
    if (tm.by && !it.end) it.end = tm.by;
    items.push(it);
  }
  const ctxToday = { isToday: date === ctx.today, now: ctx.now };
  resolve(items, ctxToday);
  // Fill lengths
  items.forEach(it => {
    if (it.kind !== "event") return;
    if (it.s != null && it.e == null && it.dur) it.e = it.s + it.dur;
    if (it.s != null && it.e != null) it.dur = it.e - it.s;
    if (!it.dur) { it.dur = DEFAULT_MIN[it.cat] || 30; it.durDefault = true; }
    it.title = it.title.replace(/\s+/g, " ").trim().slice(0, 60);
  });
  return items;
}

// ---------- Intents ----------
export const EX_ALIASES = [
  ["cableRow", /\b(seated (?:cable )?row|cable row)\b/], ["legcurl", /\b(leg curls?|hamstring curls?)\b/], ["hammer", /\bhammer curls?\b/],
  ["inclineDb", /\bincline\b/], ["bench", /\bbench\b|\bchest press\b/], ["ohp", /\b(overhead|shoulder|military) press\b|\bohp\b/],
  ["lateral", /\b(lateral|side) raises?\b/], ["pushdown", /\b(push ?downs?|tricep|triceps)\b/], ["dips", /\bdips?\b/],
  ["pullup", /\b(pull ?ups?|chin ?ups?)\b/], ["pulldown", /\b(pull ?downs?|lat pull)\b/], ["facepull", /\bface ?pulls?\b/],
  ["row", /\b(bent[- ]?over rows?|barbell rows?|rows?)\b/], ["curl", /\b(barbell curls?|bicep curls?|curls?)\b/],
  ["squat", /\bsquats?\b/], ["rdl", /\b(rdls?|romanian|deadlifts?)\b/], ["legpress", /\bleg press\b/], ["lunge", /\blunges?\b/],
  ["calf", /\bcalf|calves\b/], ["plank", /\bplanks?\b/]
];
export const findExercise = t => (EX_ALIASES.find(([, re]) => re.test(t)) || [])[0] || null;

export function intent(raw) {
  const t = normalize(stripWake(raw));
  const bare = t.replace(/[^a-z0-9: ']/g, " ").replace(/\s+/g, " ").trim();
  if (!bare) return { type: "greet" };
  if (/^(?:(?:ok(?:ay)? |alright |thanks? |thank you )?(?:bye|bye bye|goodbye|good bye|bye pg|see you|see ya|later|talk (?:to you )?later|catch you later)(?: pg)?|stop|stop listening|cancel|never ?mind|nothing|nothing else|no(?:pe)? that's (?:it|all)|that's (?:it|all)(?: for now)?(?: thanks?| thank you)?|that is all|i'?m good(?: thanks?)?|no thanks?|no that's it|end (?:the )?call|hang up|shut up|be quiet|go to sleep|good ?night(?: pg)?)(?: thanks?| thank you| pg| sir)*$/.test(bare)) return { type: "dismiss", bye: true };
  if (/^(?:thanks?|thank you|cheers|great|perfect|awesome|nice|cool|good job|got it)(?: (?:pg|so much|man|bro|sir))?$/.test(bare)) return { type: "thanks" };
  if (/\bwhat can you do\b|\bhow do (?:i|you) use\b|\bhelp me\s*$|^help$/.test(bare)) return { type: "help" };
  // ---- PG's memory: save notes and revelations ----
  let n;
  if ((n = raw.match(/^\s*(?:(?:hi|hey|okay|ok)[ ,]+p\.?\s?g[ ,.]*)?(?:(?:pg[ ,]+)?(?:please )?(?:save|remember|note|record|write down|keep|store)(?: (?:this|that|a revelation|my revelation|a note|this revelation|a lesson))?(?: (?:to|in|for) (?:my )?(?:spiritual|church|bible)(?: life)?(?: folder)?)?[:,]?\s+(?:that\s+)?|(?:i\s+)?(?:just\s+)?(?:learned|learnt|realized|realised|discovered|got|received|had)\s+(?:a\s+)?(?:new\s+)?(?:revelation|insight|lesson)(?:\s+today)?(?:\s+(?:that|about|which is|and it is|it's|it is))?[:,]?\s+|(?:a |my |new |today's )?(?:revelation|insight|lesson learned|note to self|note)(?: (?:for )?today)?(?: is)?[:,]\s*|i\s+(?:just\s+)?(?:learned|learnt|realized|realised|discovered)\s+(?:today\s+)?that\s+)(.{6,})$/i))) {
    const folder = /\b(?:spiritual|church|bible|revelation)\b/i.test(raw.slice(0, raw.length - n[1].length)) ? "spiritual" : null;
    return { type: "note", text: n[1].trim(), folder };
  }
  if (/\b(?:what(?:'s| is)|how(?:'s| is)|tell me about|show me) my (?:day|morning|afternoon|evening)\b|\bmy day (?:today|tomorrow)\b|\bplan my day\b/.test(bare)) return { type: "day", tomorrow: /\btomorrow\b/.test(bare) };
  if (/\bplan (?:out )?my week\b|\bmy week(?:ly)? (?:plan|timetable|schedule)\b/.test(bare)) return { type: "school_plan" };
  if (/\b(?:what (?:did|have) i (?:learn|learned|learnt|say|said|note|noted|save|saved|write|written)|what do i know|remind me (?:of )?what i (?:learned|learnt|said)|my (?:revelations|notes|lessons)|what (?:revelations?|notes) do i have)\b/.test(bare)) return { type: "recall", q: bare };
  // ---- School: assignments and a realistic study timetable ----
  let sm;
  if (/\bwhat (?:have you|did you|do you) (?:learn(?:ed|t)?|know|remember) about me\b|\bwhat do you know about me\b/.test(bare)) return { type: "learned" };
  if (/\b(?:make|is) (?:it|this|that|my (?:day|plan|schedule|timetable)) (?:more )?realistic\b|\bfix my (?:day|plan|schedule|timetable)\b|\b(?:is|was) (?:that|this|it|my plan|my day|my schedule|my timetable) (?:realistic|too much|doable)\b|\bunrealistic\b|\bmake (?:my )?(?:today|tomorrow|plan) realistic\b/.test(bare)) return { type: "realistic", tomorrow: /\btomorrow\b/.test(bare) };
  if ((sm = bare.match(/\bi (?:can )?(?:only )?(?:study|focus|work)(?: for)? (?:at most |max |up to |about |around )?(.+?) (?:a|per|each) day\b/)) && estIn(sm[1])) return { type: "school_cap", min: estIn(sm[1]) };
  if ((sm = bare.match(/\bi(?:'m| am) (?:usually |only )?free (?:after|from) (\d{1,2}(?::\d{2})?\s?(?:am|pm)?)(?: on (weekends?|weekdays?))?|\bi (?:finish|get out of|leave|get home from|get back from) (?:school|class|classes|uni|college|lectures?) (?:at|by|around) (\d{1,2}(?::\d{2})?\s?(?:am|pm)?)/))) return { type: "school_window", time: sm[1] || sm[3], we: /weekend/.test(sm[2] || "") };
  if ((sm = bare.match(/\bi (?:study|focus|work|concentrate) (?:best|better) (?:in the |at )?(morning|evening|night|afternoon)s?\b/))) return { type: "school_pref", p: /morning/.test(sm[1]) ? "morning" : "evening" };
  if (/\b(?:plan|make|build|create|generate|redo|update|organi[sz]e|do)\b.*\b(?:study (?:plan|timetable|schedule)|my assignments|my homework|revision|school ?work|timetable for (?:my )?(?:school|assignments|exams|homework)|school timetable)\b|\bplan my (?:study|studying|assignments|homework)\b/.test(bare) && !looksLikeSchool(bare)) return { type: "school_plan" };
  if (/\bwhat (?:assignments|homework|is due|do i have due|'s due)\b|\bmy (?:assignments|deadlines)\b|\bwhat should i (?:study|work on)\b|\bwhen (?:is|are) (?:my )?.+ due\b/.test(bare)) return { type: "school_info" };
  if (looksLikeSchool(bare)) return { type: "school_add", text: raw };
  // ---- Food, recipes and shopping ----
  let f;
  if (/\b(?:i )?(?:don'?t|do not|didn'?t) (?:really )?(?:feel like|want|fancy)\b|\bnot (?:in the mood for|feeling)\b|\bsomething (?:else|different|quicker|faster|lighter|easier)\b|\b(?:another|other) (?:one|option|idea|meal|recipe)s?\b|\bchange (?:my |the )?(?:breakfast|lunch|dinner|meal)\b|\bi(?:'m| am) (?:sick|tired) of\b|^(?:no|nah|nope)\b.*\b(?:else|that|this|not)\b|^(?:no|nah|nope)$/.test(bare)) return { type: "food_swap", text: bare };
  if ((f = bare.match(/\bi (?:don'?t|do not|can'?t|never) (?:like|eat|want)\s+(.+)$|\bi(?:'m| am) allergic to\s+(.+)$|\bi hate\s+(.+)$|\bno more\s+(.+)$/)) && !/\b(?:feel like|this|that|it|plan|schedule|timetable|lesson|gym)\b/.test(bare)) return { type: "food_avoid", item: f[1] || f[2] || f[3] || f[4] };
  if ((f = bare.match(/\bwhat (?:should|can|do) i (?:eat|have|cook|make)(?: for)? (breakfast|lunch|dinner|a snack|snack|tonight)\b|\bwhat(?:'s| is) for (breakfast|lunch|dinner)\b/))) return { type: "food_meal", when: (f[1] || f[2]).replace(/^a /, "").replace("tonight", "dinner") };
  if ((f = bare.match(/^(?:please )?(?:add|put|include) (.+?) (?:to|on|in|into) (?:my |the )?(?:shopping|grocery|groceries|food)(?: list)?$/))) return { type: "shop_add", item: f[1] };
  if (/\b(?:make|create|generate|build|give me|prepare|do|write|draw up|plan)\b.*\b(?:shopping|grocery|groceries|food) list\b|\bshopping list for (?:the |this )?week\b|\bwhat (?:should|do) i (?:buy|shop for)\b/.test(bare)) return { type: "shop_make" };
  if (/\b(?:what(?:'s| is) on|read|show|open|check)\b.*\b(?:shopping|grocery) list\b|^(?:my |the )?(?:shopping|grocery) list$/.test(bare)) return { type: "shop_show" };
  if ((f = bare.match(/\bwhere (?:can|do|should|could) i (?:buy|get|find) (?:some |good |cheap )?(.+?)(?: in hong kong| in hk)?$/))) return { type: "shop_where", item: f[1] };
  if ((f = bare.match(/\b(?:i weigh|my weight is|i(?:'m| am)(?: now)?) (\d+(?:\.\d+)?)\s?(kg|kgs|kilos?|kilograms?|lbs?|pounds)\b/))) return { type: "weight", kg: /^(?:lb|pound)/.test(f[2]) ? +f[1] * 0.4536 : +f[1] };
  if (/\b(?:fiber|fibre)\b/.test(bare)) return { type: "food_tip", k: "fiber" };
  if (/\b(?:eat|have|food|meal|snack)\b.*\bbefore (?:the |my |i )?(?:gym|workout|training|lifting|go)|\bpre[- ]?(?:workout|gym|training) (?:meal|snack|food)/.test(bare)) return { type: "food_tip", k: "pre" };
  if (/\b(?:eat|have|food|meal|shake)\b.*\bafter (?:the |my )?(?:gym|workout|training|lifting)|\bpost[- ]?(?:workout|gym|training)|\b30 minutes? (?:after|window)|\banabolic window\b/.test(bare)) return { type: "food_tip", k: "post" };
  if (/\bhow much protein\b|\bprotein (?:target|goal|per meal|a day)\b/.test(bare)) return { type: "food_tip", k: "protein" };
  if (/\b(?:leftovers?|meal prep|how long (?:does|do|can|will) (?:food|it|cooked|leftovers)|keep in the fridge|food safety)\b/.test(bare)) return { type: "food_tip", k: "safe" };
  if (/\b(?:portion|portions|how much (?:rice|carbs?)|my plate|plate size)\b/.test(bare)) return { type: "food_tip", k: "plate" };
  if ((f = bare.match(/\b(?:recipes?|how (?:do|can|should) i (?:cook|make|prepare)|what (?:should|can|do) i cook|what to cook|cook (?:for )?(?:dinner|lunch|breakfast|tonight)|teach me (?:to|how to) cook)\b(?:\s+(?:for|of|a|an|some|me))*\s*(.*)$/))) return { type: "recipe", q: f[1] };
  if (/\b(?:what (?:should|can|do) i eat|what to eat|foods? (?:with|high in|for|that|rich in)|high protein|protein (?:foods?|target|goal|intake|meals?)|how much protein|meal plan|what should i have for (?:breakfast|lunch|dinner)|my diet|nutrition|eat (?:before|after) (?:the )?(?:gym|workout|training)|build muscle|gain muscle)\b/.test(bare) && !/\b(?:at|from) \d/.test(bare)) return { type: "food_info" };
  // ---- Bible ----
  const bk = bare.match(/\b(?:(?:my |the )?plan is to|i (?:want|need|plan|am going|'m going|will|would like|'d like) to|i(?:'m| am) (?:going to )?|let's|start|starting|begin|beginning)\s*(?:read|reading|study|studying|go through|going through|finish)\s+(?:through\s+)?(?:the\s+)?(?:whole\s+)?(?:book of\s+)?([1-3]?\s?[a-z]+(?: of [a-z]+)?)/);
  const mx = bare.match(/\b(?:max(?:imum)?|up to|at most|only)?\s*(?:of\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+chapters? (?:a|per|each|every) day\b/);
  if (bk && /\b(?:book|plan)\b|\bread(?:ing)? (?:the book of )?[1-3]?\s?[a-z]+(?:\s|$)/.test(bare) && !/\b(?:chapter|verse)s? \d/.test(bare)) return { type: "bible_plan", book: bk[1], max: mx ? (+mx[1] || NUMW[mx[1]]) : null, text: bare };
  if (mx && /\bcan|max|most|only|want|per|a day/.test(bare) && !/\b(?:i read|i've read|i have read)\b/.test(bare)) return { type: "bible_max", max: +mx[1] || NUMW[mx[1]] };
  if (/\b(?:i(?:'ve| have)? (?:read|finished|completed|done)|i(?:'m| am) (?:on|at|up to)|i got (?:to|up to)|read up to)\b/.test(bare) && /\b(?:chapters?|verses?|\d+:\d+|today's reading|my reading|the book|bible)\b|\b(?:read|finished) [1-3]?\s?[a-z]+ \d/.test(bare)) return { type: "bible_read", text: bare };
  if (/\b(?:what(?:'s| is| am i| should i)?(?: be)? (?:my )?(?:bible )?(?:reading|read)(?: plan)?(?: today| for today)?|(?:bible|reading) (?:plan|progress)|how far (?:am i|have i read))\b/.test(bare) && !/\b(?:at|from) \d/.test(bare)) return { type: "bible_info" };
  // ---- Bass ----
  if (/\b(?:what(?:'s| is| am i)? (?:my |today's )?(?:bass )?lesson|what am i (?:learning|practicing|practising) (?:today|on bass|tonight)|bass (?:plan|progress|lesson today))\b/.test(bare) && !/\b(?:at|from) \d/.test(bare)) return { type: "bass_info" };
  if (/^(?:(?:the |my |this )?(?:lesson|session|step|reading|it|that) )?(?:is )?(?:complete|completed|done|finished)(?: (?:it|the lesson|this lesson|today's lesson|the step|this step))?$|^(?:i )?(?:completed|finished|mastered|nailed|got) (?:it|the lesson|this lesson|today's lesson|the step|this step|that)$|^(?:lesson|step) (?:complete|completed|done)$|^i(?:'m| am)? done with (?:the |this |today's )?(?:lesson|step|bass lesson)$|^mark (?:it |the lesson )?(?:as )?complete$/.test(bare)) return { type: "complete" };
  if (/^(?:not yet|repeat(?: (?:it|the lesson|this lesson))?|i need more (?:time|practice)|same lesson(?: again)?|again tomorrow)$/.test(bare)) return { type: "repeat" };
  if ((sm = bare.match(/\b(?:i )?(?:finished|completed|submitted|handed in|turned in|i'?m done with|done with|sent in)\s+(?:my |the )?(.*?\b(?:essay|paper|report|lab|presentation|project|assignment|homework|problem set|worksheet|exam|test|quiz|coursework)s?\b.*)$/))) return { type: "school_done", target: sm[1], min: estIn(bare) };
  if ((sm = bare.match(/\b(?:it|that|this|the .+?) (?:took|taken) (?:me )?(?:about |around |like |roughly |almost |over )?(.+)$/)) && estIn(sm[1])) return { type: "school_took", min: estIn(sm[1]) };
  // ---- Learning anything ----
  const lr = bare.match(/^(?:i(?:'m| am) (?:now )?(?:learning|studying|trying to learn)|i (?:want|need|would like|'d like|wanna|plan) to (?:learn|study|get good at)|teach me|help me learn|i(?:'m| am) starting to learn|i(?:'ve| have) started learning)\s+(?:how to\s+|about\s+)?(.{2,60}?)$/);
  if (lr && !/\b(?:at|from|until|till) \d|\b\d+ (?:minutes|hours)\b/.test(bare)) {
    if (/^(?:the )?bass(?: guitar)?\b/.test(lr[1])) return { type: "bass_info" };
    if (!findExercise(lr[1])) return { type: "learn", topic: lr[1] };
  }
  if (/\b(?:how did i do|review (?:my|of|the)? ?day|daily review|day review|how was my day|give me (?:a |my )?review)\b/.test(bare)) return { type: "review" };
  if (/\bwhat(?:'s| is| am i| should i be)? (?:doing |happening |on )?(?:right )?now\b|\bwhat should i (?:be )?do(?:ing)? (?:right )?now\b/.test(bare)) return { type: "now" };
  if (/\bwhat(?:'s| is| do i have)? (?:coming )?(?:up )?next\b|\bwhat(?:'s| is) after (?:this|that)\b|\bwhat's coming up\b/.test(bare)) return { type: "next" };
  if (/\b(?:what(?:'s| is| does)|read|tell me|show me|go over)\b.*\b(?:schedule|timetable|plan|agenda|day look)\b|\bwhat do i have (?:today|tomorrow|on)\b/.test(bare))
    return { type: "day", tomorrow: /\btomorrow\b/.test(bare) };
  if (/\b(?:clear|wipe|reset|erase|delete) (?:my |the |all |everything on )?(?:whole )?(?:schedule|timetable|day|plan|today|everything)\b|\bstart over\b/.test(bare)) return { type: "clear", tomorrow: /\btomorrow\b/.test(bare) };
  // gym / band coaching queries
  const split = bare.match(/\b(?:make it|switch to|change (?:it )?to|today is|let's do|do|it's|its|i want to do|i'll do)\s+(?:a\s+)?(push|pull|legs?|upper|lower|full body)(?: body)? day\b/);
  if (split) return { type: "gym_switch", day: split[1].replace(/^legs$/, "leg") };
  if (/\bwhat(?:'s| is| am i| do i)\b.*\b(?:workout|training|train|gym|lifting)\b|\bwhat day is it at the gym\b/.test(bare) && !/\bat \d/.test(bare)) return { type: "gym_info" };
  if (/\bwhat (?:am i|should i|do i) (?:be )?practi[cs]\w*|\bband (?:plan|progress)\b|\bhow(?:'s| is) (?:my|the) band\b/.test(bare)) return { type: "band_info" };
  const song = bare.match(/\badd (?:the |a )?(?:new )?song (.+?)(?: to (?:my |the )?(?:band|setlist|set list|songs).*)?$/) || bare.match(/\badd (.+?) to (?:my |the )?(?:setlist|set list|band songs)\b/);
  if (song) return { type: "song_add", name: song[1].trim() };
  const how = bare.match(/\b(?:how (?:do|should|can) (?:i|you)(?: do| perform)?|how to(?: do)?|show me(?: how to do)?(?: a video (?:of|for))?|explain|teach me)\s+(?:a |an |the |proper )?(.+)/);
  if (how) { const ex = findExercise(how[1]); if (ex) return { type: "howto", ex }; }
  // edits to existing blocks
  let m;
  if ((m = bare.match(/\b(?:delete|remove|cancel|drop|scrap|take off|get rid of) (?:the |my )?(.+?)(?: (?:from|off) (?:my |the )?(?:schedule|timetable|plan|day))?$/))) return { type: "delete", target: m[1] };
  if ((m = bare.match(/\b(?:move|shift|reschedule|change|push|put) (?:the |my )?(.+?) to (?:start at )?(\d{1,2}(?::\d{2})?\s?(?:am|pm)?)$/))) return { type: "move", target: m[1], time: m[2] };
  if ((m = bare.match(/\b(?:push|delay|move) (?:the |my )?(.+?) (?:back |later )?by (\d+) (hours?|minutes?)$/))) return { type: "shift", target: m[1], min: /^h/.test(m[3]) ? +m[2] * 60 : +m[2] };
  if ((m = bare.match(/\b(?:make|change|set|extend|shorten|cut) (?:the |my )?(.+?) (?:to |for )?(\d+(?:\.\d+)?) (hours?|minutes?)(?: long)?$/))) return { type: "resize", target: m[1], min: Math.round(/^h/.test(m[3]) ? +m[2] * 60 : +m[2]) };
  if ((m = bare.match(/\b(?:i(?:'m| am)? (?:done|finished) with|i (?:finished|completed|did)|mark|check off) (?:the |my )?(.+?)(?: (?:as )?(?:done|complete|completed|finished))?$/))) return { type: "done", target: m[1] };
  if ((m = bare.match(/^(?:i(?:'m| am) )?(?:done|finished)$/))) return { type: "done", target: "" };
  if (/\?\s*$/.test(raw) || /^(?:what|how|why|should|can|could|is|are|do|does|when|where|who|which|give me|tell me|remind me)\b/.test(bare)) return { type: "ask", q: bare, text: raw };
  return { type: "schedule", text: raw };
}
const NUMW = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

// Fuzzy-match a spoken name against blocks
export function matchBlock(target, blocks) {
  const t = normalize(target);
  const words = t.split(" ").filter(w => w.length > 2 && !/^(the|my|and|for|block|session|thing|task|today|tomorrow)$/.test(w));
  let best = null, bs = 0;
  blocks.forEach(b => {
    const title = (b.title + " " + b.cat).toLowerCase();
    let sc = 0;
    words.forEach(w => { if (title.includes(w)) sc += 2; else if (title.includes(w.slice(0, 4))) sc += 1; });
    if (/gym|workout/.test(t) && b.cat === "gym") sc += 3;
    if (/band|practice/.test(t) && b.cat === "band") sc += 3;
    if (/bass|lesson/.test(t) && b.cat === "bass") sc += 3;
    if (/bible|reading|devotion/.test(t) && b.cat === "bible") sc += 3;
    if (/study/.test(t) && b.cat === "study") sc += 2;
    if (/class/.test(t) && b.cat === "class") sc += 2;
    if (sc > bs) { bs = sc; best = b; }
  });
  return bs >= 2 ? best : null;
}

export function parseClock(s) {
  const m = normalize(s).match(/(\d{1,2})(?::(\d{2}))?\s?(am|pm)?/);
  if (!m) return null;
  let h = +m[1]; const mi = +(m[2] || 0);
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  if (!m[3] && h >= 1 && h <= 6) h += 12; // "move gym to 6" -> 6 PM
  return h * 60 + mi;
}

// "Thanks PG, you can end the call now" and similar: end the call right away.
export function isEndCall(t) {
  t = String(t || "").toLowerCase().replace(/[^a-z' ]/g, " ").replace(/\s+/g, " ").trim();
  return /\b(?:end|hang up|stop|close|finish|cut|drop)(?: up)?(?: (?:the|this|our))? (?:call|conversation|chat)\b/.test(t)
    || /\b(?:you|he|we|u) (?:can|could|may) (?:hang up|go now|end it|stop now)\b/.test(t)
    || /\b(?:thanks|thank you|thank u|cheers)\b.{0,25}\b(?:hang up|end it|that's all|we're done|we are done|i'm done|bye)\b/.test(t)
    || /^(?:ok(?:ay)? )?(?:we're|we are) done(?: here)?(?: pg)?$/.test(t);
}
