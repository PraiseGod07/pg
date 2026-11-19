import { calendarDate } from "./dates.js";
import { addDays } from "./util.js";

const MONTH = "january february march april may june july august september october november december".split(" ");
const numbers = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const dateStr = (year, month, day) => new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
export function goalDeadline(input, base, termEnd) {
  const q = String(input || "").toLowerCase(), y = +base.slice(0, 4), mo = +base.slice(5, 7) - 1;
  let m;
  if (/\b(?:end of (?:this |the )?term|this term)\b/.test(q)) return termEnd || null;
  if (/\b(?:month end|end of (?:this |the )?month|this month)\b/.test(q)) return dateStr(y, mo + 1, 0);
  if (/\bend of (?:this |the )?year\b/.test(q)) return `${y}-12-31`;
  if ((m = q.match(new RegExp(`\\bend of (${MONTH.join("|")})\\b`)))) {
    const i = MONTH.indexOf(m[1]); return dateStr(y + (i < mo ? 1 : 0), i + 1, 0);
  }
  if ((m = q.match(/\bin (\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten) (days?|weeks?|months?|years?)\b/))) {
    const count = numbers[m[1]] || +m[1];
    if (/day|week/.test(m[2])) return addDays(base, count * (/week/.test(m[2]) ? 7 : 1));
    const months = count * (/year/.test(m[2]) ? 12 : 1), last = +dateStr(y, mo + months + 1, 0).slice(-2);
    return dateStr(y, mo + months, Math.min(last, +base.slice(-2)));
  }
  if ((m = q.match(/(?:^|\b(?:by|due|on) )(?:the )?(\d{1,2})(?:st|nd|rd|th)\b/))) {
    const n = +m[1];
    if (n < 1 || n > 31) return null;
    for (let i = 0; i <= 2; i++) {
      const result = dateStr(y, mo + i, n);
      if (+result.slice(-2) === n && result >= base) return result;
    }
  }
  if (/\bthis week\b/.test(q)) return addDays(base, (7 - new Date(`${base}T12:00:00Z`).getUTCDay()) % 7);
  try {
    const d = calendarDate(q, base);
    return d && /\bbefore\b/.test(q) ? addDays(d, -1) : d;
  } catch { return null; }
}
export function parseGoal(input, base, termEnd, remindEvery = 14, qualifier = "") {
  let text = String(input).trim().replace(/[.!?]+$/, "");
  const cue = `${qualifier} ${text}`;
  const explicit = /\b(?:long[- ]term|my dream|someday|in (?:five|5) years)\b/i.test(cue) ? "long" : /\b(?:short[- ]term|this (?:week|month|term))\b/i.test(cue) ? "short" : "";
  let due = null;
  const deadline = text.match(/(?:,\s*|\s+)((?:by|before|due|in)\s+.+)$/i);
  if (deadline) {
    due = goalDeadline(deadline[1], base, termEnd);
    if (due || /end of (?:this |the )?term/i.test(deadline[1])) text = text.slice(0, deadline.index).trim();
  } else if (/\bthis (?:week|month|term)\b/i.test(cue)) due = goalDeadline(cue, base, termEnd);
  return { text, term: explicit || (due && due <= goalDeadline("in six months", base) ? "short" : "long"), due, made: base, status: "active", remindEvery, notes: "", lastRemind: null };
}
export function goalCommand(text) {
  const s = String(text).trim().replace(/^(?:(?:ok(?:ay)?|so|hey|pg|please|and|also)[ ,]+)+/i, "").replace(/[.!?]+$/, "");
  const m = s.match(/^((?:short[- ]term|long[- ]term) goal|my dream)\s*:\s*(.+)$/i)
    || s.match(/^((?:one of )?my (?:new |main |big |biggest )?goals?(?: (?:for )?this (?:year|month|week|semester|term))?) (?:is|are|will be) (?:to )?(.+)$/i)
    || s.match(/^((?:add|set|save|make) (?:a |another |new )*goal(?: for me)?|i(?:'ve| have) (?:a|got a) (?:new )?goal)(?: to| of| that|:)?\s+(.+)$/i);
  return m ? { text: m[2], qualifier: m[1] } : null;
}
export function normalizeGoal(g) {
  return { term: "long", due: null, status: "active", remindEvery: 14, lastRemind: null, notes: "", ...g };
}
export const activeGoals = state => (state.goals || []).filter(g => !g.status || g.status === "active")
  .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
export const daysLeft = (date, base) => Math.round((Date.parse(date) - Date.parse(base)) / 86400e3);
