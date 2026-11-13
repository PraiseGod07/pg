// Local-first storage. Everything stays on the device (browser Cache Storage). Falls back to memory if blocked.
import { today, uid } from "./util.js";

const KEY = "pg.assistant.v2";
const BOX = "pg-data";
const URL_FOR = k => new URL("./__pgdata/" + encodeURIComponent(k), location.href).href;
const mem = {};
const hasCache = (() => { try { return typeof caches !== "undefined" && !!caches.open; } catch { return false; } })();
let writing = Promise.resolve();
const ls = {
  get(k) { return mem[k]; },
  set(k, v) {
    mem[k] = v;
    if (!hasCache) return;
    writing = writing.then(() => caches.open(BOX)).then(c => c.put(URL_FOR(k), new Response(v, { headers: { "content-type": "application/json" } }))).catch(() => {});
  }
};
// Read saved data into memory before the app starts
export async function hydrate() {
  if (!hasCache) return;
  try {
    const c = await caches.open(BOX);
    const r = await c.match(URL_FOR(KEY));
    if (r) mem[KEY] = await r.text();
  } catch {}
}

export const DEFAULTS = () => ({
  v: 2,
  profile: { address: "sir", name: "", dayStart: 420, dayEnd: 1380 },
  voice: { handsFree: false, voiceURI: "", rate: 1, alerts: true, heads: 5, keepAwake: false },
  days: {},            // { "YYYY-MM-DD": { blocks: [...] } }
  inbox: [],           // unscheduled tasks
  gym: { split: "ppl", idx: 0, override: null, overrideDate: null, log: [] , weights: {} },
  band: { instrument: "bass", songs: [], log: [], techIdx: 0 },
  bass: { idx: 0, done: {}, log: [] },
  bible: { plan: null, max: 3, version: "NKJV", history: [] },
  notes: [],
  learn: { tracks: [], active: null },
  chat: [],
  ai: { provider: "none", key: "", model: "" }
});

export let S = DEFAULTS();

function merge(base, o) {
  for (const k in o) {
    if (o[k] && typeof o[k] === "object" && !Array.isArray(o[k]) && base[k] && typeof base[k] === "object" && !Array.isArray(base[k])) merge(base[k], o[k]);
    else base[k] = o[k];
  }
  return base;
}

export function load() {
  const raw = ls.get(KEY);
  if (raw) { try { S = merge(DEFAULTS(), JSON.parse(raw)); } catch { S = DEFAULTS(); } }
  
  S.chat = (S.chat || []).slice(-60);
  return S;
}

// Bring tasks over from a PG Planner (v1) backup file
export function importV1(o) {
  try {
    const catMap = { assign: "study", group: "study", study: "study", test: "study", meeting: "meeting", webinar: "meeting", venture: "work", people: "social", hobby: "other", social: "social" };
    (o.tasks || []).filter(t => !t.done).forEach(t => {
      const cat = catMap[t.c] || "other";
      if (t.d && t.tm) {
        const [h, m] = t.tm.split(":").map(Number);
        const start = h * 60 + m, end = start + (t.est || 45);
        day(t.d).blocks.push({ id: uid(), title: t.t, cat, start, end, flex: false, done: false, date: t.d, src: "v1" });
      } else S.inbox.push({ id: uid(), title: t.t, cat, dur: t.est || 45, date: t.d || "" });
    });
    if (o.ai && o.ai.key) S.ai = { provider: o.ai.provider || "gemini", key: o.ai.key, model: "" };
    save();
    return true;
  } catch { return false; }
}

export function save() { ls.set(KEY, JSON.stringify(S)); }
export function day(d = today()) { return (S.days[d] = S.days[d] || { blocks: [] }); }
export function sortedBlocks(d = today()) { return day(d).blocks.slice().sort((a, b) => a.start - b.start || a.end - b.end); }
export function reset() { S = DEFAULTS(); save(); }
export function replace(o) { S = merge(DEFAULTS(), o); save(); }
