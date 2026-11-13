// PG — app controller: views, command handling, reminders.
import { S, load, save, day, sortedBlocks, reset, replace, hydrate, importV1 } from "./store.js";
import { CATS, EXERCISES, SPLITS, INSTRUMENTS, DEFAULT_MIN, GYM_WARMUP, stageOf } from "./library.js";
import { intent, parseSchedule, matchBlock, parseClock } from "./nlu.js";
import { placeItems, conflicts, gaps, firstGap } from "./scheduler.js";
import { Voice, chime } from "./voice.js";
import * as C from "./coach.js";
import { today, addDays, nowMin, uid, esc, fmtTime, sayTime, fmtDur, sayDur, fmtDay, cap, pad } from "./util.js";

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const ui = { view: "today", date: today(), openEx: null, playing: new Set(), sheetOpen: false, autoClose: false };

await hydrate();
load();
const addr = () => S.profile.address || "sir";

// ================= Voice wiring =================
const voice = new Voice({
  onState: m => paintVoice(m),
  onHeard: t => { $("#heard").textContent = t ? "“" + t + "”" : ""; },
  onWake: () => { openAssistant(true); $("#heard").textContent = ""; },
  onGreet: () => {
    const g = `Hi. What can I do for you, ${addr()}?`;
    pushMsg("pg", g);
    voice.say(g, () => voice.listen("command"));
  },
  onIdle: () => { voice.stop(); voice.afterReply(); setStatus("I'm here when you need me."); },
  onCommand: text => { $("#heard").textContent = ""; run(text, true); },
  onError: code => {
    const msg = { unsupported: "Voice input isn't supported in this browser. Use Chrome, Edge or Safari, or type below.", blocked: "Microphone access is blocked. Allow it in your browser settings, then tap the mic.", network: "Speech service unreachable. Check your connection.", nomic: "No microphone found." }[code];
    if (msg) toast(msg);
    if (code === "blocked" || code === "nomic") { S.voice.handsFree = false; save(); if (ui.view === "settings") render(); }
  }
});
voice.voiceURI = S.voice.voiceURI; voice.rate = S.voice.rate; voice.pickVoice();

function paintVoice(m) {
  $("#orb").dataset.state = m; $("#dockOrb").dataset.state = m;
  const label = { off: voice.supported ? "Tap to talk" : "Type below to talk to PG", wake: "Say “Hi PG”", command: "Listening…", thinking: "Thinking…", speaking: "Speaking…" }[m];
  setStatus(label);
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
  if (!S.chat.length) {
    el.innerHTML = `<div class="chat-empty">${voice.supported ? "Say “Hi PG” or tap the mic, then tell me about your day." : "Type your day below and I'll build your timetable."}</div>`;
  } else {
    el.innerHTML = S.chat.slice(-30).map(m => `<div class="msg ${m.who}">${m.html || esc(m.text)}</div>`).join("");
  }
  el.scrollTop = el.scrollHeight;
}
function paintSuggest() {
  const sug = ["What's next?", "I'm going to the gym", "I want to do band practice", "Read my schedule", "How do I do a squat?"];
  $("#suggest").innerHTML = sug.map(s => `<button class="chip" data-say="${esc(s)}">${esc(s)}</button>`).join("");
}

function reply(text, opts = {}) {
  pushMsg("pg", text, opts.html);
  if (opts.view) { go(opts.view, opts.date); if (opts.spoken) ui.autoClose = isMobile(); }
  if (S.voice.speak !== false) voice.say(text, opts.then);
  else voice.afterReply();
}

