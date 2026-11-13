// PG — app controller: views, command handling, reminders.
import { S, load, save, day, sortedBlocks, reset, replace, hydrate, importV1 } from "./store.js";
import { CATS, EXERCISES, SPLITS, DEFAULT_MIN, GYM_WARMUP, stageOf } from "./library.js";
import { intent, parseSchedule, matchBlock, parseClock } from "./nlu.js";
import { placeItems, conflicts, firstGap } from "./scheduler.js";
import { Voice, chime } from "./voice.js";
import * as C from "./coach.js";
import * as BS from "./bass.js";
import * as B from "./bible.js";
import * as M from "./brain.js";
import * as LN from "./learn.js";
import * as F from "./food.js";
import { today, addDays, nowMin, uid, esc, fmtTime, sayTime, fmtDur, sayDur, fmtDay, pad } from "./util.js";

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const ui = { view: "today", date: today(), openEx: null, playing: new Set(), autoClose: false, topic: null, folder: "all", q: "", gymTab: "workout", openRec: null, openTip: null };

await hydrate();
load();
BS.bass(); B.bible(); M.notes(); LN.tracks();
const addr = () => S.profile.address || "sir";
const hello = () => `Hi, ${addr()}, what can I do for you today?`;

// ================= Voice wiring =================
const voice = new Voice({
  onState: m => paintVoice(m),
  onHeard: t => { $("#heard").textContent = t ? "“" + t + "”" : ""; },
  onWake: () => { openAssistant(true); $("#heard").textContent = ""; },
  onGreet: () => { const g = hello(); pushMsg("pg", g); voice.say(g, () => voice.listen("command")); },
  onIdle: () => { voice.stop(); voice.afterReply(); setStatus("Say “Hi PG”"); },
  onCommand: text => { $("#heard").textContent = ""; run(text, true); },
  onError: code => {
    const msg = { unsupported: "Voice isn't supported in this browser. Use Chrome, Edge or Safari, or type.", blocked: "Microphone is blocked. Allow it in your browser settings.", network: "Speech service unreachable. Check your connection.", nomic: "No microphone found." }[code];
    if (msg) toast(msg);
    if (code === "blocked" || code === "nomic") { S.voice.handsFree = false; save(); if (ui.view === "settings") render(); }
  }
});
voice.voiceURI = S.voice.voiceURI; voice.rate = S.voice.rate; voice.pickVoice();

function paintVoice(m) {
  $("#orb").dataset.state = m; $("#dockOrb").dataset.state = m;
  setStatus({ off: voice.supported ? "Tap to talk" : "Type to PG", wake: "Say “Hi PG”", command: "Listening…", thinking: "Thinking…", speaking: "Speaking…" }[m]);
  $("#listenPill").textContent = m === "wake" ? "Listening for “Hi PG”" : m === "command" ? "Listening…" : "";
  if (m === "command" || m === "speaking" || m === "thinking") openAssistant(false);
  if ((m === "wake" || m === "off") && ui.autoClose) { ui.autoClose = false; setTimeout(() => { if (voice.mode === "wake" || voice.mode === "off") closeAssistant(); }, 1800); }
  keepAwake();
}
function setStatus(t) { $("#orbStatus").textContent = t; }

