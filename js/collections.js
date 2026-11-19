import { uid } from "./util.js";
const key = s => String(s || "").toLowerCase().replace(/^(?:the|my|a|an)\s+/i, "").replace(/\s+(?:list|folder|category|notebook|tracker)$/i, "").replace(/[?.!]$/, "").replace(/\s+/g, " ").trim();
const builtIn = /^(?:timetable|schedule|calendar|(?:everyday|daily) (?:tasks?|routines?|reminders?)|habits|assignments?|school(?:work)?|homework|goals?|gym|workout|(?:push|pull|leg|legs) day|food|pantry|recipes?|shopping|bible|bass|notes?|cantonese)$/i;
export function collectionCommand(text) {
  const t = String(text).trim();
  let m;
  if ((m = t.match(/^(?:create|start|make|new)(?: a)? (list|category|folder|tracker|log)(?: called| named| for) (.+)$/i))) return { op: "create", name: key(m[2]), kind: /tracker|log/i.test(m[1]) ? m[1].toLowerCase() : "list" };
  if ((m = t.match(/^(?:save|store|file|keep)(?: this)? (?:under|in|into) (.+?):\s*(.+)$/i))) return { op: "add", name: key(m[1]), text: m[2].trim() };
  if ((m = t.match(/^(add|put|save|store|log|record|file|keep) (.+?) (?:to|in|into|under|on) (.+)$/i))) {
    const name = key(m[3]);
    if (!name || builtIn.test(name) || /\b(?:today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|am|pm)\b|\d:\d|\bthe (?:gym|library|campus)\b/i.test(m[3])) return null;
    if (!/^(?:my |the )| (?:list|folder|tracker|category)$|^(?:log|record) /i.test(m[3]) && !/^(?:log|record|store|file|save) /i.test(t)) return null;
    return { op: "add", name, text: m[2], kind: /^(log|record)$/i.test(m[1]) ? "tracker" : "list" };
  }
  if ((m = t.match(/^(?:rename) (?:my )?(.+?) (?:category )?to (.+)$/i))) return { op: "rename", name: key(m[1]), to: key(m[2]) };
  if ((m = t.match(/^merge (?:my )?(.+?) into (?:my )?(.+)$/i))) return { op: "merge", name: key(m[1]), to: key(m[2]) };
  if ((m = t.match(/^(?:delete|remove) (?:the |my )?(?:category|list|tracker) (.+)$/i))) return { op: "delete", name: key(m[1]) };
  if ((m = t.match(/^(remove|delete|tick off|mark done) (.+?) (?:from|in|on) (?:my )?(.+)$/i))) return { op: /tick|done/i.test(m[1]) ? "done" : "remove", name: key(m[3]), text: m[2] };
  if ((m = t.match(/^(?:what(?:'s|’s| is) in|show|read) (?:my )?(.+?)\??$/i))) return { op: "show", name: key(m[1]) };
  return null;
}
export const findCollection = (list, name) => list.find(c => [c.name, ...(c.aliases || [])].some(n => key(n) === key(name)));
export const reservedCollection = name => !key(name) || builtIn.test(key(name));
export const collectionTotals = collection => Object.entries(collection.items.reduce((totals, item) => {
  if (Number.isFinite(item.amount) && item.unit) totals[item.unit] = (totals[item.unit] || 0) + item.amount;
  return totals;
}, Object.create(null))).map(([unit, amount]) => `${+amount.toFixed(6)} ${unit}`);
export function mergeCollections(list, source, target) {
  if (source === target || !list.includes(source) || !list.includes(target)) throw new Error("Choose two different collections.");
  const ids = new Set(target.items.map(i => i.id));
  for (const item of source.items) target.items.push(ids.has(item.id) ? { ...item, id: uid() } : item);
  target.aliases = [...new Set([...(target.aliases || []), source.name, ...(source.aliases || [])])];
  return list.filter(c => c !== source);
}
export function saveCollection(list, name, text, kind = "list") {
  name = key(name);
  if (reservedCollection(name)) throw new Error("That name is already used by a built-in section.");
  let c = findCollection(list, name);
  const created = !c;
  if (!c) { c = { id: uid(), name: name[0].toUpperCase() + name.slice(1), aliases: [], kind, items: [], made: Date.now() }; list.push(c); }
  if (text) {
    const number = String(text).match(/^(-?\d+(?:\.\d+)?)\s+([\p{L}]+)(?:\b|$)/u);
    c.items.push({ id: uid(), text: String(text).trim(), tags: [], done: false, ts: Date.now(), ...(number ? { amount: +number[1], unit: number[2] } : {}) });
  }
  return { c, created };
}