// ================= Command handling =================
async function run(text, spoken = false) {
  text = String(text || "").trim();
  if (!text) { voice.afterReply(); return; }
  pushMsg("me", text);
  try { await handle(text, spoken); }
  catch (e) { console.error(e); reply("Sorry, something went wrong on my side. Please try that again."); }
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

async function handle(text, spoken) {
  const it = intent(text);
  const d = ui.view === "today" ? ui.date : today();
  switch (it.type) {
    case "greet": {
      const g = `Hi. What can I do for you, ${addr()}?`;
      pushMsg("pg", g);
      if (S.voice.speak !== false) voice.say(g, () => voice.supported && spoken !== "typed" ? voice.listen("command") : voice.afterReply());
      return;
    }
    case "dismiss": return reply("Okay.");
    case "thanks": return reply(`Anytime, ${addr()}.`);
    case "help": return reply(`I build your timetable from what you tell me. Say something like: today I have class from 8:30 to 11, then I'll study until 5. I can also coach your gym and band sessions, tell you what's next, and move, resize or delete anything on your day.`);
    case "now": {
      const c = current(), nx = upcoming()[0];
      if (c) return reply(`Right now it's ${c.title}, until ${sayTime(c.end)}. That's ${sayDur(c.end - nowMin())} left.` + (nx ? ` After that, ${nx.title} at ${sayTime(nx.start)}.` : ""), { view: "today", date: today(), spoken });
      if (nx) return reply(`Nothing scheduled right now. Next up is ${nx.title} at ${sayTime(nx.start)}, in ${sayDur(nx.start - nowMin())}.`, { view: "today", date: today(), spoken });
      return reply(`Your schedule is clear right now, ${addr()}.`);
    }
    case "next": {
      const nx = upcoming()[0];
      if (!nx) return reply(`Nothing else is scheduled today, ${addr()}.`);
      return reply(`Next is ${nx.title} at ${sayTime(nx.start)}, in ${sayDur(nx.start - nowMin())}. It runs until ${sayTime(nx.end)}.`, { view: "today", date: today(), spoken });
    }
    case "day": {
      const dd = it.tomorrow ? addDays(today(), 1) : d;
      const bl = live(dd);
      if (!bl.length) return reply(`${fmtDay(dd)} is open. Tell me what you have and I'll plan it.`, { view: "today", date: dd, spoken });
      return reply(`${fmtDay(dd)} you have ${bl.length} ${bl.length === 1 ? "thing" : "things"}. ` + bl.slice(0, 8).map(say).join(". ") + ".", { view: "today", date: dd, spoken });
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
      if (!b) return reply(`I couldn't find ${it.target ? "“" + it.target + "”" : "anything running now"} on ${fmtDay(d).toLowerCase()}'s schedule.`);
      const snap = snapshot(d);
      let msg = "";
      if (it.type === "delete") { day(d).blocks = day(d).blocks.filter(x => x.id !== b.id); msg = `Removed ${b.title}.`; }
      if (it.type === "move") { const t = parseClock(it.time); const len = b.end - b.start; b.start = t; b.end = Math.min(1440, t + len); b.flex = false; msg = `Moved ${b.title} to ${sayTime(b.start)}. It now ends at ${sayTime(b.end)}.`; }
      if (it.type === "shift") { b.start += it.min; b.end = Math.min(1440, b.end + it.min); msg = `Pushed ${b.title} back ${sayDur(it.min)}. It now starts at ${sayTime(b.start)}.`; }
      if (it.type === "resize") { b.end = Math.min(1440, b.start + it.min); msg = `${b.title} is now ${sayDur(it.min)}, ${sayTime(b.start)} to ${sayTime(b.end)}.`; }
      if (it.type === "done") { b.done = true; msg = `Nice work. ${b.title} is done.`; const nx = upcoming(d).find(x => x.id !== b.id); if (nx) msg += ` Next is ${nx.title} at ${sayTime(nx.start)}.`; }
      save(); render(); undoable(snap, msg.split(".")[0] + ".");
      return reply(msg, { view: "today", date: d, spoken });
    }
    case "gym_switch": {
      const w = C.switchDay(it.day);
      if (!w) return reply("I don't have that workout. Try push, pull, legs, upper or lower day.");
      renameCoachBlocks(today());
      return reply(`Switched. ${C.gymBrief(today(), true)}`, { view: "gym", spoken });
    }
    case "gym_info": return reply(C.gymBrief(today(), true), { view: "gym", spoken });
    case "band_info": return reply(C.bandBrief(bandMinutes()), { view: "band", spoken });
    case "song_add": { const s = C.addSong(it.name); return reply(`Added ${s.name} to your setlist.`, { view: "band", spoken }); }
    case "howto": {
      ui.openEx = it.ex; ui.playing.add(EXERCISES[it.ex].video.id);
      return reply(C.exerciseBrief(it.ex), { view: "gym", spoken, then: () => { voice.afterReply(); } });
    }
    case "review": return reply(reviewText(), { view: "review", spoken });
    default: return scheduleFrom(text, spoken);
  }
}

function bandMinutes(d = today()) { const b = blocksOf(d).find(x => x.cat === "band" && !x.done); return b ? b.end - b.start : 60; }
function renameCoachBlocks(d) {
  day(d).blocks.forEach(b => { if (b.cat === "gym" && /^gym\b/i.test(b.title)) b.title = "Gym · " + C.workoutFor(d).name; });
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
    else {
      const ans = await aiChat(text).catch(() => null);
      if (ans) return reply(ans);
    }
  }
  if (!events.length) {
    return reply(`I didn't catch a task in that. You can say things like: today I have class from 8:30 to 11. Or: I'm going to the gym at 6. Or ask me what's next.`);
  }
  const dates = [...new Set(events.map(e => e.date))];
  const snaps = dates.map(snapshot);
  const res = placeItems(items, day, { today: today(), now: nowMin(), dayStart: S.profile.dayStart, dayEnd: S.profile.dayEnd });
  dates.forEach(renameCoachBlocks);
  res.unplaced.forEach(u => S.inbox.push({ id: uid(), title: u.title, cat: u.cat, dur: u.dur, date: u.date }));
  save();
  const all = [...res.added, ...res.updated].sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  const d0 = dates[0];
  let parts = [];
  if (all.length) {
    const lead = all.length > 1 ? `Done, ${addr()}. Here's ${d0 === today() ? "your day" : fmtDay(d0).toLowerCase()}. ` : `Done. `;
    parts.push(lead + all.slice(0, 8).map(say).join(". ") + ".");
    if (items.some(i => i.corrected)) { const c = items.find(i => i.corrected); parts.push(`I set ${c.title} to ${sayDur(c.dur)}.`); }
  }
  if (res.unplaced.length) parts.push(`I couldn't fit ${res.unplaced.map(u => u.title).join(" and ")} today, so it's in your to-do list.`);
  const cf = conflicts(day(d0).blocks);
  const clash = all.find(b => cf.has(b.id));
  if (clash) { const other = day(d0).blocks.find(b => b.id !== clash.id && cf.has(b.id) && b.start < clash.end && clash.start < b.end); if (other) parts.push(`Heads up: ${clash.title} overlaps ${other.title}.`); }
  const gym = all.find(b => b.cat === "gym"), band = all.find(b => b.cat === "band");
  let view = "today";
  if (gym) { parts.push(C.gymBrief(gym.date, true)); if (all.length === 1) view = "gym"; }
  if (band) { parts.push(C.bandBrief(band.end - band.start)); if (all.length === 1) view = "band"; }
  render();
  undoable(snaps, `${res.added.length} added${res.updated.length ? ", " + res.updated.length + " updated" : ""}.`);
  const html = `<div>${esc(parts[0] || "")}</div>` + (all.length > 1 ? `<ul>${all.map(b => `<li>${esc(fmtTime(b.start))}–${esc(fmtTime(b.end))} · ${esc(b.title)}</li>`).join("")}</ul>` : "") + parts.slice(1).map(p => `<div style="margin-top:6px">${esc(p)}</div>`).join("");
  reply(parts.join(" "), { view, date: d0, spoken, html });
}

