// PG — app controller: views, command handling, reminders.
import { S, load, save, day, sortedBlocks, reset, replace, hydrate, importV1, flush } from "./store.js";
import { speakable, isNatural } from "./speech.js";
import { CATS, EXERCISES, SPLITS, DEFAULT_MIN, GYM_WARMUP, stageOf } from "./library.js";
import { intent, parseSchedule, matchBlock, parseClock, normalize, isEndCall } from "./nlu.js";
import { placeItems, conflicts, firstGap } from "./scheduler.js";
import { Voice, chime } from "./voice.js";
import * as C from "./coach.js";
import * as BS from "./bass.js";
import * as B from "./bible.js";
import * as M from "./brain.js";
import * as LN from "./learn.js";
import * as F from "./food.js";
import * as SC from "./school.js";
import * as AI from "./ai.js";
import * as AG from "./agent.js";
import * as SY from "./sync.js";
import { PG_CLOUD, PG_VERSION } from "./config.js";
import * as WEB from "./web.js";
import * as HR from "./hearing.js";
import { sayLike } from "./canto.js";
import * as D from "./daily.js";
import { weekOf, planWeek, planSummary } from "./timetable.js";
import { cloudApi, VOICES as CLOUD_VOICES } from "./cloudvoice.js";
import { today, addDays, nowMin, uid, esc, fmtTime, sayTime, fmtDur, sayDur, fmtDay, pad } from "./util.js";

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const ui = { view: "today", date: today(), openEx: null, playing: new Set(), autoClose: false, topic: null, folder: "all", q: "", gymTab: "workout", openRec: null, openTip: null };

await hydrate();
load();
C.syncCustom();
BS.bass(); B.bible(); M.notes(); LN.tracks();
const addr = () => S.profile.address || "sir";
const hello = () => `Hi ${addr()}. How may I help you?`;
const lc = s => s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
const ucf = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const pickOne = a => a[Math.floor(Math.random() * a.length)];

// ================= Voice wiring =================
const voice = new Voice({
  onState: m => paintVoice(m),
  onHeard: t => { $("#heard").textContent = t ? "“" + t + "”" : ""; },
  onWake: () => { openAssistant(true); $("#heard").textContent = ""; },
  onGreet: () => { const g = hello(); pushMsg("pg", g); voice.say(g, () => voice.listen("command")); },
  onIdle: () => {
    // On a call, silence just means he's thinking. Wait patiently, check in once, then step back.
    if (voice.call && !ui.checkedIn) { ui.checkedIn = true; voice.listen("command"); return; }
    if (voice.call) { ui.checkedIn = false; const t = `I'll be here. Just say Hi PG when you need me, ${addr()}.`; pushMsg("pg", t); voice.say(t, () => voice.hangUp()); return; }
    voice.stop(); voice.afterReply(); setStatus("Say “Hi PG”");
  },
  onHangUp: () => { ui.pending = null; paintVoice(voice.mode); },
  onCommand: text => { ui.checkedIn = false; $("#heard").textContent = ""; run(text, true); },
  onError: code => {
    if (code === "blocked" && S.voice.handsFree) { needTap(); return; }
    const msg = { unsupported: "Voice isn't supported in this browser. Use Chrome, Edge or Safari, or type.", blocked: "Microphone is blocked. Allow it in your browser settings.", network: "Speech service unreachable. Check your connection.", nomic: "No microphone found." }[code];
    if (msg) toast(msg);
    if (code === "nomic") { S.voice.handsFree = false; save(); if (ui.view === "settings") render(); }
  }
});
voice.voiceURI = S.voice.voiceURI; voice.rate = S.voice.rate; voice.pickVoice();
// PG's natural voice and hearing run on PG Cloud once its code is version 2 or newer.
const CV = { v: 0 };
voice.cloudVoice = S.voice.cloudVoice || "apollo";
voice.cloud = { ...cloudApi(() => SY.url(), () => S.dev.cloud?.token || ""), ok: () => SY.on() && CV.v >= 2 && S.voice.natural === true };   // paid cloud voice is opt-in only; free phone voice by default
async function probeCloud() {
  if (!SY.on()) { CV.v = 0; return; }
  try { const j = await (await fetch(SY.url() + "/", { cache: "no-store" })).json(); CV.v = +j.v || 1; } catch { return; }
  if (ui.view === "settings") render();
}
probeCloud();

function paintVoice(m) {
  $("#orb").dataset.state = m; $("#dockOrb").dataset.state = m;
  const onCall = voice.call && m !== "off" && m !== "wake";
  setStatus(onCall ? { command: "Go ahead, I'm listening", thinking: "Thinking…", speaking: "Speaking · tap to cut in" }[m] : { off: voice.supported ? "Tap to talk" : "Type to PG", wake: "Say “Hi PG”", command: "Listening…", thinking: "Thinking…", speaking: "Speaking…" }[m]);
  $("#listenPill").textContent = onCall ? "On a call with PG" : m === "wake" ? "Listening for “Hi PG”" : m === "command" ? "Listening…" : "";
  $("#endCall").hidden = !onCall;
  document.body.classList.toggle("on-call", onCall);
  if (m === "command" || m === "speaking" || m === "thinking") openAssistant(false);
  if ((m === "wake" || m === "off") && ui.autoClose && !voice.call) { ui.autoClose = false; setTimeout(() => { if (voice.mode === "wake" || voice.mode === "off") closeAssistant(); }, 1800); }
  keepAwake();
}
function setStatus(t) { $("#orbStatus").textContent = t; }

// ================= Assistant panel =================
const isMobile = () => matchMedia("(max-width: 960px)").matches;
function openAssistant() { if (!isMobile()) return; $("#assistant").classList.add("open"); $("#scrim").hidden = false; }
function closeAssistant() { $("#assistant").classList.remove("open"); $("#scrim").hidden = true; }
function pushMsg(who, text, html) {
  S.chat.push({ id: uid(), who, text, html: html || "", t: Date.now() });
  S.chat = S.chat.slice(-60); save();
  paintChat();
}
function paintChat() {
  const el = $("#chat");
  el.innerHTML = S.chat.length ? S.chat.slice(-30).map(m => `<div class="msg ${m.who}">${m.html || esc(m.text)}</div>`).join("") : "";
  el.scrollTop = el.scrollHeight;
}
const SUGGEST = {
  today: ["What's next?", "What should I eat today?", "Is my plan realistic?"],
  school: ["What's due?", "Plan my assignments", "I finish school at 4"],
  bass: ["What's my lesson?", "Lesson complete", "Not yet"],
  bible: ["Today's reading", "I read today's reading", "What did I learn?"],
  gym: ["What should I eat today?", "Make my shopping list", "Give me a recipe"],
  notes: ["What have I learned?", "Save a revelation: ", "I'm learning SolidWorks"],
  settings: ["Hi PG", "What's next?", "Read my schedule"]
};
function paintSuggest() {
  $("#suggest").innerHTML = (SUGGEST[ui.view] || SUGGEST.today).map(s => s.endsWith(": ")
    ? `<button class="chip" data-fill="${esc(s)}">${esc(s.replace(/: $/, ""))}</button>`
    : `<button class="chip" data-say="${esc(s)}">${esc(s)}</button>`).join("");
}
// speakable() lives in speech.js
function reply(text, opts = {}) {
  if (ui.quiet) { ui.quiet.push(text); if (opts.view) go(opts.view, opts.date); return; }
  // He told PG new plans: remind him of plans he already had and may have forgotten.
  if (ui.turn && !ui.turn.used && !opts.then) {
    ui.turn.used = true;
    const ex = D.forgotten(ui.turn.before, ui.turn.dates);
    if (ex) { text += " " + ex; if (opts.html) opts.html += `<div style="margin-top:6px">${esc(ex)}</div>`; if (opts.speak) opts.speak += " " + ex; }
  }
  if (ui.sources) {
    const src = ui.sources.slice(0, 3).map(x => { let h = ""; try { h = new URL(x.url).hostname.replace(/^www\./, ""); } catch {} return `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.site || h || x.title)}</a>`; }).filter((v, i, a) => a.indexOf(v) === i).join(" · ");
    opts.html = (opts.html || esc(text)) + `<div class="srcs">${src}</div>`; ui.sources = null;
  }
  pushMsg("pg", text, opts.html);
  if (opts.view) { go(opts.view, opts.date); if (opts.spoken) ui.autoClose = isMobile(); }
  if (S.voice.speak !== false) voice.say(opts.speak || speakable(text, opts.full), opts.then);
  else voice.afterReply();
}

// ================= Command handling =================
async function run(text, spoken = false) {
  text = String(text || "").trim();
  if (!text) { voice.afterReply(); return; }
  // Fix misheard or mistyped words from the words around them ("end the corner" -> "end the call").
  const fixed = HR.clean(text);
  pushMsg("me", fixed);
  if (fixed !== text) S.chat.at(-1).raw = text;
  text = fixed;
  const dates = [...Array(8)].map((_, i) => addDays(today(), i));
  ui.turn = { before: new Set(dates.flatMap(d => (S.days[d]?.blocks || []).map(b => b.id))), dates };
  try { await handle(text, spoken); }
  catch (e) { console.error(e); reply("Sorry, something went wrong. Please try that again."); }
  finally { ui.turn = null; await flush(); if (SY.on()) SY.push(); }
}

const blocksOf = d => sortedBlocks(d);
const live = d => blocksOf(d).filter(b => !b.done && !b.skipped);
function current(d = today()) { const n = nowMin(); return live(d).find(b => b.start <= n && n < b.end) || null; }
function upcoming(d = today()) { const n = nowMin(); return live(d).filter(b => b.start > n); }
function snapshot(d) { return { d, blocks: JSON.parse(JSON.stringify(day(d).blocks)) }; }
function undoable(snap, msg) {
  const list = Array.isArray(snap) ? snap : [snap];
  toast(msg, "Undo", () => { list.forEach(sn => { day(sn.d).blocks = sn.blocks; }); save(); render(); toast("Undone."); });
}
const say = b => `${b.title}, ${sayTime(b.start)} to ${sayTime(b.end)}`;
const markCat = cat => { day(today()).blocks.filter(b => b.cat === cat && !b.done).forEach(b => b.done = true); save(); };
const minsFor = (cat, dflt) => { const b = blocksOf(today()).find(x => x.cat === cat && !x.done); return b ? b.end - b.start : dflt; };
const gymToday = (d = today()) => blocksOf(d).some(b => b.cat === "gym");
const bibleRef = () => { const td = B.todays(); return td && !td.done ? B.refText(td) : ""; };

// Which coach does "complete" refer to?
function context() {
  const n = nowMin(), bl = blocksOf(today());
  const c = bl.find(b => b.start <= n && n < b.end + 30 && !b.done && ["bass", "bible", "learn", "gym"].includes(b.cat));
  if (c) return c.cat;
  if (["bass", "bible", "gym"].includes(ui.view)) return ui.view;
  if (ui.topic) return ui.topic;
  const r = bl.filter(b => b.start <= n && !b.done && ["bass", "bible", "learn", "gym"].includes(b.cat)).pop();
  return r ? r.cat : null;
}

