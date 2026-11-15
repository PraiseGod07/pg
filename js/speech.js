// Turns on-screen text into something that sounds natural when spoken.
const h12 = (h, m) => {
  h = +h; m = +m;
  if (h === 0 && m === 0) return "midnight";
  if (h === 12 && m === 0) return "noon";
  const ap = h < 12 || h === 24 ? "AM" : "PM", hh = h % 12 || 12;
  return m ? `${hh}:${String(m).padStart(2, "0")} ${ap}` : `${hh} ${ap}`;
};
export function speakable(t, full) {
  // Keep Cantonese marked for the Hong Kong voice: ⟦yue:…⟧
  const yue = [];
  let s = String(t || "").replace(/⟦yue:([^⟧]*)⟧/g, (_, z) => { yue.push(z); return ` qqyue${yue.length - 1}qq `; });
  s = s.replace(/<[^>]+>/g, " ")                                   // stray html
    .replace(/https?:\/\/\S+/g, "")                                // links
    .replace(/\s*\([^)]*[\u3400-\u9fff][^)]*\)/g, "")              // (Chinese names)
    .replace(/[\u3400-\u9fff]+/g, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu, "")          // emoji
    .replace(/\*\*|__|`|#+\s/g, "")                                // markdown
    .replace(/^\s*[-•·]\s+/gm, "")                                 // bullets
    .replace(/\s+[·•|]\s+/g, ", ")                                 // "Bass · Lesson 1"
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, date => {
      const d = new Date(date + "T12:00:00Z");
      return Number.isFinite(+d) ? d.toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }) : date;
    })
    .replace(/\s*[—–]\s*(?=\D)/g, ", ")                            // dashes as pauses
    .replace(/\b([01]?\d|2[0-4]):([0-5]\d)\s*[–-]\s*([01]?\d|2[0-4]):([0-5]\d)\b/g, (_, a, b, c, d) => `${h12(a, b)} to ${h12(c, d)}`)
    .replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b(?!\s*(?:AM|PM|am|pm))/g, (_, a, b) => h12(a, b))
    .replace(/(\d)\s*[–-]\s*(\d)/g, "$1 to $2")
    .replace(/HK\$\s?(\d[\d,.]*)/g, "$1 Hong Kong dollars")
    .replace(/\$(\d[\d,.]*)/g, "$1 dollars")
    .replace(/(\d)\s?g\b/g, "$1 grams")
    .replace(/(\d)\s?kg\b/g, "$1 kilos")
    .replace(/(\d)\s?ml\b/g, "$1 millilitres")
    .replace(/(\d)\s?kcal\b/g, "$1 calories")
    .replace(/(\d)\s?mins?\b/g, "$1 minutes")
    .replace(/(\d)\s?hrs?\b/g, "$1 hours")
    .replace(/(\d)\s?×/g, "$1 times").replace(/×/g, " by ")
    .replace(/°C/g, " degrees").replace(/%/g, " percent")
    .replace(/\s&\s/g, " and ").replace(/\be\.g\.,?/gi, "for example").replace(/\bi\.e\.,?/gi, "that is")
    .replace(/\bvs\.?\b/g, "versus").replace(/\betc\.?/g, "and so on")
    .replace(/\b(\d+)\/(\d+)\b(?! ?\d)/g, (m, a, b) => +b <= 31 && +a <= 31 ? m : `${a} out of ${b}`)
    .replace(/[“”"]/g, "").replace(/:\s+(?=[A-Z])/g, ", ")
    .replace(/\s*\n+\s*/g, ". ").replace(/\.\s*\./g, ".")
    .replace(/\s+([,.?])/g, "$1").replace(/\s{2,}/g, " ").trim();
  return s.replace(/\s*qqyue(\d+)qq\s*/g, (_, i) => ` ⟦yue:${yue[+i]}⟧ `).trim();
}
// Bound EVERY utterance, including a long sentence with no punctuation.
// Short phrases avoid mobile/Chromium long-utterance stalls without losing words.
export function chunks(s, max = 150) {
  const sents = String(s).replace(/\s+/g, " ").match(/(?:[^.?]|\.(?=\d)|\b(?:Mr|Mrs|Dr|St|No)\.)+(?:[.?]+|$)/g) || [s];
  const out = []; let cur = "";
  for (let x of sents) { x = x.trim(); if (!x) continue;
    for (const word of x.split(/\s+/).flatMap(w => w.length > max ? w.match(new RegExp(`.{1,${max}}`, "g")) : [w])) {
      if (cur && (cur + " " + word).length > max) { out.push(cur); cur = ""; }
      cur = cur ? cur + " " + word : word;
    }
  }
  if (cur) out.push(cur);
  return out;
}
// Rank by quality and language, without excluding any gender.
export function voiceScore(v) {
  const n = v.name || "";
  let s = 0;
  if (/natural|neural|online/i.test(n)) s += 60;           // Edge / Windows neural voices
  if (/premium|enhanced|siri/i.test(n)) s += 50;            // Apple high-quality voices
  if (/^google/i.test(n)) s += 35;                          // Chrome cloud voices
  if (/en[-_]GB/i.test(v.lang)) s += 6; else if (/en[-_]US/i.test(v.lang)) s += 5; else if (/^en/i.test(v.lang)) s += 2;
  if (/compact|espeak|zarvox|trinoids|bad news|bells|bubbles|cellos|whisper|wobble|jester|organ|albert|boing|deranged|hysterical|pipe|superstar|grandpa|grandma|rocko|shelley|flo|reed|sandy|eddy/i.test(n)) s -= 80;
  if (v.localService === false) s += 3;
  return s;
}
export const isMale = v => {
  const id = `${v?.name || ""} ${v?.voiceURI || ""}`;
  return !/\bfemale\b/i.test(id) && (/\bmale\b|andrew|brian|\bguy\b|ryan|christopher|eric|davis|daniel|arthur|evan|aaron|oliver|nathan|thomas|\btom\b|\balex\b|david|george|james|mark|fred|rishi|ravi|danny|wanlung|wan lung|yunlong/i.test(id)
    || /en[-_]au[-_]x[-_](?:aub|aud)|en[-_]gb[-_]x[-_](?:gbb|gbd|rjs)|en[-_]in[-_]x[-_](?:end|ene)|en[-_]us[-_]x[-_](?:iol|iom|tpd)/i.test(id));
};
export const isNatural = v => /natural|neural|online|premium|enhanced|siri/i.test(v?.name || "");