function reviewText() {
  const bl = blocksOf(today());
  if (!bl.length) return `There's nothing on today's schedule to review yet, ${addr()}.`;
  const done = bl.filter(b => b.done), open = bl.filter(b => !b.done && b.end <= nowMin());
  const mins = done.reduce((a, b) => a + (b.end - b.start), 0);
  let t = `You planned ${bl.length} ${bl.length === 1 ? "block" : "blocks"} today and finished ${done.length}, about ${sayDur(mins)} of work.`;
  if (open.length) t += ` Not checked off yet: ${open.slice(0, 3).map(b => b.title).join(", ")}.`;
  if (S.gym.log.find(l => l.date === today())) t += " Gym session logged.";
  if (S.band.log.find(l => l.date === today())) t += " Band practice logged.";
  const tm = live(addDays(today(), 1))[0];
  if (tm) t += ` Tomorrow starts with ${tm.title} at ${sayTime(tm.start)}.`;
  t += done.length >= bl.length * 0.7 ? " Strong day." : " Pick the one thing that matters most tomorrow and do it first.";
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
  const sys = `Extract schedule items from speech. Today is ${ctx.today}. Fix speech-to-text errors (e.g. "solid work" = SolidWorks, "work to my dorm" = walk to dorm, wrong AM/PM). Return JSON {"items":[{"title":"","category":"class|study|work|commute|gym|band|meal|meeting|social|rest|other","date":"YYYY-MM-DD","start":"HH:MM or null","end":"HH:MM or null","minutes":number or null}]} in the order spoken. Return {"items":[]} if none.`;
  const raw = await callAI(sys, text, true);
  const o = JSON.parse(raw.replace(/^```json\s*|```$/g, ""));
  const toM = s => { if (!s) return null; const [h, m] = s.split(":").map(Number); return h * 60 + m; };
  return (o.items || []).map(x => { const s = toM(x.start), e = toM(x.end); const cat = CATS[x.category] ? x.category : "other"; return { kind: "event", title: x.title || "Task", cat, date: x.date || ctx.date, s, e, dur: x.minutes || (s != null && e != null ? e - s : DEFAULT_MIN[cat]) }; });
}
async function aiChat(text) {
  const sys = `You are PG, a concise, polite personal assistant. Address the user as "${addr()}". Answer in 1–3 short spoken sentences.`;
  return (await callAI(sys, text, false)).trim();
}

// ================= Views =================
function go(view, date) { ui.view = view; if (date) ui.date = date; render(); $("#main").scrollTo?.(0, 0); if (isMobile()) window.scrollTo(0, 0); }
function render() {
  $$("[data-view]").forEach(b => b.classList.toggle("on", b.dataset.view === ui.view));
  const v = { today: viewToday, gym: viewGym, band: viewBand, review: viewReview, settings: viewSettings }[ui.view] || viewToday;
  $("#view").innerHTML = v();
  document.title = { today: "Today", gym: "Gym coach", band: "Band coach", review: "Review", settings: "Settings" }[ui.view] + " · PG";
}
function greeting() { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; }
const catVar = c => `--c:${(CATS[c] || CATS.other).color}`;

