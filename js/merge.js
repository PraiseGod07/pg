// Three-way sync. The baseline is the last cloud state this device acknowledged,
// not the device's wall clock. An empty/new device cannot delete another's data.
const copy = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = v => v && typeof v === "object" && !Array.isArray(v);
const identity = v => object(v) ? v.id != null ? "id:" + v.id
  : v.ex ? "ex:" + v.ex
  : v.i != null ? `lesson:${v.date || ""}:${v.i}`
  : v.date && v.key ? `session:${v.date}:${v.key}`
  : v.date && v.idx != null ? `step:${v.date}:${v.idx}:${!!v.repeat}`
  : v.date && v.from != null && v.to != null ? `reading:${v.date}:${v.from}:${v.to}`
  : v.key && !v.date ? "key:" + v.key
  : JSON.stringify(v) : JSON.stringify(v);

function merge(base, local, remote, initial, defaults) {
  if (equal(local, remote)) return copy(local);
  if (!initial && equal(local, base)) return copy(remote);
  if (!initial && equal(remote, base)) return copy(local);
  if (Array.isArray(local) || Array.isArray(remote)) {
    const b = new Map((Array.isArray(base) ? base : []).map(x => [identity(x), x]));
    const l = new Map((Array.isArray(local) ? local : []).map(x => [identity(x), x]));
    const r = new Map((Array.isArray(remote) ? remote : []).map(x => [identity(x), x]));
    const result = [];
    for (const id of new Set([...l.keys(), ...r.keys(), ...b.keys()])) {
      // A deletion relative to a known baseline wins over stale/concurrent edits.
      if (!initial && b.has(id) && (!l.has(id) || !r.has(id))) continue;
      const value = merge(b.get(id), l.get(id), r.get(id), initial, undefined);
      if (value !== undefined) result.push(value);
    }
    return result;
  }
  if (object(local) || object(remote)) {
    const result = {};
    for (const k of new Set([...Object.keys(base || {}), ...Object.keys(local || {}), ...Object.keys(remote || {})])) {
      if (["__proto__", "prototype", "constructor"].includes(k)) continue;
      const v = merge(base?.[k], local?.[k], remote?.[k], initial, defaults?.[k]);
      if (v !== undefined) result[k] = v;
    }
    return result;
  }
  if (initial) {
    // On first connection, prefer existing cloud settings over device defaults.
    if (remote === undefined || equal(remote, defaults)) return copy(local === undefined ? remote : local);
    return copy(remote);
  }
  return copy(local); // genuine same-field conflict: preserve this device's pending edit
}

export function mergeState(base, local, remote, defaults = {}) {
  const initial = !base;
  const out = merge(base || {}, local || {}, remote || {}, initial, defaults);
  // A timetable move keeps its ID. Never leave the same block on two days.
  const positions = s => new Map(Object.entries(s?.days || {}).flatMap(([d, v]) => (v.blocks || []).map(b => [b.id, d])));
  const bp = positions(base), lp = positions(local), rp = positions(remote);
  const seen = new Set();
  for (const [d, v] of Object.entries(out.days || {})) v.blocks = (v.blocks || []).filter(b => {
    if (!initial && bp.has(b.id) && (!lp.has(b.id) || !rp.has(b.id))) return false;
    const chosen = !initial && lp.has(b.id) && (!bp.has(b.id) || lp.get(b.id) !== bp.get(b.id)) ? lp.get(b.id)
      : rp.get(b.id) || lp.get(b.id);
    if (chosen && chosen !== d || seen.has(b.id)) return false;
    seen.add(b.id); b.date = d; return true;
  });
  if (out.chat) out.chat = out.chat.sort((a, b) => (a.t || a.ts || 0) - (b.t || b.ts || 0)).slice(-60);
  if (out.notes) out.notes.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return out;
}