// ================= Assistant panel =================
const isMobile = () => matchMedia("(max-width: 960px)").matches;
function openAssistant() { if (!isMobile()) return; $("#assistant").classList.add("open"); $("#scrim").hidden = false; }
function closeAssistant() { $("#assistant").classList.remove("open"); $("#scrim").hidden = true; }
function pushMsg(who, text, html) {
  S.chat.push({ who, text, html: html || "", t: Date.now() });
  S.chat = S.chat.slice(-60); save();
  paintChat();
}
function paintChat() {
  const el = $("#chat");
  el.innerHTML = S.chat.length ? S.chat.slice(-30).map(m => `<div class="msg ${m.who}">${m.html || esc(m.text)}</div>`).join("") : "";
  el.scrollTop = el.scrollHeight;
}
const SUGGEST = {
  today: ["What's next?", "Read my schedule", "Today's Bible reading"],
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
const speakable = t => t.replace(/\s*\([^)]*[\u3400-\u9fff][^)]*\)/g, "").replace(/[\u3400-\u9fff]+/g, "").replace(/(\d)–(\d)/g, "$1 to $2").replace(/°C/g, " degrees").replace(/“|”/g, "");
function reply(text, opts = {}) {
  pushMsg("pg", text, opts.html);
  if (opts.view) { go(opts.view, opts.date); if (opts.spoken) ui.autoClose = isMobile(); }
  if (S.voice.speak !== false) voice.say(speakable(text), opts.then);
  else voice.afterReply();
}