function viewToday() {
  const d = ui.date, isT = d === today(), bl = blocksOf(d), n = nowMin();
  const cf = conflicts(bl);
  const planned = bl.reduce((a, b) => a + (b.end - b.start), 0);
  const done = bl.filter(b => b.done).length;
  const cur = isT ? current() : null, nx = isT ? upcoming()[0] : null;
  let h = `<div class="spread"><div class="eyebrow">${esc(fmtDay(d, true))}</div>
    <div class="day-nav"><button class="icon-btn" data-act="day" data-n="-1" aria-label="Previous day"><svg><use href="#i-left"/></svg></button>
    ${isT ? "" : `<button class="chip" data-act="day" data-n="0">Today</button>`}
    <button class="icon-btn" data-act="day" data-n="1" aria-label="Next day"><svg><use href="#i-right"/></svg></button></div></div>
    <h1 class="title">${isT ? `${greeting()}, <em>${esc(addr())}</em>.` : esc(fmtDay(d))}</h1>
    <p class="lede">${bl.length ? `${bl.length} ${bl.length === 1 ? "block" : "blocks"} planned${done ? `, ${done} done` : ""}.` : (isT ? "Your day is open. Tell PG what you have on." : "Nothing planned yet.")}</p>`;
  if (bl.length) h += `<div class="stats"><div class="stat"><b>${fmtDur(planned)}</b><span>Planned</span></div><div class="stat"><b>${done}/${bl.length}</b><span>Done</span></div>${isT ? `<div class="stat"><b>${nx ? fmtTime(nx.start) : "—"}</b><span>Next start</span></div>` : ""}</div>`;
  if (isT && (cur || nx)) {
    if (cur) {
      const pct = Math.round((n - cur.start) / (cur.end - cur.start) * 100);
      h += `<section class="now" aria-label="Happening now"><div class="eyebrow">Now · ${fmtTime(cur.start)} – ${fmtTime(cur.end)}</div><div class="now-title">${esc(cur.title)}</div>
        <div class="now-meta">${fmtDur(cur.end - n)} left</div><div class="bar"><i style="width:${pct}%"></i></div>
        <div class="now-next"><span>${nx ? `Next · <b>${esc(nx.title)}</b> at ${fmtTime(nx.start)}` : "Last block of the day"}</span>${coachLink(cur)}</div></section>`;
    } else {
      h += `<section class="now" aria-label="Up next"><div class="eyebrow">Up next · in ${fmtDur(nx.start - n)}</div><div class="now-title">${esc(nx.title)}</div>
        <div class="now-meta">${fmtTime(nx.start)} – ${fmtTime(nx.end)}</div><div class="now-next"><span>Free until then</span>${coachLink(nx)}</div></section>`;
    }
  }
  if (!bl.length) {
    h += `<div class="empty"><h3>Tell PG about your day.</h3><p>${voice.supported ? "Say “Hi PG”, or tap the mic, and describe your day in your own words. PG fills in the timetable." : "Type your day to PG in your own words. PG fills in the timetable."}</p>
      <div class="try">${[
        "Today I have class from 8:30 to 11, then I'll walk to my dorm for 30 minutes. I want to study from 11:30 to 5 PM, then do SolidWorks for an hour.",
        "I'm going to the gym at 6",
        "I want to do band practice after dinner at 7"
      ].map(s => `<button data-say="${esc(s)}"><b>Try</b> · ${esc(s)}</button>`).join("")}</div>
      <div class="row" style="justify-content:center;margin-top:var(--space-5)"><button class="btn" data-act="add"><svg><use href="#i-plus"/></svg>Add a block</button></div></div>`;
  } else {
    h += `<h2 class="sec"><span>Timetable</span><button class="btn sm" data-act="add"><svg><use href="#i-plus"/></svg>Add</button></h2><div class="timeline">`;
    const from = Math.min(S.profile.dayStart, bl[0].start), to = Math.max(S.profile.dayEnd, bl[bl.length - 1].end);
    const free = gaps(bl, from, to, 30);
    const rows = [...bl.map(b => ({ t: b.start, b })), ...free.map(g => ({ t: g.start, g }))].sort((a, b) => a.t - b.t || (a.g ? 1 : -1));
    let nowDrawn = !isT;
    for (const r of rows) {
      if (!nowDrawn && n < r.t) { h += nowLine(n); nowDrawn = true; }
      if (r.b) {
        const b = r.b, isLive = isT && b.start <= n && n < b.end && !b.done;
        h += `<div class="tl-row"><div class="tl-time">${fmtTime(b.start)}<small>${fmtTime(b.end)}</small></div>
          <div><div class="blk ${b.done ? "done" : ""} ${isLive ? "live" : ""}" style="${catVar(b.cat)}" role="button" tabindex="0" data-act="edit" data-id="${b.id}" aria-label="${esc(b.title)}, ${fmtTime(b.start)} to ${fmtTime(b.end)}">
            <div class="blk-title">${esc(b.title)}</div>
            <button class="check" data-act="toggle" data-id="${b.id}" aria-label="${b.done ? "Mark not done" : "Mark done"}"><svg><use href="#i-check"/></svg></button>
            <div class="blk-meta"><span class="tag cat" style="${catVar(b.cat)}">${esc((CATS[b.cat] || CATS.other).label)}</span><span class="tnum">${fmtDur(b.end - b.start)}</span>
              ${b.flex ? `<span class="tag">Auto-placed</span>` : ""}${cf.has(b.id) ? `<span class="tag warn">Overlaps</span>` : ""}${coachLink(b)}</div>
          </div></div></div>`;
      } else {
        const g = r.g;
        h += `<div class="tl-row gap-row"><div class="tl-time"></div><div class="gap"><span>Free · ${fmtDur(g.end - g.start)}</span><span class="tnum">${fmtTime(g.start)} – ${fmtTime(g.end)}</span></div></div>`;
      }
    }
    if (!nowDrawn && n < 1440) h += nowLine(n);
    h += `</div>`;
  }
  const inbox = S.inbox;
  if (inbox.length) {
    h += `<h2 class="sec"><span>To-do · not scheduled</span></h2><div class="card">${inbox.map(t => `<div class="set-row"><div><div class="lbl">${esc(t.title)}</div><div class="sub">${fmtDur(t.dur || 30)}${t.date ? " · " + esc(fmtDay(t.date)) : ""}</div></div>
      <div class="row"><button class="btn sm" data-act="fit" data-id="${t.id}">Fit into ${esc(fmtDay(d).toLowerCase())}</button><button class="btn sm ghost" data-act="inbox-del" data-id="${t.id}" aria-label="Remove">Remove</button></div></div>`).join("")}</div>`;
  }
  return h;
}
const nowLine = n => `<div class="now-line" aria-hidden="true"><span>${fmtTime(n)}</span><i></i></div>`;
function coachLink(b) {
  if (b.cat === "gym") return `<button class="tag link" data-act="go" data-v="gym">Open gym coach</button>`;
  if (b.cat === "band") return `<button class="tag link" data-act="go" data-v="band">Open band coach</button>`;
  return "";
}

function videoHTML(v, title) {
  const playing = ui.playing.has(v.id);
  const q = encodeURIComponent(title + " proper form");
  return `<div class="video">${playing
    ? `<iframe src="https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&rel=0&playsinline=1&modestbranding=1" title="${esc(title)} demo video" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe>`
    : `<button data-act="play" data-vid="${v.id}" aria-label="Play ${esc(title)} video"><img src="https://i.ytimg.com/vi/${v.id}/hqdefault.jpg" alt="" loading="lazy" width="480" height="360"><span class="play" style="position:absolute"><svg><use href="#i-play"/></svg></span></button>`}</div>
    <div class="video-cap"><span>Demo · ${esc(v.by)}</span><span class="row"><a href="https://www.youtube.com/watch?v=${v.id}" target="_blank" rel="noopener">YouTube <svg><use href="#i-ext"/></svg></a><a href="https://www.youtube.com/results?search_query=${q}" target="_blank" rel="noopener">More videos <svg><use href="#i-ext"/></svg></a></span></div>`;
}

