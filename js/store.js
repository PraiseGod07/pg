// Local-first storage. Everything stays on the device. Falls back to memory if storage is blocked.
import { today, uid } from "./util.js";

const KEY = "pg.assistant.v2";
let mem = null;
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return mem && mem[k]; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { mem = mem || {}; mem[k] = v; } }
};

export const DEFAULTS = () => ({
  v: 2,
  profile: { address: "sir", name: "", dayStart: 420, dayEnd: 1380 },
  voice: { handsFree: false, voiceURI: "", rate: 1, alerts: true, heads: 5, keepAwake: false },
  days: {},            // { "YYYY-MM-DD": { blocks: [...] } }
  inbox: [],           // unscheduled tasks
  gym: { split: "ppl", idx: 0, override: null, overrideDate: null, log: [] , weights: {} },
  band: { instrument: "bass", songs: [], log: [], techIdx: 0 },
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
  else migrateV1();
  S.chat = (S.chat || []).slice(-60);
  return S;
}

// Bring tasks over from the previous PG Planner version (pgplanner.v1)
function migrateV1() {
  const r = ls.get("pgplanner.v1") || ls.get("myplanner.v2") || ls.get("myplanner.v1");
  if (!r) return;
  try {
    const o = JSON.parse(r);
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
  } catch {}
}

export function save() { ls.set(KEY, JSON.stringify(S)); }
export function day(d = today()) { return (S.days[d] = S.days[d] || { blocks: [] }); }
export function sortedBlocks(d = today()) { return day(d).blocks.slice().sort((a, b) => a.start - b.start || a.end - b.end); }
export function reset() { S = DEFAULTS(); save(); }
export function replace(o) { S = merge(DEFAULTS(), o); save(); }