// ================= Command handling =================
async function run(text, spoken = false) {
  text = String(text || "").trim();
  if (!text) { voice.afterReply(); return; }
  pushMsg("me", text);
  try { await handle(text, spoken); }
  catch (e) { console.error(e); reply("Sorry, something went wrong. Please try that again."); }
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

async function handle(text, spoken) {
  const it = intent(text);
  const d = ui.view === "today" ? ui.date : today();
  switch (it.type) {
    case "greet": {
      const g = hello(); pushMsg("pg", g);
      if (S.voice.speak !== false) voice.say(g, () => voice.supported && spoken !== "typed" ? voice.listen("command") : voice.afterReply());
      return;
    }
    case "dismiss": return reply("Okay.");
    case "thanks": return reply(`Anytime, ${addr()}.`);
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
      if (it.type === "done") { b.done = true; msg = `Nice work. ${b.title} is done.`; const nx = upcoming(d).find(x => x.id !== b.id); if (nx) msg += ` Next is ${nx.title} at ${sayTime(nx.start)}.`; }
      save(); render(); undoable(snap, msg.split(".")[0] + ".");
      return reply(msg, { view: "today", date: d, spoken });
    }
    // ---- Memory ----
    case "note": {
      const inBible = context() === "bible" || ui.view === "bible";
      const n = M.add(it.text, { folder: it.folder || (inBible ? "spiritual" : null), ctx: inBible && B.bible().plan ? bibleRef() || B.stats()?.book : "" });
      if (ui.view === "notes" || ui.view === "bible") render();
      return reply(`Saved to ${M.FOLDERS[n.folder].label}${n.refs.length ? `, linked to ${n.refs[0]}` : ""}.`);
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
      const steps = S.ai.provider !== "none" && S.ai.key ? await aiLearn(it.topic).catch(() => null) : null;
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
    case "food_info": ui.gymTab = "food"; return reply(F.brief(today(), gymToday()), { view: "gym", spoken });
    case "food_tip": { const t = F.tip(it.k); ui.gymTab = "food"; ui.openTip = it.k; return reply(t.d(), { view: "gym", spoken }); }
    case "weight": { const t = F.setWeight(it.kg); ui.gymTab = "food"; return reply(`Got it. Your target is about ${t} grams of protein a day.`, { view: "gym", spoken }); }
    case "recipe": {
      let r = F.findRecipe(it.q);
      if (!r) { const ms = F.todayMeals(today(), gymToday()); const w = /breakfast/.test(it.q) ? "Breakfast" : /lunch/.test(it.q) ? "Lunch" : /after|post/.test(it.q) ? "After the gym" : "Dinner"; r = (ms.find(m => m.when === w) || ms.at(-1)).r; }
      ui.gymTab = "food"; ui.openRec = r.k;
      return reply(F.recipeBrief(r), { view: "gym", spoken });
    }
    case "shop_make": { const ls = F.build(); ui.gymTab = "list"; const g = F.byStore(ls); return reply(`Your shopping list is ready, ${ls.length} items for the week. ${g.map(x => `${x.rows.length} ${{ wet: "from the wet market", super: "from Wellcome or PARKnSHOP", online: "online from HKTVmall or pandamart", other: "other" }[x.s]}`).join(", ")}.`, { view: "gym", spoken }); }
    case "shop_show": ui.gymTab = "list"; return reply(F.listBrief(), { view: "gym", spoken });
    case "shop_add": { const items = it.item.split(/\s*(?:,|\band\b)\s*/).filter(Boolean); const rows = items.map(x => F.add(x)); ui.gymTab = "list"; return reply(`Added ${rows.map(r => r.n.toLowerCase().replace(/ \(.+\)/, "")).join(", ")}.`, { view: "gym", spoken }); }
    case "shop_where": { const w = F.whereBrief(it.item); if (w) return reply(w); break; }
    case "band_info": return reply(C.bandBrief(minsFor("band", 60)), { view: "bass", spoken });
    case "song_add": { const s = C.addSong(it.name); return reply(`Added ${s.name} to your songs.`, { view: "bass", spoken }); }
    case "howto": {
      ui.openEx = it.ex; ui.playing.add(EXERCISES[it.ex].video.id);
      return reply(C.exerciseBrief(it.ex), { view: "gym", spoken });
    }
    case "review": return reply(reviewText(), { view: "today", date: today(), spoken });
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
  if (S.ai.provider !== "none" && S.ai.key && (open || found.length)) {
    setStatus("Thinking…");
    const ans = await aiChat(q, found.length ? found : M.search(q, 6)).catch(() => null);
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
  const ctx = { date: ui.view === "today" ? ui.date : today(), today: today(), now: nowMin() };
  let items = parseSchedule(text, ctx);
  let events = items.filter(i => i.kind === "event");
  if (!events.length && S.ai.provider !== "none" && S.ai.key) {
    setStatus("Thinking…");
    const ai = await aiExtract(text, ctx).catch(() => null);
    if (ai && ai.length) { items = ai; events = ai; }
    else { const ans = await aiChat(text, M.search(text, 4)).catch(() => null); if (ans) return reply(ans); }
  }
  if (!events.length) {
    const a = M.answer(text, M.search(text, 2));
    if (a) return reply(a);
    return reply(`Sorry, ${addr()}, I didn't catch that. Try: bass lesson at 6:30, or what's next?`);
  }
  const dates = [...new Set(events.map(e => e.date))];
  const snaps = dates.map(snapshot);
  const res = placeItems(items, day, { today: today(), now: nowMin(), dayStart: S.profile.dayStart, dayEnd: S.profile.dayEnd });
  dates.forEach(renameCoachBlocks);
  res.unplaced.forEach(u => S.inbox.push({ id: uid(), title: u.title, cat: u.cat, dur: u.dur, date: u.date }));
  // "Learn X" blocks get a learning plan
  for (const b of [...res.added]) if (b.cat === "learn") { const topic = b.title.replace(/^learn\s+/i, ""); if (!LN.findTrack(topic)) LN.create(topic); }
  save();
  const all = [...res.added, ...res.updated].sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  const d0 = dates[0];
  const parts = [];
  if (all.length) parts.push((all.length > 1 ? `Done, ${addr()}. ` : "Done. ") + all.slice(0, 8).map(say).join(". ") + ".");
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
async function callAI(system, user, json) {
  const { provider, key } = S.ai; const model = S.ai.model;
  if (provider === "gemini") {
    const m = model || "gemini-2.5-flash";
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: system + "\n\n" + user }] }], generationConfig: json ? { responseMimeType: "application/json", temperature: 0.1 } : { temperature: 0.5 } }) });
    if (!r.ok) throw new Error(await r.text());
    return (await r.json()).candidates?.[0]?.content?.parts?.[0]?.text || "";
  }
  if (provider === "openai") {
    const r = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key }, body: JSON.stringify({ model: model || "gpt-4o-mini", messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: json ? 0.1 : 0.5, ...(json ? { response_format: { type: "json_object" } } : {}) }) });
    if (!r.ok) throw new Error(await r.text());
    return (await r.json()).choices?.[0]?.message?.content || "";
  }
  return "";
}
async function aiExtract(text, ctx) {
  const sys = `Extract schedule items from speech. Today is ${ctx.today}. Fix speech-to-text errors (e.g. "solid work" = SolidWorks, "based lessons" = bass lessons, wrong AM/PM). Return JSON {"items":[{"title":"","category":"class|study|work|commute|gym|bass|bible|church|learn|band|meal|meeting|social|rest|other","date":"YYYY-MM-DD","start":"HH:MM or null","end":"HH:MM or null","minutes":number or null}]} in the order spoken. Return {"items":[]} if none.`;
  const raw = await callAI(sys, text, true);
  const o = JSON.parse(raw.replace(/^```json\s*|```$/g, ""));
  const toM = s => { if (!s) return null; const [h, m] = s.split(":").map(Number); return h * 60 + m; };
  return (o.items || []).map(x => { const s = toM(x.start), e = toM(x.end); const cat = CATS[x.category] ? x.category : "other"; return { kind: "event", title: x.title || "Task", cat, date: x.date || ctx.date, s, e, dur: x.minutes || (s != null && e != null ? e - s : DEFAULT_MIN[cat]) }; });
}
async function aiChat(text, notes = []) {
  const mem = notes.length ? `\nThings the user taught you (use these first, mention the date):\n${notes.map(n => `- ${n.date}${n.refs.length ? " (" + n.refs.join(", ") + ")" : ""}: ${n.text}`).join("\n")}` : "";
  const sys = `You are PG, a warm, concise personal assistant. The user is a Christian student who plays bass. Address him as "${addr()}". Answer in 1–3 short spoken sentences. If his own notes apply, remind him of them and say how to apply them.${mem}`;
  return (await callAI(sys, text, false)).trim();
}
async function aiLearn(topic) {
  const raw = await callAI(`Make a beginner-to-advanced learning plan. Return JSON {"steps":[{"t":"short step title","d":"one sentence","q":"a YouTube search query for this step"}]} with 6 to 8 steps.`, topic, true);
  const o = JSON.parse(raw.replace(/^```json\s*|```$/g, ""));
  return (o.steps || []).filter(s => s.t).slice(0, 8);
}