function gymProgress() {
  if (!S.gym.cur || S.gym.cur.date !== today()) S.gym.cur = { date: today(), sets: {} };
  return S.gym.cur;
}
function viewGym() {
  const sp = C.split(), w = C.workoutFor(today()), prog = gymProgress();
  const logged = S.gym.log.find(l => l.date === today());
  const est = Math.round(w.plan.reduce((a, p) => a + p.sets * (45 + p.rest), 0) / 60 + 8);
  const totalSets = w.plan.reduce((a, p) => a + p.sets, 0);
  const doneSets = Object.values(prog.sets).reduce((a, arr) => a + arr.filter(Boolean).length, 0);
  const nextDay = sp.days[(sp.days.indexOf(w) + 1) % sp.days.length];
  let h = `<div class="eyebrow">Gym coach · ${esc(sp.label)}</div>
    <h1 class="title">Today is <em>${esc(w.name.toLowerCase())}</em>.</h1>
    <p class="lede">${esc(cap(w.focus))}. About ${est} minutes · ${w.plan.length} exercises · ${totalSets} sets.${logged ? " Logged today." : ""}</p>
    <div class="stats"><div class="stat"><b>${doneSets}/${totalSets}</b><span>Sets done</span></div><div class="stat"><b>${C.gymStreak()}</b><span>Sessions, last 7 days</span></div><div class="stat"><b>${esc(nextDay.name)}</b><span>Up next time</span></div></div>
    <div class="hero-coach"><div class="split-chips" role="group" aria-label="Choose workout">${sp.days.map(x => `<button class="chip ${x === w ? "on" : ""}" data-act="gymday" data-k="${x.key}">${esc(x.name)}</button>`).join("")}</div>
    <div class="row"><button class="btn" data-act="speak-gym"><svg><use href="#i-speaker"/></svg>Talk me through it</button>
    <button class="btn primary" data-act="gym-finish" ${logged ? "disabled" : ""}>${logged ? "Workout logged" : "Finish workout"}</button></div></div>
    <h2 class="sec"><span>Warm-up</span></h2><div class="card"><div class="lbl">${esc(GYM_WARMUP)}</div></div>
    <h2 class="sec"><span>Exercises</span><span class="faint" style="font-weight:400">Tap one for cues and a video</span></h2>`;
  w.plan.forEach((p, i) => {
    const e = EXERCISES[p.ex], open = ui.openEx === p.ex;
    const sets = prog.sets[p.ex] || [];
    const comp = sets.filter(Boolean).length >= p.sets;
    const last = C.lastLog(p.ex);
    h += `<article class="ex ${open ? "open" : ""} ${comp ? "complete" : ""}" id="ex-${p.ex}">
      <button class="ex-head" data-act="ex" data-k="${p.ex}" aria-expanded="${open}">
        <span class="ex-num">${comp ? `<svg style="width:14px;height:14px"><use href="#i-check"/></svg>` : i + 1}</span>
        <span><span class="ex-name">${esc(e.name)}</span><br><span class="ex-sub">${esc(e.muscles)}</span></span>
        <span class="ex-dose">${p.sets} × ${esc(p.reps)}<small>Rest ${p.rest >= 60 ? Math.round(p.rest / 60 * 10) / 10 + " min" : p.rest + "s"}</small></span>
      </button>
      ${open ? `<div class="ex-body"><div>${videoHTML(e.video, e.name)}</div><div>
        <ol class="cues">${e.cues.map(c => `<li>${esc(c)}</li>`).join("")}</ol>
        <div class="sets" role="group" aria-label="Sets">${Array.from({ length: p.sets }, (_, k) => `<button class="set ${sets[k] ? "on" : ""}" data-act="set" data-k="${p.ex}" data-i="${k}" aria-pressed="${!!sets[k]}">Set ${k + 1}</button>`).join("")}</div>
        <div class="weight"><label class="row" style="gap:6px">Weight <input class="input tnum" type="number" inputmode="decimal" min="0" step="0.5" data-act="w" data-k="${p.ex}" value="${last ? esc(last.w) : ""}" placeholder="kg"></label>
          <span>${last ? `Last · ${esc(last.w)} kg (${esc(fmtDay(last.date))})` : "Log a weight to track progress"}</span></div>
        <div class="row" style="margin-top:var(--space-4)"><button class="btn sm" data-act="speak-ex" data-k="${p.ex}"><svg><use href="#i-speaker"/></svg>Explain it</button></div>
      </div></div>` : ""}
    </article>`;
  });
  return h;
}

