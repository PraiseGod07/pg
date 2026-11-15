const WD = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
export function calendarDate(text, base) {
  const s = String(text).toLowerCase();
  let date = s.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1], m;
  const months = "(" + MONTHS.join("|") + "|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)";
  if (!date) {
    const a = s.match(new RegExp(`\\b${months}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`));
    const b = !a && s.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${months}(?:,?\\s+(\\d{4}))?\\b`));
    if (a || b) {
      const x = a || b, month = MONTHS.findIndex(v => v.startsWith((a ? x[1] : x[2]).slice(0, 3))) + 1;
      date = `${x[3] || base.slice(0, 4)}-${String(month).padStart(2, "0")}-${String(a ? x[2] : x[1]).padStart(2, "0")}`;
    }
  }
  if (date) {
    const d = new Date(date + "T12:00:00Z");
    if (!Number.isFinite(+d) || d.toISOString().slice(0, 10) !== date) throw new Error("That calendar date is invalid. Which date should I use?");
    const weekday = s.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/)?.[1];
    if (weekday && WD[d.getUTCDay()] !== weekday) throw new Error(`${date} is ${WD[d.getUTCDay()]}, not ${weekday}. Which date did you mean?`);
    return date;
  }
  const add = n => { const d = new Date(base + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  if (/\btomorrow\b/.test(s)) return add(1);
  if (/\b(?:today|tonight|this morning|this afternoon|this evening)\b/.test(s)) return base;
  if ((m = s.match(/\b(next |this |on )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/))) {
    const diff = (WD.indexOf(m[2]) - new Date(base + "T12:00:00Z").getUTCDay() + 7) % 7;
    return add(diff === 0 && m[1] === "next " ? 7 : diff);
  }
  return null;
}