// ================= Views =================
function go(view, date) { ui.view = view; if (date) ui.date = date; render(); $("#main").scrollTo?.(0, 0); if (isMobile()) window.scrollTo(0, 0); }
const TITLES = { today: "Today", bass: "Bass", bible: "Bible", gym: "Gym", notes: "Notes", settings: "Settings" };
function render() {
  if (!TITLES[ui.view]) ui.view = "today";
  $$("[data-view]").forEach(b => b.classList.toggle("on", b.dataset.view === ui.view));
  $("#view").innerHTML = { today: viewToday, bass: viewBass, bible: viewBible, gym: viewGym, notes: viewNotes, settings: viewSettings }[ui.view]();
  document.title = TITLES[ui.view] + " · PG";
  paintSuggest();
}
function greeting() { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; }
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
  if (cur) {
    const pct = Math.round((n - cur.start) / (cur.end - cur.start) * 100);
    h += `<section class="now" aria-label="Happening now"><div class="eyebrow">Now · until ${fmtTime(cur.end)}</div><div class="now-title">${esc(cur.title)}</div>${bar(pct)}
      <div class="now-next"><span>${nx ? `Next · ${esc(nx.title)} at ${fmtTime(nx.start)}` : "Last one today"}</span>${coachLink(cur)}</div></section>`;
  } else if (nx) {
    h += `<section class="now" aria-label="Up next"><div class="eyebrow">Next · in ${fmtDur(nx.start - n)}</div><div class="now-title">${esc(nx.title)}</div>
      <div class="now-next"><span>${fmtTime(nx.start)} – ${fmtTime(nx.end)}</span>${coachLink(nx)}</div></section>`;
  }
  if (!bl.length) {
    h += `<div class="empty"><p>${isT ? "Your day is open." : "Nothing planned."}</p><button class="btn" data-act="add"><svg><use href="#i-plus"/></svg>Add</button></div>`;
  } else {
    h += `<h2 class="sec"><span>Schedule</span><button class="btn sm ghost" data-act="add" aria-label="Add a block"><svg><use href="#i-plus"/></svg>Add</button></h2><div class="timeline">`;
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
  if (S.inbox.length) {
    h += `<h2 class="sec"><span>To-do</span></h2><div class="card">${S.inbox.map(t => `<div class="set-row"><div><div class="lbl">${esc(t.title)}</div><div class="sub">${fmtDur(t.dur || 30)}</div></div>
      <div class="row"><button class="btn sm" data-act="fit" data-id="${t.id}">Fit in</button><button class="btn sm ghost" data-act="inbox-del" data-id="${t.id}">Remove</button></div></div>`).join("")}</div>`;
  }
  return h;
}
const nowLine = n => `<div class="now-line" aria-hidden="true"><span>${fmtTime(n)}</span><i></i></div>`;
function coachLink(b) {
  const v = { gym: ["gym", "Workout"], bass: ["bass", "Lesson"], band: ["bass", "Songs"], bible: ["bible", "Reading"], learn: ["notes", "Plan"] }[b.cat];
  return v ? `<button class="tag link" data-act="go" data-v="${v[0]}">${v[1]}</button>` : "";
}