function viewBand() {
  const ins = C.inst(), mins = bandMinutes(), p = C.bandPlan(mins);
  let h = `<div class="spread"><div class="eyebrow">Band coach · ${esc(ins.label)}</div>
    <select class="input" style="width:auto" data-act="instrument" aria-label="Instrument">${Object.entries(INSTRUMENTS).map(([k, v]) => `<option value="${k}" ${k === S.band.instrument ? "selected" : ""}>${v.label}</option>`).join("")}</select></div>
    <h1 class="title">${p.focus ? `Today's focus: <em>${esc(p.focus.name)}</em>.` : `Band practice, <em>${mins} minutes</em>.`}</h1>
    <p class="lede">${p.focus ? `${p.focus.progress}% · ${stageOf(p.focus.progress).label}. PG picks the song that needs the most work.` : "Add your setlist and PG will track each song and choose what to work on."}</p>
    <div class="stats"><div class="stat"><b>${S.band.songs.length}</b><span>Songs</span></div><div class="stat"><b>${S.band.songs.length ? Math.round(S.band.songs.reduce((a, s) => a + s.progress, 0) / S.band.songs.length) + "%" : "—"}</b><span>Setlist ready</span></div><div class="stat"><b>${C.bandStreak()}</b><span>Practices, last 7 days</span></div></div>
    <div class="hero-coach"><div class="row"><button class="btn" data-act="speak-band"><svg><use href="#i-speaker"/></svg>Talk me through it</button><button class="btn primary" data-act="band-log">Log practice</button></div></div>
    <h2 class="sec"><span>Today's plan · ${mins} min</span></h2><div class="card"><div class="steps">${p.steps.map((s, i) => `<div class="step"><div class="step-min">${s.min} min</div><div><div class="step-t">${esc(s.t)}</div><div class="step-d">${esc(s.d)}</div>${i === 0 && s.video ? `<div style="margin-top:var(--space-3);max-width:420px">${videoHTML(s.video, ins.label + " warm up")}</div>` : ""}</div></div>`).join("")}</div></div>
    <h2 class="sec"><span>Setlist progress</span></h2><div class="card">`;
  if (S.band.songs.length) h += S.band.songs.map(s => { const st = stageOf(s.progress); return `<div class="song"><div><div class="song-name">${esc(s.name)}${p.focus && p.focus.id === s.id ? ` <span class="tag link">Focus</span>` : ""}</div><div class="song-stage ${st.tone}"><span class="tnum">${s.progress}%</span> · ${st.label}${s.last ? ` · practiced ${esc(fmtDay(s.last).toLowerCase())}` : ""}</div></div>
      <button class="x" data-act="song-del" data-id="${s.id}" aria-label="Remove ${esc(s.name)}"><svg><use href="#i-x"/></svg></button>
      <input type="range" min="0" max="100" step="5" value="${s.progress}" data-act="song-p" data-id="${s.id}" aria-label="${esc(s.name)} progress"></div>`; }).join("");
  else h += `<p class="muted" style="margin:0 0 var(--space-4);font-size:var(--text-sm)">No songs yet. Add the songs your band is rehearsing.</p>`;
  h += `<form class="row" data-form="song" style="margin-top:var(--space-4);flex-wrap:nowrap"><input class="input" name="song" placeholder="Add a song, e.g. Seven Nation Army" aria-label="Song name"><button class="btn">Add</button></form></div>`;
  return h;
}

function viewReview() {
  const bl = blocksOf(today()), done = bl.filter(b => b.done);
  const planned = bl.reduce((a, b) => a + (b.end - b.start), 0), doneMin = done.reduce((a, b) => a + (b.end - b.start), 0);
  const byCat = {}; bl.forEach(b => { byCat[b.cat] = (byCat[b.cat] || 0) + (b.end - b.start); });
  const max = Math.max(1, ...Object.values(byCat));
  const week = Array.from({ length: 7 }, (_, i) => addDays(today(), -6 + i)).map(d => { const b = S.days[d]?.blocks || []; return { d, n: b.length, done: b.filter(x => x.done).length }; });
  let h = `<div class="eyebrow">Review · ${esc(fmtDay(today(), true))}</div><h1 class="title">How today <em>went</em>.</h1>
    <p class="lede">${esc(reviewText())}</p>
    <div class="row" style="margin-top:var(--space-5)"><button class="btn" data-act="speak-review"><svg><use href="#i-speaker"/></svg>Read it to me</button></div>
    <div class="kpis"><div class="kpi"><b>${done.length}/${bl.length}</b><span>Blocks done</span></div><div class="kpi"><b>${fmtDur(doneMin)}</b><span>Completed</span></div><div class="kpi"><b>${fmtDur(planned)}</b><span>Planned</span></div><div class="kpi"><b>${bl.length ? Math.round(done.length / bl.length * 100) : 0}%</b><span>Follow-through</span></div></div>
    <h2 class="sec"><span>Where your time is going</span></h2><div class="card">`;
  h += Object.keys(byCat).length ? Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, m]) => `<div class="hbar" style="${catVar(c)}"><span>${esc(CATS[c]?.label || c)}</span><span class="track"><i style="width:${m / max * 100}%"></i></span><span class="v">${fmtDur(m)}</span></div>`).join("") : `<p class="muted" style="margin:0;font-size:var(--text-sm)">Plan your day to see a breakdown.</p>`;
  h += `</div><h2 class="sec"><span>Last 7 days</span></h2><div class="card">${week.map(w => `<div class="hbar" style="--c:var(--accent)"><span>${esc(new Date(w.d + "T00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric" }))}</span><span class="track"><i style="width:${w.n ? w.done / w.n * 100 : 0}%"></i></span><span class="v">${w.n ? `${w.done}/${w.n}` : "—"}</span></div>`).join("")}</div>`;
  return h;
}

function viewSettings() {
  const vs = voice.voices();
  const tm = m => pad(Math.floor(m / 60)) + ":" + pad(m % 60);
  return `<div class="eyebrow">Settings</div><h1 class="title">Make PG <em>yours</em>.</h1>
  <p class="lede">Everything is stored on this device only.</p>
  <h2 class="sec"><span>Voice</span></h2><div class="card">
    <div class="set-row"><div><div class="lbl">Hands-free “Hi PG”</div><div class="sub">PG listens for its name while this app is open. ${voice.supported ? `<span class="status-dot ok"></span>Supported in this browser` : `<span class="status-dot bad"></span>Not supported here. Use Chrome, Edge or Safari.`}</div></div>
      <label class="switch"><input type="checkbox" data-act="handsfree" ${S.voice.handsFree ? "checked" : ""} ${voice.supported ? "" : "disabled"} aria-label="Hands-free wake word"><i></i></label></div>
    <div class="set-row"><div><div class="lbl">Speak replies</div><div class="sub">PG answers out loud.</div></div><label class="switch"><input type="checkbox" data-act="speak" ${S.voice.speak !== false ? "checked" : ""} aria-label="Speak replies"><i></i></label></div>
    <div class="set-row"><div><div class="lbl">Spoken reminders</div><div class="sub">PG tells you when each block starts.</div></div><label class="switch"><input type="checkbox" data-act="alerts" ${S.voice.alerts ? "checked" : ""} aria-label="Spoken reminders"><i></i></label></div>
    <div class="set-row"><div><div class="lbl">Heads-up before each block</div></div><select class="input" style="width:auto" data-act="heads" aria-label="Heads-up minutes">${[0, 5, 10, 15].map(m => `<option value="${m}" ${S.voice.heads === m ? "selected" : ""}>${m ? m + " min" : "Off"}</option>`).join("")}</select></div>
    <div class="set-row"><div><div class="lbl">Keep screen awake</div><div class="sub">Useful when PG sits on your desk in hands-free mode.</div></div><label class="switch"><input type="checkbox" data-act="awake" ${S.voice.keepAwake ? "checked" : ""} aria-label="Keep screen awake"><i></i></label></div>
    <div class="set-row" style="display:block"><div class="grid2" style="margin-top:var(--space-2)">
      <label class="field"><span>PG's voice</span><select class="input" data-act="voice">${vs.length ? vs.map(v => `<option value="${esc(v.voiceURI)}" ${voice.voice && voice.voice.voiceURI === v.voiceURI ? "selected" : ""}>${esc(v.name)}</option>`).join("") : `<option>System default</option>`}</select></label>
      <label class="field"><span>Speed</span><select class="input" data-act="rate">${[0.9, 1, 1.1, 1.2].map(r => `<option value="${r}" ${S.voice.rate === r ? "selected" : ""}>${r}×</option>`).join("")}</select></label></div>
      <button class="btn sm" data-act="test-voice"><svg><use href="#i-speaker"/></svg>Test voice</button></div>
  </div>
  <h2 class="sec"><span>You</span></h2><div class="card">
    <div class="grid3"><label class="field"><span>PG calls you</span><input class="input" data-act="address" value="${esc(addr())}" placeholder="sir"></label>
    <label class="field"><span>Day starts</span><input class="input" type="time" data-act="daystart" value="${tm(S.profile.dayStart)}"></label>
    <label class="field"><span>Day ends</span><input class="input" type="time" data-act="dayend" value="${tm(S.profile.dayEnd)}"></label></div>
  </div>
  <h2 class="sec"><span>Coaching</span></h2><div class="card"><div class="grid2">
    <label class="field"><span>Gym split</span><select class="input" data-act="split">${Object.entries(SPLITS).map(([k, v]) => `<option value="${k}" ${S.gym.split === k ? "selected" : ""}>${v.label}</option>`).join("")}</select></label>
    <label class="field"><span>Your instrument</span><select class="input" data-act="instrument">${Object.entries(INSTRUMENTS).map(([k, v]) => `<option value="${k}" ${S.band.instrument === k ? "selected" : ""}>${v.label}</option>`).join("")}</select></label></div></div>
  <h2 class="sec"><span>Smarter understanding (optional)</span></h2><div class="card">
    <p class="muted" style="margin:0 0 var(--space-4);font-size:var(--text-sm)">PG works fully without this. Add your own AI key and PG will use it as a backup for unusual requests and general questions. The key stays on this device.</p>
    <div class="grid3"><label class="field"><span>Provider</span><select class="input" data-act="ai-provider"><option value="none" ${S.ai.provider === "none" ? "selected" : ""}>Off</option><option value="gemini" ${S.ai.provider === "gemini" ? "selected" : ""}>Google Gemini</option><option value="openai" ${S.ai.provider === "openai" ? "selected" : ""}>OpenAI</option></select></label>
    <label class="field"><span>API key</span><input class="input" type="password" data-act="ai-key" value="${esc(S.ai.key)}" placeholder="Paste key" autocomplete="off"></label>
    <label class="field"><span>Model (optional)</span><input class="input" data-act="ai-model" value="${esc(S.ai.model)}" placeholder="${S.ai.provider === "openai" ? "gpt-4o-mini" : "gemini-2.5-flash"}"></label></div></div>
  <h2 class="sec"><span>Data</span></h2><div class="card"><div class="row">
    <button class="btn sm" data-act="backup">Back up</button><button class="btn sm" data-act="restore">Restore</button><button class="btn sm" data-act="clear-chat">Clear conversation</button><button class="btn sm danger" data-act="reset">Erase everything</button>
    <input type="file" id="restoreFile" accept="application/json,.json" hidden></div></div>
  <h2 class="sec"><span>Install on your phone</span></h2><div class="card"><p class="muted" style="margin:0;font-size:var(--text-sm)">iPhone: open in Safari, tap Share, then Add to Home Screen. Android: open in Chrome, tap the menu, then Install app. PG then opens full-screen like a native app.</p></div>`;
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
  sh.innerHTML = `<form method="dialog" data-form="block" data-id="${b ? b.id : ""}"><h3>${b ? "Edit block" : "New block"}</h3>
    <label class="field"><span>Title</span><input class="input" name="title" value="${esc(b ? b.title : "")}" required placeholder="e.g. Study"></label>
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
  const el = e.target.closest("[data-act],[data-view],[data-say]");
  if (!el) return;
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
    case "del-block": { const snap = snapshot(d); day(d).blocks = day(d).blocks.filter(x => x.id !== id); save(); $("#sheet").close(); render(); undoable(snap, "Block deleted."); break; }
    case "fit": {
      const t = S.inbox.find(x => x.id === id); if (!t) break;
      const n = nowMin(); const from = d === today() ? Math.max(S.profile.dayStart, Math.ceil(n / 15) * 15) : S.profile.dayStart;
      const s = firstGap(day(d).blocks, from, t.dur || 30, 1440);
      if (s == null) { toast("No free slot left on that day."); break; }
      day(d).blocks.push({ id: uid(), title: t.title, cat: t.cat, start: s, end: s + (t.dur || 30), flex: true, done: false, date: d, src: "inbox" });
      S.inbox = S.inbox.filter(x => x.id !== id); save(); render(); toast(`${t.title} placed at ${fmtTime(s)}.`); break;
    }
    case "inbox-del": S.inbox = S.inbox.filter(x => x.id !== id); save(); render(); break;
    case "ex": ui.openEx = ui.openEx === el.dataset.k ? null : el.dataset.k; render(); break;
    case "play": ui.playing.add(el.dataset.vid); render(); break;
    case "set": { const p = gymProgress(); const k = el.dataset.k, i = +el.dataset.i; p.sets[k] = p.sets[k] || []; p.sets[k][i] = !p.sets[k][i]; save(); render(); if (p.sets[k][i]) chime("ok"); break; }
    case "gymday": S.gym.override = el.dataset.k; S.gym.overrideDate = today(); save(); renameCoachBlocks(today()); render(); break;
    case "speak-gym": reply(C.gymBrief(today(), false)); break;
    case "speak-ex": reply(C.exerciseBrief(el.dataset.k)); break;
    case "gym-finish": {
      const w = C.completeWorkout(today(), gymProgress().sets);
      day(today()).blocks.filter(b => b.cat === "gym").forEach(b => b.done = true); save();
      const nx = C.workoutFor(addDays(today(), 1));
      render(); reply(`Workout logged. Good work, ${addr()}. Next session is ${nx.name.toLowerCase()}.`); break;
    }
    case "speak-band": reply(C.bandBrief(bandMinutes())); break;
    case "band-log": {
      C.completeBand({}, bandMinutes());
      day(today()).blocks.filter(b => b.cat === "band").forEach(b => b.done = true); save();
      render(); reply(`Practice logged. Keep the sliders honest and tomorrow's plan will adapt.`); break;
    }
    case "song-del": S.band.songs = S.band.songs.filter(s => s.id !== id); save(); render(); break;
    case "speak-review": reply(reviewText()); break;
    case "test-voice": voice.say(`Hi. What can I do for you, ${addr()}?`); break;
    case "backup": {
      const a2 = document.createElement("a");
      a2.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 1)], { type: "application/json" }));
      a2.download = `pg-backup-${today()}.json`; document.body.appendChild(a2); a2.click(); a2.remove(); toast("Backup downloaded."); break;
    }
    case "restore": $("#restoreFile").click(); break;
    case "clear-chat": S.chat = []; save(); paintChat(); toast("Conversation cleared."); break;
    case "reset": confirmSheet("Erase everything?", "This removes your schedule, coaching progress and settings from this device.", "Erase", () => { reset(); load(); paintChat(); render(); toast("Everything erased."); }); break;
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
    case "handsfree": S.voice.handsFree = el.checked; save(); voice.enableHandsFree(el.checked); if (el.checked) toast("Say “Hi PG” any time this app is open."); break;
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
    case "instrument": S.band.instrument = v; save(); render(); break;
    case "ai-provider": S.ai.provider = v; save(); render(); break;
    case "ai-key": S.ai.key = v.trim(); save(); break;
    case "ai-model": S.ai.model = v.trim(); save(); break;
    case "song-p": { const s = S.band.songs.find(x => x.id === el.dataset.id); if (s) { s.progress = +v; s.last = today(); save(); render(); } break; }
    case "w": C.setWeight(el.dataset.k, v, ""); break;
  }
});
document.addEventListener("input", e => {
  if (e.target.dataset.act === "song-p") { const row = e.target.closest(".song"); const st = stageOf(+e.target.value); const lab = row.querySelector(".song-stage"); lab.className = "song-stage " + st.tone; lab.innerHTML = `<span class="tnum">${e.target.value}%</span> · ${st.label}`; }
});
document.addEventListener("submit", e => {
  const f = e.target;
  if (f.id === "composer") { e.preventDefault(); const t = $("#ask").value; $("#ask").value = ""; voice.kill(); run(t, "typed"); return; }
  if (f.dataset.form === "song") { e.preventDefault(); const n = f.song.value.trim(); if (n) { C.addSong(n); render(); } return; }
  if (f.dataset.form === "block") {
    e.preventDefault();
    const d = ui.date, fd = new FormData(f);
    const toM = s => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
    let s = toM(fd.get("start")), en = toM(fd.get("end")); if (en <= s) en = Math.min(1440, s + 30);
    const data = { title: String(fd.get("title")).trim() || "Untitled", cat: fd.get("cat"), start: s, end: en };
    if (f.dataset.id) Object.assign(day(d).blocks.find(x => x.id === f.dataset.id), data, { flex: false });
    else day(d).blocks.push({ id: uid(), ...data, flex: false, done: false, date: d, src: "manual" });
    save(); $("#sheet").close(); render(); toast(f.dataset.id ? "Saved." : "Block added.");
  }
});
$("#orb").addEventListener("click", () => orbTap());
$("#dockOrb").addEventListener("click", () => { openAssistant(); orbTap(); });
$("#asClose").addEventListener("click", closeAssistant);
$("#scrim").addEventListener("click", closeAssistant);
function orbTap() {
  if (!voice.supported) { openAssistant(); $("#ask").focus(); toast("Voice input isn't available in this browser. Type to PG instead."); return; }
  voice.tap();
}