const YES = /^(?:yes|yeah|yea|yep|yup|ya|sure|ok|okay|alright|all right|sounds good|that sounds good|sounds great|good|perfect|great|let's do (?:it|that)|do it|go ahead|please|fine|cool|that works|works for me|i like (?:it|that)|love it|deal|better|much better|that's better)(?: pg| sir| please| thanks?| thank you| then)*$/;
const NO = /^(?:no|nah|nope|not really|no thanks?|no thank you|don't|do not|not now|maybe later|leave it|i'm good|it's fine|keep it)(?: pg| sir| thanks?)*$/;
// Answers that only make sense after PG asked something
// ================= Daily companion =================
const zhSay = z => `⟦yue:${z}⟧`;
// Hong Kong clock: the same verse through 21:00; one Cantonese sentence from 21:01.
function endCall() {
  const minute = nowMin(), hang = { then: () => voice.hangUp() };
  if (minute <= 21 * 60) {
    const v = D.verse();
    const t = `Before you go, ${addr()}, here's a verse for your day. ${v.ref}: ${v.text} ${pickOne(["Have a blessed day.", "Go well today.", "Have a great day."])}`;
    return reply(t, { ...hang, full: true });
  }
  if (minute > 21 * 60) {
    const c = D.teachDaily(), bye = "Good night";
    const text = `Today's Cantonese, ${addr()}: ${c.zh} (say it: ${c.jp}) means "${c.en}" This is the same sentence for today. ${bye}.`;
    const html = `<div>Today's Cantonese. Practise this same sentence today.</div>${cantoCard(c)}<div>${bye}, ${esc(addr())}.</div>`;
    const sp = `Today's Cantonese, ${addr()}. ${zhSay(c.zh)} It means: ${c.en.replace(/\(.*?\)/g, "")} Once more. ${zhSay(c.zh)} ${bye}.`;
    return reply(text, { ...hang, html, speak: speakable(sp, true) });
  }
  return reply(pickOne([`You're welcome, ${addr()}. Talk soon.`, `Anytime, ${addr()}. Ending the call.`, `My pleasure, ${addr()}. Bye for now.`]), hang);
}
function doReport(spoken) {
  const r = D.report();
  let t = `Here's your update, ${addr()}. ${r.text}`;
  if (r.missed.length) {
    const b = r.missed[0];
    t += ` ${r.missed.length === 1 ? "One thing isn't" : r.missed.length + " things aren't"} checked off yet. Did you do ${b.title}? It was at ${sayTime(b.start)}.`;
    ui.pending = { type: "didyou", ids: r.missed.map(x => x.id) };
  } else t += " " + D.goalsLine();
  return reply(t, { view: "today", date: today(), spoken, full: true });
}
const REPORT_RE = /\b(?:what (?:have|did) i (?:do|done|get done|finish(?:ed)?|accomplish(?:ed)?)|what i(?:'ve| have)? (?:done|did|got done)|how (?:am i|have i been|did i) do(?:ing)?(?: today| so far)?|how was my day|(?:progress|daily) (?:report|update)|(?:give me |can i (?:get|have) |i (?:want|need) )?(?:an? |my |the )?(?:quick |full |detailed )?(?:update|report|recap|rundown|summary)(?: (?:of|on|for) (?:what i(?:'ve| have)? (?:done|did)|my day|today|everything|my progress))?$)/;
async function daily(text, bare, spoken) {
  const b = bare.replace(/^(?:(?:ok(?:ay)?|so|hey|pg|please|and|also)[ ,]+)+/, "");
  if (REPORT_RE.test(b) && b.split(" ").length <= 14) return doReport(spoken), true;
  let m;
  if ((m = text.match(/^\s*(?:(?:ok(?:ay)?|so|pg|and|also)[ ,]+)*(?:(?:one of )?my (?:new |main |big |biggest )?goals?(?: for (?:this|the) (?:year|month|week|semester|term))? (?:is|are|will be)|(?:add|set|save|make) (?:a |another |new )*goal(?: for me)?(?: to| that| of|:)?|i(?:'ve| have) (?:a|got a) (?:new )?goal(?: to| of|:)?)\s*(?:to\s+)?(.{3,})$/i))) {
    const g = D.addGoal(m[1]);
    return reply(`Got it, ${addr()}. Your goal: ${g.text}. I'll remind you of it when you ask for an update.`), true;
  }
  if ((m = b.match(/^(?:remove|delete|drop|take off|i finished|i achieved|i reached) (?:the |my )?goal(?: to| about| of)? (.+)$/))) {
    const g = D.removeGoal(m[1]);
    return reply(g ? `Done. I took off ${g.text}.` : `I couldn't find that goal. Your goals are: ${D.goals().map(x => x.text).join(", ") || "none yet"}.`), true;
  }
  if (/\b(?:what are my goals|(?:remind me of|tell me|list|read) my goals|my goals\??$)/.test(b)) {
    const g = D.goals();
    return reply(g.length ? `Your goals are: ${g.map(x => x.text).join(". ")}.` : "You haven't told me any goals yet. Say, my goal is, and I'll save it."), true;
  }
  if (/\bteach me (?:some |one |two |2 |a few |more )?(?:cantonese|canto)\b|\bcantonese (?:lesson|sentences?) (?:now|please)\b/.test(b)) {
    const c = D.teachDaily();
    return reply(`Today's sentence: ${c.zh} (say it: ${c.jp}) means "${c.en}" We'll practise this one today.`,
      { speak: speakable(`Today's sentence. ${zhSay(c.zh)} It means: ${c.en} Once more. ${zhSay(c.zh)}`, true), html: cantoCard(c) }), true;
  }
  if (/\b(?:what|which) cantonese (?:have i|did i) (?:learn|learned|learnt)|\b(?:show|open|read) (?:me )?my cantonese\b|\bmy cantonese (?:sentences|words|list)\b/.test(b)) {
    const l = D.learned();
    openCanto();
    if (!l.length) return reply("You haven't learned any yet. After 9:01 PM, ending a call gives you one sentence to practise that day."), true;
    return reply(`You've learned ${l.length} sentence${l.length === 1 ? "" : "s"}. The latest: ${l[0].zh} means "${l[0].en}"`, { speak: speakable(`You've learned ${l.length}. The latest one. ${zhSay(l[0].zh)} It means: ${l[0].en}`, true) }), true;
  }
  return false;
}
function cantoCard(c) {
  return `<ol class="canto-list"><li><button class="canto-play" data-act="canto-play" data-zh="${esc(c.zh)}" aria-label="Play ${esc(c.en)}"><b lang="zh-HK">${esc(c.zh)}</b><span class="faint">Say it: ${esc(c.jp)}</span><span>${esc(c.en)}</span><span class="faint">Tap to hear it</span></button></li></ol>`;
}
function openCanto() {
  const l = D.learned(), sh = $("#sheet");
  sh.innerHTML = `<h3>Cantonese</h3><p class="note" style="margin:0 0 8px">One sentence per day. Repeat it throughout today. ${l.length} of ${D.CANTO_N} saved. Tap a sentence to hear it.</p>
    ${l.length ? `<ol class="canto-list">${l.map(c => `<li><button class="canto-play" data-act="canto-play" data-zh="${esc(c.zh)}" aria-label="Play ${esc(c.en)}"><b lang="zh-HK">${esc(c.zh)}</b><span class="faint">Say it: ${esc(c.jp)}</span><span>${esc(c.en)}</span></button></li>`).join("")}</ol>` : `<p class="note">Nothing yet. After 9:01 PM, ending a call teaches one sentence for that day.</p>`}
    <div class="sheet-actions"><button class="btn" data-act="canto-more">Practise today's sentence</button><button class="btn ghost" data-act="close-sheet">Close</button></div>`;
  if (!sh.open) sh.showModal();
}
function openGoals() {
  const g = D.goals(), sh = $("#sheet");
  sh.innerHTML = `<h3>Your goals</h3><p class="note" style="margin:0 0 8px">PG reminds you of these when you ask for an update.</p>
    ${g.length ? `<ul class="goal-list">${g.map(x => `<li><span>${esc(x.text)}</span><button class="btn sm ghost" data-act="goal-del" data-id="${x.id}">Remove</button></li>`).join("")}</ul>` : ""}
    <form data-form="goal" class="row"><input class="input" name="g" placeholder="Add a goal" aria-label="New goal" autocomplete="off"><button class="btn primary" type="submit">Add</button></form>
    <div class="sheet-actions"><span></span><button class="btn ghost" data-act="close-sheet">Close</button></div>`;
  if (!sh.open) sh.showModal();
}
function sayCanto(zh) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(zh), v = voice.yueVoice();
    u.lang = v ? v.lang : "zh-HK"; if (v) u.voice = v; u.rate = 0.85;
    speechSynthesis.speak(u);
  } catch { toast("This browser can't speak Cantonese."); }
}

// Ask for what's missing before adding anything to the timetable.
function missingOf(it) { return { time: it.s == null && it.b == null, len: it.e == null && !!it.durDefault }; }
function askLine(it) {
  const m = missingOf(it), name = it.title;
  if (m.time && m.len) return `What time should I put ${name}, and for how long?`;
  if (m.time) return `What time should I put ${name}?`;
  return `How long should ${name} be? It starts at ${sayTime(it.s)}.`;
}
function needsAsk(items) { return items.find(i => i.kind === "event" && !i.ok && (missingOf(i).time || missingOf(i).len)); }

async function followUp(p, bare, text, spoken) {
  if (p.type === "week-complete") {
    const at = parseClock(text);
    const options = blocksOf(today()).filter(b => p.ids.includes(b.id));
    const found = options.filter(b => b.start === at);
    if (found.length !== 1) { ui.pending = p; return reply("What was the start time of the session you finished?"), true; }
    found[0].done = true;
    if (found[0].src === "school") SC.noteDone(found[0]);
    save(); reply(`Marked ${found[0].title} at ${sayTime(found[0].start)} as done.`, { view: "today", date: today(), spoken }); return true;
  }
  if (p.type === "didyou") {
    const [id, ...rest] = p.ids, f = Object.keys(S.days).map(d => (S.days[d].blocks || []).find(x => x.id === id)).find(Boolean);
    let head = "";
    if (YES.test(bare) || /^(?:i did|did it|done|yep i did|already did)/.test(bare)) { if (f) { f.done = true; save(); render(); } head = "Nice, I checked it off."; }
    else if (NO.test(bare) || /^(?:i didn'?t|not yet|didn'?t)/.test(bare)) head = "Okay, I'll leave it open.";
    else return false;
    const nx = rest.map(x => Object.keys(S.days).map(d => (S.days[d].blocks || []).find(b => b.id === x)).find(Boolean)).find(Boolean);
    if (nx) { ui.pending = { type: "didyou", ids: rest.slice(rest.indexOf(nx.id)) }; return reply(`${head} Did you do ${nx.title}? It was at ${sayTime(nx.start)}.`), true; }
    return reply(`${head} ${D.goalsLine()}`, { full: true }), true;
  }
  if (p.type === "clarify") {
    const it = p.items.find(i => i.kind === "event" && !i.ok && (missingOf(i).time || missingOf(i).len));
    if (!it) return false;
    const m = missingOf(it);
    if (/^(?:any ?time|whenever|you (?:can )?(?:choose|decide|pick)|doesn'?t matter|it doesn'?t matter|up to you|i don'?t (?:know|mind)|not sure|flexible|wherever it fits|just fit it in|your choice)\b/.test(bare)) it.ok = true;
    else if (!/\d|\b(?:noon|midday|midnight|morning|afternoon|evening|tonight|night|half|quarter|hour|hours|minutes?|mins?|until|till)\b/.test(bare) || (!/\d/.test(bare) && bare.split(/\s+/).length > 6) || /\b(?:can you|could you|please|add|remove|delete|change|move|what|how|why|who|tell me|show)\b/.test(bare) && !/\d/.test(bare)) return false;   // a new request, not an answer
    else {
      const ans = text.trim().replace(/[.?!]+$/, "");
      const lead = /^\d/.test(ans) ? (m.time ? "at " : "for ") : "";
      let got = parseSchedule(`${it.title} ${lead}${ans}`, { date: it.date, today: today(), now: nowMin() }).find(x => x.kind === "event");
      if (got && m.len && !m.time && got.s != null && got.e == null && got.durDefault) got = null;   // "5" meant minutes? ask again
      const minOnly = !m.time && m.len ? SC.estIn(bare) : null;
      if (got && got.s != null && m.time) { it.s = got.s; if (got.e != null) it.e = got.e; if (!got.durDefault) { it.dur = got.dur; it.durDefault = false; if (it.e == null) it.e = it.s + it.dur; } }
      else if (got && m.len && !got.durDefault) { it.dur = got.dur; it.durDefault = false; if (it.s != null) it.e = it.s + it.dur; }
      else if (minOnly) { it.dur = minOnly; it.durDefault = false; if (it.s != null) it.e = it.s + it.dur; }
      else if (got && m.len && got.e != null && got.s == null) { it.e = got.e; it.dur = it.s != null ? it.e - it.s : it.dur; it.durDefault = false; }
      else if (p.tries >= 1) return false;
      else { ui.pending = { ...p, tries: (p.tries || 0) + 1 }; return reply(`Sorry, ${addr()}, I didn't get that. ${askLine(it)}`), true; }
      if (it.s != null && it.e != null) it.dur = it.e - it.s;
      const still = missingOf(it);
      if ((still.time || still.len) && it.asked) it.ok = true;   // asked twice already: he only gave part, so fit the rest
      it.asked = true;
    }
    const next = needsAsk(p.items);
    if (next) { ui.pending = { ...p, tries: 0 }; return reply(askLine(next)), true; }
    await commitSchedule(p.items, spoken, p.replace || []);
    return true;
  }
  if (p.type === "food") {
    if (YES.test(bare)) { F.like(p.k); ui.pending = { type: "food_list", k: p.k }; return reply(pickOne(["Great choice.", "Good one.", "Nice."]) + " Want me to add what you need to your shopping list?"), true; }
    return false;
  }
  if (p.type === "food_list") {
    if (YES.test(bare)) { if (!F.food().week.includes(p.k)) F.toggleWeek(p.k); F.build(); ui.gymTab = "list"; return reply(`Done. It's on your list. Anything else, ${addr()}?`, { view: "gym", spoken }), ui.pending = { type: "more" }, true; }
    if (NO.test(bare)) return reply("Okay. Enjoy it."), true;
    return false;
  }
  if (p.type === "fix") {
    if (YES.test(bare)) {
      const r = SC.fix(p.d); render();
      const bits = [];
      if (r.split) bits.push("split long study into 50 minute sessions with breaks");
      if (r.moved) bits.push(`moved ${r.moved} session${r.moved > 1 ? "s" : ""} to ${r.to.join(" and ") || "later"}`);
      return reply(bits.length ? `Done. I ${bits.join(" and ")}. It should feel doable now.` : "It already looks doable. I left it as is.", { view: "today", date: p.d, spoken }), true;
    }
    if (NO.test(bare)) return reply("Okay, I'll leave it as you planned."), true;
    return false;
  }
  if (p.type === "actual") {
    const min = SC.estIn(bare);
    if (min) return tookReply(SC.tasks().find(t => t.id === p.tid), min, spoken), true;
    if (NO.test(bare)) return reply("No problem."), true;
    return false;
  }
  if (p.type === "due") {
    const t = SC.tasks().find(x => x.id === p.tid);
    const got = t && SC.parse(t.title + " due " + text)[0];
    if (got && got.due) { t.due = got.due; if (got.dueMin != null) t.dueMin = got.dueMin; if (got.est) { t.guess = got.est; } save(); const res = SC.plan(); return reply(`Got it, due ${SC.fmt.dueText(t)}. ${SC.planBrief(res)}`, { view: "school", spoken }), true; }
    return false;
  }
  if (p.type === "duetime") {
    const t = SC.tasks().find(x => x.id === p.tid); if (!t) return false;
    if (SC.looksLikeSchool(text) || bare.split(" ").length > 7) return false;   // a new request, not an answer
    const min = SC.timeIn(bare) ?? parseClock(bare);
    if (min != null && min >= 0) { t.dueMin = min; save(); const res = SC.plan(); return reply(`Okay, due ${SC.fmt.dueText(t)}. ${SC.planBrief(res)}`, { view: "school", spoken }), true; }
    if (NO.test(bare) || /\b(?:no (?:set )?time|don'?t know|not sure|any ?time|end of (?:the )?day|whenever)\b/.test(bare)) { const res = SC.plan(); return reply(`No problem. I'll have it done before then. ${SC.planBrief(res)}`, { view: "school", spoken }), true; }
    return false;
  }
  if (p.type === "more") {
    if (NO.test(bare) || /^(?:no )?(?:that's (?:it|all)|nothing(?: else)?|i'm good|all good)/.test(bare)) return reply(`Okay, ${addr()}. Talk soon.`, { then: () => voice.call ? voice.hangUp() : voice.afterReply() }), true;
    if (YES.test(bare)) return reply("Go ahead."), true;
    return false;
  }
  return false;
}
function tookReply(t, min, spoken) {
  if (!t) return reply(`Noted, ${sayDur(min)}.`);
  const off = SC.logActual(t, min), r = SC.ratio();
  ui.lastTask = null;
  const vs = t.guess ? `your guess of ${sayDur(t.guess)}` : `my plan of ${sayDur(t.plan)}`;
  const rel = off > 1.15 ? `That's ${Math.round(off * 10) / 10} times ${vs}.` : off < 0.85 ? `That's quicker than ${vs}. Nice.` : `Right on ${vs}.`;
  const next = r.learned ? ` From now on I'll plan assignments at ${r.r} times your guess.` : " One more like this and I'll start planning with your real pace.";
  const res = SC.plan();
  return reply(`${rel}${next}`, { view: "school", spoken });
}
function schoolReply(res, head, spoken) { render(); return reply((head ? head + " " : "") + SC.planBrief(res), { view: "school", spoken }); }

async function handle(text, spoken) {
  const bare0 = normalize(text).replace(/[^a-z0-9: ']/g, " ").replace(/\s+/g, " ").trim();
  if (isEndCall(bare0) || /^(?:(?:okay|ok|thanks|thank you|pg)[ ,]+)*(?:good ?night|goodbye|bye|hang up)(?: pg| sir| please| now)*$/.test(bare0)) { ui.pending = null; return endCall(); }
  const personal = M.capturePersonal(text);
  const remembered = M.personalAnswer(text);
  if (remembered) return reply(remembered);
  if (personal && (!AI.on() || text.length < 180 && !/\b(?:how|why|what|should|could|can you|help me)\b/i.test(text)))
    return reply(`Saved, ${addr()}. ${personal.text}`);
  // Daily reminders are definitions, separate from any single day's timetable.
  const dailyReminder = text.match(/^(?:(?:pg|please|can you)[, ]+)*(?:remind me to|remind me|add (?:a )?daily reminder (?:to|for)) (.+?) (?:every day|daily)(?: at (.+?))?[.!]?$/i)
    || text.match(/^(?:please )?remind me (?:every day|daily) to (.+?)(?: at (.+?))?[.!]?$/i);
  if (dailyReminder) {
    const start = dailyReminder[2] ? parseClock(dailyReminder[2]) : null;
    if (dailyReminder[2] && start == null) return reply("What time should the daily reminder be?");
    const result = AG.apply([{ op: "add_routine", title: dailyReminder[1], start, minutes: 5 }]);
    render(); return reply(result.join(" "), { view: "today", date: today(), spoken });
  }
  const stopRoutine = text.match(/^(?:please )?(?:stop reminding me to|stop the daily reminder (?:to|for)|remove (?:the |my )?daily reminder (?:to|for)) (.+?)(?: every day)?[.!]?$/i);
  if (stopRoutine) {
    const q = stopRoutine[1].trim().toLowerCase();
    const r = (S.routines || []).find(r => !r.disabled && (r.title.toLowerCase() === q || r.title.toLowerCase().includes(q)));
    if (!r) return reply("Which daily reminder should I stop?");
    const result = AG.apply([{ op: "remove_routine", id: r.id }]); render(); return reply(result.join(" "));
  }
  const pend = ui.pending; ui.pending = null;
  if (pend && await followUp(pend, bare0, text, spoken)) return;
  if (await daily(text, bare0, spoken)) return;
  const it = intent(text);
  const d = ui.view === "today" && ui.pinDate ? ui.date : today();
  // Read/check the actual saved timetable before consulting the model.
  if (it.type === "now" || /\bwhat (?:am i supposed to|am i meant to|should i|do i need to) (?:be )?(?:do|doing)\b.*\b(?:now|at the moment)\b/i.test(text)) {
    const active = live(today()).filter(b => b.start <= nowMin() && nowMin() < b.end), next = upcoming()[0];
    let answer;
    if (active.length > 1) answer = `${addr()}, your timetable has overlapping entries right now: ` + active.map(b => `${b.title} until ${sayTime(b.end)}`).join("; ") + ". Which one should take priority?";
    else if (active.length) answer = `${addr()}, according to your timetable, you should be ${active[0].cat === "rest" ? "taking a rest break" : "doing " + active[0].title} right now, until ${sayTime(active[0].end)}.`
      + (next ? ` Next is ${next.title} at ${sayTime(next.start)}.` : "");
    else answer = `${addr()}, you have no unfinished activity scheduled right now.` + (next ? ` Next is ${next.title} at ${sayTime(next.start)}.` : " There is nothing else scheduled today.");
    return reply(answer, { view: "today", date: today(), spoken, full: true });
  }
  if (it.type === "next") {
    const next = upcoming()[0];
    return reply(next ? `${addr()}, next is ${next.title} at ${sayTime(next.start)}, until ${sayTime(next.end)}.` : `There is nothing else scheduled today, ${addr()}.`, { view: "today", date: today(), spoken });
  }
  if (it.type === "day" || /^(?:pg[,]? )?(?:what do i have (?:on )?today|what(?:'s| is) (?:on )?my (?:timetable|schedule)(?: today)?)[?.!]*$/i.test(text.trim())) {
    const dd = it.tomorrow ? addDays(today(), 1) : today(), entries = blocksOf(dd).filter(b => !b.skipped);
    return reply(entries.length ? `${addr()}, ${dd === today() ? "today" : "tomorrow"} you have ` + entries.map(b =>
      `${b.title} from ${sayTime(b.start)} to ${sayTime(b.end)}${b.done ? ", completed" : ""}`).join("; ") + "."
      : `${addr()}, nothing is scheduled ${dd === today() ? "today" : "tomorrow"}.`, { view: "today", date: dd, spoken, full: true });
  }
  const finished = text.match(/^(?:(?:okay|ok|pg|pga)[, ]+)*(?:i(?:'ve| have)? (?:done|finished|completed)|mark) (.+?)(?: as (?:done|complete))?[.!]?$/i);
  if (finished) {
    const target = finished[1].replace(/\s+today$/i, "").replace(/^(?:the|my)\s+/i, "").trim();
    const pool = blocksOf(today()).filter(b => !b.done && !b.skipped);
    const exact = pool.filter(b => b.title.toLowerCase() === target.toLowerCase());
    const candidates = exact.length ? exact : pool.filter(b => b.title.toLowerCase().includes(target.toLowerCase()));
    if (candidates.length === 1) {
      const block = candidates[0]; block.done = true;
      if (block.src === "school") SC.noteDone(block);
      save(); return reply(`Marked ${block.title} as done, ${addr()}.`, { view: "today", date: today(), spoken });
    }
    if (candidates.length > 1) {
      ui.pending = { type: "week-complete", ids: candidates.map(b => b.id) };
      return reply(`Which ${target} session did you finish: ${candidates.map(b => sayTime(b.start)).join(" or ")}?`);
    }
    const routines = (S.routines || []).filter(r => !r.disabled && r.start == null && r.title.toLowerCase().includes(target.toLowerCase()));
    if (routines.length === 1) {
      S.routineDone ||= {}; S.routineDone[`${routines[0].id}:${today()}`] = true;
      save(); return reply(`Marked ${routines[0].title} as done for today, ${addr()}. It stays as a daily reminder.`, { view: "today", date: today(), spoken });
    }
  }
  if (/\b(?:build|create|generate|regenerate|rebuild|compile|plan)\b/i.test(text) && /\b(?:weekly|week|timetable)\b/i.test(text) && !AI.on()) {
    openWeekPlanner();
    return reply("Tell me the tasks and their minutes in this planner, choose the days and breaks, then press Build timetable. Your existing fixed commitments stay in place.");
  }
  // Add / delete / replace things on the timetable, in plain words
  if (!ui.editing && !["greet", "hush", "dismiss", "school_add"].includes(it.type) && await localEdit(text, spoken)) return;
  // With an AI key, PG thinks with the AI first so it can handle anything; the built-in brain is the backup.
  if (AI.on() && !ui.quiet && !["greet", "hush", "dismiss", "clear", "school_add"].includes(it.type)) {
    setStatus("Thinking…");
    try { const ans = await aiChat(text, M.search(text, 4)); if (ans) return reply(ans, { spoken }); return voice.afterReply(); }
    catch (e) { console.warn(e); ui.aiFail = AI.friendlyError(e); if (/Cloudflare AI isn't connected/.test(ui.aiFail) && !/^(?:what'?s next|read my schedule)/i.test(text.trim())) return reply(ui.aiFail); }
  }
  switch (it.type) {
    case "greet": {
      const g = hello(); pushMsg("pg", g);
      if (S.voice.speak !== false) voice.say(g, () => voice.supported && spoken !== "typed" ? voice.listen("command") : voice.afterReply());
      return;
    }
    case "hush": return reply(voice.call ? pickOne(["Sure, go ahead.", "Okay, I'm listening.", `Go ahead, ${addr()}.`]) : "Okay.", { then: () => voice.call ? voice.listen("command") : voice.afterReply() });
    case "dismiss": return reply(it.bye || voice.call ? pickOne([`Okay, ${addr()}. I'm here if you need me.`, `Talk soon, ${addr()}.`, `Okay. Just say Hi PG when you need me.`]) : "Okay.", { then: () => voice.call ? voice.hangUp() : voice.afterReply() });
    case "thanks": if (voice.call) ui.pending = { type: "more" }; return reply(voice.call ? `Anytime, ${addr()}. Anything else?` : `Anytime, ${addr()}.`);
    case "help": return reply("Tell me your day and I'll plan it. I also teach you bass, keep your Bible plan, coach the gym, plan your meals and shopping, and remember what you learn.");
    case "now": {
      const c = current(), nx = upcoming()[0];
      if (c) return reply(`Right now it's ${c.title}, until ${sayTime(c.end)}.` + (nx ? ` Then ${nx.title} at ${sayTime(nx.start)}.` : ""), { view: "today", date: today(), spoken });
      if (nx) return reply(`Nothing right now. Next is ${nx.title} at ${sayTime(nx.start)}.`, { view: "today", date: today(), spoken });
      return reply(`Your schedule is clear, ${addr()}.`);
    }
    case "next": {
      const nx = upcoming()[0];
      if (!nx) return reply(`Nothing else today, ${addr()}.`);
      return reply(`Next is ${nx.title} at ${sayTime(nx.start)}, in ${sayDur(nx.start - nowMin())}.`, { view: "today", date: today(), spoken });
    }
    case "day": {
      const dd = it.tomorrow ? addDays(today(), 1) : d;
      const bl = live(dd);
      if (!bl.length) return reply(`${fmtDay(dd)} is open.`, { view: "today", date: dd, spoken });
      return reply(`${fmtDay(dd)}: ` + bl.slice(0, 8).map(say).join(". ") + ".", { view: "today", date: dd, spoken });
    }
    case "clear": {
      const dd = it.tomorrow ? addDays(today(), 1) : d;
      const snap = snapshot(dd);
      day(dd).blocks = []; save(); render();
      undoable(snap, `${fmtDay(dd)} cleared.`);
      return reply(`Done. ${fmtDay(dd)} is clear.`, { view: "today", date: dd, spoken });
    }
    case "delete": case "move": case "shift": case "resize": case "done": {
      const pool = blocksOf(d);
      const b = it.target ? matchBlock(it.target, pool) : current(d);
      if (!b) return reply(`I couldn't find ${it.target ? "“" + it.target + "”" : "anything running now"} on your schedule.`);
      if (it.type === "done" && ["bass", "bible", "learn", "gym"].includes(b.cat)) return completeCoach(b.cat, spoken);
      const snap = snapshot(d);
      let msg = "";
      if (it.type === "delete") { day(d).blocks = day(d).blocks.filter(x => x.id !== b.id); msg = `Removed ${b.title}.`; }
      if (it.type === "move") { const t = parseClock(it.time); const len = b.end - b.start; b.start = t; b.end = Math.min(1440, t + len); b.flex = false; msg = `Moved ${b.title} to ${sayTime(b.start)}.`; }
      if (it.type === "shift") { b.start += it.min; b.end = Math.min(1440, b.end + it.min); msg = `${b.title} now starts at ${sayTime(b.start)}.`; }
      if (it.type === "resize") { b.end = Math.min(1440, b.start + it.min); msg = `${b.title} is now ${sayTime(b.start)} to ${sayTime(b.end)}.`; }
      if (it.type === "done") { b.done = true; if (b.src === "school") SC.noteDone(b); msg = `Nice work. ${b.title} is done.`; const nx = upcoming(d).find(x => x.id !== b.id); if (nx) msg += ` Next is ${nx.title} at ${sayTime(nx.start)}.`; }
      save(); render(); undoable(snap, msg.split(".")[0] + ".");
      return reply(msg, { view: "today", date: d, spoken });
    }
    // ---- Memory ----
    case "note": {
      const inBible = context() === "bible" || ui.view === "bible";
      const n = M.add(it.text, { folder: it.folder || (M.classify(it.text) === "about" ? "about" : inBible ? "spiritual" : null), ctx: inBible && B.bible().plan ? bibleRef() || B.stats()?.book : "" });
      if (ui.view === "notes" || ui.view === "bible") render();
      return reply(n.folder === "about" ? pickOne([`Got it, I'll remember that about you.`, `Noted. I wrote that in your Learned things about PraiseGod folder.`]) : `Saved to ${M.FOLDERS[n.folder].label}${n.refs.length ? `, linked to ${n.refs[0]}` : ""}.`);
    }
    case "recall": return recall(it.q, spoken);
    case "ask": {
      const ev = parseSchedule(text, { date: d, today: today(), now: nowMin() }).filter(i => i.kind === "event" && (i.s != null || i.e != null));
      if (ev.length) return scheduleFrom(text, spoken);
      return recall(it.q, spoken, true);
    }
    // ---- Bible ----
    case "bible_plan": {
      const i = B.findBook(it.book);
      if (i < 0) return reply("Which book of the Bible? For example: my plan is to read Ephesians.");
      B.setPlan(i, it.max); ui.topic = "bible"; renameCoachBlocks(today());
      const s = B.stats();
      return reply(`Plan set: ${s.book}, ${s.nCh} chapters at up to ${B.bible().max} a day. That's ${s.daysLeft} ${s.daysLeft === 1 ? "day" : "days"}. Today's reading is ${bibleRef()}.`, { view: "bible", spoken });
    }
    case "bible_max": {
      B.setMax(it.max); renameCoachBlocks(today());
      return reply(`Got it, up to ${it.max} ${it.max === 1 ? "chapter" : "chapters"} a day.` + (B.bible().plan ? " " + B.brief() : " Which book do you want to read?"), { view: "bible", spoken });
    }
    case "bible_read": {
      let bi = B.findBook(text);
      if (!B.bible().plan || (bi >= 0 && bi !== B.bible().plan.book)) {
        if (bi < 0) return reply("Which book are you reading? Say: my plan is to read Ephesians.");
        B.setPlan(bi);
      }
      const r = B.parseRead(text);
      if (!r) return reply("How far did you get? For example: up to chapter 2 verse 10.");
      const s = B.record(r); ui.topic = "bible";
      const td = B.todays();
      let msg = `Got it. ${s.read} of ${s.tot} verses in ${s.book}, ${s.pct}%.`;
      if (s.finished) { msg = `You finished ${s.book}. Well done, ${addr()}. Which book is next?`; markCat("bible"); }
      else if (td.doneToday) { msg += ` Today's reading is done. ${s.chLeft} ${s.chLeft === 1 ? "chapter" : "chapters"} left, about ${s.daysLeft} ${s.daysLeft === 1 ? "day" : "days"}.`; markCat("bible"); }
      else msg += ` ${td.left} verses left for today.`;
      return reply(msg, { view: "bible", spoken });
    }
    case "bible_info": ui.topic = "bible"; return reply(B.brief(), { view: "bible", spoken });
    // ---- Bass ----
    case "bass_info": ui.topic = "bass"; return reply(BS.brief(minsFor("bass", 30)), { view: "bass", spoken });
    case "complete": {
      const c = context();
      if (c) return completeCoach(c, spoken);
      const b = current(d);
      if (b) { b.done = true; save(); render(); return reply(`Nice work. ${b.title} is done.`); }
      return reply("What did you complete? Your bass lesson, Bible reading, or something on your schedule?");
    }
    case "repeat": {
      if ((context() || "bass") === "bass") { BS.logTry(); return reply(`No problem. We'll stay on ${BS.lesson().t.toLowerCase()} next time. Repetition is how it sticks.`, { view: "bass", spoken }); }
      return reply("Okay, we'll pick it up next time.");
    }
    // ---- Learning anything ----
    case "learn": {
      setStatus("Thinking…");
      const steps = AI.on() ? await aiLearn(it.topic).catch(() => null) : null;
      const tr = LN.create(it.topic, steps); ui.topic = "learn";
      return reply(LN.brief(tr), { view: "notes", spoken });
    }
    case "gym_switch": {
      const w = C.switchDay(it.day);
      if (!w) return reply("Try push, pull, legs, upper or lower day.");
      renameCoachBlocks(today()); ui.topic = "gym";
      return reply(`Switched. ${C.gymBrief(today(), true)}`, { view: "gym", spoken });
    }
    case "gym_info": ui.topic = "gym"; ui.gymTab = "workout"; return reply(C.gymBrief(today(), true) + " " + F.postLine(), { view: "gym", spoken });
    // ---- Food ----
    case "food_info": case "food_meal": {
      const W = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };
      const c = F.chat(today(), gymToday(), it.when ? W[it.when] : null);
      const m = F.todayMeals(today(), gymToday()).find(x => x.when === c.focus);
      ui.food = { focus: c.focus, at: Date.now() }; ui.gymTab = "food"; ui.openRec = m ? m.r.k : null;
      ui.pending = { type: "food", k: m ? m.r.k : null };
      return reply(c.text, { view: "gym", spoken });
    }
    case "food_swap": {
      const fresh = (ui.food && Date.now() - ui.food.at < 20 * 60e3) || /\b(?:breakfast|lunch|dinner|snack|meal|eat|food|recipe)\b/.test(it.text);
      if (!fresh) return reply(/^(?:no|nah|nope)$/.test(it.text) ? "Okay." : `What would you like to change, ${addr()}?`);
      const t = it.text, gym = gymToday(), ms = F.todayMeals(today(), gym);
      let when = /breakfast|morning/.test(t) ? "Breakfast" : /lunch/.test(t) ? "Lunch" : /dinner|tonight/.test(t) ? "Dinner" : /snack/.test(t) ? (gym ? "Before the gym" : "Snack") : /after (?:the )?gym|post/.test(t) ? "After the gym" : null;
      const tail = t.replace(/^.*?\b(?:feel like|want|fancy|mood for|feeling|sick of|tired of)\b\s*/, "");
      const ingK = tail !== t ? F.findItem(tail) : null;
      if (!when && ingK) when = (ms.find(m => m.r.ing.some(([k]) => k === ingK)) || {}).when;
      if (!when) { const r = ms.find(m => tail.length > 3 && m.r.t.toLowerCase().includes(tail.split(" ")[0])); if (r) when = r.when; }
      when = when || (ui.food && ui.food.focus) || "Dinner";
      const FAM = { fish: ["fish", "salmon", "tuna"], salmon: ["salmon"], shrimp: ["shrimp"], beef: ["beef"], chicken: ["chicken"], pork: ["pork"], eggs: ["eggs"] };
      const noList = /seafood/.test(t) ? ["fish", "salmon", "tuna", "shrimp"] : ingK ? (FAM[ingK] || [ingK]) : null;
      if (noList) { const has = m => m && m.r.ing.some(([k]) => noList.includes(k)); const cur = ms.find(m => m.when === when); if (!has(cur)) when = (ms.find(has) || {}).when || when; }
      const f = { gym, quick: /quick|faster|easier|easy|less time|lazy|tired|simple/.test(t), veg: /no meat|vegetarian|without meat|meat ?free|plant/.test(t), no: noList };
      const sw = F.swap(when, f);
      ui.food = { focus: when, at: Date.now() }; ui.gymTab = "food";
      if (!sw) return reply(`I'm out of ideas for ${lc(when)} that fit that. Have a look at all recipes on screen.`, { view: "gym", spoken });
      ui.openRec = sw.r.k; ui.pending = { type: "food", k: sw.r.k };
      return reply(`${pickOne(["Okay", "No problem", "Fair enough", "Sure"])}. For ${when === "After the gym" || when === "Before the gym" ? lc(when).replace("the gym", "the gym,") : lc(when) + ","} maybe try ${lc(sw.r.t)} then. ${ucf(F.why({ when, r: sw.r }))}${sw.r.min <= 15 ? "" : `, about ${sw.r.min} minutes`}. How's that?`, { view: "gym", spoken });
    }
    case "food_avoid": {
      const name = F.avoid(it.item);
      if (!name) return reply(`Okay, noted.`);
      F.build(); ui.gymTab = "food";
      return reply(`Got it, no ${name} from now on. I'll keep it out of your meals and shopping list.`, { view: "gym", spoken });
    }
    case "food_tip": { const t = F.tip(it.k); ui.gymTab = "food"; ui.openTip = it.k; return reply(t.d(), { view: "gym", spoken }); }
    case "weight": { const t = F.setWeight(it.kg); ui.gymTab = "food"; return reply(`Got it. Your target is about ${t} grams of protein a day.`, { view: "gym", spoken }); }
    case "recipe": {
      let r = F.findRecipe(it.q);
      if (!r) { const ms = F.todayMeals(today(), gymToday()); const w = /breakfast/.test(it.q) ? "Breakfast" : /lunch/.test(it.q) ? "Lunch" : /after|post/.test(it.q) ? "After the gym" : "Dinner"; r = (ms.find(m => m.when === w) || ms.at(-1)).r; }
      ui.gymTab = "food"; ui.openRec = r.k;
      return reply(F.recipeBrief(r), { view: "gym", spoken });
    }
    case "shop_make": { const ls = F.build(); ui.food = { focus: "Dinner", at: Date.now() }; ui.gymTab = "list"; const g = F.byStore(ls); return reply(`Your shopping list is ready, ${ls.length} items for the week. ${g.map(x => `${x.rows.length} ${{ wet: "from the wet market", super: "from Wellcome or PARKnSHOP", online: "online from HKTVmall or pandamart", other: "other" }[x.s]}`).join(", ")}.`, { view: "gym", spoken }); }
    case "shop_show": ui.gymTab = "list"; return reply(F.listBrief(), { view: "gym", spoken });
    case "shop_add": { const items = it.item.split(/\s*(?:,|\band\b)\s*/).filter(Boolean); const rows = items.map(x => F.add(x)); ui.gymTab = "list"; return reply(`Added ${rows.map(r => r.n.toLowerCase().replace(/ \(.+\)/, "")).join(", ")}.`, { view: "gym", spoken }); }
    case "shop_where": { const w = F.whereBrief(it.item); if (w) return reply(w); break; }
    case "band_info": return reply(C.bandBrief(minsFor("band", 60)), { view: "bass", spoken });
    case "song_add": { const s = C.addSong(it.name); return reply(`Added ${s.name} to your songs.`, { view: "bass", spoken }); }
    case "howto": {
      ui.openEx = it.ex; if (EXERCISES[it.ex].video) ui.playing.add(EXERCISES[it.ex].video.id);
      return reply(C.exerciseBrief(it.ex), { view: "gym", spoken });
    }
    case "review": return doReport(spoken);
    // ---- School ----
    case "school_add": {
      const list = SC.parse(text);
      if (!list.length) return scheduleFrom(text, spoken);
      const added = SC.add(list);
      added.filter(t => (t.kind === "exam" || t.kind === "quiz") && t.due && t.dueMin != null).forEach(t => {
        if (!day(t.due).blocks.some(b => b.tid === t.id && b.src === "exam")) day(t.due).blocks.push({ id: uid(), title: t.title, cat: "class", start: t.dueMin, end: Math.min(1440, t.dueMin + (t.kind === "quiz" ? 30 : 90)), flex: false, done: false, date: t.due, src: "exam", tid: t.id });
      });
      const res = SC.plan();
      const nodate = added.find(t => !t.due);
      if (nodate) ui.pending = { type: "due", tid: nodate.id };
      // Due day but no time: ask instead of guessing
      const notime = !nodate && added.length === 1 && added[0].due && added[0].dueMin == null && added[0].kind !== "exam" && added[0].kind !== "quiz" ? added[0] : null;
      if (notime) { ui.pending = { type: "duetime", tid: notime.id }; render(); return reply(`Got it. ${notime.title}, due ${SC.fmt.dueText(notime)}. ${SC.planBrief(res)} What time is it due? If there's no set time, just say no.`, { view: "school", spoken }); }
      return schoolReply(res, added.length === 1 ? `Got it. ${added[0].title}${added[0].due ? `, due ${SC.fmt.dueText(added[0])}` : ""}. ${SC.whyTime(added[0])}` : `Got it, ${added.length} assignments: your ${andWords(added.map(t => lc(t.title)))}.${added.some(t => t.guess) ? (SC.ratio().learned ? ` I planned your guesses at ${SC.ratio().r} times, your real pace.` : " I added 50% to your time guesses, since most people underestimate.") : ""}`, spoken);
    }
    case "school_plan": return schoolReply(SC.plan(), "", spoken);
    case "school_info": return reply(SC.brief(), { view: "school", spoken });
    case "school_done": {
      const t = SC.find(it.target);
      if (!t) { const b = matchBlock(it.target, blocksOf(d)); if (b) { b.done = true; save(); render(); return reply(`Nice work. ${b.title} is done.`); } return reply(`I couldn't find ${it.target} in your assignments.`); }
      SC.finish(t); render();
      if (it.min) return tookReply(t, it.min, spoken);
      ui.pending = { type: "actual", tid: t.id }; ui.lastTask = t.id;
      return reply(`Nice work, ${addr()}. ${t.title} is done. Roughly how long did it take you in total?`, { view: "school", spoken });
    }
    case "school_took": {
      const t = SC.tasks().find(x => x.id === ui.lastTask) || SC.tasks().filter(x => x.done).sort((a, b) => (b.doneOn || "").localeCompare(a.doneOn || "")).at(0);
      return tookReply(t, it.min, spoken);
    }
    case "school_cap": SC.setCap(it.min); return schoolReply(SC.plan(), `Okay, at most ${sayDur(SC.sch().cap)} of study a day.`, spoken);
    case "school_window": { const m = parseClock(it.time); SC.setWindow(m, it.we ? "we" : "wk"); return schoolReply(SC.plan(), `Got it. I'll plan study after ${sayTime(m)}${it.we ? " on weekends" : " on school days"}.`, spoken); }
    case "school_pref": SC.setPref(it.p); return schoolReply(SC.plan(), `Noted, you focus best in the ${it.p}.`, spoken);
    case "realistic": {
      const dd = it.tomorrow ? addDays(today(), 1) : d;
      const issues = SC.check(dd);
      if (!issues.length) return reply(`${dd === today() ? "Today" : "That day"} looks doable. You have breaks, study is under ${sayDur(SC.sch().cap)}, and you'll get to bed on time.`, { view: "today", date: dd, spoken });
      ui.pending = { type: "fix", d: dd };
      return reply(`A few things. ${issues.map(ucf).join(". ")}. Want me to make it realistic?`, { view: "today", date: dd, spoken });
    }
    case "learned": {
      syncFacts();
      const fs = M.facts();
      if (!fs.length) return reply(`Not much yet, ${addr()}. As you use me, I write what I learn in your Learned things about PraiseGod folder, like how long things really take and what food you like.`);
      const top = fs.slice(0, 4).map(n => n.text.replace(/\.$/, "")).map(lc);
      ui.folder = "about";
      return reply(`I've written ${fs.length} thing${fs.length > 1 ? "s" : ""} in your Learned things about PraiseGod folder. For example, ${top.slice(0, 3).join(". Also, ")}. I use all of it when I plan for you.`, { view: "notes", spoken });
    }
    default: return scheduleFrom(text, spoken);
  }
}

function completeCoach(cat, spoken) {
  if (cat === "bass") {
    const r = BS.complete(); markCat("bass"); renameCoachBlocks(today()); ui.topic = "bass";
    if (!r) return reply("You've already finished the whole course.", { view: "bass", spoken });
    return reply(r.next ? `Lesson complete: ${r.done.t}. Next session you'll learn ${r.next.t.toLowerCase()}.` : `That's the last lesson. You've finished the course, ${addr()}.`, { view: "bass", spoken });
  }
  if (cat === "bible") {
    if (!B.bible().plan) return reply("You don't have a reading plan yet. Which book do you want to read?");
    const s = B.record({ kind: "today" }); markCat("bible"); ui.topic = "bible";
    return reply(s.finished ? `You finished ${s.book}. Which book is next?` : `Today's reading is done. ${s.pct}% through ${s.book}, ${s.chLeft} ${s.chLeft === 1 ? "chapter" : "chapters"} left.`, { view: "bible", spoken });
  }
  if (cat === "learn") {
    const r = LN.complete(); markCat("learn");
    if (!r) return reply("Nothing left on that plan.");
    return reply(r.next ? `Step done. Next for ${r.tr.topic}: ${r.next.t}.` : `You finished every step of ${r.tr.topic}.`, { view: "notes", spoken });
  }
  if (cat === "gym") {
    C.completeWorkout(today(), gymProgress().sets); markCat("gym");
    return reply(`Workout logged. Next time is ${C.workoutFor(addDays(today(), 1)).name.toLowerCase()}.`, { view: "gym", spoken });
  }
}

async function recall(q, spoken, open) {
  const general = !/\babout\b|\bin [a-z]/.test(q) && /\b(?:what (?:have|did) i (?:learn|learned|learnt)|my (?:revelations|notes|lessons)|what revelations)\b/.test(q);
  let found = general ? M.notes().slice(0, 3) : M.search(q, 3);
  if (AI.on() && (open || found.length)) {
    setStatus("Thinking…");
    const ans = await aiChat(q, found.length ? found : M.search(q, 6)).catch(e => { console.warn(e); return null; });
    if (ans) return reply(ans);
  }
  if (general && found.length) return reply(`Your latest: ` + found.map(n => `“${n.text}”`).join(" "), { view: "notes", spoken });
  const a = M.answer(q, found);
  if (a) return reply(a);
  if (open) return reply(`I don't have anything on that yet, ${addr()}. When you learn something, say: save this, then tell me.`);
  return reply("You haven't taught me anything about that yet.");
}

function renameCoachBlocks(d) {
  day(d).blocks.forEach(b => {
    if (b.cat === "gym" && /^gym\b/i.test(b.title)) b.title = "Gym · " + C.workoutFor(d).name;
    if (b.cat === "bass" && /^bass\b/i.test(b.title) && d === today()) b.title = BS.finished() ? "Bass practice" : `Bass · ${BS.lesson().t}`;
    if (b.cat === "bible" && /^bible\b/i.test(b.title) && d === today()) { const r = bibleRef(); b.title = r ? `Bible · ${r}` : "Bible study"; }
  });
  save();
}

async function scheduleFrom(text, spoken) {
  const ctx = { date: ui.view === "today" && ui.pinDate ? ui.date : today(), today: today(), now: nowMin() };
  // "can you add reading at 9pm" -> "reading at 9pm", so the title is just "Reading"
  const asked = text.replace(/^(?:(?:ok(?:ay)?|so|and|also|then|pg|hey|please)[ ,]+)*(?:(?:can|could|would|will) you (?:please )?|please |i want (?:you )?to |i need (?:you )?to |i'd like (?:you )?to |let's |go ahead and )?(?:add|put|schedule|book|pencil in|block out|block off|set up)\s+(?:in |me |a |an |some )?(?=\S)/i, "");
  let items = parseSchedule(asked || text, ctx);
  let events = items.filter(i => i.kind === "event");
  // With the AI on, chatty or vague lines go to conversation instead of becoming calendar blocks.
  const chatty = /^(?:oh|um+|uh+|so|well|hmm+|maybe|i think|i feel|i'?m (?:so |really |kind of |a bit )?(?:tired|sad|stressed|bored|happy|excited|worried|feeling)|honestly|you know|to be honest|what do you think|do you think|should i|why|how come|tell me|can you explain)\b/i.test(text.trim()) || /\?\s*$/.test(text);
  const vague = events.some(e => e.cat === "other" && e.s == null && e.e == null);
  // Only put things on the calendar when he clearly asks (a time, a day, or words like add / schedule / put).
  const cue = /\b(?:add|schedule|put|plan|book|remind|block|set up|move|pencil|slot|fit|\d{1,2}(?::\d\d)? ?(?:am|pm|a\.m\.|p\.m\.)|at \d|from \d|for \d+ ?(?:min|minutes|hours?|h)\b|tomorrow|tonight|this (?:morning|afternoon|evening)|in the (?:morning|afternoon|evening)|later today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|due)\b/i.test(text);
  const talkAbout = /\b(?:talk|chat|speak|tell me) (?:about|to you about)|\blet'?s talk\b/i.test(text);
  if (AI.on() && !ui.quiet && events.length && (chatty || vague || talkAbout || !cue)) events = [];
  if (!events.length && AI.on() && !ui.quiet) {
    setStatus("Thinking…");
    try { const ans = await aiChat(text, M.search(text, 4)); if (ans) return reply(ans); }
    catch (e) { const m = AI.friendlyError(e); return reply(/Cloudflare/.test(m) ? m : `${m} You can check it in More, under PG's AI brain.`); }
  }
  if (!events.length) {
    const a = M.answer(text, M.search(text, 2));
    if (a) return reply(a);
    return reply(`Sorry, ${addr()}, I didn't catch that. Try: bass lesson at 6:30, or what's next?`);
  }
  // Don't guess: ask for any missing time or length first.
  const gap = needsAsk(items);
  if (gap) { ui.pending = { type: "clarify", items, tries: 0 }; return reply(askLine(gap), { spoken }); }
  return commitSchedule(items, spoken);
}
async function commitSchedule(items, spoken, replacing = []) {
  const events = items.filter(i => i.kind === "event");
  const dates = [...new Set([...events.map(e => e.date), ...replacing.map(b => b.date)])];
  const snaps = dates.map(snapshot);
  for (const old of replacing) day(old.date).blocks = day(old.date).blocks.filter(b => b.id !== old.id);
  const res = placeItems(items, day, { today: today(), now: nowMin(), dayStart: S.profile.dayStart, dayEnd: S.profile.dayEnd });
  dates.forEach(renameCoachBlocks);
  res.unplaced.forEach(u => S.inbox.push({ id: uid(), title: u.title, cat: u.cat, dur: u.dur, date: u.date }));
  // "Learn X" blocks get a learning plan
  for (const b of [...res.added]) if (b.cat === "learn") { const topic = b.title.replace(/^learn\s+/i, ""); if (!LN.findTrack(topic)) LN.create(topic); }
  save();
  const all = [...res.added, ...res.updated].sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  const d0 = dates[0];
  const parts = [];
  if (all.length) parts.push((all.length > 1 ? `Okay, ${addr()}, I added these. ` : pickOne(["Okay, I added it. ", "Got it. ", "Done. "])) + all.slice(0, 8).map(say).join(". ") + ".");
  if (res.unplaced.length) parts.push(`${res.unplaced.map(u => u.title).join(" and ")} didn't fit, so it's in your to-do list.`);
  const cf = conflicts(day(d0).blocks);
  const clash = all.find(b => cf.has(b.id));
  if (clash) { const other = day(d0).blocks.find(b => b.id !== clash.id && cf.has(b.id) && b.start < clash.end && clash.start < b.end); if (other) parts.push(`Heads up: it overlaps ${other.title}.`); }
  const first = cat => all.find(b => b.cat === cat);
  let view = "today";
  const solo = all.length === 1;
  if (first("bass")) { ui.topic = "bass"; parts.push(BS.brief(first("bass").end - first("bass").start)); if (solo) view = "bass"; }
  if (first("bible")) {
    ui.topic = "bible";
    if (B.bible().plan) {
      parts.push(B.brief());
      const rel = M.search(B.stats().book, 1, "spiritual")[0];
      if (rel) parts.push(`Last time you learned: “${rel.text}”`);
    } else parts.push("Which book are we reading? Say: my plan is to read Ephesians.");
    if (solo) view = "bible";
  }
  if (first("gym")) { ui.topic = "gym"; ui.gymTab = "workout"; parts.push(C.gymBrief(first("gym").date, true) + " " + F.postLine(first("gym").date)); if (solo) view = "gym"; }
  if (first("band")) parts.push(C.bandBrief(first("band").end - first("band").start));
  if (first("learn")) { const tr = LN.findTrack(first("learn").title.replace(/^learn\s+/i, "")); if (tr) { ui.topic = "learn"; parts.push(LN.brief(tr)); if (solo) view = "notes"; } }
  const warn = SC.check(d0);
  if (warn.length && all.some(b => b.cat === "study" || b.end > S.profile.dayEnd)) { parts.push(`Heads up: ${warn[0]}. Say make it realistic and I'll fix it.`); ui.pending = null; }
  render();
  undoable(snaps, `${res.added.length} added${res.updated.length ? ", " + res.updated.length + " updated" : ""}.`);
  const html = `<div>${esc(parts[0] || "")}</div>` + (all.length > 1 ? `<ul>${all.map(b => `<li>${esc(fmtTime(b.start))}–${esc(fmtTime(b.end))} · ${esc(b.title)}</li>`).join("")}</ul>` : "") + parts.slice(1).map(p => `<div style="margin-top:6px">${esc(p)}</div>`).join("");
  reply(parts.join(" "), { view, date: d0, spoken, html });
}

function reviewText() {
  const bl = blocksOf(today());
  if (!bl.length) return `Nothing on today's schedule yet, ${addr()}.`;
  const done = bl.filter(b => b.done), open = bl.filter(b => !b.done && b.end <= nowMin());
  let t = `You finished ${done.length} of ${bl.length} today.`;
  if (open.length) t += ` Still open: ${open.slice(0, 3).map(b => b.title).join(", ")}.`;
  const tm = live(addDays(today(), 1))[0];
  if (tm) t += ` Tomorrow starts with ${tm.title} at ${sayTime(tm.start)}.`;
  return t;
}

// ================= Optional AI (user's own key) =================
async function callAI(system, user, json) { return AI.call(system, user, { json }); }
async function aiExtract(text, ctx) {
  const sys = `Extract schedule items from speech. Today is ${ctx.today}. Fix speech-to-text errors (e.g. "solid work" = SolidWorks, "based lessons" = bass lessons, wrong AM/PM). Return JSON {"items":[{"title":"","category":"class|study|work|commute|gym|bass|bible|church|learn|band|meal|meeting|social|rest|other","date":"YYYY-MM-DD","start":"HH:MM or null","end":"HH:MM or null","minutes":number or null}]} in the order spoken. Return {"items":[]} if none.`;
  const raw = await callAI(sys, text, true);
  const o = JSON.parse(raw.replace(/^```json\s*|```$/g, ""));
  const toM = s => { if (!s) return null; const [h, m] = s.split(":").map(Number); return h * 60 + m; };
  return (o.items || []).map(x => { const s = toM(x.start), e = toM(x.end); const cat = CATS[x.category] ? x.category : "other"; return { kind: "event", title: x.title || "Task", cat, date: x.date || ctx.date, s, e, dur: x.minutes || (s != null && e != null ? e - s : DEFAULT_MIN[cat]) }; });
}
function aiContext(notes = []) {
  const d = today(), now = nowMin();
  const sched = live(d).map(b => `${fmtTime(b.start)}-${fmtTime(b.end)} ${b.title}`).join("; ") || "nothing planned";
  const due = SC.pending().slice(0, 6).map(t => `${t.title}${t.due ? " due " + t.due : ""}`).join("; ") || "none";
  let meals = ""; try { meals = F.todayMeals(d, false).map(m => `${m.when}: ${m.r.t}`).join("; "); } catch {}
  const facts = M.facts().slice(0, 25).map(n => "- " + n.text).join("\n") || "- nothing yet";
  const mem = notes.length ? notes.map(n => `- ${n.date} (${M.FOLDERS[n.folder].label}): ${n.text}`).join("\n") : "";
  return `Now: ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Hong_Kong", weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })} Hong Kong time (UTC+8). Today is ${today()}. Do not use the server timezone or infer the date from his greeting. He lives in Hong Kong.
Today's timetable: ${sched}.
Assignments: ${due}.
Today's suggested meals: ${meals || "none"}.
His goals: ${D.goals().map(g => g.text).join("; ") || "none saved yet"}.
Learned things about PraiseGod:
${facts}${mem ? `\nHis saved notes that may apply:\n${mem}` : ""}
These are permanent memories, even if this is a new call. Use them to answer personal questions. Never say you don't know his personal life when the answer is here.`;
}
const REFUSE = /\b(?:can(?:'|’|no)t|cannot|unable to|not able to|don't have (?:the )?(?:ability|access|permission)|no way to|outside (?:of )?my|beyond my)\b/i;
const ACTION = /\b(?:add|put|include|insert|create|make|schedule|book|plan|set|change|edit|update|rename|move|shift|push back|swap|replace|switch|remove|delete|drop|cancel|clear|take (?:out|off|away)|get rid of|increase|decrease|raise|lower|turn (?:on|off)|mark|log|save|write down|note)\b/i;
function history(n = 10) {
  // Leave out old refusals so the AI doesn't copy them
  return S.chat.slice(-n - 1, -1).filter(m => m.text && !(m.who !== "me" && REFUSE.test(m.text))).map(m => ({ role: m.who === "me" ? "user" : "assistant", content: m.text }));
}
// A natural back-and-forth with PG. The AI can also ask the app to do things and remember facts.
async function aiTalk(text, notes = [], web = null, live = false) {
  const sys = `You are PG, PraiseGod's personal assistant and partner, talking with him by voice like on a phone call. Call him "${addr()}" now and then, not every sentence.
Speak naturally and warmly, like a smart friend who knows him well. You can talk about ANYTHING he brings up: faith and the Bible, life, feelings, relationships, school subjects, science, history, tech and coding, money, business, health, fitness, food, music, sports, news, ideas, jokes, advice or just casual chat. Give real, thoughtful answers with substance, share your view when he asks, and keep the conversation going like a real person would. Never refuse a normal topic or steer him back to the app. For business (starting or growing a business, marketing, sales, pricing, money, investing, companies, side hustles, creator products), answer like a sharp business mentor with clear, practical steps; search the internet for real company facts, numbers, prices and market news.
His words come from voice recognition or quick typing, so some words may be misheard or misspelled, like "corner" when he said "call", "jim" for "gym", "base" for "bass", or a word that sounds alike but makes no sense in the sentence. Work out what he really meant from the whole sentence and the conversation so far, act on that, and don't mention the mistake. When you changed any word, put his corrected sentence in "heard". When you write Cantonese, give the Chinese characters, then an easy English-style "say it" spelling with NO tone numbers (for example 你好 "say it: nay hoh" means hello), then the meaning. Never use Jyutping numbers like nei5. You have the internet. When answering needs current or exact facts you aren't sure of (news, weather, sports, prices, people, recent events, places, opening hours, anything "latest" or "today", or anything after 2024), don't guess: reply with "search" set to a short web search query and "say" empty, and you'll get live results back. Write the query like a good Google search with the key words only, and put in the year or date when he says "this year", "today" or "latest" (today is ${today()}). Never say you can't access the internet. When you search, leave "say" empty: never say "let me check" or "one moment", because you get the results straight away.
Never promise to do something later ("I'll add", "I'll look"). Either do it now with "ops"/"do" in this same reply, or ask the question you need answered.
Personal memories: save explicit disclosures immediately in "remember", even if they are about relationships or faith. "I love Maya" means save "You love Maya." This is about his life, not a one-off question. Never wait for repeated mentions of a personal fact. Do not save hypothetical examples or questions as facts.
Assignments must be saved in School with add_assignment, never just a calendar block. Save the known title and deadline now; ask for any missing due date/time or study estimate without discarding the assignment.
For moving a whole timetable, use move_day with from and to. Do not recreate its items with add_block. A move removes the old entries and preserves IDs.
Daily reminders use add_routine. They survive clearing or moving the timetable, and are stopped only when he explicitly asks. An untimed daily habit can be saved as a checklist, without inventing a time.
The weekly table and checklist share the same saved blocks. For weekly generation/regeneration use plan_week, not a pile of add_block operations. Ask for missing task durations, eligible days, daily start/end times and preferred work/break lengths before planning. Existing weekly_plans contain confirmed settings and task lists; reuse those and include prior tasks when he adds more, unless he explicitly removes them. Keep fixed commitments, completed work and daily routines. Do not promise more work than fits; report any unallocated minutes. For advice: UNC's calendar guidance recommends fixed commitments first, time estimates, color coding, buffer time and readjusting: https://learningcenter.unc.edu/tips-and-tools/using-planners . Cornell recommends balanced activities, spreading work and real breaks: https://lsc.cornell.edu/how-to-study/studying-for-and-taking-exams/guidelines-for-creating-a-study-schedule/ . These are principles, not permission to invent his personal availability or durations.
Gym edits must use add_exercise with the exact gym day, real exercise name, cues, sets and reps. Do not call it saved if you did not return an operation. Do not claim an "inner chest" muscle can be isolated or that one exercise will open a chest gap. Explain that chest development is overall and the shape varies. Any videoId must come from his actual YouTube URL or live internet results, never an invented ID. Video search links are searches, not a fetched or watched video.
Every exercise you add with add_exercise automatically gets a "Watch on YouTube" form-video button in his Gym tab, made from its "search" field (for example "incline dumbbell press proper form"). So when he asks for videos, add the exercise with a good "search", and tell him the video button is on the exercise in the Gym tab. Exercises already in his plan already have that video button.${web ? `

LIVE INTERNET RESULTS for his question, fetched just now (${new Date().toString().slice(0, 24)}):
${web.text}

Answer from these results. Be specific with the real facts and numbers, mention where they came from by name (like "according to Reuters"), and don't set "search" again. If the results don't answer it, say so honestly.` : ""} Your specialty is still his life and his PG app: his schedule, plans, gym, food, Bible, bass, school and goals, so when a topic touches those, use his data below.
Keep replies easy to listen to: usually one to four spoken sentences. If he asks you to explain, teach or go deeper, you can talk longer, up to about eight sentences. No lists, no markdown, no emojis. Ask a short follow-up question when it helps. Use what you know about him below, and his own notes when they apply.
He is a Christian student who plays bass, goes to the gym and wants high-protein, high-fiber food.

${aiContext(notes)}

You are fully in control of his app and you CAN change anything in it: timetable, gym exercises, Bible plan, bass, songs, shopping list, notes, food, school and settings. The only thing you can't touch is API keys and private settings. Never tell him you can't change the app or that he should do it himself.
NEVER ASSUME. Before you change anything, make sure you know every detail the change needs: which day, what time it starts, how long it lasts or when it ends, which exact item he means, names, amounts, sets and reps. If any detail is missing or unclear, make no change yet ("ops" and "do" empty) and ask for ALL the missing details in one short question. Don't fill gaps with defaults or your own picks. Use the conversation so far: if he already gave a detail, don't ask for it again, and once he has answered, make the change with "ops" (or "do") in that reply and say briefly what you did. Only when he says "you choose", "anything" or "up to you" may you pick a sensible option yourself, and then tell him what you picked. If you need knowledge (like which exercise works a muscle), you may suggest one, but still ask him to confirm the details before adding it. Asking is not refusing.
When he tells you his plans for the day, add each one he gave full details for, and ask about the ones missing a time or length.
When he tells you a goal, save it with {"op":"push","path":"goals","value":{"text":"...","made":"${today()}"}}.

APP DATA (today is ${today()}):
${AG.snapshot()}

Example: he says "add an exercise for my chest" -> {"say":"We could use a cable chest fly, sir. Should I add it to push day, and how many sets and reps would you like?","ops":[],"do":[],"remember":[]}
Then he says "push day, 3 sets of 10 to 15" -> {"say":"","ops":[{"op":"add_exercise","day":"push","name":"Cable chest fly","muscles":"Chest","cues":["Use a comfortable light load","Keep a slight bend in your elbows","Bring your hands together under control without shoulder pain"],"search":"cable chest fly proper form","sets":3,"reps":"10-15","rest":60}]}
Reply ONLY with JSON: {"say": "what you say out loud", "ops": [direct changes], "do": ["plain commands for the app"], "remember": ["new lasting facts about him"], "search": "web search query, only when you need the internet", "heard": "his corrected sentence, only if you fixed a misheard word", "topic": "what this is about"}.
${AG.TOOLS}
"do" is for when he clearly wants the app to act. Write each as a short command the app understands, for example "gym at 5pm", "bass lesson tomorrow at 6:30pm", "I have a history essay due Friday", "add eggs to my shopping list", "I don't eat pork", "is my plan realistic", "move gym to 7pm", "clear today". Leave it empty otherwise.
For homework, assignments, essays, projects and tests, use add_assignment and keep the exact name he gave. Never make up a due time or a timetable slot he didn't say.
"remember" is ONLY for lasting things about him that will still be true next month: who he is (school, church, city, age, job), people in his life, likes and dislikes, food rules and allergies, habits and routines, goals and dreams, skills he's working on, strong opinions and values, and how he wants PG to talk or act. NOT for one-off questions, today's plans, passing moods, things he asked you to look up, or facts about the world. Write each as a "You ..." sentence. Leave it empty if nothing new.
"topic" is a 1 to 3 word label for what his message is about, like "business", "premier league", "bass guitar", "bible", "fitness", "coding" or "cantonese". Use "" for small talk, greetings and simple app commands.`;
  const raw = await AI.call(sys, [...history(10), { role: "user", content: live ? text + "\n\n(PG note: this needs live facts from the internet, so reply with a \"search\" query.)" : text }], { json: true, max: 900 });
  const o = AI.parseJSON(raw) || { say: String(raw || "").trim() };
  {
    const heard = typeof o.heard === "string" ? o.heard.trim() : "";
    const me = S.chat.at(-1)?.who === "me" ? S.chat.at(-1) : S.chat.slice().reverse().find(m => m.who === "me");
    if (heard && me && me.text === text && heard.toLowerCase() !== text.toLowerCase() && heard.length < text.length * 1.6 + 10) { me.raw = me.raw || text; me.text = heard; save(); paintChat(); }
    if (!web && typeof o.topic === "string") D.noteTopic(o.topic, M);
  }
  // He needs the internet: look it up, then answer from the live results.
  const q = !web && typeof o.search === "string" ? o.search.trim() : "";
  if (q && !(Array.isArray(o.ops) && o.ops.length)) {
    setStatus("Searching the internet…");
    const found = WEB.SPORTS_RE.test(q + " " + text) ? await WEB.sports(q + " " + text).catch(() => null) || await WEB.search(q).catch(() => null)
      : WEB.WEATHER_RE.test(q + " " + text) ? await WEB.weather(text).catch(() => null) : await WEB.search(q).catch(e => (console.warn(e), null));
    if (found) return aiTalk(text, notes, found);
    return { sources: [], say: `I searched the internet for that, ${addr()}, but couldn't find a reliable answer. Want me to try it a different way?`, ops: [], do: [], remember: [] };
  }
  if (web) {
    // The answer must come from the results: never "let me check" or a bare "Search".
    let say = String(o.say || "").trim();
    if (!say || /^search\b|let me (?:check|look|search|find)|i(?:'ll| will) (?:check|look|search)|one moment|hold on/i.test(say) && say.length < 90) say = web.spoken || `Here's what I found, ${addr()}: ${web.sources.slice(0, 2).map(x => x.title).join("; ")}.`;
    o.say = say; o.search = "";
  }
  // Cantonese from the AI: swap any Jyutping numbers (nei5 hou2) for the easy spelling (nay hoh).
  if (typeof o.say === "string" && /[\u4e00-\u9fff]/.test(o.say)) o.say = o.say.replace(/\b(?:[a-z]{1,6}[1-6](?:\s+|(?=[^a-z0-9])|$)){2,}/gi, m => sayLike(m.trimEnd()) + (/\s$/.test(m) ? " " : ""));
  const r = { sources: web?.sources || [], say: String(o.say || "").trim(), ops: Array.isArray(o.ops) ? o.ops : [], do: (Array.isArray(o.do) ? o.do : []).filter(x => typeof x === "string" && x.trim()).slice(0, 3), remember: (Array.isArray(o.remember) ? o.remember : []).filter(x => typeof x === "string" && x.trim()).slice(0, 3) };
  // He asked for a change but the AI only talked (or said it couldn't): ask again, just for the changes.
  if (!web && !r.ops.length && !r.do.length && (REFUSE.test(r.say) || (ACTION.test(text) && !/\?\s*$/.test(r.say)))) {
    try {
      const raw2 = await AI.call(`You turn PraiseGod's request into changes to his PG app. You CAN change everything in the app below, so never refuse. Never assume: if the request is missing a detail the change needs (which day, start time, length, which item, amounts, sets and reps), make no change and put one short question asking for all the missing details in "say". Use the earlier conversation for details he already gave.
APP DATA (today is ${today()}):
${AG.snapshot()}

${AG.TOOLS}
"do" is a list of short plain commands for the app, like "gym at 5pm" or "add eggs to my shopping list".
Reply ONLY with JSON: {"say": "one short spoken sentence saying what you did, calling him ${addr()}", "ops": [...], "do": [...]}. If it is not a change request at all, reply {"say": "", "ops": [], "do": []}.`, [...history(6), { role: "user", content: text }], { json: true, max: 900 });
      const o2 = AI.parseJSON(raw2) || {};
      const ops = Array.isArray(o2.ops) ? o2.ops : [], dos = (Array.isArray(o2.do) ? o2.do : []).filter(x => typeof x === "string" && x.trim()).slice(0, 3);
      if (ops.length || dos.length) Object.assign(r, { ops, do: dos, say: String(o2.say || "").trim() || (REFUSE.test(r.say) ? "" : r.say) });
      else if (/\?\s*$/.test(String(o2.say || "")) && !REFUSE.test(o2.say)) r.say = String(o2.say).trim();
    } catch (e) { console.warn(e); }
  }
  if (!r.ops.length && !r.do.length && REFUSE.test(r.say) && ACTION.test(text)) r.say = `I didn't catch exactly what to change, ${addr()}. Say it once more, like "add cable crossovers to push day".`;
  return r;
}
async function aiChat(text, notes = []) {
  // Weather and obviously live questions go to the internet first, so the answer is fast and real.
  let web = null;
  if (WEB.WEATHER_RE.test(text)) { setStatus("Checking the weather…"); web = await WEB.weather(text).catch(e => (console.warn(e), null)); }
  else if (WEB.SPORTS_RE.test(text) && !ACTION.test(text)) { setStatus("Checking the fixtures…"); web = await WEB.sports(text).catch(e => (console.warn(e), null)); }
  let r;
  try { r = await aiTalk(text, notes, web, !web && WEB.LIVE_RE.test(text) && !ACTION.test(text)); }
  catch (e) { if (web?.spoken) { ui.sources = web.sources; return web.spoken; } throw e; }   // AI down: still give the live weather
  ui.sources = r.sources?.length && r.say ? r.sources : null;
  for (const op of r.ops || []) if (op.op === "add_exercise") {
    // Discard invented IDs. Keep only a user-supplied URL or a validated lookup.
    const supplied = text.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/))([\w-]{11})/i)?.[1];
    const video = await WEB.exerciseVideo(op.name, supplied).catch(() => null);
    delete op.videoId;
    if (video) { op.videoId = video.id; op.videoBy = video.by; }
  }
  return finishTalk(r);
}
// Run what the AI asked for quietly, then speak its reply.
async function finishTalk(r) {
  r.remember.forEach(f => { if (!M.facts().some(n => n.text.toLowerCase() === f.toLowerCase())) M.add(f, { folder: "about" }); });
  const done = [];
  if (r.ops?.length) {
    const lines = AG.apply(r.ops, { onDone: undo => toast("PG made changes.", "Undo", () => { undo(); C.syncCustom(); render(); toast("Undone."); }) });
    if (r.ops.some(o => /exercise/.test(o.op))) {
      const added = r.ops.find(o => o.op === "add_exercise");
      if (added?.day) C.switchDay(C.dayKeyFor(added.day) || added.day);
      const ex = added && C.findEx(added.name); if (ex) ui.openEx = ex;
      go("gym");
    }
    else if (r.ops.some(o => o.op === "add_assignment")) go("school");
    else if (r.ops.some(o => o.op === "plan_week")) go("today", r.ops.find(o => o.op === "plan_week").weekStart || today());
    else if (r.ops.some(o => /block|clear_day/.test(o.op))) go("today", r.ops.map(o => o.date).find(x => /^\d{4}-/.test(x || "")) || today());
    else render();
    // The application, not the model, is the authority on whether a write succeeded.
    done.push(...lines);
  }
  for (const c of r.do) {
    ui.quiet = []; try { await handle(c, false); } catch (e) { console.warn(e); }
    done.push(...ui.quiet); ui.quiet = null;
  }
  if (r.do.length) render();
  r.do = r.do || [];
  if (!r.say && !done.length) return null;
  if (done.length) return [...new Set(done)].join(" ");
  if (!r.ops.length && !r.do.length && /^(?:done|added|saved|updated|moved|removed|deleted|i(?:'ve| have) (?:added|saved|updated|moved|removed))/i.test(r.say) && !r.remember.length)
    return `I haven't saved a change yet, ${addr()}. What exactly should I change?`;
  return r.say;
}
async function aiLearn(topic) {
  const raw = await callAI(`Make a beginner-to-advanced learning plan. Return JSON {"steps":[{"t":"short step title","d":"one sentence","q":"a YouTube search query for this step"}]} with 6 to 8 steps.`, topic, true);
  const o = JSON.parse(raw.replace(/^```json\s*|```$/g, ""));
  return (o.steps || []).filter(s => s.t).slice(0, 8);
}


// ================= Add / delete / replace in plain words =================
const WD = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DEL_RE = /^(?:(?:ok(?:ay)?|so|and|also|please|pg|hey|actually|now|then|oh)[ ,]+)*(?:(?:can|could|would|will) you |please |i want (?:you )?to |i need (?:you )?to |i'd like (?:you )?to |let's |lets |go ahead and |just )?(delete|remove|cancel|drop|scrap|erase|clear|skip|ditch|take out|take off|take away|get rid of|forget about|no more|no)\b\s*(.*)$/;
const NEG_RE = /^(?:(?:ok(?:ay)?|so|actually|honestly|pg|and|but|oh)[ ,]+)*i(?:'m| am)? ?(?:not (?:going|gonna|doing|able)|won't|will not|can't|cannot|don't (?:want|wanna|need|have time)|do not (?:want|need)|no longer|am not)\b(?: (?:to|be|going to|gonna|for))?(?: (?:go(?:ing)? to|go|do(?:ing)?|make it to|make|have|attend(?:ing)?|practi[cs]e|practi[cs]ing|study|studying|read(?:ing)?|play(?:ing)?|train(?:ing)?|hit|do the))?\s*(.*)$/;
const TAKE_RE = /^(?:(?:can|could) you |please )?take (?:the |my )?(.+?) (?:off|out)\b(.*)$/;
const REPL_RES = [
  [/^(?:(?:ok(?:ay)?|so|actually|pg)[ ,]+)*(?:(?:can|could|would) you |please |let's |i want to )?(?:replace|swap|switch|exchange|change) (?:out )?(?:the |my )?(.+?) (?:with|for|into) (.+)$/, 1, 2],
  [/^(?:(?:ok(?:ay)?|so|actually|pg)[ ,]+)*(?:instead of|rather than) (?:the |my )?(.+?)[, ]+(?:i'll |i will |let's |i want to |i wanna |put |add |do |have |schedule )?(.+)$/, 1, 2],
  [/^(?:(?:ok(?:ay)?|so|actually|pg)[ ,]+)*(?:put |add |do |schedule |i'll do |i want )?(.+?) instead of (?:the |my )?(.+)$/, 2, 1]
];
const TIME_ONLY = /^(?:at |to |for )?\d{1,2}(?::\d\d)?\s?(?:am|pm)?(?: (?:today|tomorrow|tonight))?$/;
const EDIT_CUE = /\b(?:delete|remove|cancel|drop|scrap|erase|skip|ditch|take (?:out|off|away)|get rid of|forget about|no more|replace|swap|instead of|rather than|not (?:going|gonna|doing)|won't|can't|cannot|don't (?:want|wanna|need)|take .+ off|clear)\b/;
function dayOf(t) {
  if (/\btomorrow\b/.test(t)) return { d: addDays(today(), 1), x: true };
  if (/\b(?:today|tonight|this (?:morning|afternoon|evening))\b/.test(t)) return { d: today(), x: true };
  const w = WD.findIndex(n => new RegExp("\\b" + n + "\\b").test(t));
  if (w >= 0) { const n = new Date(today() + "T12:00").getDay(); return { d: addDays(today(), ((w - n + 7) % 7) || 7), x: true }; }
  return { d: today(), x: false };
}
function clauseTime(t) { const m = t.match(/\b(\d{1,2})(?::(\d\d))?\s?(am|pm|o'?clock)\b|\bat (\d{1,2})(?::(\d\d))?\b/); if (!m) return null; return parseClock((m[1] || m[4]) + ":" + (m[2] || m[5] || "00") + (/[ap]m/.test(m[3] || "") ? " " + m[3] : "")); }
// Which timetable items does he mean?
function targets(raw, base) {
  let t = " " + normalize(raw).replace(/[^a-z0-9: ']/g, " ") + " ";
  const { d, x } = dayOf(t);
  t = t.replace(/\b(?:today|tonight|tomorrow|this (?:morning|afternoon|evening)|(?:on )?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|(?:from|off|on|in|out of) (?:my |the )?(?:schedule|timetable|calendar|plan|day|list|agenda)|please|for now|any ?more|for (?:the )?day|i have|that i have|i had|i was|planned|scheduled|the|my|a|an|that|this)\b/g, " ").replace(/\s+/g, " ").trim();
  const range = t.match(/\b(?:everything|all|anything|stuff)(?: else)?(?: that'?s)? (after|before|from|past|until|till) (.+)$/);
  const pool = blocksOf(d);
  if (range) { const at = clauseTime(range[2]) ?? parseClock(range[2]); if (at == null) return { d, list: [] }; return { d, list: pool.filter(b => /after|from|past/.test(range[1]) ? b.start >= at : b.start < at), range: true }; }
  if (/^(?:everything|all|all of it|whole (?:day|thing)|it all|schedule|timetable)$/.test(t)) return { d, list: pool, all: true };
  if (!t || /^(?:it|that|this|them|one)$/.test(t)) return { d, list: [] };
  const at = clauseTime(t);
  const name = t.replace(/\b(?:at )?\d{1,2}(?::\d\d)?\s?(?:am|pm|o'?clock)?\b/g, "").replace(/\b(?:at|session|block|thing|one|appointment|class session)\b/g, "").trim();
  const every = /\b(?:all|every|each)\b/.test(t);
  const days = x ? [d] : every ? Array.from({ length: 7 }, (_, i) => addDays(today(), i)) : Array.from({ length: 8 }, (_, i) => addDays(today(), i));
  const out = [];
  for (const dd of days) {
    let cand = blocksOf(dd);
    if (at != null) cand = cand.filter(b => Math.abs(b.start - at) <= 20 || (b.start <= at && at < b.end));
    const hits = name.length > 1 ? cand.filter(b => matchBlock(name, [b])) : at != null ? cand : [];
    if (hits.length) {
      const best = name.length > 1 ? (matchBlock(name, hits) || hits[0]) : hits[0];
      out.push(...(every ? hits : [best]).map(b => ({ b, d: dd })));
      if (!every) break;   // nearest day only
    }
  }
  return { d: out[0]?.d || d, list: out.map(o => o.b), pairs: out };
}
function splitClauses(text) {
  return text.split(/\s*(?:[,;]|\.(?:\s|$)|\band then\b|\bthen\b|\band also\b|\balso\b|\band\b|\bplus\b|\bbut\b|\bafter that\b)\s*/i).map(x => x.trim()).filter(Boolean);
}
function exerciseCmd(c) {
  const add = c.match(/^(?:(?:can|could) you |please )?(?:add|put|include|throw in) (?:in )?(?:a |an |the |some )?(.+?) (?:to|into|in|on) (?:my |the )?(?:(push|pull|legs?|upper|lower|full body) )?(?:day|workout|routine|exercises?|exercise list|gym(?: list| plan| day| routine)?)\b/);
  // Vague asks ("an exercise for my chest") need the AI to choose one
  if (add && /^(?:new |another |one more |good |better )?(?:exercises?|workouts?|moves?|something|one|it|that|this)\b|\bfor (?:my |the )?/i.test(add[1])) return AI.on() ? "@ai" : "Tell me which exercise to add, like cable crossovers to push day. Or connect an AI in Settings and I'll pick one for you.";
  if (add) {
    if (AI.on() && !ui.quiet) return "@ai";
    const sets = c.match(/(\d+) sets? (?:of )?(\d+(?:\s*(?:to|-)\s*\d+)?)/);
    if (!add[2] || !sets) return "Which gym day, and how many sets and reps should I use?";
    const r = C.addExercise({ name: add[1].replace(/\s+exercise$/, ""), sets: +sets[1], reps: sets[2] }, add[2]);
    return `${r.existing ? "Already saved" : "Added"} ${EXERCISES[r.key].name} on ${r.day.name}.`;
  }
  const rm = c.match(/^(?:(?:can|could) you |please )?(?:remove|delete|drop|take out|get rid of|skip) (?:the |my )?(.+?) (?:from|off|out of) (?:my |the )?(?:(push|pull|legs?|upper|lower|full body) )?(?:day|workout|routine|exercises?|exercise list|gym(?: list| plan| day| routine)?)\b/);
  if (rm) { const r = C.removeExercise(rm[1], rm[2] || ""); return r ? `Removed ${EXERCISES[r.key].name} from your workout.` : `I couldn't find ${rm[1]} in your workout.`; }
  return null;
}
async function localEdit(text, spoken) {
  const low = normalize(text).replace(/[^a-z0-9: ',.;-]/g, " ").replace(/\s+/g, " ").trim();
  // Whole-day moves are atomic and never routed through the add-item parser.
  if (/\b(?:move|shift|transfer|reschedule)\b/.test(low) && /\b(?:schedule|timetable|everything|all (?:the |my )?(?:items|things|blocks))\b/.test(low)) {
    const m = low.match(/\bfrom (today|tomorrow|\d{4}-\d{2}-\d{2}) (?:and |over )?(?:to|into|onto) (today|tomorrow|\d{4}-\d{2}-\d{2})\b/)
      || low.match(/\b(tomorrow)'?s? (?:schedule|timetable|plans?) (?:back )?to (today)\b/);
    if (m) { const lines = AG.apply([{ op: "move_day", from: m[1], to: m[2] }]); return reply(lines.join(" "), { view: "today", date: m[2] === "today" ? today() : addDays(today(), 1), spoken }), true; }
    // Let the AI resolve unstructured wording, without a partial delete/add.
    if (AI.on() && !ui.quiet) return false;
    return reply("Which day should I move the timetable from, and which day should it go to?"), true;
  }
  const ex = exerciseCmd(low.replace(/[,.;]/g, ""));
  if (ex === "@ai") return false;
  if (ex) { go("gym"); return reply(ex, { spoken }), true; }
  if (!EDIT_CUE.test(low)) return false;
  const clauses = splitClauses(low);
  const snaps = {}, said = [], adds = [];
  const snap = dd => { if (!snaps[dd]) snaps[dd] = snapshot(dd); };
  let mode = null, acted = false, view = null;
  const del = (tg, explicit, phrase) => {
    if (!tg.list.length) { if (explicit) said.push(`I couldn't find ${phrase ? "“" + phrase + "”" : "that"} on your schedule.`); return false; }
    const pairs = tg.pairs || tg.list.map(b => ({ b, d: tg.d }));
    pairs.forEach(({ b, d: dd }) => { snap(dd); day(dd).blocks = day(dd).blocks.filter(x => x.id !== b.id); });
    const names = [...new Set(pairs.map(p => p.b.title.split(" · ")[0]))];
    const dd = pairs[0].d;
    const when = dd === today() ? "" : dd === addDays(today(), 1) ? " tomorrow" : " on " + fmtDay(dd);
    said.push(tg.all ? `Cleared everything${when || " today"}.` : tg.range ? `Removed ${pairs.length} ${pairs.length === 1 ? "item" : "items"}${when}: ${names.join(", ")}.` : `Removed ${names.join(" and ")}${when}.`);
    view = dd; acted = true; return pairs;
  };
  for (const c of clauses) {
    let m, done = false;
    for (const [re, a, b] of REPL_RES) {
      if (!(m = c.match(re))) continue;
      const from = m[a], to = m[b];
      if (TIME_ONLY.test(to.trim())) break;          // "change gym to 6pm" is a move
      const tg = targets(from);
      if (tg.list.length) {
        const old = (tg.pairs || tg.list.map(b => ({ b, d: tg.d })))[0];
        const proposed = to + (clauseTime(to) != null ? "" : ` at ${fmtTime(old.b.start)}`);
        const items = parseSchedule(proposed, { date: old.d, today: today(), now: nowMin() });
        const gap = needsAsk(items);
        if (gap) {
          Object.values(snaps).forEach(sn => { day(sn.d).blocks = sn.blocks; });
          ui.pending = { type: "clarify", items, tries: 0, replace: (tg.pairs || tg.list.map(b => ({ b, d: tg.d }))).map(o => ({ id: o.b.id, date: o.d })) };
          return reply(askLine(gap) + " I haven't removed the original item yet.", { spoken }), true;
        }
      }
      const gone = del(tg, true, from);
      if (gone) { const g = gone[0]; const dd = g.d; const hasTime = clauseTime(to) != null; adds.push(to + (hasTime ? "" : ` at ${fmtTime(g.b.start)}`) + (dayOf(to).x ? "" : dd === today() ? " today" : dd === addDays(today(), 1) ? " tomorrow" : " on " + WD[new Date(dd + "T12:00").getDay()])); }
      mode = null; done = true; break;
    }
    if (done) continue;
    if ((m = c.match(TAKE_RE)) && !/\b(?:work|time|day|week)\b off/.test(c)) { del(targets(m[1] + " " + m[2]), true, m[1]); mode = "del"; continue; }
    if ((m = c.match(DEL_RE))) {
      const verb = m[1], rest = m[2].trim();
      if (verb === "clear" && /^(?:my |the )?(?:whole )?(?:schedule|timetable|day|plan|today|tomorrow|everything|calendar)?(?: (?:today|tomorrow))?$/.test(rest)) return false;  // whole-day clear: handled below
      const soft = /^(?:no|skip|forget about)$/.test(verb);
      const tg = targets(rest);
      if (!del(tg, !soft && rest.length > 0, rest) && soft && !acted) return false;
      mode = "del"; continue;
    }
    if ((m = c.match(NEG_RE)) && m[1]) {
      const tg = targets(m[1]);
      if (tg.list.length) { del(tg, false); mode = "del"; continue; }
      if (!acted && clauses.length === 1) return false;
      continue;
    }
    // "remove gym and bass" -> "bass" carries the delete
    if (mode === "del" && !/\b(?:add|put|schedule|plan|book|move|at \d|\d\s?(?:am|pm))\b/.test(c)) {
      const tg = targets(c); if (tg.list.length) { del(tg, false); continue; }
    }
    mode = null;
    if (/\b(?:add|put|schedule|plan|book|move|shift|push|pencil|slot|fit|make|change|\d{1,2}(?::\d\d)?\s?(?:am|pm)|at \d)\b/.test(c)) adds.push(c);
  }
  if (!acted && !adds.length && !said.length) return false;
  // With an AI key, anything PG couldn't pin down goes to the AI instead of failing.
  if (AI.on() && !ui.quiet && said.some(x => /^I couldn't find/.test(x))) { Object.values(snaps).forEach(sn => { day(sn.d).blocks = sn.blocks; }); return false; }
  for (const a of adds) {
    ui.quiet = []; ui.editing = true;
    try { await handle(a, false); } catch (e) { console.warn(e); }
    finally { ui.editing = false; }
    said.push(...ui.quiet); ui.quiet = null; acted = true;
  }
  save(); render();
  const list = Object.values(snaps);
  if (list.length) undoable(list, said[0]?.split(".")[0] + ".");
  reply(said.join(" ") || "Done.", { view: "today", date: view || ui.date || today(), spoken });
  return true;
}

// ================= Views =================
function go(view, date) { ui.view = view; if (date) { ui.date = date; ui.pinDate = date !== today(); } render(); $("#main").scrollTo?.(0, 0); if (isMobile()) window.scrollTo(0, 0); }
const TITLES = { today: "Today", school: "School", bass: "Bass", bible: "Bible", gym: "Gym", notes: "Notes", settings: "Settings" };
// Everything PG has learned, written into the "Learned things about PraiseGod" folder.
function factList() {
  const out = [...SC.facts(), ...F.facts()];
  const bs = BS.bass();
  if (BS.finished()) out.push({ k: "bass", t: "You finished all 26 bass lessons." });
  else if (bs.idx > 0) out.push({ k: "bass", t: `You're on bass lesson ${BS.lessonNo()} of ${BS.CURRICULUM.length}, ${BS.lesson().t}.` });
  const bb = B.bible();
  if (bb.plan && !bb.plan.finished) out.push({ k: "bible", t: `You're reading ${B.bookName(bb.plan.book)}, up to ${bb.max} chapter${bb.max > 1 ? "s" : ""} a day.` });
  const doneBooks = [...new Set([...(bb.history || []), bb.plan].filter(x => x && x.finished).map(x => B.bookName(x.book)))];
  if (doneBooks.length) out.push({ k: "bible_done", t: `You've finished reading ${doneBooks.join(", ")}.` });
  if (S.gym?.splitChosen && SPLITS[S.gym.split]) out.push({ k: "gym_split", t: `You train on a ${SPLITS[S.gym.split].label.toLowerCase()} split.` });
  const gl = (S.gym?.log || []).filter(l => l.date >= addDays(today(), -28)).length;
  if (gl >= 3) out.push({ k: "gym_freq", t: `You've trained about ${Math.round(gl / 4 * 10) / 10} times a week this past month.` });
  if (S.profile.dayStart !== 420 || S.profile.dayEnd !== 1380) out.push({ k: "day", t: `Your day usually runs from ${fmtTime(S.profile.dayStart)} to ${fmtTime(S.profile.dayEnd)}.` });
  const tr = LN.tracks(); if (tr.length) out.push({ k: "learning", t: `You're learning ${tr.map(t => t.topic).join(", ")}.` });
  return out;
}
function syncFacts() { try { M.syncFacts(factList()); } catch (e) { console.warn(e); } }
function render() {
  const oldWeek = $(".week-scroll");
  const scroll = oldWeek ? { week: oldWeek.dataset.week, x: oldWeek.scrollLeft, y: oldWeek.scrollTop } : null;
  syncFacts();
  if (!TITLES[ui.view]) ui.view = "today";
  $$("[data-view]").forEach(b => b.classList.toggle("on", b.dataset.view === ui.view));
  $("#view").innerHTML = { today: viewToday, school: viewSchool, bass: viewBass, bible: viewBible, gym: viewGym, notes: viewNotes, settings: viewSettings }[ui.view]();
  const newWeek = $(".week-scroll");
  if (newWeek && scroll?.week === newWeek.dataset.week) { newWeek.scrollLeft = scroll.x; newWeek.scrollTop = scroll.y; }
  document.title = TITLES[ui.view] + " · PG";
  paintSuggest();
}
function greeting() { const h = Math.floor(nowMin() / 60); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; }
const catVar = c => `--c:${(CATS[c] || CATS.other).color}`;
const bar = p => `<div class="bar"><i style="width:${p}%"></i></div>`;

function viewToday() {
  const d = ui.date, isT = d === today(), bl = blocksOf(d), n = nowMin();
  const cf = conflicts(bl);
  const cur = isT ? current() : null, nx = isT ? upcoming()[0] : null;
  let h = `<div class="spread"><div class="eyebrow">${esc(fmtDay(d, true))}</div>
    <div class="day-nav"><button class="icon-btn" data-act="day" data-n="-1" aria-label="Previous day"><svg><use href="#i-left"/></svg></button>
    ${isT ? "" : `<button class="chip" data-act="day" data-n="0">Today</button>`}
    <button class="icon-btn" data-act="day" data-n="1" aria-label="Next day"><svg><use href="#i-right"/></svg></button></div></div>
    <h1 class="title">${isT ? `${greeting()}, <em>${esc(addr())}</em>.` : esc(fmtDay(d))}</h1>`;
  h += weeklyTable(d);
  if (cur) {
    const pct = Math.round((n - cur.start) / (cur.end - cur.start) * 100);
    h += `<p class="note" aria-label="Happening now">Now: ${esc(cur.title)}, until ${fmtTime(cur.end)} · ${pct}% through. ${coachLink(cur)}</p>`;
  } else if (nx) {
    h += `<p class="note" aria-label="Up next">Next: ${esc(nx.title)}, ${fmtTime(nx.start)} to ${fmtTime(nx.end)} · in ${fmtDur(nx.start - n)}. ${coachLink(nx)}</p>`;
  }
  if (!bl.length) {
    h += `<div class="empty"><p>${isT ? "Your day is open." : "Nothing planned."}</p><button class="btn" data-act="add"><svg><use href="#i-plus"/></svg>Add</button></div>`;
  } else {
    h += `<h2 class="sec"><span>${isT ? "Today's checklist" : "Daily checklist"} · ${bl.filter(b => b.done).length}/${bl.length}</span><button class="btn sm ghost" data-act="add" aria-label="Add a block"><svg><use href="#i-plus"/></svg>Add</button></h2><div class="timeline">`;
    let nowDrawn = !isT;
    for (const b of bl) {
      if (!nowDrawn && n < b.start) { h += nowLine(n); nowDrawn = true; }
      const isLive = isT && b.start <= n && n < b.end && !b.done;
      h += `<div class="tl-row"><div class="tl-time">${fmtTime(b.start)}<small>${fmtTime(b.end)}</small></div>
        <div><div class="blk ${b.done ? "done" : ""} ${isLive ? "live" : ""}" style="${catVar(b.cat)}" role="button" tabindex="0" data-act="edit" data-id="${b.id}" aria-label="${esc(b.title)}, ${fmtTime(b.start)} to ${fmtTime(b.end)}">
          <div class="blk-title">${esc(b.title)}</div>
          <button class="check" data-act="toggle" data-id="${b.id}" aria-label="${b.done ? "Mark not done" : "Mark done"}"><svg><use href="#i-check"/></svg></button>
          <div class="blk-meta"><span class="tag cat" style="${catVar(b.cat)}">${esc((CATS[b.cat] || CATS.other).label)}</span><span class="tnum">${fmtDur(b.end - b.start)}</span>${cf.has(b.id) ? `<span class="tag warn">Overlaps</span>` : ""}${coachLink(b)}</div>
        </div></div></div>`;
    }
    if (!nowDrawn && n < 1440) h += nowLine(n);
    h += `</div>`;
  }
  if (isT) {
    const st = B.stats(), ls = BS.lesson();
    h += `<div class="tiles">
      <button class="tile" data-view="bass" style="${catVar("bass")}"><span class="eyebrow">Bass · ${BS.finished() ? "Done" : "Lesson " + BS.lessonNo()}</span><b>${esc(BS.finished() ? "Course complete" : ls.t)}</b>${bar(BS.pct())}</button>
      <button class="tile" data-view="bible" style="${catVar("bible")}"><span class="eyebrow">Bible${st ? " · " + st.pct + "%" : ""}</span><b>${esc(st ? (B.todays().doneToday ? "Done for today" : bibleRef()) : "Choose a book")}</b>${bar(st ? st.pct : 0)}</button></div>`;
  }
  if (isT && SC.pending().length) {
    const t = SC.pending()[0];
    h += `<button class="tile wide" data-view="school" style="${catVar("study")}"><span class="eyebrow">School · ${SC.pending().length} due</span><b>${esc(t.title)} · ${esc(t.due ? fmtDay(t.due) : "no date")}</b></button>`;
  }
  const routines = (S.routines || []).filter(r => !r.disabled && r.start == null);
  if (routines.length) h += `<h2 class="sec"><span>Every day</span></h2><div class="card"><p class="note">Daily reminders stay here. Checking one off only completes it for this day.</p>${routines.map(r => {
    const done = S.routineDone?.[`${r.id}:${d}`];
    return `<div class="set-row"><span>${esc(r.title)}</span><button class="btn sm" data-act="routine-check" data-id="${esc(r.id)}" aria-pressed="${!!done}">${done ? "Done today" : "Mark done"}</button></div>`;
  }).join("")}</div>`;
  if (S.inbox.length) {
    h += `<h2 class="sec"><span>To-do</span></h2><div class="card">${S.inbox.map(t => `<div class="set-row"><div><div class="lbl">${esc(t.title)}</div><div class="sub">${fmtDur(t.dur || 30)}</div></div>
      <div class="row"><button class="btn sm" data-act="fit" data-id="${t.id}">Fit in</button><button class="btn sm ghost" data-act="inbox-del" data-id="${t.id}">Remove</button></div></div>`).join("")}</div>`;
  }
  return h;
}
function weeklyTable(date) {
  const week = weekOf(date), dates = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const entries = dates.flatMap(d => blocksOf(d).filter(b => !b.skipped));
  const from = Math.max(0, Math.floor(Math.min(S.profile.dayStart, ...entries.map(b => b.start)) / 60) * 60);
  const until = Math.min(1440, Math.ceil(Math.max(S.profile.dayEnd, ...entries.map(b => b.end)) / 60) * 60);
  const span = Math.max(60, until - from), height = span * 1.2;
  const categories = [...new Set(entries.map(b => b.cat))];
  const pending = S.weekPlans?.[week]?.missing || [];
  return `<section class="week-panel" aria-label="Weekly timetable">
    <div class="week-heading"><div><h2>Weekly timetable</h2><p class="note">${esc(fmtDay(week))} to ${esc(fmtDay(dates[6]))} · Hong Kong time</p></div>
      <div class="row"><button class="icon-btn" data-act="week" data-n="-1" aria-label="Previous week"><svg><use href="#i-left"/></svg></button><button class="icon-btn" data-act="week" data-n="1" aria-label="Next week"><svg><use href="#i-right"/></svg></button><button class="btn sm primary" data-act="week-plan">${S.weekPlans?.[week] ? "Rebuild week" : "Plan week"}</button></div></div>
    <div class="week-scroll" data-week="${week}" role="region" tabindex="0" aria-label="Scrollable weekly timetable, Monday to Sunday">
      <div class="week-grid" role="table" aria-label="Weekly timetable">
        <div class="week-head" role="row"><div role="columnheader">Time</div>${dates.map((d, i) => `<button role="columnheader" class="${d === today() ? "is-today" : ""} ${d === date ? "selected" : ""}" data-act="week-day" data-date="${d}" aria-label="Show checklist for ${esc(fmtDay(d, true))}">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i]}<b>${+d.slice(-2)}</b></button>`).join("")}</div>
        <div class="week-body" role="row" style="height:${height}px">
          <div class="week-times" role="rowheader">${Array.from({ length: span / 60 }, (_, i) => `<span style="top:${i * 72}px">${fmtTime(from + i * 60)}</span>`).join("")}</div>
          ${dates.map(d => {
            const blocks = blocksOf(d).filter(b => !b.skipped), overlapping = conflicts(blocks);
            return `<div class="week-column ${d === today() ? "is-today" : ""}" role="cell" aria-label="${esc(fmtDay(d, true))}">${blocks.map(b => `<button class="week-event ${b.done ? "done" : ""} ${b.end - b.start < 30 ? "short" : ""} ${overlapping.has(b.id) ? "overlap" : ""}" style="${catVar(b.cat)};top:${(b.start - from) * 1.2}px;height:${Math.max(12, (b.end - b.start) * 1.2 - 1)}px" data-act="week-edit" data-date="${d}" data-id="${esc(b.id)}" title="${esc(b.title)} · ${fmtTime(b.start)} to ${fmtTime(b.end)}${b.done ? " · completed" : ""}${overlapping.has(b.id) ? " · overlaps another item" : ""}"><strong>${b.done ? "Done: " : ""}${esc(b.title)}</strong><small>${fmtTime(b.start)} to ${fmtTime(b.end)}${overlapping.has(b.id) ? " · Overlap" : ""}</small></button>`).join("")}</div>`;
          }).join("")}
        </div>
      </div>
    </div>
    <div class="week-legend">${categories.map(c => `<span style="${catVar(c)}"><i></i>${esc((CATS[c] || CATS.other).label)}</span>`).join("")}<span>Blank space is free, not a scheduled break.</span></div>
    ${!entries.length ? `<p class="note">Your week is open. Add commitments or press Plan week to allocate tasks and rest.</p>` : ""}
    ${pending.length ? `<p class="week-warning">Unallocated: ${pending.map(t => `${esc(t.title)} (${t.minutes} minutes)`).join(", ")}. Rebuild with more time or fewer tasks.</p>` : ""}
    <p class="note week-hint">Scroll for more hours or days. Tap an item to edit it; use the checklist to mark it done.</p>
  </section>`;
}
function openWeekPlanner() {
  const week = weekOf(ui.date), previous = S.weekPlans?.[week];
  const time = m => pad(Math.floor(m / 60)) + ":" + pad(m % 60);
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const sh = $("#sheet");
  sh.innerHTML = `<form data-form="week-plan"><h3>${previous ? "Rebuild your week" : "Plan your week"}</h3>
    <p class="note">Confirm the times below. Fixed appointments and completed work stay. Only future auto-planned sessions are rebuilt.</p>
    <label class="field"><span>Week starting Monday</span><input class="input" type="date" name="week" value="${week}" required></label>
    <div class="grid2"><label class="field"><span>Available from</span><input class="input" type="time" name="from" value="${time(previous?.start ?? S.profile.dayStart)}" required></label><label class="field"><span>Finish by</span><input class="input" type="time" name="until" value="${time(previous?.end ?? S.profile.dayEnd)}" required></label></div>
    <fieldset class="week-days"><legend>Allowed days</legend>${days.map((d, i) => `<label><input type="checkbox" name="days" value="${i}" ${!previous || previous.tasks.some(t => t.days.includes(d)) ? "checked" : ""}>${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i]}</label>`).join("")}</fieldset>
    <div class="grid2"><label class="field"><span>Work session, minutes</span><input class="input" name="focus" type="number" min="10" max="120" value="${previous?.focusMinutes || 50}" required></label><label class="field"><span>Rest after each, minutes</span><input class="input" name="rest" type="number" min="1" max="60" value="${previous?.breakMinutes || 10}" required></label></div>
    <label class="field"><span>Tasks and total minutes, one per line</span><textarea class="input" name="tasks" rows="5" placeholder="History revision, 90&#10;Practice bass, 30" required>${esc((previous?.tasks || []).map(t => `${t.title}, ${t.minutes}`).join("\n"))}</textarea></label>
    <p class="note">Minutes are the total for the week, not every day. Sessions are spread across your chosen days. Already-started sessions stay in place.</p>
    <p class="note">Planning principles: fixed commitments first, realistic time, manageable sessions and breaks. <a href="https://learningcenter.unc.edu/tips-and-tools/using-planners" target="_blank" rel="noopener">UNC planning guide</a> · <a href="https://lsc.cornell.edu/how-to-study/studying-for-and-taking-exams/guidelines-for-creating-a-study-schedule/" target="_blank" rel="noopener">Cornell study guide</a>.</p>
    <p class="note week-warning" data-week-error role="alert"></p>
    <div class="row"><button class="btn primary" type="submit">Build timetable</button><button class="btn" type="button" data-act="close-sheet">Cancel</button></div>
  </form>`;
  sh.showModal();
}
const nowLine = n => `<div class="now-line" aria-hidden="true"><span>${fmtTime(n)}</span><i></i></div>`;
function coachLink(b) {
  const v = { gym: ["gym", "Workout"], bass: ["bass", "Lesson"], band: ["bass", "Songs"], bible: ["bible", "Reading"], learn: ["notes", "Plan"] }[b.cat];
  return v ? `<button class="tag link" data-act="go" data-v="${v[0]}">${v[1]}</button>` : "";
}

function videoHTML(v, title, search) {
  if (!v || !v.id) {
    const q = encodeURIComponent(search || title + " proper form");
    return `<a class="video video-search" href="https://www.youtube.com/results?search_query=${q}" target="_blank" rel="noopener"><span class="play" style="position:static"><svg><use href="#i-play"/></svg></span><span>Search YouTube for ${esc(title)}</span></a><div class="video-cap"><span>Video not verified. This opens a search.</span><a href="https://www.youtube.com/results?search_query=${q}" target="_blank" rel="noopener">YouTube search <svg><use href="#i-ext"/></svg></a></div>`;
  }
  const playing = ui.playing.has(v.id);
  return `<div class="video">${playing
    ? `<iframe src="https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&rel=0&playsinline=1&modestbranding=1" title="${esc(title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe>`
    : `<button data-act="play" data-vid="${v.id}" aria-label="Play ${esc(title)}"><img src="https://i.ytimg.com/vi/${v.id}/hqdefault.jpg" alt="" loading="lazy" width="480" height="360"><span class="play" style="position:absolute"><svg><use href="#i-play"/></svg></span></button>`}</div>
    <div class="video-cap"><span>${esc(v.by)}</span><a href="https://www.youtube.com/watch?v=${v.id}" target="_blank" rel="noopener">YouTube <svg><use href="#i-ext"/></svg></a></div>`;
}

function gymProgress() {
  if (!S.gym.cur || S.gym.cur.date !== today()) S.gym.cur = { date: today(), sets: {} };
  return S.gym.cur;
}
const GYM_TABS = [["workout", "Workout"], ["food", "Food"], ["list", "Shopping"]];
function viewGym() {
  const tabs = `<div class="tabs" role="tablist">${GYM_TABS.map(([k, l]) => `<button role="tab" class="tab ${ui.gymTab === k ? "on" : ""}" aria-selected="${ui.gymTab === k}" data-act="gymtab" data-k="${k}">${l}</button>`).join("")}</div>`;
  if (ui.gymTab === "food") return tabs + viewFood();
  if (ui.gymTab === "list") return tabs + viewList();
  return tabs + viewWorkout();
}
function recipeCard(r, label) {
  const open = ui.openRec === r.k, on = F.food().week.includes(r.k);
  return `<article class="rec ${open ? "open" : ""}"><button class="rec-head" data-act="rec" data-k="${r.k}" aria-expanded="${open}">
    ${label ? `<span class="rec-when">${esc(label)}</span>` : ""}<span class="rec-t">${esc(r.t)}</span><span class="rec-p tnum">${r.p} g</span></button>
    ${open ? `<div class="rec-body"><div class="faint rec-meta">${esc(r.zh)} · ${r.min} min · ${r.p} g protein · ${r.f} g fiber${r.batch ? ` · makes ${r.batch}` : ""}</div>
      <ul class="ing">${r.ing.map(([k, a]) => { const it = F.ITEMS[k]; const q = it.unit && a ? F.fmtQty(a, it.unit) : ""; return `<li><span>${esc(it.n)}</span><span class="faint">${esc(q)}</span></li>`; }).join("")}</ul>
      <ol class="cues">${r.steps.map(x => `<li>${esc(x)}</li>`).join("")}</ol>
      ${r.store ? `<p class="note rec-store">${esc(r.store)}</p>` : ""}
      <div class="row"><a class="btn sm" href="${esc(F.link(r).url)}" target="_blank" rel="noopener"><svg><use href="#${r.src ? "i-ext" : "i-play"}"/></svg>${esc(F.link(r).label)}</a>
      <button class="btn sm" data-act="speak-rec" data-k="${r.k}"><svg><use href="#i-speaker"/></svg>Read it</button>
      <button class="btn sm ${on ? "" : "primary"}" data-act="rec-week" data-k="${r.k}">${on ? "On this week's list" : "Add to this week"}</button></div></div>` : ""}</article>`;
}
function viewFood() {
  const gym = gymToday(), ms = F.todayMeals(today(), gym), f = F.food();
  let h = `<div class="eyebrow">Food · ${gym ? "Gym day" : "Rest day"}</div><h1 class="title">About <em>${F.target()} g</em> of protein today.</h1>
    <div class="macros"><div><b class="tnum">${F.perMeal()} g</b><span>protein a meal</span></div><div><b class="tnum">${F.fiberTarget()} g</b><span>fiber a day</span></div></div>
    <form class="row kg-form" data-form="kg"><span class="faint">Your weight</span><input class="input tnum" name="kg" type="number" inputmode="decimal" min="30" max="250" step="0.5" placeholder="kg" value="${f.kg || ""}" aria-label="Weight in kg"><span class="faint">kg</span><button class="btn sm">Save</button></form>
    <h2 class="sec"><span>Today</span></h2>`;
  h += ms.map(m => recipeCard(m.r, m.when)).join("");
  h += `<p class="note">These meals give about ${F.sum(ms, "p")} g of protein and ${F.sum(ms, "f")} g of fiber.</p>`;
  h += `<h2 class="sec"><span>Know this</span></h2><div class="card list tips">${F.TIPS.map(t => `<details class="tip" ${ui.openTip === t.k ? "open" : ""}><summary>${esc(t.t)}</summary><p>${esc(t.d())}</p><span class="faint tip-src">${esc(t.src)}</span></details>`).join("")}</div>`;
  const inToday = ms.some(m => m.r.k === ui.openRec);
  h += `<details class="fold" ${ui.openRec && !inToday ? "open" : ""}><summary>All recipes</summary>${F.RECIPES.map(r => recipeCard(r)).join("")}</details>`;
  return h;
}
function viewList() {
  const ls = F.list(), left = ls.filter(x => !x.got).length;
  let h = `<div class="eyebrow">Shopping · This week</div><h1 class="title"><em>${left}</em> ${left === 1 ? "item" : "items"} to buy.</h1>
    <form class="row add-note" data-form="shop"><input class="input" name="t" placeholder="Add an item" aria-label="Add an item"><button class="btn primary">Add</button></form>`;
  F.byStore(ls).forEach(({ s, rows }) => {
    h += `<h2 class="sec"><span>${esc(F.STORES[s].label)}</span></h2>${F.STORES[s].tip ? `<p class="note store-tip">${esc(F.STORES[s].tip)}</p>` : ""}<div class="card list">`;
    h += rows.map(r => `<div class="shop ${r.got ? "got" : ""}"><button class="chk" data-act="shop-got" data-id="${r.id}" aria-pressed="${r.got}" aria-label="${r.got ? "Unmark" : "Mark"} ${esc(r.n)}">${r.got ? `<svg><use href="#i-check"/></svg>` : ""}</button>
      <span class="shop-n">${esc(r.n)}${r.zh ? ` <span class="faint">${esc(r.zh)}</span>` : ""}</span><span class="faint tnum">${esc(r.qty)}</span>
      <button class="x" data-act="shop-del" data-id="${r.id}" aria-label="Remove ${esc(r.n)}"><svg><use href="#i-x"/></svg></button></div>`).join("");
    h += `</div>`;
  });
  if (!ls.length) h += `<p class="note">Your list is empty.</p>`;
  h += `<div class="row act-row" style="margin-top:var(--space-5)"><button class="btn" data-act="shop-build">Rebuild from recipes</button>${ls.some(x => x.got) ? `<button class="btn" data-act="shop-clear">Clear bought</button>` : ""}</div>`;
  return h;
}
function viewWorkout() {
  const sp = C.split(), w = C.workoutFor(today()), prog = gymProgress();
  const logged = S.gym.log.find(l => l.date === today());
  let h = `<div class="eyebrow">Gym · ${esc(sp.label)}</div>
    <h1 class="title">Today is <em>${esc(w.name.toLowerCase())}</em>.</h1>
    <div class="split-chips" role="group" aria-label="Choose workout">${sp.days.map(x => `<button class="chip ${x.key === w.key ? "on" : ""}" data-act="gymday" data-k="${x.key}">${esc(x.name)}</button>`).join("")}</div>
    <div class="row act-row"><button class="btn" data-act="speak-gym"><svg><use href="#i-speaker"/></svg>Talk me through it</button>
    <button class="btn primary" data-act="gym-finish" ${logged ? "disabled" : ""}>${logged ? "Logged" : "Finish workout"}</button></div>
    <p class="note" style="margin-bottom:var(--space-5)">${esc(GYM_WARMUP)}</p>`;
  w.plan.forEach((p, i) => {
    const e = EXERCISES[p.ex], open = ui.openEx === p.ex;
    const sets = prog.sets[p.ex] || [];
    const comp = sets.filter(Boolean).length >= p.sets;
    const last = C.lastLog(p.ex);
    h += `<article class="ex ${open ? "open" : ""} ${comp ? "complete" : ""}" id="ex-${p.ex}">
      <button class="ex-head" data-act="ex" data-k="${p.ex}" aria-expanded="${open}">
        <span class="ex-num">${comp ? `<svg style="width:14px;height:14px"><use href="#i-check"/></svg>` : i + 1}</span>
        <span class="ex-name">${esc(e.name)}</span>
        <span class="ex-dose">${p.sets} × ${esc(p.reps)}</span>
      </button>
      ${open ? `<div class="ex-body"><div>${videoHTML(e.video, e.name, e.search)}</div><div>
        ${e.muscles ? `<p class="note" style="margin:0 0 8px">Works: ${esc(e.muscles)}</p>` : ""}<ol class="cues">${e.cues.map(c => `<li>${esc(c)}</li>`).join("")}</ol>
        <div class="sets" role="group" aria-label="Sets">${Array.from({ length: p.sets }, (_, k) => `<button class="set ${sets[k] ? "on" : ""}" data-act="set" data-k="${p.ex}" data-i="${k}" aria-pressed="${!!sets[k]}">Set ${k + 1}</button>`).join("")}</div>
        <div class="weight"><label class="row" style="gap:6px">kg <input class="input tnum" type="number" inputmode="decimal" min="0" step="0.5" data-act="w" data-k="${p.ex}" value="${last ? esc(last.w) : ""}" aria-label="Weight in kg"></label>
          <span>${last ? `Last · ${esc(last.w)} kg` : ""}</span><span>Rest ${p.rest >= 60 ? Math.round(p.rest / 60 * 10) / 10 + " min" : p.rest + "s"}</span></div>
      </div></div>` : ""}
    </article>`;
  });
  return h;
}

function viewBass() {
  const st = BS.bass(), mins = minsFor("bass", 30);
  let h = "";
  if (BS.finished()) {
    h += `<div class="eyebrow">Bass · Course complete</div><h1 class="title">You finished all <em>26 lessons</em>.</h1>${bar(100)}
      <h2 class="sec"><span>Keep growing</span></h2><div class="card list">${BS.EXTRAS.map(x => `<div class="li"><span>${esc(x.t)}</span><a class="tag link" href="https://www.youtube.com/watch?v=${x.video.id}" target="_blank" rel="noopener">${esc(x.video.by)}</a></div>`).join("")}</div>`;
  } else {
    const p = BS.plan(mins);
    h += `<div class="eyebrow">Bass · Lesson ${p.n} of ${BS.CURRICULUM.length} · ${esc(BS.LEVELS[p.lesson.lvl])}</div>
      <h1 class="title">${esc(p.lesson.t)}</h1>${bar(BS.pct())}
      <div class="lesson"><div>${videoHTML(p.lesson.video, p.lesson.t)}</div>
      <div><div class="steps">${p.steps.map(s => `<div class="step"><div class="step-min">${s.min} min</div><div><div class="step-t">${esc(s.t)}</div><div class="step-d">${esc(s.d)}</div></div></div>`).join("")}</div>
      <p class="note"><b>Move on when:</b> ${esc(p.pass)}</p>
      <div class="row act-row"><button class="btn primary" data-act="bass-done"><svg><use href="#i-check"/></svg>Complete</button><button class="btn" data-act="bass-repeat">Not yet</button><button class="btn ghost" data-act="speak-bass" aria-label="Talk me through it"><svg><use href="#i-speaker"/></svg></button></div></div></div>`;
  }
  h += `<details class="fold"><summary>All lessons</summary>${BS.LEVELS.map((lv, li) => `<div class="lv"><div class="eyebrow">${esc(lv)}</div>${BS.CURRICULUM.map((l, i) => l.lvl !== li ? "" : `<button class="li ${i === st.idx ? "on" : ""} ${st.done[i] ? "done" : ""}" data-act="bass-jump" data-i="${i}"><span class="n">${st.done[i] ? `<svg><use href="#i-check"/></svg>` : i + 1}</span><span>${esc(l.t)}</span></button>`).join("")}</div>`).join("")}</details>
    <details class="fold"><summary>Songs${S.band.songs.length ? ` · ${S.band.songs.length}` : ""}</summary><div class="card">`;
  h += S.band.songs.map(s => { const sg = stageOf(s.progress); return `<div class="song"><div><div class="song-name">${esc(s.name)}</div><div class="song-stage ${sg.tone}"><span class="tnum">${s.progress}%</span> · ${sg.label}</div></div>
      <button class="x" data-act="song-del" data-id="${s.id}" aria-label="Remove ${esc(s.name)}"><svg><use href="#i-x"/></svg></button>
      <input type="range" min="0" max="100" step="5" value="${s.progress}" data-act="song-p" data-id="${s.id}" aria-label="${esc(s.name)} progress"></div>`; }).join("");
  h += `<form class="row" data-form="song" style="flex-wrap:nowrap"><input class="input" name="song" placeholder="Add a song" aria-label="Song name"><button class="btn">Add</button></form></div></details>`;
  return h;
}

function viewBible() {
  const b = B.bible();
  const opts = sel => B.BOOKS.map(([n], i) => `<option value="${i}" ${i === sel ? "selected" : ""}>${esc(n)}</option>`).join("");
  const maxSel = `<select class="input" name="max" aria-label="Chapters a day">${[1, 2, 3, 4, 5, 10].map(n => `<option value="${n}" ${b.max === n ? "selected" : ""}>${n} a day</option>`).join("")}</select>`;
  if (!b.plan) {
    return `<div class="eyebrow">Bible</div><h1 class="title">What are you <em>reading</em>?</h1>
      <form class="row plan-form" data-form="bible-plan"><select class="input" name="book" aria-label="Book">${opts(B.findBook("ephesians"))}</select>${maxSel}<button class="btn primary">Start</button></form>`;
  }
  const s = B.stats(), td = B.todays(), ref = bibleRef();
  const rel = M.notes().filter(n => n.refs.some(r => r.startsWith(s.book))).slice(0, 4);
  let h = `<div class="eyebrow">Bible · ${esc(s.book)} · ${s.pct}%</div>
    <h1 class="title">${s.finished ? `You finished <em>${esc(s.book)}</em>.` : td.doneToday ? "Done for <em>today</em>." : esc(ref)}</h1>${bar(s.pct)}
    <p class="note tnum">${s.read} of ${s.tot} verses · ${s.chLeft} ${s.chLeft === 1 ? "chapter" : "chapters"} left${s.chLeft ? ` · about ${s.daysLeft} ${s.daysLeft === 1 ? "day" : "days"}` : ""}</p>`;
  if (!s.finished && !td.doneToday) h += `<div class="row act-row"><a class="btn" href="${B.link(ref)}" target="_blank" rel="noopener">Open reading <svg><use href="#i-ext"/></svg></a><button class="btn primary" data-act="bible-done"><svg><use href="#i-check"/></svg>I read it</button></div>
    <form class="row upto" data-form="bible-upto"><span class="faint">Read up to</span><input class="input tnum" name="ch" type="number" min="1" max="${s.nCh}" placeholder="Ch" aria-label="Chapter"><input class="input tnum" name="v" type="number" min="1" placeholder="Verse" aria-label="Verse"><button class="btn sm">Save</button></form>`;
  h += `<h2 class="sec"><span>Study</span></h2><div class="card"><div class="steps">${B.STUDY.map((x, i) => `<div class="step"><div class="step-min">${i + 1}</div><div><div class="step-t">${esc(x.t)}</div><div class="step-d">${esc(x.d)}</div></div></div>`).join("")}</div></div>`;
  if (rel.length) h += `<h2 class="sec"><span>What you learned in ${esc(s.book)}</span></h2>${rel.map(noteCard).join("")}`;
  h += `<details class="fold"><summary>Change plan</summary><form class="row plan-form" data-form="bible-plan"><select class="input" name="book" aria-label="Book">${opts(b.plan.book)}</select>${maxSel}<button class="btn">Save</button></form></details>`;
  return h;
}

const noteCard = n => `<article class="note-card" style="--c:${M.FOLDERS[n.folder].color}"><p>${esc(n.text)}</p><div class="nmeta"><span>${esc(M.fmtDate(n.date))}</span><span class="tag cat">${esc(M.FOLDERS[n.folder].short || M.FOLDERS[n.folder].label)}</span>${n.by === "pg" ? `<span class="tag">Written by PG</span>` : ""}${n.refs.slice(0, 2).map(r => `<span class="tag">${esc(r)}</span>`).join("")}<button class="x" data-act="note-del" data-id="${n.id}" aria-label="Delete note"><svg><use href="#i-x"/></svg></button></div></article>`;
function viewNotes() {
  const c = M.counts(), all = M.notes();
  let list = ui.q ? M.search(ui.q, 50) : all;
  if (ui.folder !== "all") list = list.filter(n => n.folder === ui.folder);
  const trs = LN.tracks();
  let h = `<div class="eyebrow">What PG knows about you</div><h1 class="title">Notes</h1>
    <form class="row add-note" data-form="note"><input class="input" name="t" placeholder="Save a revelation or lesson" aria-label="New note"><button class="btn primary">Save</button></form>`;
  if (trs.length) {
    h += `<h2 class="sec"><span>Learning</span></h2>`;
    h += trs.map(t => { const s = t.steps[t.idx]; const pc = Math.round(t.idx / t.steps.length * 100); return `<div class="card track"><div class="spread"><b>${esc(t.topic)}</b><span class="faint tnum">${Math.min(t.idx + 1, t.steps.length)}/${t.steps.length}</span></div>${bar(pc)}
      ${s ? `<div class="step-t">${esc(s.t)}</div><div class="step-d">${esc(s.d)}</div><div class="row">${s.links.map(l => `<a class="tag link" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} <svg><use href="#i-ext"/></svg></a>`).join("")}<span class="grow"></span><button class="btn sm primary" data-act="learn-done" data-id="${t.id}">Complete</button><button class="x" data-act="learn-del" data-id="${t.id}" aria-label="Remove ${esc(t.topic)}"><svg><use href="#i-x"/></svg></button></div>` : `<div class="step-d">All steps done.</div>`}</div>`; }).join("");
  }
  h += `<h2 class="sec"><span>Folders</span></h2><div class="split-chips">${[["all", "All", all.length], ...Object.entries(M.FOLDERS).map(([k, v]) => [k, v.short || v.label, c[k] || 0])].map(([k, l, n]) => `<button class="chip ${ui.folder === k ? "on" : ""}" data-act="folder" data-k="${k}">${esc(l)} <span class="faint">${n}</span></button>`).join("")}</div>
    <input class="input search" data-act="note-q" type="search" placeholder="Search" value="${esc(ui.q)}" aria-label="Search notes">`;
  if (ui.folder === "about") h += `<h2 class="sec"><span>Learned things about PraiseGod</span></h2><p class="note">PG saves lasting things here by itself: who you are, the people in your life, likes and dislikes, food rules, habits, goals, skills you're building, your values, and how you want PG to act. If you keep asking about the same topic on different days, PG saves that too. One-off questions, today's plans and passing moods are not saved. You can add your own, like: remember that I focus best after a walk.</p>`;
  h += list.length ? list.map(noteCard).join("") : `<p class="note">${all.length ? "Nothing here yet." : "Nothing saved yet."}</p>`;
  return h;
}

function viewSchool() {
  const p = SC.pending(), nx = SC.upcomingStudy(), r = SC.ratio(), learned = SC.learnedLines();
  const short = d => d === today() ? "Today" : d === addDays(today(), 1) ? "Tomorrow" : new Date(d + "T00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const dueLbl = t => t.due ? `Due ${short(t.due)}${t.dueMin != null && t.dueMin < 1439 ? " · " + fmtTime(t.dueMin) : ""}` : "No date yet";
  let h = `<div class="eyebrow">School</div><h1 class="title">${p.length ? `<em>${p.length}</em> assignment${p.length > 1 ? "s" : ""} to go.` : "Nothing due."}</h1>`;
  if (nx) h += `<section class="now" aria-label="Next study session"><div class="eyebrow">Next study · ${esc(fmtDay(nx.date))}</div><div class="now-title">${esc(nx.title)}</div><div class="now-next"><span>${fmtTime(nx.start)} – ${fmtTime(nx.end)}</span><button class="btn sm" data-act="go" data-v="today">Timetable</button></div></section>`;
  h += `<form class="row add-task" data-form="task"><input class="input" name="t" placeholder="History essay due Friday 5pm, 3 hours" aria-label="Add an assignment"><button class="btn primary">Add</button></form>`;
  if (p.length) {
    h += `<h2 class="sec"><span>Due</span><button class="btn sm ghost" data-act="replan">Re-plan</button></h2><div class="card list">`;
    h += p.map(t => {
      const ss = SC.sessionsOf(t), dn = ss.filter(b => b.done).length;
      const pct = Math.min(100, Math.round((t.doneMin || 0) / Math.max(1, t.plan) * 100));
      return `<div class="task"><div class="task-main"><div class="lbl">${esc(t.title)}</div>
        <div class="sub">${esc(dueLbl(t))} · ${fmtDur(t.plan)} planned${ss.length ? ` · ${dn}/${ss.length} sessions` : ""}</div>${bar(pct)}</div>
        <div class="row"><button class="btn sm" data-act="task-done" data-id="${t.id}">Done</button><button class="icon-btn" data-act="task-del" data-id="${t.id}" aria-label="Remove ${esc(t.title)}"><svg><use href="#i-x"/></svg></button></div></div>`;
    }).join("") + `</div>`;
  } else h += `<p class="note">Tell PG what's due, like: I have a math test next Tuesday and a biology report due the 20th.</p>`;
  const done = SC.tasks().filter(t => t.done).slice(-3).reverse();
  if (done.length) h += `<h2 class="sec"><span>Finished</span></h2><div class="card list">${done.map(t => `<div class="task done"><div class="lbl">${esc(t.title)}</div></div>`).join("")}</div>`;
  h += `<p class="note">Assignments stay here until you mark them done. Tell PG the name and due date. Study time is only a plan, not a change to your deadline.</p>`;
  h += `<details class="fold"><summary>How PG plans</summary><div class="card list tips">${SC.RULES.map(x => `<div class="rule"><b>${esc(x.t)}</b><p>${esc(x.d)}</p><a class="faint tip-src" href="${esc(x.url)}" target="_blank" rel="noopener">Source</a></div>`).join("")}</div></details>`;
  return h;
}
// ================= PG Cloud: sync, passcode, Workers AI =================
const ago = t => { if (!t) return "not yet"; const s = Math.round((Date.now() - t) / 1000); return s < 60 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : fmtTime(new Date(t).getHours() * 60 + new Date(t).getMinutes()); };
function cloudSteps(open) {
  return `<details class="fold" ${open ? "open" : ""}><summary>Set up PG Cloud (about 3 minutes, free)</summary>
    <ol class="steps">
      <li>In Cloudflare, open <a href="https://dash.cloudflare.com/?to=/:account/workers/d1" target="_blank" rel="noopener">D1 SQL database</a>. Press Create Database, name it <b>pg</b>, and press Create.</li>
      <li>Open <a href="https://dash.cloudflare.com/?to=/:account/workers-and-pages/create" target="_blank" rel="noopener">Workers and Pages</a>. Press Create application, then Start with Hello World. Name it <b>pg-cloud</b> and press Deploy.</li>
      <li>Press Edit code. Clear everything in worker.js, paste the PG Cloud code, and press Deploy.</li>
      <li>In the Worker's Bindings tab, press Add binding. Pick <b>Workers AI</b> and type <b>AI</b> as the name. Add one more: <b>D1 database</b>, name <b>DB</b>, and pick <b>pg</b>.</li>
      <li>Copy the Worker's address (it ends in .workers.dev) into PG Cloud address here. Type your passcode and press Connect. The first device you connect sets the passcode.</li>
    </ol>
    <button class="btn" type="button" data-act="cloud-copy">Copy PG Cloud code</button></details>`;
}
function cloudSettings() {
  if (SY.on()) return `<h2 class="sec"><span>PG Cloud</span></h2><div class="card">
    <div class="ai-status ${S.dev.cloud?.error ? "err" : "ok"}" role="status"><i></i><span data-sync-status>${esc(SY.status())} · last synced ${esc(ago(SY.last()))}</span></div>
    <p class="note">Assignments, memories, workouts, schedules and daily reminders are saved locally and merged with PG Cloud. Connect both devices to the same PG Cloud. ${S.dev.cloud?.safe ? "" : "Update PG Cloud for protected simultaneous saves."}</p>
    <div class="row"><button class="btn" data-act="cloud-sync">Sync now</button><button class="btn" data-act="cloud-others">Sign out other devices</button><button class="btn ghost" data-act="cloud-off">Stop syncing here</button></div>${cloudSteps(false)}</div>`;
  const st = ui.cloudStatus;
  return `<h2 class="sec"><span>PG Cloud</span></h2><div class="card">
    <p class="note" style="margin-top:0">Keep your laptop and phone the same, lock PG with a passcode, and run PG's AI on your Cloudflare Workers AI. It all lives in your own Cloudflare account.</p>
    ${st ? `<div class="ai-status ${st.err ? "err" : ""}" role="status"><i></i><span>${esc(st.text)}</span></div>` : ""}
    <form class="ai-form" data-form="cloud">
      ${PG_CLOUD ? "" : `<label class="field"><span>PG Cloud address</span><input class="input" name="url" value="${esc(SY.url())}" placeholder="https://pg-cloud.yourname.workers.dev" autocomplete="off" spellcheck="false" autocapitalize="off" inputmode="url"></label>`}
      <label class="field"><span>Passcode</span><input class="input" name="code" type="password" inputmode="numeric" autocomplete="off" placeholder="Your passcode"></label>
      <div class="row"><button class="btn primary" type="submit">Connect</button></div>
    </form>${cloudSteps(!SY.url())}</div>`;
}
function naturalVoice() {
  if (!SY.on() || !CV.v || CV.v >= 5) return "";
  return `<div class="update-box"><b>Update PG Cloud to protect your saved data</b><p class="note" style="margin:4px 0 8px">Copy the code, open pg-cloud in Cloudflare, press Edit code, replace the code and Deploy. Keep the same Worker and database. This prevents simultaneous device saves overwriting each other and keeps cloud recovery copies.</p><div class="row"><button class="btn primary sm" data-act="cloud-copy">Copy PG Cloud code</button><a class="btn sm" href="https://dash.cloudflare.com/?to=/:account/workers-and-pages" target="_blank" rel="noopener">Open Cloudflare</a></div></div>`;
}   // PG uses the free built-in phone voice
function copyCloud() { navigator.clipboard?.writeText(AI.CLOUD_CODE).then(() => toast("PG Cloud code copied. Paste it in Cloudflare."), () => toast("Couldn't copy. Open worker/pg-worker.js in the PG GitHub repo.")); }
async function connectCloud(address, code, done) {
  try {
    const r = await SY.unlock(address, code);
    if (S.ai.provider === "none" || !AI.on() || S.ai.provider === "cloudflare") { S.ai = { ...S.ai, provider: "cloudflare", ok: false }; save(); }
    afterSync(); done?.(null, r);
    toast(r.adopted ? "Connected. This device now has your PG data." : r.first ? "PG Cloud is set up. Your passcode is saved." : "Connected. This device's data is now in PG Cloud.");
    if (S.ai.provider === "cloudflare") connectAI();
  } catch (e) { done?.(e); }
}
function afterSync() { if (CV.v < 5) probeCloud(); C.syncCustom(); BS.bass(); B.bible(); M.notes(); LN.tracks(); if (!ui.pinDate) ui.date = today(); paintLock(); paintChat(); render(); }
function paintLock() {
  let el = $("#lock");
  if (!SY.locked()) { el?.remove(); document.body.classList.remove("locked"); return; }
  document.body.classList.add("locked");
  if (el) return;
  el = document.createElement("div"); el.id = "lock"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Unlock PG");
  el.innerHTML = `<form class="lock-card" data-form="unlock">
    <div class="lock-mark" aria-hidden="true">PG</div>
    <h1 class="title">Enter passcode</h1>
    <p class="faint">PG is private. Enter the passcode to open it on this device.</p>
    ${PG_CLOUD ? "" : `<label class="field"><span>PG Cloud address</span><input class="input" name="url" placeholder="https://pg-cloud.yourname.workers.dev" autocomplete="off" spellcheck="false" autocapitalize="off" inputmode="url"></label>`}
    <label class="field"><span>Passcode</span><input class="input lock-code" name="code" type="password" inputmode="numeric" autocomplete="off" autofocus></label>
    <p class="lock-err" role="alert"></p>
    <button class="btn primary" type="submit">Unlock</button></form>`;
  document.body.appendChild(el);
  setTimeout(() => el.querySelector(".lock-code")?.focus(), 50);
}
SY.init({
  busy: () => voice.mode !== "off" || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || ""),
  changed: () => afterSync(),
  revoked: () => { voice.kill?.(); afterSync(); }
});
function aiSettings() {
  const st = ui.aiStatus || (AI.on() ? { ok: S.ai.ok, text: S.ai.ok ? `Connected to ${AI.label()}` : "Saved. Tap Test to check it works." } : { text: "Not connected" });
  const pv = S.ai.provider && !["none", "auto"].includes(S.ai.provider) ? S.ai.provider : "";
  return `<h2 class="sec"><span>PG's AI brain</span></h2><div class="card ai-card">
    <p class="note" style="margin-top:0">Paste an API key from any AI company, like ChatGPT, Claude, Gemini, Grok, DeepSeek, Groq, Mistral, Perplexity or OpenRouter, so PG can hold real conversations. PG figures out which one it is. ${SY.on() ? "PG Cloud keeps the key on your other devices too." : "The key stays on this device unless PG Cloud is on."}</p>
    <div class="ai-status ${st.ok ? "ok" : st.err ? "err" : ""}" role="status"><i></i><span>${esc(st.text)}${st.ok ? ` · ${esc(AI.modelOf())}` : ""}</span></div>
    <form class="ai-form" data-form="ai">
      <label class="field" data-ai-key ${pv === "cloudflare" ? "hidden" : ""}><span>API key</span><input class="input" name="key" type="password" data-act="ai-key-live" value="${esc(S.ai.key)}" placeholder="Paste your key here" autocomplete="off" spellcheck="false" autocapitalize="off"></label>
      <div class="grid2"><label class="field"><span>Provider</span><select class="input" name="provider" data-act="ai-prov"><option value="">Detect from key</option>${Object.entries(AI.PROVIDERS).map(([k, v]) => `<option value="${k}" ${pv === k ? "selected" : ""}>${v.label}</option>`).join("")}</select></label>
      <label class="field"><span>Model <span class="faint">(optional)</span></span><input class="input" name="model" value="${esc(S.ai.model && AI.modelOf() === S.ai.model ? S.ai.model : "")}" placeholder="${esc(pv ? (AI.PROVIDERS[pv].model || "PG picks one") : "PG picks one")}" autocomplete="off" spellcheck="false" autocapitalize="off"></label></div>
      <p class="note ai-cf" data-ai-cf ${pv === "cloudflare" ? "" : "hidden"}>${SY.on() ? "Uses Workers AI on your PG Cloud. No key needed." : "Connect PG Cloud above first. Then PG uses your Workers AI with no key."}</p>
      <label class="field" data-ai-base ${pv === "custom" ? "" : "hidden"}><span>Web address of the AI</span><input class="input" name="base" value="${esc(S.ai.base || "")}" placeholder="https://api.example.com/v1" autocomplete="off" spellcheck="false" autocapitalize="off" inputmode="url"></label>
      <div class="row"><button class="btn primary" type="submit">Save and connect</button>${AI.on() ? `<button class="btn" type="button" data-act="ai-test">Test</button><button class="btn ghost" type="button" data-act="ai-clear">Remove key</button>` : ""}</div>
    </form>
    <details class="fold"><summary>Where to get a key</summary><p class="note">${Object.values(AI.PROVIDERS).filter(v => v.keyUrl).map(v => `<a href="${v.keyUrl}" target="_blank" rel="noopener">${esc(v.label.replace(/ \(.*\)$/, ""))}</a>`).join(" · ")}. One OpenRouter key works with models from almost every company.</p></details></div>`;
}
function showBase(f) { const b = f?.querySelector("[data-ai-base]"); if (b) b.hidden = f.provider.value !== "custom"; const c = f?.querySelector("[data-ai-cf]"); if (c) c.hidden = f.provider.value !== "cloudflare"; const k = f?.querySelector("[data-ai-key]"); if (k) k.hidden = f.provider.value === "cloudflare"; }
async function connectAI() {
  ui.aiStatus = { text: "Connecting…" }; render();
  try { await AI.test(); S.ai.ok = true; save(); ui.aiStatus = null; render(); toast(`PG is connected to ${AI.label()}.`); }
  catch (e) { S.ai.ok = false; save(); ui.aiStatus = { err: true, text: AI.friendlyError(e) }; render(); }
}
function viewSettings() {
  const vs = voice.voices();
  const tm = m => pad(Math.floor(m / 60)) + ":" + pad(m % 60);
  const sw = (act, on, label, dis) => `<label class="switch"><input type="checkbox" data-act="${act}" ${on ? "checked" : ""} ${dis ? "disabled" : ""} aria-label="${label}"><i></i></label>`;
  return `<h1 class="title">More <span class="faint" style="font-size:var(--text-xs);font-family:inherit;font-weight:400">v${PG_VERSION}</span></h1>
  <div class="tiles"><button class="tile wide" data-act="about-folder" style="${catVar("learn")}"><span class="eyebrow">Learned things about PraiseGod</span><b>${M.facts().length} thing${M.facts().length === 1 ? "" : "s"} PG knows about you</b></button><button class="tile" data-view="notes" style="${catVar("learn")}"><span class="eyebrow">Notes</span><b>${M.notes().length} saved</b></button><button class="tile" data-view="school" style="${catVar("study")}"><span class="eyebrow">School</span><b>${SC.pending().length} due</b></button><button class="tile" data-act="goals-open" style="${catVar("gym")}"><span class="eyebrow">Goals</span><b>${D.goals().length ? D.goals().length + " goal" + (D.goals().length > 1 ? "s" : "") : "Add your goals"}</b></button><button class="tile" data-act="canto-open" style="${catVar("social")}"><span class="eyebrow">Cantonese</span><b>${D.learned().length} learned</b></button></div>
  ${cloudSettings()}
  ${aiSettings()}
  <h2 class="sec"><span>Voice</span></h2><div class="card">
    <div class="set-row"><div class="lbl">Always listen for “Hi PG”<span class="faint" style="display:block;font-weight:400;font-size:var(--text-xs)">${voice.supported ? "Off means PG only listens after you press the button. Some phones beep when it's on." : "Not supported here"}</span></div>${sw("handsfree", S.voice.handsFree, "Hands-free wake word", !voice.supported)}</div>
    <div class="set-row"><div class="lbl">Speak replies</div>${sw("speak", S.voice.speak !== false, "Speak replies")}</div>
    <div class="set-row"><div class="lbl">Spoken reminders</div>${sw("alerts", S.voice.alerts, "Spoken reminders")}</div>
    <div class="set-row"><div class="lbl">Heads-up</div><select class="input" style="width:auto" data-act="heads" aria-label="Heads-up minutes">${[0, 5, 10, 15].map(m => `<option value="${m}" ${S.voice.heads === m ? "selected" : ""}>${m ? m + " min before" : "Off"}</option>`).join("")}</select></div>
    <div class="set-row"><div class="lbl">Keep screen awake</div>${sw("awake", S.voice.keepAwake, "Keep screen awake")}</div>
    ${naturalVoice()}
    <div class="grid2" style="margin-top:var(--space-3)" ${voice.cloud.ok() ? "hidden" : ""}>
      <label class="field"><span>Voice</span><select class="input" data-act="voice">${vs.length ? vs.map(v => `<option value="${esc(v.voiceURI)}" ${voice.voice && voice.voice.voiceURI === v.voiceURI ? "selected" : ""}>${esc(v.name)}${isNatural(v) ? " (natural)" : ""}</option>`).join("") : `<option>System default</option>`}</select></label>
      <label class="field"><span>Speed</span><select class="input" data-act="rate">${[0.9, 1, 1.1, 1.2].map(r => `<option value="${r}" ${S.voice.rate === r ? "selected" : ""}>${r}×</option>`).join("")}</select></label></div>
    <p class="faint">Free device speech prefers a male voice when your phone or laptop provides one.</p>
    <button class="btn sm" data-act="test-voice"><svg><use href="#i-speaker"/></svg>Test</button>
  </div>
  <h2 class="sec"><span>You</span></h2><div class="card"><div class="grid3">
    <label class="field"><span>PG calls you</span><input class="input" data-act="address" value="${esc(addr())}"></label>
    <label class="field"><span>Day starts</span><input class="input" type="time" data-act="daystart" value="${tm(S.profile.dayStart)}"></label>
    <label class="field"><span>Day ends</span><input class="input" type="time" data-act="dayend" value="${tm(S.profile.dayEnd)}"></label></div>
    <div class="grid2"><label class="field"><span>Gym split</span><select class="input" data-act="split">${Object.entries(SPLITS).map(([k, v]) => `<option value="${k}" ${S.gym.split === k ? "selected" : ""}>${v.label}</option>`).join("")}</select></label>
    <label class="field"><span>Bible version</span><select class="input" data-act="version">${["NKJV", "KJV", "NIV", "ESV", "NLT", "AMP"].map(v => `<option ${B.bible().version === v ? "selected" : ""}>${v}</option>`).join("")}</select></label></div></div>
  <h2 class="sec"><span>Data</span></h2><div class="card"><div class="row">
    <button class="btn sm" data-act="backup">Back up</button><button class="btn sm" data-act="restore">Restore</button><button class="btn sm" data-act="clear-chat">Clear chat</button><button class="btn sm danger" data-act="reset">Erase all</button>
    <input type="file" id="restoreFile" accept="application/json,.json" hidden></div>
    <p class="note">Install: Safari › Share › Add to Home Screen, or Chrome › Install app.</p></div>`;
}

// ================= Edit sheet =================
function openEditor(id) {
  const d = ui.date;
  const b = id ? day(d).blocks.find(x => x.id === id) : null;
  const n = nowMin();
  const start = b ? b.start : (firstGap(day(d).blocks, d === today() ? Math.ceil(n / 15) * 15 : S.profile.dayStart, 60) ?? 540);
  const end = b ? b.end : start + 60;
  const tm = m => pad(Math.floor(m / 60) % 24) + ":" + pad(m % 60);
  const sh = $("#sheet");
  sh.innerHTML = `<form method="dialog" data-form="block" data-id="${b ? b.id : ""}"><h3>${b ? "Edit" : "New"}</h3>
    <label class="field"><span>Title</span><input class="input" name="title" value="${esc(b ? b.title : "")}" required></label>
    <div class="grid3"><label class="field"><span>Start</span><input class="input" type="time" name="start" value="${tm(start)}" required></label>
    <label class="field"><span>End</span><input class="input" type="time" name="end" value="${tm(Math.min(end, 1439))}" required></label>
    <label class="field"><span>Type</span><select class="input" name="cat">${Object.entries(CATS).map(([k, v]) => `<option value="${k}" ${(b ? b.cat : "other") === k ? "selected" : ""}>${v.label}</option>`).join("")}</select></label></div>
    <div class="sheet-actions">${b ? `<button type="button" class="btn danger" data-act="del-block" data-id="${b.id}">Delete</button>` : "<span></span>"}
    <span class="row"><button type="button" class="btn ghost" data-act="close-sheet">Cancel</button><button class="btn primary" value="save">Save</button></span></div></form>`;
  sh.showModal();
  setTimeout(() => sh.querySelector("input[name=title]").focus(), 30);
}

// ================= Events =================
document.addEventListener("click", e => {
  const el = e.target.closest("[data-act],[data-view],[data-say],[data-fill]");
  if (!el) return;
  if (el.dataset.fill != null) { openAssistant(); const a = $("#ask"); a.value = el.dataset.fill; a.focus(); return; }
  if (el.dataset.say != null && !el.dataset.act) { run(el.dataset.say, false); return; }
  if (el.dataset.view && !el.dataset.act) { go(el.dataset.view); return; }
  const a = el.dataset.act, id = el.dataset.id;
  const d = ui.date;
  switch (a) {
    case "day": ui.date = el.dataset.n === "0" ? today() : addDays(ui.date, +el.dataset.n); ui.pinDate = ui.date !== today(); render(); break;
    case "week": ui.date = addDays(ui.date, +el.dataset.n * 7); ui.pinDate = ui.date !== today(); render(); break;
    case "week-day": go("today", el.dataset.date); break;
    case "week-edit": ui.date = el.dataset.date; ui.pinDate = ui.date !== today(); render(); openEditor(id); break;
    case "week-plan": openWeekPlanner(); break;
    case "add": openEditor(null); break;
    case "edit": if (e.target.closest(".check,.tag.link")) return; openEditor(id); break;
    case "toggle": { e.stopPropagation(); const b = day(d).blocks.find(x => x.id === id); if (b) { b.done = !b.done; if (b.done && b.src === "school") SC.noteDone(b); save(); render(); if (b.done) chime("ok"); } break; }
    case "task-done": { const t = SC.tasks().find(x => x.id === id); if (t) { SC.finish(t); ui.pending = { type: "actual", tid: t.id }; ui.lastTask = t.id; render(); openAssistant(); reply(`Nice work. How long did ${t.title} take you in total?`); } break; }
    case "task-del": confirmSheet("Remove this assignment?", "Its study sessions come off your timetable.", "Remove", () => { SC.remove(id); render(); }); break;
    case "replan": { const r = SC.plan(); render(); toast(`${r.placed.length} study sessions planned.`); break; }
    case "go": e.stopPropagation(); go(el.dataset.v); break;
    case "close-sheet": $("#sheet").close(); break;
    case "goals-open": openGoals(); break;
    case "goal-del": D.removeGoal(el.dataset.id); openGoals(); render(); break;
    case "canto-open": openCanto(); break;
    case "canto-play": sayCanto(el.dataset.zh); break;
    case "canto-more": D.teachDaily(); openCanto(); render(); break;
    case "routine-check": {
      const key = `${id}:${ui.date || today()}`;
      S.routineDone ||= {}; S.routineDone[key] = !S.routineDone[key]; save(); render(); break;
    }
    case "cv-test": voice.cloudVoice = S.voice.cloudVoice || "apollo"; voice.player.unlock(); voice.say(hello()); break;
    case "del-block": { const snap = snapshot(d); day(d).blocks = day(d).blocks.filter(x => x.id !== id); save(); $("#sheet").close(); render(); undoable(snap, "Deleted."); break; }
    case "fit": {
      const t = S.inbox.find(x => x.id === id); if (!t) break;
      const n = nowMin(); const from = d === today() ? Math.max(S.profile.dayStart, Math.ceil(n / 15) * 15) : S.profile.dayStart;
      const s = firstGap(day(d).blocks, from, t.dur || 30, 1440);
      if (s == null) { toast("No free slot left that day."); break; }
      day(d).blocks.push({ id: uid(), title: t.title, cat: t.cat, start: s, end: s + (t.dur || 30), flex: true, done: false, date: d, src: "inbox" });
      S.inbox = S.inbox.filter(x => x.id !== id); save(); render(); toast(`${t.title} at ${fmtTime(s)}.`); break;
    }
    case "inbox-del": S.inbox = S.inbox.filter(x => x.id !== id); save(); render(); break;
    case "ex": ui.openEx = ui.openEx === el.dataset.k ? null : el.dataset.k; render(); break;
    case "play": ui.playing.add(el.dataset.vid); render(); break;
    case "set": { const p = gymProgress(); const k = el.dataset.k, i = +el.dataset.i; p.sets[k] = p.sets[k] || []; p.sets[k][i] = !p.sets[k][i]; save(); render(); if (p.sets[k][i]) chime("ok"); break; }
    case "gymday": S.gym.override = el.dataset.k; S.gym.overrideDate = today(); save(); renameCoachBlocks(today()); render(); break;
    case "speak-gym": reply(C.gymBrief(today(), false)); break;
    case "gym-finish": completeCoach("gym"); break;
    case "gymtab": ui.gymTab = el.dataset.k; render(); break;
    case "rec": ui.openRec = ui.openRec === el.dataset.k ? null : el.dataset.k; render(); break;
    case "speak-rec": reply(F.recipeBrief(F.recipe(el.dataset.k))); break;
    case "rec-week": { const k = el.dataset.k; F.toggleWeek(k); F.build(); render(); toast(F.food().week.includes(k) ? "Added to this week's list." : "Removed from this week's list."); break; }
    case "shop-got": F.toggle(id); render(); break;
    case "shop-del": F.removeItem(id); render(); break;
    case "shop-build": F.build(); render(); toast("List rebuilt."); break;
    case "shop-clear": F.clearGot(); render(); break;
    case "bass-done": chime("ok"); completeCoach("bass"); break;
    case "bass-repeat": BS.logTry(); reply(`No problem. We'll stay on ${BS.lesson().t.toLowerCase()} next time.`); break;
    case "speak-bass": reply(BS.brief(minsFor("bass", 30))); break;
    case "bass-jump": BS.jump(+el.dataset.i); renameCoachBlocks(today()); render(); toast(`Lesson ${+el.dataset.i + 1} is up next.`); break;
    case "bible-done": chime("ok"); completeCoach("bible"); break;
    case "note-del": M.remove(id); render(); break;
    case "folder": ui.folder = el.dataset.k; render(); break;
    case "ai-test": connectAI(); break;
    case "cloud-copy": copyCloud(); break;
    case "cloud-sync": SY.push().then(ok => { render(); toast(ok ? "Saved to PG Cloud." : SY.status()); }); break;
    case "cloud-others": if (confirm("Sign out every other device? They'll need the passcode again, and their copy of PG is cleared.")) SY.signOutOthers().then(() => toast("Other devices are signed out."), e => toast(e.message)); break;
    case "cloud-off": SY.disconnect(); if (S.ai.provider === "cloudflare") S.ai.ok = false; save(true); render(); toast("This device stopped syncing."); break;
    case "ai-clear": S.ai = { provider: "none", key: "", model: "", ok: false }; ui.aiStatus = null; save(); render(); toast("Key removed from this device."); break;
    case "about-folder": ui.folder = "about"; ui.q = ""; go("notes"); break;
    case "learn-done": { const tr = LN.tracks().find(t => t.id === id); const r = LN.complete(tr); render(); if (r) { chime("ok"); toast(r.next ? `Next: ${r.next.t}` : `${tr.topic} complete.`); } break; }
    case "learn-del": confirmSheet("Remove this learning plan?", "", "Remove", () => { LN.remove(id); render(); }); break;
    case "song-del": S.band.songs = S.band.songs.filter(s => s.id !== id); save(); render(); break;
    case "test-voice": voice.player.unlock(); voice.say(hello()); break;
    case "backup": {
      const a2 = document.createElement("a");
      a2.href = URL.createObjectURL(new Blob([JSON.stringify({ ...S, ai: { provider: "none", key: "", model: "" } }, null, 1)], { type: "application/json" }));
      a2.download = `pg-backup-${today()}.json`; document.body.appendChild(a2); a2.click(); a2.remove(); toast("Backup downloaded."); break;
    }
    case "restore": $("#restoreFile").click(); break;
    case "clear-chat": S.chat = []; save(); paintChat(); toast("Chat cleared."); break;
    case "reset": confirmSheet("Erase everything?", "This removes your schedule, progress, notes and settings from this device.", "Erase", () => { reset(); load(); paintChat(); render(); toast("Everything erased."); }); break;
  }
});
document.addEventListener("keydown", e => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches(".blk[data-act=edit]")) { e.preventDefault(); openEditor(e.target.dataset.id); }
});
document.addEventListener("change", e => {
  const el = e.target, a = el.dataset.act;
  if (!a) { if (el.id === "restoreFile") restoreFrom(el.files[0]); return; }
  const v = el.value;
  switch (a) {
    case "handsfree": S.voice.handsFree = el.checked; save(); voice.enableHandsFree(el.checked); if (el.checked) toast("Say “Hi PG” any time."); break;
    case "speak": S.voice.speak = el.checked; save(); break;
    case "alerts": S.voice.alerts = el.checked; save(); if (el.checked && "Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {}); break;
    case "heads": S.voice.heads = +v; save(); break;
    case "awake": S.voice.keepAwake = el.checked; save(); keepAwake(); break;
    case "cvoice": S.voice.cloudVoice = v; voice.cloudVoice = v; save(); voice.player.unlock(); voice.say(`Hi ${addr()}. This is how I sound now.`); break;
    case "natural": S.voice.natural = el.checked; save(); render(); break;
    case "voice": S.voice.voiceURI = v; voice.voiceURI = v; voice.pickVoice(); save(); break;
    case "rate": S.voice.rate = +v; voice.rate = +v; save(); break;
    case "address": S.profile.address = v.trim() || "sir"; save(); break;
    case "daystart": { const [h, m] = v.split(":").map(Number); S.profile.dayStart = h * 60 + m; save(); break; }
    case "dayend": { const [h, m] = v.split(":").map(Number); S.profile.dayEnd = h * 60 + m; save(); break; }
    case "split": S.gym.split = v; S.gym.splitChosen = true; S.gym.idx = 0; S.gym.override = null; save(); renameCoachBlocks(today()); break;
    case "version": B.bible().version = v; save(); break;
    case "ai-provider": S.ai.provider = v; save(); render(); break;
    case "ai-key": S.ai.key = v.trim(); save(); break;
    case "ai-model": S.ai.model = v.trim(); save(); break;
    case "song-p": { const s = S.band.songs.find(x => x.id === el.dataset.id); if (s) { s.progress = +v; s.last = today(); save(); render(); } break; }
    case "w": C.setWeight(el.dataset.k, v, ""); break;
  }
});
let qT;
document.addEventListener("input", e => {
  const el = e.target;
  if (el.dataset.act === "song-p") { const row = el.closest(".song"); const st = stageOf(+el.value); const lab = row.querySelector(".song-stage"); lab.className = "song-stage " + st.tone; lab.innerHTML = `<span class="tnum">${el.value}%</span> · ${st.label}`; }
  if (el.dataset.act === "ai-key-live") { const pv = AI.detect(el.value), sel = el.form?.provider; if (sel && !sel.dataset.touched) { sel.value = pv || ""; showBase(el.form); } }
  if (el.dataset.act === "ai-prov") { el.dataset.touched = 1; showBase(el.form); }
  if (el.name === "provider" && el.form?.dataset.form === "ai") el.dataset.touched = "1";
  if (el.dataset.act === "note-q") { clearTimeout(qT); qT = setTimeout(() => { ui.q = el.value; render(); const s = $(".search"); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }, 250); }
});
document.addEventListener("submit", e => {
  const f = e.target;
  if (f.dataset.form === "week-plan") {
    e.preventDefault();
    try {
      const values = new FormData(f), week = values.get("week");
      const days = values.getAll("days").map(i => addDays(week, +i));
      const tasks = String(values.get("tasks")).split("\n").filter(s => s.trim()).map(line => {
        const match = line.trim().match(/^(.+),\s*(\d+)\s*$/);
        if (!match) throw new Error("Use one task per line with minutes, for example: History revision, 90");
        const title = match[1].trim(), old = S.weekPlans?.[week]?.tasks.find(t => t.title === title);
        const cat = old?.cat || (/\bbass\b/i.test(title) ? "bass" : /\b(?:gym|workout)\b/i.test(title) ? "gym" : /\b(?:bible|prayer)\b/i.test(title) ? "bible" : /\b(?:rest|break)\b/i.test(title) ? "rest" : "study");
        return { title, minutes: +match[2], days, cat };
      });
      const result = planWeek({ weekStart: week, start: values.get("from"), end: values.get("until"),
        focusMinutes: +values.get("focus"), breakMinutes: +values.get("rest"), tasks });
      $("#sheet").close(); go("today", days.find(d => d >= today()) || week);
      reply(planSummary(result)); return;
    } catch (error) { f.querySelector("[data-week-error]").textContent = error.message; return; }
  }
  if (f.id === "composer") { e.preventDefault(); const t = $("#ask").value; $("#ask").value = ""; voice.kill(); run(t, "typed"); return; }
  if (f.dataset.form === "unlock" || f.dataset.form === "cloud") {
    e.preventDefault();
    const code = f.code.value, url = f.url ? f.url.value : PG_CLOUD, btn = f.querySelector("button[type=submit]");
    if (!code.trim()) { f.code.focus(); return; }
    btn.disabled = true; btn.textContent = "Checking…";
    connectCloud(url, code, err => {
      if (!err) return;
      btn.disabled = false; btn.textContent = f.dataset.form === "unlock" ? "Unlock" : "Connect";
      if (f.dataset.form === "unlock") { f.querySelector(".lock-err").textContent = err.message; f.code.value = ""; f.code.focus(); }
      else { ui.cloudStatus = { err: true, text: err.message }; render(); }
    });
    return;
  }
  if (f.dataset.form === "ai") {
    e.preventDefault();
    const key = f.key.value.trim();
    if (f.provider.value === "cloudflare") {
      S.ai = { ...S.ai, provider: "cloudflare", model: f.model.value.trim(), ok: false }; save();
      if (!SY.on()) { ui.aiStatus = { err: true, text: "Connect PG Cloud above first." }; render(); return; }
      connectAI(); return;
    }
    if (!key) { toast("Paste your API key first."); return; }
    const prov = f.provider.value || AI.detect(key) || "auto";
    const base = f.base.value.trim();
    if (prov === "custom" && !/^https:\/\//.test(base)) { ui.aiStatus = { err: true, text: "Paste the AI's web address. It starts with https:// and usually ends in /v1." }; render(); return; }
    S.ai = { provider: prov, key, model: f.model.value.trim(), base, ok: false }; save();
    connectAI(); return;
  }
  if (f.dataset.form === "goal") { e.preventDefault(); const t = f.g.value.trim(); if (t) { D.addGoal(t); openGoals(); render(); } return; }
  if (f.dataset.form === "song") { e.preventDefault(); const n = f.song.value.trim(); if (n) { C.addSong(n); render(); } return; }
  if (f.dataset.form === "note") { e.preventDefault(); const t = f.t.value.trim(); if (t) { const n = M.add(t); ui.folder = "all"; ui.q = ""; render(); toast(`Saved to ${M.FOLDERS[n.folder].label}.`); } return; }
  if (f.dataset.form === "task") { e.preventDefault(); const t = f.t.value.trim(); if (!t) return; const list = SC.parse(/\b(?:essay|report|test|exam|quiz|project|presentation|homework|assignment|paper|lab|reading|worksheet)\b/i.test(t) ? t : t + " assignment"); if (!list.length) { toast("Try: History essay due Friday 5pm."); return; } const added = SC.add(list); const r = SC.plan(); render(); toast(added.some(x => !x.due) ? "Added. When is it due? Tell PG." : `${r.placed.length} study sessions planned.`); return; }
  if (f.dataset.form === "kg") { e.preventDefault(); const kg = +f.kg.value; if (kg > 0) { const t = F.setWeight(kg); render(); toast(`Target: ${t} g of protein a day.`); } return; }
  if (f.dataset.form === "shop") { e.preventDefault(); const t = f.t.value.trim(); if (t) { F.add(t); render(); $("[data-form=shop] input")?.focus(); } return; }
  if (f.dataset.form === "bible-plan") { e.preventDefault(); B.setPlan(+f.book.value, +f.max.value); renameCoachBlocks(today()); render(); toast(`Reading ${B.stats().book}.`); return; }
  if (f.dataset.form === "bible-upto") {
    e.preventDefault(); const ch = +f.ch.value, v = +f.v.value; if (!ch) return;
    B.record(v ? { kind: "to", ch, v } : { kind: "toCh", ch });
    if (B.todays().doneToday) markCat("bible");
    render(); toast(`Saved. ${B.stats().pct}% through ${B.stats().book}.`); return;
  }
  if (f.dataset.form === "block") {
    e.preventDefault();
    const d = ui.date, fd = new FormData(f);
    const toM = s => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
    let s = toM(fd.get("start")), en = toM(fd.get("end")); if (en <= s) en = Math.min(1440, s + 30);
    const data = { title: String(fd.get("title")).trim() || "Untitled", cat: fd.get("cat"), start: s, end: en };
    if (f.dataset.id) Object.assign(day(d).blocks.find(x => x.id === f.dataset.id), data, { flex: false });
    else day(d).blocks.push({ id: uid(), ...data, flex: false, done: false, date: d, src: "manual" });
    save(); $("#sheet").close(); render(); toast(f.dataset.id ? "Saved." : "Added.");
  }
});
$("#orb").addEventListener("click", () => orbTap());
$("#dockOrb").addEventListener("click", () => { openAssistant(); orbTap(); });
$("#asClose").addEventListener("click", closeAssistant);
$("#endCall").addEventListener("click", () => { voice.hush(); voice.hangUp(); toast("Call ended."); });
$("#scrim").addEventListener("click", closeAssistant);
function orbTap() {
  voice.player.unlock();
  if (!voice.supported) { openAssistant(); $("#ask").focus(); toast("Voice isn't available in this browser. Type to PG instead."); return; }
  // Press to talk: PG greets you, then listens. Nothing listens in the background.
  if (voice.mode === "off" || voice.mode === "wake") {
    voice.call = true; openAssistant(false);
    const g = hello(); pushMsg("pg", g);
    if (S.voice.speak !== false) voice.say(g, () => voice.listen("command")); else voice.listen("command");
    return;
  }
  voice.tap();
}

function confirmSheet(title, body, cta, fn) {
  const sh = $("#sheet");
  sh.innerHTML = `<h3>${esc(title)}</h3>${body ? `<p class="note" style="margin:0">${esc(body)}</p>` : ""}<div class="sheet-actions"><span></span><span class="row"><button class="btn ghost" data-act="close-sheet">Cancel</button><button class="btn danger" id="cfm">${esc(cta)}</button></span></div>`;
  sh.showModal();
  $("#cfm").onclick = () => { sh.close(); fn(); };
}
function restoreFrom(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => { try { const o = JSON.parse(r.result); if (!o.days && Array.isArray(o.tasks)) { confirmSheet("Import PG Planner tasks?", "Open tasks from the old app will be added.", "Import", () => { importV1(o); render(); toast("Imported."); }); return; } if (!o.days) throw 0; confirmSheet("Restore this backup?", "It replaces everything on this device.", "Restore", () => { replace(o); load(); C.syncCustom(); paintChat(); render(); toast("Restored."); }); } catch { toast("That file isn't a PG backup."); } };
  r.readAsText(file);
}

let toastT;
function toast(msg, action, fn) {
  const t = $("#toast");
  t.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button class="btn sm">${esc(action)}</button>` : "");
  t.hidden = false;
  if (action) t.querySelector("button").onclick = () => { t.hidden = true; fn(); };
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, action ? 7000 : 3500);
}

// ================= Reminders & wake lock =================
const alerted = new Set();
let lastCalendarDay = today();
function tick() {
  const n = nowMin(), d = today();
  if (lastCalendarDay !== d) {
    if (ui.date === lastCalendarDay && !ui.pinDate) ui.date = d;
    lastCalendarDay = d;
  }
  const syncStatus = $("[data-sync-status]");
  if (syncStatus) syncStatus.textContent = SY.status() + " · last synced " + ago(SY.last());
  if (ui.view === "today" && ui.date === d && !$("#sheet").open && !document.activeElement?.matches("input,select,textarea")) {
    const y = window.scrollY, m = $("#main").scrollTop;
    render(); window.scrollTo(0, y); $("#main").scrollTop = m;
  }
  if (!S.voice.alerts) return;
  for (const b of live(d)) {
    const kH = b.id + ":h", kS = b.id + ":s";
    if (voice.mode === "command" || voice.mode === "speaking") continue;
    if (S.voice.heads && n >= b.start - S.voice.heads && n < b.start && !alerted.has(kH)) { alerted.add(kH); notify(`${b.title} starts in ${sayDur(b.start - n)}, ${addr()}.`); }
    if (n >= b.start && n < b.start + 3 && !alerted.has(kS)) {
      alerted.add(kS);
      let msg = `It's time for ${b.title}, until ${sayTime(b.end)}.`;
      if (b.cat === "gym") msg += " " + C.gymBrief(d, true);
      if (b.cat === "bass") { ui.topic = "bass"; msg += " " + BS.brief(b.end - b.start); }
      if (b.cat === "bible") { ui.topic = "bible"; msg += " " + B.brief(); }
      if (b.cat === "learn") { ui.topic = "learn"; const tr = LN.findTrack(b.title.replace(/^learn\s+/i, "")); if (tr) msg += " " + LN.brief(tr); }
      notify(msg);
    }
  }
}
function notify(msg) {
  chime("ok");
  pushMsg("pg", msg);
  if (S.voice.speak !== false) voice.say(speakable(msg));
  if (document.hidden && "Notification" in window && Notification.permission === "granted") { try { new Notification("PG", { body: msg, icon: "icon-192.png" }); } catch {} }
}
let lock = null;
async function keepAwake() {
  const want = S.voice.keepAwake && S.voice.handsFree && !document.hidden;
  try {
    if (want && !lock && navigator.wakeLock) { lock = await navigator.wakeLock.request("screen"); lock.addEventListener("release", () => { lock = null; }); }
    if (!want && lock) { await lock.release(); lock = null; }
  } catch { lock = null; }
}
document.addEventListener("visibilitychange", () => { keepAwake(); if (!document.hidden && S.voice.handsFree && voice.mode === "off") voice.listen("wake"); });

// ================= Boot =================
renameCoachBlocks(today());
paintChat(); render(); paintVoice("off"); paintLock(); SY.pull();
setInterval(tick, 20000);
// Always listening for "Hi PG". Some browsers (like iPhone Safari) need one tap first.
function needTap() {
  if (ui.tapWait) return; ui.tapWait = true;
  navigator.permissions?.query({ name: "microphone" }).then(p => { if (p.state === "denied") toast("Microphone is blocked. Allow it for this site in your browser settings so PG can hear Hi PG."); }).catch(() => {});
  toast("Tap anywhere so PG can start listening for Hi PG.");
  const go = () => { ui.tapWait = false; document.removeEventListener("pointerdown", go, true); if (S.voice.handsFree && voice.mode === "off") { voice.handsFree = true; voice.listen("wake"); } };
  document.addEventListener("pointerdown", go, true);
}
if (S.voice.handsFree && voice.supported) { voice.handsFree = true; voice.listen("wake"); }
if ("serviceWorker" in navigator && location.protocol === "https:") {
  // When a new version arrives, reload once so he's never stuck on an old copy (but never mid-call).
  const had = !!navigator.serviceWorker.controller; let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (!had || reloaded) return; const go = () => { if (voice.mode === "off" && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "")) { reloaded = true; location.reload(); } else setTimeout(go, 3000); }; go(); });
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(r => r.update()).catch(() => {});
}
window.PG = { run, S, voice, probeCloud };

function andWords(a) { return a.length < 2 ? (a[0] || "") : a.slice(0, -1).join(", ") + " and your " + a.at(-1); }