function videoHTML(v, title) {
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
    <div class="split-chips" role="group" aria-label="Choose workout">${sp.days.map(x => `<button class="chip ${x === w ? "on" : ""}" data-act="gymday" data-k="${x.key}">${esc(x.name)}</button>`).join("")}</div>
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
      ${open ? `<div class="ex-body"><div>${videoHTML(e.video, e.name)}</div><div>
        <ol class="cues">${e.cues.map(c => `<li>${esc(c)}</li>`).join("")}</ol>
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

const noteCard = n => `<article class="note-card" style="--c:${M.FOLDERS[n.folder].color}"><p>${esc(n.text)}</p><div class="nmeta"><span>${esc(M.fmtDate(n.date))}</span><span class="tag cat">${esc(M.FOLDERS[n.folder].label)}</span>${n.refs.slice(0, 2).map(r => `<span class="tag">${esc(r)}</span>`).join("")}<button class="x" data-act="note-del" data-id="${n.id}" aria-label="Delete note"><svg><use href="#i-x"/></svg></button></div></article>`;
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
  h += `<h2 class="sec"><span>Folders</span></h2><div class="split-chips">${[["all", "All", all.length], ...Object.entries(M.FOLDERS).map(([k, v]) => [k, v.label, c[k] || 0])].map(([k, l, n]) => `<button class="chip ${ui.folder === k ? "on" : ""}" data-act="folder" data-k="${k}">${esc(l)} <span class="faint">${n}</span></button>`).join("")}</div>
    <input class="input search" data-act="note-q" type="search" placeholder="Search" value="${esc(ui.q)}" aria-label="Search notes">`;
  h += list.length ? list.map(noteCard).join("") : `<p class="note">${all.length ? "Nothing here." : "Nothing saved yet."}</p>`;
  return h;
}

function viewSettings() {
  const vs = voice.voices();
  const tm = m => pad(Math.floor(m / 60)) + ":" + pad(m % 60);
  const sw = (act, on, label, dis) => `<label class="switch"><input type="checkbox" data-act="${act}" ${on ? "checked" : ""} ${dis ? "disabled" : ""} aria-label="${label}"><i></i></label>`;
  return `<h1 class="title">Settings</h1>
  <h2 class="sec"><span>Voice</span></h2><div class="card">
    <div class="set-row"><div class="lbl">Hands-free “Hi PG”${voice.supported ? "" : ` <span class="faint">· not supported here</span>`}</div>${sw("handsfree", S.voice.handsFree, "Hands-free wake word", !voice.supported)}</div>
    <div class="set-row"><div class="lbl">Speak replies</div>${sw("speak", S.voice.speak !== false, "Speak replies")}</div>
    <div class="set-row"><div class="lbl">Spoken reminders</div>${sw("alerts", S.voice.alerts, "Spoken reminders")}</div>
    <div class="set-row"><div class="lbl">Heads-up</div><select class="input" style="width:auto" data-act="heads" aria-label="Heads-up minutes">${[0, 5, 10, 15].map(m => `<option value="${m}" ${S.voice.heads === m ? "selected" : ""}>${m ? m + " min before" : "Off"}</option>`).join("")}</select></div>
    <div class="set-row"><div class="lbl">Keep screen awake</div>${sw("awake", S.voice.keepAwake, "Keep screen awake")}</div>
    <div class="grid2" style="margin-top:var(--space-3)">
      <label class="field"><span>Voice</span><select class="input" data-act="voice">${vs.length ? vs.map(v => `<option value="${esc(v.voiceURI)}" ${voice.voice && voice.voice.voiceURI === v.voiceURI ? "selected" : ""}>${esc(v.name)}</option>`).join("") : `<option>System default</option>`}</select></label>
      <label class="field"><span>Speed</span><select class="input" data-act="rate">${[0.9, 1, 1.1, 1.2].map(r => `<option value="${r}" ${S.voice.rate === r ? "selected" : ""}>${r}×</option>`).join("")}</select></label></div>
    <button class="btn sm" data-act="test-voice"><svg><use href="#i-speaker"/></svg>Test</button>
  </div>
  <h2 class="sec"><span>You</span></h2><div class="card"><div class="grid3">
    <label class="field"><span>PG calls you</span><input class="input" data-act="address" value="${esc(addr())}"></label>
    <label class="field"><span>Day starts</span><input class="input" type="time" data-act="daystart" value="${tm(S.profile.dayStart)}"></label>
    <label class="field"><span>Day ends</span><input class="input" type="time" data-act="dayend" value="${tm(S.profile.dayEnd)}"></label></div>
    <div class="grid2"><label class="field"><span>Gym split</span><select class="input" data-act="split">${Object.entries(SPLITS).map(([k, v]) => `<option value="${k}" ${S.gym.split === k ? "selected" : ""}>${v.label}</option>`).join("")}</select></label>
    <label class="field"><span>Bible version</span><select class="input" data-act="version">${["NKJV", "KJV", "NIV", "ESV", "NLT", "AMP"].map(v => `<option ${B.bible().version === v ? "selected" : ""}>${v}</option>`).join("")}</select></label></div></div>
  <h2 class="sec"><span>Smarter answers (optional)</span></h2><div class="card">
    <p class="note" style="margin-top:0">Add your own AI key for richer answers from your notes. It stays on this device.</p>
    <div class="grid3"><label class="field"><span>Provider</span><select class="input" data-act="ai-provider"><option value="none" ${S.ai.provider === "none" ? "selected" : ""}>Off</option><option value="gemini" ${S.ai.provider === "gemini" ? "selected" : ""}>Google Gemini</option><option value="openai" ${S.ai.provider === "openai" ? "selected" : ""}>OpenAI</option></select></label>
    <label class="field"><span>API key</span><input class="input" type="password" data-act="ai-key" value="${esc(S.ai.key)}" autocomplete="off"></label>
    <label class="field"><span>Model</span><input class="input" data-act="ai-model" value="${esc(S.ai.model)}" placeholder="${S.ai.provider === "openai" ? "gpt-4o-mini" : "gemini-2.5-flash"}"></label></div></div>
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
    case "day": ui.date = el.dataset.n === "0" ? today() : addDays(ui.date, +el.dataset.n); render(); break;
    case "add": openEditor(null); break;
    case "edit": if (e.target.closest(".check,.tag.link")) return; openEditor(id); break;
    case "toggle": { e.stopPropagation(); const b = day(d).blocks.find(x => x.id === id); if (b) { b.done = !b.done; save(); render(); if (b.done) chime("ok"); } break; }
    case "go": e.stopPropagation(); go(el.dataset.v); break;
    case "close-sheet": $("#sheet").close(); break;
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
    case "learn-done": { const tr = LN.tracks().find(t => t.id === id); const r = LN.complete(tr); render(); if (r) { chime("ok"); toast(r.next ? `Next: ${r.next.t}` : `${tr.topic} complete.`); } break; }
    case "learn-del": confirmSheet("Remove this learning plan?", "", "Remove", () => { LN.remove(id); render(); }); break;
    case "song-del": S.band.songs = S.band.songs.filter(s => s.id !== id); save(); render(); break;
    case "test-voice": voice.say(hello()); break;
    case "backup": {
      const a2 = document.createElement("a");
      a2.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 1)], { type: "application/json" }));
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
    case "voice": S.voice.voiceURI = v; voice.voiceURI = v; voice.pickVoice(); save(); break;
    case "rate": S.voice.rate = +v; voice.rate = +v; save(); break;
    case "address": S.profile.address = v.trim() || "sir"; save(); break;
    case "daystart": { const [h, m] = v.split(":").map(Number); S.profile.dayStart = h * 60 + m; save(); break; }
    case "dayend": { const [h, m] = v.split(":").map(Number); S.profile.dayEnd = h * 60 + m; save(); break; }
    case "split": S.gym.split = v; S.gym.idx = 0; S.gym.override = null; save(); renameCoachBlocks(today()); break;
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
  if (el.dataset.act === "note-q") { clearTimeout(qT); qT = setTimeout(() => { ui.q = el.value; render(); const s = $(".search"); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }, 250); }
});
document.addEventListener("submit", e => {
  const f = e.target;
  if (f.id === "composer") { e.preventDefault(); const t = $("#ask").value; $("#ask").value = ""; voice.kill(); run(t, "typed"); return; }
  if (f.dataset.form === "song") { e.preventDefault(); const n = f.song.value.trim(); if (n) { C.addSong(n); render(); } return; }
  if (f.dataset.form === "note") { e.preventDefault(); const t = f.t.value.trim(); if (t) { const n = M.add(t); ui.folder = "all"; ui.q = ""; render(); toast(`Saved to ${M.FOLDERS[n.folder].label}.`); } return; }
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
$("#scrim").addEventListener("click", closeAssistant);
function orbTap() {
  if (!voice.supported) { openAssistant(); $("#ask").focus(); toast("Voice isn't available in this browser. Type to PG instead."); return; }
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
  r.onload = () => { try { const o = JSON.parse(r.result); if (!o.days && Array.isArray(o.tasks)) { confirmSheet("Import PG Planner tasks?", "Open tasks from the old app will be added.", "Import", () => { importV1(o); render(); toast("Imported."); }); return; } if (!o.days) throw 0; confirmSheet("Restore this backup?", "It replaces everything on this device.", "Restore", () => { replace(o); load(); paintChat(); render(); toast("Restored."); }); } catch { toast("That file isn't a PG backup."); } };
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
function tick() {
  const n = nowMin(), d = today();
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
paintChat(); render(); paintVoice("off");
setInterval(tick, 20000);
if (S.voice.handsFree && voice.supported) { voice.handsFree = true; voice.listen("wake"); }
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
window.PG = { run, S, voice };
