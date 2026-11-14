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
  s = yue.length || full ? s : trimForVoice(s);
  return s.replace(/\s*qqyue(\d+)qq\s*/g, (_, i) => ` ⟦yue:${yue[+i]}⟧ `).trim();
}
// Long replies: say the first part, then point to the screen like a person would.
function trimForVoice(s, max = 420) {
  if (s.length <= max) return s;
  const sents = s.match(/[^.?]+(?:[.?]+|$)/g) || [s];
  let out = "";
  for (const x of sents) { if ((out + x).length > max && out) break; out += x; }
  const tail = /\?\s*$/.test(s) ? " " + sents.at(-1).trim() : "";
  return (out.trim() + " The rest is on your screen." + (tail && !out.includes(tail.trim()) ? tail : "")).trim();
}
// Group sentences into natural phrases so the voice doesn't stop after every one.
export function chunks(s, max = 190) {
  const sents = String(s).replace(/\s+/g, " ").match(/(?:[^.?]|\.(?=\d)|\b(?:Mr|Mrs|Dr|St|No)\.)+(?:[.?]+|$)/g) || [s];
  const out = []; let cur = "";
  for (let x of sents) { x = x.trim(); if (!x) continue;
    if (cur && (cur + " " + x).length > max) { out.push(cur); cur = x; } else cur = cur ? cur + " " + x : x; }
  if (cur) out.push(cur);
  return out;
}
// Rank system voices: neural/natural voices first, then good male English voices.
export function voiceScore(v) {
  const n = v.name || "";
  let s = 0;
  if (/natural|neural|online/i.test(n)) s += 60;           // Edge / Windows neural voices
  if (/premium|enhanced|siri/i.test(n)) s += 50;            // Apple high-quality voices
  if (/^google/i.test(n)) s += 35;                          // Chrome cloud voices
  if (/andrew|brian|guy|ryan|christopher|eric|davis|daniel|arthur|evan|aaron|oliver|nathan|tom|google uk english male/i.test(n)) s += 20;
  if (/en[-_]GB/i.test(v.lang)) s += 6; else if (/en[-_]US/i.test(v.lang)) s += 5; else if (/^en/i.test(v.lang)) s += 2;
  if (/compact|espeak|zarvox|trinoids|bad news|bells|bubbles|cellos|whisper|wobble|jester|organ|albert|boing|deranged|hysterical|pipe|superstar|grandpa|grandma|rocko|shelley|flo|reed|sandy|eddy/i.test(n)) s -= 80;
  if (v.localService === false) s += 3;
  if (isMale(v)) s += 300;
  else if (/female|samantha|victoria|zira|susan|hazel|karen|moira|tessa|salli|jenny|aria|sonia|libby|sinji/i.test(n)) s -= 200;
  return s;
}
export const isMale = v => /\bmale\b|andrew|brian|guy|ryan|christopher|eric|davis|daniel|arthur|evan|aaron|oliver|nathan|thomas|\btom\b|\balex\b|david|george|james|mark|fred|rishi|ravi|danny|wanlung|wan lung|yunlong/i.test(v?.name || "")
  && !/\bfemale\b/i.test(v?.name || "");
export const isNatural = v => /natural|neural|online|premium|enhanced|siri/i.test(v?.name || "");
