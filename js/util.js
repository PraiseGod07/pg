// Shared helpers: dates, minutes-of-day, formatting.
export const pad = n => String(n).padStart(2, "0");
export const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
export const today = () => ymd(new Date());
export const addDays = (s, n) => { const d = new Date(s + "T00:00"); d.setDate(d.getDate() + n); return ymd(d); };
export const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 24h minutes -> "8:30 AM"
export function fmtTime(m, opts = {}) {
  m = ((Math.round(m) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60), mi = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const ap = h < 12 ? "AM" : "PM";
  if (opts.short) return h12 + (mi ? ":" + pad(mi) : "");
  return h12 + ":" + pad(mi) + (opts.noAp ? "" : " " + ap);
}
// For speech: "8:30 AM" -> "8:30 a.m.", "5:00 PM" -> "5 p.m."
export function sayTime(m) {
  m = ((Math.round(m) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60), mi = m % 60;
  if (m === 720) return "noon";
  if (m === 0) return "midnight";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return h12 + (mi ? ":" + pad(mi) : "") + (h < 12 ? " AM" : " PM");
}
export function fmtDur(min) {
  min = Math.round(min);
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return m + " min";
  if (!m) return h + " hr";
  return h + " hr " + m + " min";
}
export function sayDur(min) {
  const h = Math.floor(min / 60), m = min % 60;
  const hs = h ? (h === 1 ? "1 hour" : h + " hours") : "";
  const ms = m ? m + " minutes" : "";
  if (h && m === 30) return h === 1 ? "an hour and a half" : h + " and a half hours";
  return [hs, ms].filter(Boolean).join(" and ") || "0 minutes";
}
export function fmtDay(s, long) {
  const t = today();
  if (!long) {
    if (s === t) return "Today";
    if (s === addDays(t, 1)) return "Tomorrow";
    if (s === addDays(t, -1)) return "Yesterday";
  }
  return new Date(s + "T00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}
export const dayName = s => new Date(s + "T00:00").toLocaleDateString(undefined, { weekday: "long" });
export const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