function confirmSheet(title, body, cta, fn) {
  const sh = $("#sheet");
  sh.innerHTML = `<h3>${esc(title)}</h3><p class="muted" style="margin:0;font-size:var(--text-sm)">${esc(body)}</p><div class="sheet-actions"><span></span><span class="row"><button class="btn ghost" data-act="close-sheet">Cancel</button><button class="btn danger" id="cfm">${esc(cta)}</button></span></div>`;
  sh.showModal();
  $("#cfm").onclick = () => { sh.close(); fn(); };
}
function restoreFrom(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => { try { const o = JSON.parse(r.result); if (!o.days && Array.isArray(o.tasks)) { confirmSheet("Import PG Planner tasks?", "Your open tasks from the old app will be added to your days and to-do list.", "Import", () => { importV1(o); render(); toast("Old tasks imported."); }); return; } if (!o.days) throw 0; confirmSheet("Restore this backup?", "It replaces everything currently on this device.", "Restore", () => { replace(o); load(); paintChat(); render(); toast("Backup restored."); }); } catch { toast("That file isn't a PG backup."); } };
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
  if (ui.view === "today" && ui.date === d && !$("#sheet").open) {
    const y = window.scrollY, m = $("#main").scrollTop;
    render(); window.scrollTo(0, y); $("#main").scrollTop = m;
  }
  if (!S.voice.alerts) return;
  for (const b of live(d)) {
    const kH = b.id + ":h", kS = b.id + ":s";
    if (S.voice.heads && n >= b.start - S.voice.heads && n < b.start && !alerted.has(kH)) {
      if (voice.mode === "command" || voice.mode === "speaking") continue;
      alerted.add(kH); notify(`${b.title} starts in ${sayDur(b.start - n)}, ${addr()}.`);
    }
    if (n >= b.start && n < b.start + 3 && !alerted.has(kS)) {
      if (voice.mode === "command" || voice.mode === "speaking") continue;
      alerted.add(kS);
      let msg = `It's ${sayTime(b.start)}. Time for ${b.title}, until ${sayTime(b.end)}.`;
      if (b.cat === "gym") msg += " " + C.gymBrief(d, true);
      if (b.cat === "band") msg += " " + C.bandBrief(b.end - b.start);
      notify(msg);
    }
  }
}
function notify(msg) {
  chime("ok");
  pushMsg("pg", msg);
  if (S.voice.speak !== false) voice.say(msg);
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
paintChat(); paintSuggest(); render(); paintVoice("off");
setInterval(tick, 20000);
if (S.voice.handsFree && voice.supported) { voice.handsFree = true; voice.listen("wake"); }
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
window.PG = { run, S, voice }; // handy for debugging
