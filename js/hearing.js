// Cleans up misheard or mistyped words using the words around them.
// Example: "you can end the corner now" -> "you can end the call now".
// Only fixes a word when the sentence around it makes the real word clear, so normal sentences are left alone.
const FIXES = [
  // the call ("in the corner" alone stays as it is: only fixed when he is clearly telling PG to stop)
  [/\b(?:end|ens|send) (the|this|our) (?:corner|cool|car|core|coal|cole|caul|cold|court|curl|calm|col|cord|cal|kohl|collar|caller|corral|carl|kall|coll)\b/gi, "end $1 call"],
  [/(^|\b(?:can|could|please|pg|now|just|you|let's|lets|ok|okay|thanks|thank you) )(?:and|in|ant|hand|end) (the|this|our) (?:call|corner|cool|car|core|coal|cole|caul|court|calm|col|cord|cal|collar|caller|carl)\b/gi, "$1end $2 call"],
  [/\bhang (?:op|out|app|cup)\b(?= (?:now|please|pg|sir)?\s*$)/gi, "hang up"],
  [/\b(?:hand|hang) up the (?:corner|cool|car|core|court)\b/gi, "hang up the call"],
  // PG
  [/^(?:hey|hi|okay|ok) (?:pj|pee gee|p g|bg|b g|tg|t g|pg's|peachy|pc)\b/gi, m => m.replace(/(?:pj|pee gee|p g|bg|b g|tg|t g|pg's|peachy|pc)$/i, "PG")],
  // gym
  [/\b(?:the |my |to |at |for )(?:jim|gem|jem|jen|chim|gin)\b(?! carrey)/gi, m => m.replace(/(?:jim|gem|jem|jen|chim|gin)$/i, "gym")],
  [/\b(?:jim|gem|jem)(?= (?:at|today|tomorrow|tonight|session|workout|day|time|plan|from|for)\b)/gi, "gym"],
  [/\b(?:poll|bull|pole) day\b/gi, "pull day"],
  [/\b(?:lake|lag|lead|lack) day\b/gi, "leg day"],
  [/\b(?:posh|bush|push's) day\b/gi, "push day"],
  [/\b(?:bench dress|bench breast|bench prez)\b/gi, "bench press"],
  [/\b(?:try sips|tri cep|tricep's|trips)\b(?= (?:pushdown|push down|extension|exercise|workout|dips))/gi, "triceps"],
  // bass
  [/\bbase (lesson|lessons|practice|guitar|line|lines|course|scale|scales|session|player|tab|tabs)\b/gi, "bass $1"],
  [/\b(?:play|practice|practise|learn|learning) (?:the )?base\b/gi, m => m.replace(/base$/i, "bass")],
  // Bible
  [/\b(?:bibo|bible's|by bill|bye bill)\b(?= (?:reading|verse|plan|study|chapter))/gi, "Bible"],
  // Cantonese
  [/\b(?:can tunes|cantoness|canton ease|cantonis|canto knees|counter knees)\b/gi, "Cantonese"],
  // schedule / reminders
  [/\b(?:shed ule|sched you'll|schedule's)\b/gi, "schedule"],
  [/\b(?:re mind|remind me too)\b/gi, "remind me"],
  [/\b(?:a sign meant|a signment|assignmint)\b/gi, "assignment"],
  [/\bat (\d{1,2}) (?:p m|pee em|p.m)\b/gi, "at $1 pm"],
  [/\bat (\d{1,2}) (?:a m|a.m)\b/gi, "at $1 am"]
];

// Common typing slips.
const TYPOS = { teh: "the", adn: "and", waht: "what", hwo: "how", tommorow: "tomorrow", tommorrow: "tomorrow", tomorow: "tomorrow", tonite: "tonight", excercise: "exercise", exersice: "exercise", exercize: "exercise", workot: "workout", shedule: "schedule", scedule: "schedule", calender: "calendar", remmber: "remember", rember: "remember", recieve: "receive", wierd: "weird", definately: "definitely", untill: "until", wich: "which", wat: "what", becuase: "because", beacuse: "because", pls: "please", plz: "please", thx: "thanks", ur: "your", u: "you", r: "are", tmrw: "tomorrow", tmr: "tomorrow", rn: "right now", bc: "because", abt: "about", wanna: "want to", gonna: "going to", gotta: "got to" };

export function clean(text) {
  let t = String(text || "");
  for (const [re, to] of FIXES) t = t.replace(re, to);
  t = t.replace(/\b[A-Za-z]+\b/g, w => { const f = TYPOS[w.toLowerCase()]; return f ? (w[0] === w[0].toUpperCase() && w.length > 1 ? f[0].toUpperCase() + f.slice(1) : f) : w; });
  return t.replace(/\s+/g, " ").trim();
}
