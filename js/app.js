// PG — app controller: views, command handling, reminders.
import { S, load, save, day, sortedBlocks, reset, replace, hydrate, importV1, flush, beginDraft, endDraft, inDraft } from "./store.js";
import { changes, describe, approval, applyProposal, validateChanges, reconcileWindows, namedBlocks } from "./commands.js";
import { calendarDate } from "./dates.js";
import { speakable, isNatural } from "./speech.js";
import { CATS, EXERCISES, SPLITS, DEFAULT_MIN, GYM_WARMUP, stageOf } from "./library.js";
import { intent, parseSchedule, matchBlock, parseClock, normalize, hasCalendarCue } from "./nlu.js";
import { placeItems, conflicts, firstGap, gaps, activityKey } from "./scheduler.js";
import { Voice } from "./voice.js";
import * as C from "./coach.js";
import * as BS from "./bass.js";
import * as B from "./bible.js";
import * as M from "./brain.js";
import * as LN from "./learn.js";
import * as F from "./food.js";
import * as SC from "./school.js";
import * as AG from "./agent.js";
import * as SY from "./sync.js";
import { PG_CLOUD, PG_VERSION } from "./config.js";
import * as WEB from "./web.js";
import * as HR from "./hearing.js";
import { sayLike } from "./canto.js";
import * as D from "./daily.js";
import { weekOf, planWeek, planSummary } from "./timetable.js";
import { today, addDays, nowMin, uid, esc, fmtTime, sayTime, fmtDur, sayDur, fmtDay, pad } from "./util.js";
import { commandText, PHRASES } from "./phrasebook.js";
import { carriedTasks, planCarryover, untimedTasks } from "./carryover.js";
import { collectionCommand, collectionTotals, findCollection, mergeCollections, reservedCollection, saveCollection } from "./collections.js";
import { archiveDays, calendarFile, hkAt, isQuiet, occurrences, pendingAlarms, readTime, reviewDay, timeValue } from "./alarms.js";
import { daysLeft, goalCommand, goalDeadline } from "./goals.js";
import { anchorCommand, clearFutureInstances, exactClock, onRoutineDay, WEEKDAYS } from "./routines.js";
import { accents, appearanceValues, applyAppearance, loadWallpaper, removeWallpaper, setWallpaper } from "./appearance.js";

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const ui = { view: "today", date: today(), openEx: null, playing: new Set(), autoClose: false, topic: null, folder: "all", q: "", gymTab: "workout", openRec: null, openTip: null };

await hydrate();
load();
applyAppearance(S.ui);
loadWallpaper();
C.syncCustom();
BS.bass(); B.bible(); M.notes(); LN.tracks();
const addr = () => S.profile.address || "sir";
const lc = s => s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
const ucf = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const pickOne = a => a[Math.floor(Math.random() * a.length)];
const carrySince = () => S.carrySince || addDays(today(), -1);
const carryList = () => carriedTasks(S, today(), carrySince());
const getUntimed = id => S.inbox.find(t => t.id === id) || carryList().find(t => t.id === id);
function initCarryover() {
  if (SY.locked()) return false;
  const fresh = !S.carrySince;
  if (fresh) S.carrySince = carrySince();
  const date = today(), result = planCarryover(S, date, S.carrySince, day(date).blocks, nowMin());
  if (fresh || result.changed) save();
  return result.changed;
}

// ================= Voice wiring =================
const voice = new Voice({
  onState: paintVoice,
  onTranscript: t => {
    $("#ask").value = t;
    $("#heard").textContent = "Check the transcript, then tap Send.";
    if (S.voice.autoSend) $("#composer").requestSubmit();
  },
  onError: code => {
    const msg = { unsupported: "Recording isn’t available here. You can still type.", "not-allowed": "Microphone blocked. Allow it in your browser settings or type instead.", "service-not-allowed": "Speech recognition is unavailable. Type instead.", network: "Your browser couldn’t transcribe this. Try again online or type.", "audio-capture": "No microphone available. Type instead.", "no-speech": "No words heard. Record again or type." }[code];
    toast(msg || "Couldn’t transcribe. Record again or type.");
  }
});
voice.voiceURI = S.voice.voiceURI; voice.rate = S.voice.rate; voice.pickVoice();
function setStatus(t) { $("#orbStatus").textContent = t; }
function paintVoice(mode) {
  for (const el of [$("#orb"), $("#dockOrb")]) {
    el.dataset.state = mode;
    el.setAttribute("aria-label", mode === "command" ? "Stop recording" : "Record a command");
  }
  setStatus({ off: "Tap to record", command: "Recording · tap to stop", thinking: "Finishing transcript…" }[mode]);
  $("#listenPill").textContent = mode === "command" ? "Recording" : "";
  $("#finishTurn").hidden = mode !== "command";
  if (mode !== "off") openAssistant();
}

// ================= Assistant panel =================
const assistantScreen = matchMedia("(max-width: 960px)");
const isMobile = () => assistantScreen.matches;
assistantScreen.addEventListener?.("change", () => {
  if (!isMobile()) closeAssistant();
  else if (["command", "thinking", "speaking"].includes(voice.mode)) openAssistant();
});
function openAssistant() { if (!isMobile()) return; $("#assistant").classList.add("open"); $("#scrim").hidden = false; }
function closeAssistant() { voice.kill(); $("#assistant").classList.remove("open"); $("#scrim").hidden = true; }
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
  settings: ["Brief me", "What's next?", "What do I have today?"]
};
function paintSuggest() {
  $("#suggest").innerHTML = (ui.view === "today" ? PHRASES[0].slice(1) : SUGGEST[ui.view] || SUGGEST.today).map(s => s.endsWith(": ")
    ? `<button class="chip" data-fill="${esc(s)}">${esc(s.replace(/: $/, ""))}</button>`
    : `<button class="chip" data-say="${esc(s)}">${esc(s)}</button>`).join("");
}
// speakable() lives in speech.js
function reply(text, opts = {}) {
  if (ui.draftReplies) { ui.draftReplies.push({ text, opts }); return; }
  if (!text) return;
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
  if (opts.readAloud) voice.say(speakable(text, true));
}

// ================= Command handling =================
function receipt(p) {
  const summary = p.summary.join("; ") || "Saved";
  const title = /^(?:Add|Save|Added|Created|Assignment saved)\b/.test(summary) ? "Added" : /^Remove\b/.test(summary) ? "Removed" : /^(?:Done|Completed)\b/.test(summary) ? "Done" : "Updated";
  const html = `<div class="result-card"><strong>${title}</strong><div>${esc(summary)}</div><div class="row"><button class="btn" data-act="undo-action" data-id="${esc(p.id)}">Undo</button><button class="btn" data-act="edit-action" data-id="${esc(p.id)}">Edit</button></div></div>`;
  reply(`${title}: ${summary}`, { html });
  toast(`${title}: ${p.summary[0] || "saved"}`, "Undo", () => undoAction(p.id));
}
function applyAction(p) {
  if (!applyProposal(S, p)) return;
  // Keep reversible deltas local; they can include text removed from live data.
  S.dev.actions = [...(S.dev.actions || []), p].slice(-10);
  const added = p.changes.filter(c => c.path.join(".") === "school.tasks")
    .flatMap(c => (c.after || []).filter(t => !(c.before || []).some(b => b.id === t.id)));
  if (added.length === 1) ui.lastAddedTask = added[0].id;
  save(); C.syncCustom(); render(); receipt(p);
  if (p.changes.some(c => c.path[0] === "ui")) applyAppearance(S.ui);
  if (document.hidden) systemNotice(p.summary.join("; "));
}
function undoAction(id) {
  const p = (S.dev.actions || []).findLast(x => !x.undone && (!id || x.id === id));
  if (!p) { reply("There’s no recent action to undo."); return; }
  try {
    applyProposal(S, { id: uid(), changes: p.changes.map(c => ({ path: c.path, before: c.after, after: c.before })) });
    p.undone = true; save(); C.syncCustom(); applyAppearance(S.ui); render(); reply("Undone. The previous values were restored."); toast("Undone.");
  } catch { reply("Can’t undo safely because part of that entry has changed. Edit the current entry instead."); }
}
function needsConfirmation(text, delta) {
  if (delta.some(c => c.path[0] === "weekPlans")
    || /^(?:clear|wipe|reset|erase)\b|\bmove (?:my |the |all |everything |whole )*(?:day|schedule|timetable)\b/i.test(text)) return true;
  const surviving = new Set(delta.filter(c => c.path[0] === "days").flatMap(c => (Array.isArray(c.after) ? c.after : []).map(b => b.id)));
  const removed = delta.flatMap(c => Array.isArray(c.before) ? c.before.filter(x => x?.id && !(c.after || []).some(y => y?.id === x.id)).map(x => ({ x, root: c.path[0] })) : []);
  const assignments = new Set(removed.filter(({ root }) => root === "school").map(({ x }) => x.id));
  const separate = removed.filter(({ x, root }) => root !== "days" || !surviving.has(x.id) && !assignments.has(x.tid));
  return separate.length > 1 || removed.some(({ root }) => root === "routines" || root === "collections");
}
async function run(raw, spoken = false) {
  raw = String(raw || "").trim();
  if (!raw || ui.running || SY.locked()) return;
  const cleaned = commandText(HR.clean(raw));
  const text = (S.phrases || []).find(p => p.from.toLowerCase() === cleaned.toLowerCase())?.to || cleaned;
  if (!text) return;
  ui.running = true;
  $("#composer .send").disabled = true;
  pushMsg("me", raw);
  try {
    if (ui.proposal) {
      const answer = approval(text);
      const p = ui.proposal;
      if (!answer) return reply("Confirm or cancel the pending change first.");
      ui.proposal = null;
      if (answer === "yes") return applyAction(p);
      return reply("Cancelled. Nothing changed.");
    }
    if (/^(?:undo(?: that| last action)?|that’s wrong, remove it|that's wrong, remove it)[.!]?$/i.test(text)) return undoAction();
    const correction = text.match(/^(?:no[, ]+)?(?:make it|change (?:that|it|the last one) to)\s+(.+)$/i);
    if (correction) {
      const last = (S.dev.actions || []).findLast(x => !x.undone);
      const list = last?.changes.flatMap(c => c.path.at(-1) === "blocks" ? (c.after || []).filter(b => !(c.before || []).some(x => x.id === b.id && JSON.stringify(x) === JSON.stringify(b))) : []) || [];
      if (list.length !== 1) return reply("I can’t tell which entry to change. Say its name and the new time or date.");
      const b = list[0], input = correction[1];
      const date = calendarDate(input, today()) || b.date;
      const start = calendarDate(input, today()) ? b.start : parseClock(input);
      if (start == null) return reply("No change. Give a weekday or a time.");
      const before = structuredClone(S); let after;
      beginDraft();
      try { AG.apply([{ op: "update_block", id: b.id, date, start, end: start + b.end - b.start }]); after = endDraft(); }
      finally { if (inDraft()) endDraft(); }
      const delta = changes(before, after);
      if (!delta.length) return reply("That entry already has those details.");
      return applyAction({ id: uid(), original: text, changes: delta, summary: describe({ changes: delta }) });
    }
    ui.original = raw;
    const before = structuredClone(S);
    ui.draftReplies = []; beginDraft();
    let after, replies;
    try {
      await handle(text, spoken);
      if (S.carrySince && changes(before, S).some(c => c.path[0] === "days" || c.path[0] === "inbox")) {
        const date = today();
        planCarryover(S, date, S.carrySince, day(date).blocks, nowMin());
      }
      after = endDraft(); replies = ui.draftReplies;
    }
    finally { if (inDraft()) endDraft(); ui.draftReplies = null; C.syncCustom(); }
    reconcileWindows(before, after);
    const delta = changes(before, after);
    validateChanges(before, after, delta);
    if (delta.length) {
      const merge = collectionCommand(text);
      const p = { id: uid(), original: text, changes: delta, summary: merge?.op === "merge" && delta.some(c => c.path[0] === "collections")
        ? [`Merge ${merge.name} into ${merge.to}. All items will be kept.`] : describe({ changes: delta }) };
      if (needsConfirmation(text, delta)) {
        ui.proposal = p;
        const label = `Confirm: ${p.summary.join("; ")}`;
        return reply(label, { html: `${esc(label)}<div class="row"><button class="btn" data-say="yes">Yes</button><button class="btn" data-say="no">No</button></div>` });
      }
      applyAction(p);
      if (replies.length) {
        const { text: message, opts } = replies.at(-1);
        if (opts.view) go(opts.view, opts.date);
        if (message && /\b(?:overlaps|didn’t fit|didn't fit|no time yet)\b/i.test(message)) reply(message, opts);
      }
    } else for (const r of replies) reply(r.text, r.opts);
  } catch (error) {
    if (inDraft()) endDraft();
    reply(error.message || "Nothing saved. Try again.");
  } finally {
    if (ui.logMiss) {
      S.dev.missed = [...(S.dev.missed || []), ui.logMiss].slice(-200);
      ui.logMiss = null; save(true);
    }
    ui.running = false;
    ui.original = null;
    $("#composer .send").disabled = false;
    await flush();
    if (SY.on()) SY.push();
  }
}

function unrecognized(text) {
  const original = ui.original || text;
  if (inDraft()) ui.logMiss = original;
  return reply("I didn’t understand. Nothing was saved.", { html: `<div>I didn’t understand. Nothing was saved.</div><div class="row"><button class="btn" data-act="fallback-note" data-text="${esc(original)}">Save as a note</button><button class="btn" data-act="fallback-category" data-text="${esc(original)}">Save in a new category…</button><button class="btn" data-act="fallback-web" data-text="${esc(original)}">Run as a search</button></div>` });
}
function previewNote(text, folder = "") {
  return reply("Review this note before saving.", { html: `<div>Review this note before saving:</div><p>${esc(text)}</p><button class="btn" data-act="fallback-note" data-text="${esc(text)}" data-folder="${esc(folder)}">Review and save</button>` });
}
function openHandbook(filter = "") {
  const sh = $("#sheet");
  const q = filter.trim().toLowerCase();
  sh.innerHTML = `<h3>What can I say?</h3><form data-form="handbook" class="row wrap"><input name="q" class="input" placeholder="Search commands" aria-label="Find a command" value="${esc(filter)}"><button class="btn">Filter</button></form>${PHRASES.map(([title, ...phrases]) => {
    const matches = phrases.filter(p => !q || `${title} ${p}`.toLowerCase().includes(q));
    return matches.length ? `<h4>${esc(title)}</h4>${matches.map(p => `<div class="set-row"><span>${esc(p)}</span><button class="btn" data-act="try-phrase" data-text="${esc(p)}">Try it</button></div>`).join("")}` : "";
  }).join("")}<p class="note" data-phrase-demo aria-live="polite">Try it never saves anything.</p><button class="btn" data-act="close-sheet">Close</button>`;
  if (!sh.open) sh.showModal();
}
function openCollections(id) {
  const c = S.collections.find(x => x.id === id), sh = $("#sheet");
  const totals = c ? collectionTotals(c) : [];
  sh.innerHTML = c ? `<h3>${esc(c.name)}</h3><p class="note">${c.items.length} items${totals.length ? ` · Total: ${esc(totals.join(", "))}` : ""}</p><div class="list">${c.items.map(x => `<div class="set-row"><span>${x.done ? "Done: " : ""}${esc(x.text)}${x.date ? `<span class="sub">${esc(fmtDay(x.date))}${x.remindMin == null ? "" : ` · Reminder at ${fmtTime(x.remindMin)}`}</span>` : ""}</span><div class="row wrap"><button class="btn" data-act="collection-tick" data-group="${esc(c.id)}" data-id="${esc(x.id)}" aria-label="${x.done ? "Uncheck" : "Complete"} ${esc(x.text)}">${x.done ? "Uncheck" : "Done"}</button><button class="btn" data-act="collection-item-edit" data-group="${esc(c.id)}" data-id="${esc(x.id)}" aria-label="Edit ${esc(x.text)}">Edit</button></div></div>`).join("")}</div><form data-form="collection" class="field"><input type="hidden" name="group" value="${esc(c.name)}"><label class="field"><span>New item</span><input required class="input" name="entry"></label><button class="btn primary">Add item</button></form><div class="row wrap"><button class="btn" data-act="collections">All collections</button><button class="btn danger" data-say="${esc(`Delete category ${c.name}`)}" data-act="collection-delete">Delete category</button><button class="btn" data-act="close-sheet">Close</button></div>`
    : `<h3>Collections</h3>${S.collections.map(x => `<button class="btn" data-act="collections" data-id="${esc(x.id)}">${esc(x.name)} (${x.items.length})</button>`).join("") || "<p>No custom collections yet.</p>"}<form data-form="collection" class="field"><label class="field"><span>New collection</span><input class="input" name="group" required></label><button class="btn primary">Create</button></form><button class="btn" data-act="close-sheet">Close</button>`;
  if (!sh.open) sh.showModal();
}
function handleCollection(text) {
  const p = collectionCommand(text);
  if (!p || reservedCollection(p.name)) return false;
  const c = findCollection(S.collections, p.name);
  if (p.op === "create" || p.op === "add") {
    const { c: target, created } = saveCollection(S.collections, p.name, p.text, p.kind);
    reply(`${created ? `Created category: ${target.name}. ` : ""}${p.text ? `Added: ${p.text}.` : !created ? `Already exists: ${target.name}.` : ""}`);
  } else if (!c) return false;
  else if (p.op === "show") reply(`${c.name}: ${c.items.map(x => x.text).join("; ") || "Empty"}.`, { html: `<strong>${esc(c.name)}</strong><button class="btn" data-act="collections" data-id="${esc(c.id)}">Open collection</button>` });
  else if (p.op === "delete") S.collections = S.collections.filter(x => x.id !== c.id);
  else if (p.op === "merge") {
    const target = findCollection(S.collections, p.to);
    if (!target || target === c) return reply("Give the names of two different existing collections."), true;
    S.collections = mergeCollections(S.collections, c, target);
  }
  else if (p.op === "rename") {
    if (reservedCollection(p.to) || findCollection(S.collections, p.to)) return reply("That name is already in use."), true;
    c.aliases = [...new Set([...(c.aliases || []), c.name])]; c.name = ucf(p.to);
  } else {
    const exact = c.items.filter(x => x.text.trim().toLowerCase() === p.text.trim().toLowerCase());
    if (exact.length !== 1) return reply(`I couldn't identify a single item in ${c.name}. Open the collection to choose it.`), true;
    if (p.op === "done") exact[0].done = true;
    else c.items = c.items.filter(x => x.id !== exact[0].id);
  }
  return true;
}
async function showSearch(query) {
  const q = String(query || "").trim().slice(0, 350);
  if (!q) return reply("Enter a search query.");
  const google = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  const computed = WEB.calculate(q);
  if (computed != null) return reply(`Answer: ${computed}. Calculated on this device.`);
  let result;
  try {
    result = /\bweather\b/i.test(q) ? await WEB.weather(q) : WEB.SPORTS_RE.test(q) && /\b(?:scores?|results?|fixtures?)\b/i.test(q) ? await WEB.sports(q) : await WEB.search(q);
  } catch {}
  const cards = result?.cards ?? (result?.text ? (result.sources || []).slice(0, 1).map(x => ({ ...x, text: result.text })) : []);
  ui.lastSearch = cards.map(c => c.text).join(" ");
  const summary = cards.length ? "Search results" : "No clear answer found";
  const html = `<div class="search-card"><strong>${summary}</strong>${cards.map(c => `<article><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.title)}</a><p>${esc(c.text)}</p><div class="row wrap"><button class="btn" data-act="fallback-note" data-text="${esc(`${c.text}\n${c.url}`)}">Save as note</button><button class="btn" data-act="fallback-category" data-text="${esc(`${c.text}\n${c.url}`)}">Save to a category</button></div></article>`).join("")}<a class="btn" href="${esc(google)}" target="_blank" rel="noopener">Open full search in Google</a></div>`;
  return reply(summary, { html });
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
// Hong Kong clock: the same verse through 21:00; one Cantonese sentence from 21:01.
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
  const draft = goalCommand(text);
  if (draft) {
    const g = D.addGoal(draft.text, draft.qualifier);
    if (g) reply(`Goal: ${g.text} · ${goalLabel(g)}`);
    return true;
  }
  if ((m = b.match(/^(?:(goal done):\s*|(remove|delete|drop|take off|i finished|i achieved|i reached) (?:the |my )?goal(?: to| about| of)? )(.+)$/))) {
    const [g, ...rest] = namedBlocks(m[3], D.goals().map(g => ({ ...g, title: g.text })));
    if (!g || rest.length) return reply(rest.length ? "More than one goal matches. Say its full title." : "No matching goal."), true;
    const status = m[1] || m[2]?.startsWith("i ") ? "done" : "dropped";
    changeGoalStatus(g.id, status); reply(`${status === "done" ? "Completed" : "Dropped"}: ${g.text}.`); return true;
  }
  if ((m = b.match(/^change (?:the |my )?goal(?: (.+?))? deadline to (.+)$/))) {
    const list = m[1] ? namedBlocks(m[1], D.goals().map(g => ({ ...g, title: g.text }))) : D.goals();
    const due = goalDeadline(m[2], today(), S.profile.termEnd);
    if (list.length !== 1 || !due) return reply(list.length !== 1 ? "Give the goal's title to change its deadline." : "Give an exact goal deadline."), true;
    const g = S.goals.find(g => g.id === list[0].id), old = g.due;
    g.due = due; reply(`${g.text}: ${old || "No date"} → ${due}`); return true;
  }
  if (/\b(?:how are my goals going|(?:what are|remind me (?:of|about)|tell me|list|read|show) my (?:long[- ]term |short[- ]term )?goals|my goals$)/.test(b)) {
    const term = /long[- ]term/.test(b) ? "long" : /short[- ]term/.test(b) ? "short" : "";
    return reply(D.goals().filter(g => !term || g.term === term).map(g => `${g.text} · ${goalLabel(g)}`).join("; ") || "No active goals."), true;
  }
  if (/\bteach me (?:some |one |two |2 |a few |more )?(?:cantonese|canto)\b|\bcantonese (?:lesson|sentences?) (?:now|please)\b/.test(b)) {
    const c = D.teachDaily();
    return reply(`Today's sentence: ${c.zh} (say it: ${c.jp}) means "${c.en}" We'll practise this one today.`,
      { html: cantoCard(c) }), true;
  }
  if (/\b(?:what|which) cantonese (?:have i|did i) (?:learn|learned|learnt)|\b(?:show|open|read) (?:me )?my cantonese\b|\bmy cantonese (?:sentences|words|list)\b/.test(b)) {
    const l = D.learned();
    openCanto();
    if (!l.length) return reply("No learned phrases yet. Tap Learned on the Cantonese card on Today."), true;
    return reply(`You've learned ${l.length} sentence${l.length === 1 ? "" : "s"}. The latest: ${l[0].zh} means "${l[0].en}"`), true;
  }
  return false;
}
function cantoCard(c) {
  return `<ol class="canto-list"><li><button class="canto-play" data-act="canto-play" data-zh="${esc(c.zh)}" aria-label="Play ${esc(c.en)}"><b lang="zh-HK">${esc(c.zh)}</b><span class="faint">Say it: ${esc(c.jp)}</span><span>${esc(c.en)}</span><span class="faint">Tap to hear it</span></button></li></ol>`;
}
function openCanto() {
  const l = D.learned(), sh = $("#sheet");
  sh.innerHTML = `<h3>Cantonese</h3><p class="note" style="margin:0 0 8px">One sentence per day. Repeat it throughout today. ${l.length} of ${D.CANTO_N} saved. Tap a sentence to hear it.</p>
    ${l.length ? `<ol class="canto-list">${l.map(c => `<li><button class="canto-play" data-act="canto-play" data-zh="${esc(c.zh)}" aria-label="Play ${esc(c.en)}"><b lang="zh-HK">${esc(c.zh)}</b><span class="faint">Say it: ${esc(c.jp)}</span><span>${esc(c.en)}</span></button></li>`).join("")}</ol>` : `<p class="note">Tap Learned on Today to save a phrase here.</p>`}
    <div class="sheet-actions"><button class="btn" data-act="canto-more">Practise today's sentence</button><button class="btn ghost" data-act="close-sheet">Close</button></div>`;
  if (!sh.open) sh.showModal();
}
function goalLabel(g) {
  if (!g.due) return "No date";
  const n = daysLeft(g.due, today());
  return `${fmtDay(g.due)} · ${n === 0 ? "Due today" : n < 0 ? `${-n} day${n === -1 ? "" : "s"} overdue` : `${n} day${n === 1 ? "" : "s"} left`}`;
}
function changeGoalStatus(id, status) {
  const g = D.finishGoal(id, status);
  if (!g) return;
  if (inDraft()) return;
  const row = S.goalHistory.at(-1);
  toast(`${status === "done" ? "Completed" : "Dropped"}: ${g.text}`, "Undo", () => {
    g.status = "active"; S.goalHistory = S.goalHistory.filter(x => x !== row); save(); render(); if ($("#sheet").open) openGoals();
  });
}
function openGoals(editId = "") {
  const g = D.goals(), sh = $("#sheet"), edit = g.find(x => x.id === editId);
  const history = (S.goalHistory || []).slice(-20).reverse();
  sh.innerHTML = `<h3>Your goals</h3>
    ${["short","long"].map(term => `<h4>${term === "short" ? "Short-term" : "Long-term"}</h4>${g.filter(x => x.term === term).map(x => `<div class="set-row"><span>${esc(x.text)}<span class="sub">${esc(goalLabel(x))}</span></span><div class="row wrap"><button class="btn sm" data-act="goal-edit" data-id="${esc(x.id)}">${x.due ? "Edit / Push date" : "Set date / Edit"}</button><button class="btn sm" data-act="goal-status" data-id="${esc(x.id)}" data-status="done">Done</button><button class="btn sm ghost" data-act="goal-status" data-id="${esc(x.id)}" data-status="dropped">Drop</button></div></div>`).join("") || "<p class=\"note\">None</p>"}`).join("")}
    ${edit ? `<form class="field" data-form="goal-edit" data-id="${esc(edit.id)}"><label class="field">Goal<input class="input" name="g" required value="${esc(edit.text)}"></label><div class="grid2"><label class="field">Due date<input class="input" name="due" type="date" value="${esc(edit.due || "")}"></label><label class="field">Type<select class="input" name="term"><option value="short" ${edit.term === "short" ? "selected" : ""}>Short-term</option><option value="long" ${edit.term === "long" ? "selected" : ""}>Long-term</option></select></label></div><label class="field">Remind every (days; 0 turns off repeats)<input class="input" name="period" type="number" min="0" max="365" required value="${edit.remindEvery}"></label><label class="field">Notes<textarea class="input" name="notes">${esc(edit.notes)}</textarea></label><button class="btn primary">Save goal</button></form>` : `<form data-form="goal" class="row"><input class="input" name="g" placeholder="Add a goal" aria-label="New goal" autocomplete="off" required><button class="btn primary" type="submit">Add</button></form>`}
    ${history.length ? `<details><summary>Goal history</summary>${history.map(x => `<p class="note">${esc(x.date)} · ${x.status === "done" ? "Completed" : "Dropped"}: ${esc(x.text)}</p>`).join("")}</details>` : ""}
    <div class="sheet-actions"><span></span><button class="btn ghost" data-act="close-sheet">Close</button></div>`;
  if (!sh.open) sh.showModal();
}
function sayCanto(zh) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(zh), v = voice.yueVoice();
    u.lang = v ? v.lang.replace(/_/g, "-") : "zh-HK"; if (v) u.voice = v; u.rate = 0.85;
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
  if (p.type === "clarify" && /^(?:please )?(?:add|delete|remove|move|schedule|what|show|tell|i have|i've got)\b/i.test(text)) return false;
  if (p.type === "academic-context") {
    if (/^(?:school|schoolwork|school related|for school|yes)(?:[.! ]|$)/i.test(text)) {
      return followUp({ type: "assignment-slot", tasks: p.tasks }, bare, text.replace(/^(?:school|schoolwork|school related|for school|yes)[,. ]*/i, ""), spoken);
    }
    if (/^(?:personal|not school|not schoolwork|no)(?:[.! ]|$)/i.test(text))
      return await scheduleFrom(p.original.replace(/\b(?:due|deadline|by)\b.*$/i, ""), spoken, true), true;
    ui.pending = p;
    return reply("Is that schoolwork or a personal activity, sir? Nothing saved."), true;
  }
  if (p.type === "assignment-slot") {
    if (/^(?:cancel|never mind)$/i.test(text.trim())) return reply("Cancelled. Nothing saved."), true;
    const tasks = p.tasks;
    if (/^(?:what|show|tell|add|delete|remove|move|gym|church|cook)\b/i.test(text)) return false;
    const timeCue = /\b(?:from|at|to|until)\s+\d|\d{1,2}(?::\d\d)?\s*(?:am|pm)\b/i.test(normalize(text));
    if (!timeCue) {
      if (/^(?:what|show|tell|add|delete|remove|move|gym|church)\b/i.test(text)) return false;
      ui.pending = p;
      return reply(`What day, start time and end time should I put ${tasks.map(t => t.title).join("; ")} on the timetable? Nothing saved yet.`), true;
    }
    const input = tasks.length === 1 ? `assignment ${text}` : text;
    const items = parseSchedule(input, { date: today(), today: today(), now: nowMin() });
    if (tasks.length === 1) for (const item of items) if (item.kind === "event") { item.title = tasks[0].title; item.cat = "study"; }
    const gap = needsAsk(items);
    if (gap) { ui.pending = p; return reply(askLine(gap)), true; }
    const events = items.filter(i => i.kind === "event");
    if (!events.length || tasks.some(t => !events.some(i => i.title.toLowerCase() === t.title.toLowerCase()))) {
      ui.pending = p;
      return reply("Please name each assignment with its day, start time and end time. Nothing saved yet."), true;
    }
    const added = SC.add(tasks);
    await reviewSchedule(items, spoken);
    for (const task of added) for (const value of Object.values(S.days))
      for (const b of value.blocks) if (b.title.toLowerCase() === task.title.toLowerCase()) b.tid = task.id;
    return true;
  }
  if (p.type === "schedule-review") {
    if (YES.test(bare)) return await commitSchedule(p.items, spoken, p.replace || []), true;
    if (NO.test(bare) || /^(?:cancel|never ?mind|stop)$/.test(bare)) return reply("Nothing changed, sir. Please give me the corrected activity, day, start and end time."), true;
    return false;
  }
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
      if (got?.ambiguous) it.ambiguous = true;
      if (got?.invalidRange) it.invalidRange = true;
      it.asked = true;
    }
    const next = needsAsk(p.items);
    if (next) { ui.pending = { ...p, tries: 0 }; return reply(askLine(next)), true; }
    await reviewSchedule(p.items, spoken, p.replace || []);
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
    if (got && got.due) { t.due = got.due; if (got.dueMin != null) t.dueMin = got.dueMin; if (got.est) { t.guess = got.est; } save(); return reply(`Saved, due ${SC.fmt.dueText(t)}. I haven't added any study times. Tell me when you want to work on it.`, { view: "school", spoken }), true; }
    return false;
  }
  if (p.type === "duetime") {
    const t = SC.tasks().find(x => x.id === p.tid); if (!t) return false;
    if (SC.looksLikeSchool(text) || bare.split(" ").length > 7) return false;   // a new request, not an answer
    const min = SC.timeIn(bare) ?? parseClock(bare);
    if (min != null && min >= 0) { t.dueMin = min; save(); return reply(`Saved, due ${SC.fmt.dueText(t)}. No study times were added.`, { view: "school", spoken }), true; }
    if (NO.test(bare) || /\b(?:no (?:set )?time|don'?t know|not sure|any ?time|end of (?:the )?day|whenever)\b/.test(bare)) return reply("Saved without a due time. No study times were added.", { view: "school", spoken }), true;
    return false;
  }
  if (p.type === "more") {
    if (NO.test(bare) || /^(?:no )?(?:that's (?:it|all)|nothing(?: else)?|i'm good|all good)/.test(bare)) return true;
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
  return reply(`${rel}${next}`, { view: "school", spoken });
}
function schoolReply(res, head, spoken) { render(); return reply((head ? head + " " : "") + SC.planBrief(res), { view: "school", spoken }); }

async function handle(text, spoken) {
  const bare0 = normalize(text).replace(/[^a-z0-9: ']/g, " ").replace(/\s+/g, " ").trim();
  const theme = bare0.match(/^(?:switch to|use|set) (?:a |the )?(light|dark|auto) theme$/i);
  const font = bare0.match(/^(?:make (?:the )?font|make (?:the )?text) (bigger|smaller)$/i);
  if (theme || font) {
    S.ui = appearanceValues({ ...S.ui, ...(theme ? { theme: theme[1] } : { fontScale: S.ui.fontScale + (font[1] === "bigger" ? .1 : -.1) }) });
    return reply("Appearance updated.");
  }
  if (/^(?:set|change|add) (?:this picture as |a |my )?(?:wallpaper)$/.test(bare0)) return reply("Open More → Appearance and choose a wallpaper image.");
  if (/^(?:show |open )?(?:my )?(?:evening review|daily review)[.!?]?$/i.test(text)) { openReview(today()); return reply("Evening review opened."); }
  if (/^(?:show |open |list )?(?:my )?(?:alarms|reminders)[.!?]?$/i.test(text)) { openReminders(); return reply("Reminders opened."); }
  if (/^what did i miss yesterday[.!?]?$/i.test(text)) {
    const d = addDays(today(), -1), missed = S.history[d]?.missed || reviewDay(S, d).missed;
    return reply(missed.length ? `Not completed yesterday: ${missed.map(x => x.title).join(", ")}.` : "No missed tasks were recorded yesterday.");
  }
  if (/^how was my week[.!?]?$/i.test(text)) {
    const d = today(), dates = Array.from({ length: 7 }, (_, i) => addDays(d, i - 6));
    return reply(dates.map(day => { const r = day === d ? reviewDay(S, day) : S.history[day] || reviewDay(S, day); return `${fmtDay(day)}: ${r.done.length} of ${r.planned.length} done`; }).join("; ") + ".");
  }
  const alarmAsk = text.match(/^(?:remind me (?:to|about)|set an alarm for|alert me to|wake me for) (.+?) at (.+)$/i);
  if (alarmAsk && !/\b(?:every day|daily)\b/i.test(text)) {
    const date = calendarDate(text, today()) || today();
    const time = normalize(alarmAsk[2]).match(/\b(\d{1,2}(?::\d\d)?\s*(?:am|pm)|(?:[01]?\d|2[0-3]):[0-5]\d|noon|midnight)\b/i)?.[1];
    const minute = time ? exactClock(time) : null;
    if (minute == null || minute >= 1440) return reply("No reminder saved. Give an exact time, for example “remind me to call Mum at 6 PM”.");
    const at = hkAt(date, minute);
    if (at <= Date.now()) return reply("That time has passed. Include “tomorrow” or choose another date.");
    const title = alarmAsk[1].replace(/\b(?:today|tomorrow|tonight)\b/gi, "").trim();
    if (!title) return reply("Add what you want to be reminded about.");
    S.reminders.push({ id: uid(), title, text: title, kind: "custom", at, done: false });
    return reply(`Reminder saved: ${title}, ${fmtDay(date)} at ${fmtTime(minute)}.${S.alarms.enabled ? "" : " Turn alarms on in More to hear it."}`);
  }
  const forced = text.match(/^search (?:the )?web (?:for )?(.+)$/i);
  if (forced) return showSearch(forced[1]);
  const calculated = WEB.calculate(text);
  if (calculated != null) return reply(`Answer: ${calculated}. Calculated on this device.`);
  const remember = (ui.original || text).match(/^(?:PG[, ]+)?(?:save this|remember (?:this|that))(?=\s|:|$)\s*(?::\s*)?(.*)$/i);
  if (remember) {
    const pending = remember[1].trim() || [...S.chat].reverse().filter(m => m.who === "me")[1]?.text || "";
    return pending && !/^\s*(?:save this|remember (?:this|that))[.!?]?\s*$/i.test(pending)
      ? previewNote(pending, /^\s*(?:PG[, ]+)?remember that\b/i.test(ui.original || text) ? "about" : "") : reply("No note text yet. Try “save this: bring the spare cable”.");
  }
  if (/^(?:brief me|read it)[.!?]?$/i.test(text) && ui.lastSearch) return reply(ui.lastSearch, { readAloud: true });
  if (/^(?:brief me|what'?s my day)[.!?]?$/i.test(text)) {
    const date = today();
    const entries = live(date).map(b => `${b.title} from ${sayTime(b.start)} to ${sayTime(b.end)}`);
    const due = SC.pending().filter(t => t.due && t.due <= date).map(t => `${t.title}, due ${SC.fmt.dueText(t)}`);
    const untimed = [...untimedTasks(S, date, date, carrySince()), ...carryList()].map(t => t.title);
    return reply([`Today, ${fmtDay(date, true)}.`, entries.length ? entries.join("; ") + "." : "No timed activities.", due.length ? `Due: ${due.join("; ")}.` : "", untimed.length ? `No time yet: ${untimed.join(", ")}.` : ""].filter(Boolean).join(" "), { readAloud: /^brief me/i.test(text), view: "today", date });
  }
  if (handleCollection(text)) return;
  const pin = text.match(/^don['’]t move (.+?)[.!]?$/i);
  const field = text.match(/^(.+?) is (flexible|top priority)[.!]?$/i);
  const venueEdit = text.match(/^(.+?) (?:venue is|venue:) (.+?)[.!]?$/i);
  if (pin || field || venueEdit) {
    const title = (pin || field || venueEdit)[1], date = calendarDate(title, today()) || ui.date || today();
    const [match, ...rest] = namedBlocks(title.replace(/\b(?:on )?(?:today|tomorrow|(?:next |this )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d{4}-\d{2}-\d{2})\b/gi, "").trim(), day(date).blocks.filter(b => !b.skipped && !b.routine));
    if (!match || rest.length) return reply(rest.length ? "More than one block matches. Give the full title and date." : "No matching timetable block.");
    if (pin || field?.[2].toLowerCase() === "flexible") { match.fixed = !!pin; match.flex = !pin; }
    if (field?.[2].toLowerCase() === "top priority") match.priority = 1;
    if (venueEdit) match.venue = venueEdit[2].slice(0, 120).trim();
    return reply(`Updated ${match.title}.`);
  }
  const anchor = anchorCommand(text);
  if (anchor) {
    if (S.routines.some(r => !r.disabled && r.title.toLowerCase() === anchor.title.toLowerCase())) return reply("That routine already exists. Edit it in Everyday tasks.");
    S.routines.push({ id: uid(), ...anchor, fixed: true, cat: "other", from: today() }); save();
    return reply(`Added ${anchor.title}, ${fmtTime(anchor.start)} to ${fmtTime(anchor.start + anchor.minutes)} ${anchor.days.length === 7 ? "every day" : anchor.days.length === 5 ? "on weekdays" : "on weekends"}.`, { view: "today", date: today() });
  }
  const everyday = text.match(/^(?:for (?:my )?(?:everyday|daily) tasks(?:[, ]+))?(?:add|include|put) (.+?)(?: (?:to|in) (?:my )?(?:everyday|daily) tasks)?[.!]?$/i);
  if (everyday && /\b(?:everyday|daily) tasks\b/i.test(text)) {
    const ops = everyday[1].split(/\s+(?:and|also)\s+|,\s*/i).map(title => ({ op: "add_routine", title }));
    return reply(AG.apply(ops).join(" "), { view: "today", date: today() });
  }
  const forgetEveryday = text.match(/^(?:remove|delete|drop|take off) (.+?) from (?:my )?(?:everyday|daily) tasks[.!]?$/i);
  if (forgetEveryday) {
    const matches = namedBlocks(forgetEveryday[1], S.routines.filter(r => !r.disabled));
    if (matches.length !== 1) return reply(matches.length ? "More than one task matches. Use the exact title shown under Everyday tasks." : "No matching everyday task.");
    return reply(AG.apply([{ op: "remove_routine", id: matches[0].id }]).join(" "));
  }
  const free = bare0.match(/^when am i free(?: (?:on )?(.+))?$/);
  if (free && (!free[1] || calendarDate(free[1], today()))) {
    const date = free[1] ? calendarDate(free[1], today()) : today();
    const from = date === today() ? Math.max(S.profile.dayStart, nowMin()) : S.profile.dayStart;
    const slots = gaps(blocksOf(date), from, S.profile.dayEnd);
    return reply(slots.length ? `Free ${fmtDay(date)}: ${slots.map(b => `${sayTime(b.start)} to ${sayTime(b.end)}`).join("; ")}.` : `No free slots of 20 minutes or more on ${fmtDay(date, true)}.`);
  }
  const pantry = text.match(/^(?:please )?(?:make|generate|build|give me|find)(?: me)? (?:a |some )?recipes? (?:with|using|from) (.+)$/i)
    || text.match(/^(?:what can i (?:cook|make) with|i have these ingredients[: ]+)\s*(.+)$/i);
  if (pantry) {
    ui.pantryInput = pantry[1]; ui.pantryResult = F.pantryMatches(pantry[1]); ui.gymTab = "food"; go("gym");
    const r = ui.pantryResult;
    return reply(r.matches.length ? `Recipe matches: ${r.matches.map(x => `${x.r.t}. Still needed: ${x.missing.map(k => F.ITEMS[k].n).join(", ") || "nothing"}`).join(". ")}. Full steps are in Food.`
      : "I don't have a supported recipe for those ingredients yet. Please use the ingredient names shown in Food.");
  }
  if (/\b(?:today'?s? (?:bible )?verse|verse (?:for today|of the day)|give me (?:a |the )?(?:bible )?verse)\b/.test(bare0)) {
    const v = D.verse(); return reply(`${v.ref}: ${v.text}`, { full: true });
  }
  const dayQuery = bare0.match(/^(?:pg )?(?:what do i have|what is on my (?:timetable|schedule)|read my (?:timetable|schedule))(?: (?:on|for))? (today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/);
  if (dayQuery) {
    const dd = parseSchedule(`Meeting on ${dayQuery[1]} at 12 pm for 1 minute`, { date: today(), today: today(), now: nowMin() })[0]?.date || today();
    const entries = blocksOf(dd).filter(b => !b.skipped);
    return reply(entries.length ? `${addr()}, on ${fmtDay(dd, true)} you have ` + entries.map(b => `${b.title} from ${sayTime(b.start)} to ${sayTime(b.end)}${b.continuation ? ", continuing from yesterday" : ""}${b.done ? ", completed" : ""}`).join("; ") + "."
      : `${addr()}, nothing is scheduled on ${fmtDay(dd, true)}.`, { view: "today", date: dd, full: true });
  }
  if (/^(?:pg )?(?:what(?:'s| is) (?:the )?(?:time|date|day)(?: (?:is it|today|now|right now))?|what day is (?:it|today)|what(?:'s| is) today'?s date)$/.test(bare0)) {
    const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Hong_Kong", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date());
    return reply(`${addr()}, it's ${fmtDay(today(), true)}, ${clock}, Hong Kong time.`);
  }
  const personal = M.capturePersonal(text);
  const remembered = M.personalAnswer(text);
  if (remembered) return reply(remembered);
  if (personal)
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
  // Read the actual saved timetable.
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
      if (block.tid) SC.noteDone(block);
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
  if (/\b(?:build|create|generate|regenerate|rebuild|compile|plan)\b/i.test(text) && /\b(?:weekly|week|timetable)\b/i.test(text)) {
    openWeekPlanner();
    return reply("Tell me the tasks and their minutes in this planner, choose the days and breaks, then press Build timetable. Your existing fixed commitments stay in place.");
  }
  // Add / delete / replace things on the timetable, in plain words
  // Clear timetable declarations are deterministic, not an AI interpretation.
  // "Assignment from 4 to 5" is a work session, not a made-up assignment deadline.
  const timed = parseSchedule(text, { date: d, today: today(), now: nowMin() }).filter(x => x.kind === "event");
  if (!ui.editing && (["schedule", "school_add"].includes(it.type) || /^(?:(?:can|could|would|will) you |please )?(?:add|put|schedule|book|block)\b/i.test(text))
    && !/\b(?:due|deadline|move|shift|replace|instead|remove|delete|change|reschedule|don't|do not|didn't|did not)\b/i.test(text)
    && !/^(?:what|when|why|how|where|should|is|are|do|does|tell me)\b/i.test(text)
    && timed.some(x => x.s != null || x.e != null) && timed.every(x => x.cat !== "other"))
    return scheduleFrom(text, spoken, true);
  if (!ui.editing && !["greet", "hush", "dismiss", "school_add"].includes(it.type) && await localEdit(text, spoken)) return;
  switch (it.type) {
    case "greet": return reply("Try “What’s next?” or “Add gym tomorrow at 5 pm.”");
    case "hush": case "dismiss": case "thanks": return reply("No changes.");
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
      day(dd).blocks = day(dd).blocks.filter(b => b.routine); save(); render();
      undoable(snap, `${fmtDay(dd)} cleared.`);
      return reply(`Cleared the one-off timetable entries for ${fmtDay(dd)}. Your daily routines remain.`, { view: "today", date: dd, spoken });
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
      if (it.type === "done") { b.done = true; if (b.tid) SC.noteDone(b); msg = `Nice work. ${b.title} is done.`; const nx = upcoming(d).find(x => x.id !== b.id); if (nx) msg += ` Next is ${nx.title} at ${sayTime(nx.start)}.`; }
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
    case "ask": case "unknown": { const q = WEB.webQuery(text); return q ? showSearch(q) : unrecognized(text); }
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
      const steps = null;
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
      if (SC.nonAcademic(text)) return scheduleFrom(text, spoken, true);
      const list = SC.parse(text);
      if (!list.length) return scheduleFrom(text, spoken);
      if (!SC.academic(text)) return unrecognized(text);
      const slotItems = parseSchedule(text.replace(/\b(?:due|deadline|submit|hand in)\b.*$/i, ""), { date: today(), today: today(), now: nowMin() });
      const slotEvents = slotItems.filter(i => i.kind === "event");
      if (list.length === 1 && slotEvents.length === 1 && slotEvents[0].s != null && slotEvents[0].e != null && !needsAsk(slotItems)) {
        slotEvents[0].title = list[0].title; slotEvents[0].cat = "study";
        SC.add(list); return reviewSchedule(slotItems, spoken);
      }
      SC.add(list);
      return reply(`Assignment saved: ${list.map(t => t.title).join("; ")}. Pinned on Today.`, { view: "today", date: today() });
    }
    case "school_plan": {
      openWeekPlanner();
      return reply("Which days and study windows should I use, how many minutes does each subject need, and how long should the work sessions and breaks be? The planner is open. Fixed appointments stay in place.");
    }
    case "school_info": return reply(SC.brief(), { view: "school", spoken });
    case "school_done": {
      const t = SC.find(it.target);
      if (!t) { const b = matchBlock(it.target, blocksOf(d)); if (b) { b.done = true; save(); render(); return reply(`Nice work. ${b.title} is done.`); } return reply(`I couldn't find ${it.target} in your assignments.`); }
      SC.finish(t); render();
      if (it.min) return tookReply(t, it.min, spoken);
      ui.pending = { type: "actual", tid: t.id }; ui.lastTask = t.id;
      return reply(`Done: ${t.title}.`, { view: "school", spoken });
    }
    case "school_took": {
      const t = SC.tasks().find(x => x.id === ui.lastTask) || SC.tasks().filter(x => x.done).sort((a, b) => (b.doneOn || "").localeCompare(a.doneOn || "")).at(0);
      return tookReply(t, it.min, spoken);
    }
    case "school_cap": SC.setCap(it.min); return reply(`Study limit: ${sayDur(SC.sch().cap)} per day. No timetable changes.`);
    case "school_window": { const m = parseClock(it.time); SC.setWindow(m, it.we ? "we" : "wk"); return reply(`Study availability starts at ${sayTime(m)}${it.we ? " on weekends" : " on school days"}. No timetable changes.`); }
    case "school_pref": SC.setPref(it.p); return reply(`Study preference: ${it.p}. No timetable changes.`);
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

async function scheduleFrom(text, spoken, deterministic = false) {
  if (!hasCalendarCue(text)) return unrecognized(text);
  const ctx = { date: today(), today: today(), now: nowMin() };
  // "can you add reading at 9pm" -> "reading at 9pm", so the title is just "Reading"
  const asked = text.replace(/^(?:(?:ok(?:ay)?|so|and|also|then|pg|hey|please)[ ,]+)*(?:(?:can|could|would|will) you (?:please )?|please |i want (?:you )?to |i need (?:you )?to |i'd like (?:you )?to |let's |go ahead and )?(?:add|put|schedule|book|pencil in|block out|block off|set up)\s+(?:in |me |a |an |some )?(?=\S)/i, "");
  const clean = (asked || text).replace(/\b(?:to|on|in) (?:my |the )?(?:calendar|timetable|schedule)\b/gi, "").replace(/^(?:my |the )?(?:calendar|timetable|schedule)\s*:\s*/i, "");
  const venue = clean.match(/(?:\bvenue(?: is|:)|\bat (?:the )?)([a-z][^;?!]*?)[.!]?$/i);
  const location = venue && !/^(?:noon|midnight|half past|quarter|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i.test(venue[1].trim()) ? venue[1].trim() : "";
  const items = parseSchedule(location ? clean.slice(0, venue.index) : clean, ctx);
  const events = items.filter(i => i.kind === "event");
  if (!events.length) return unrecognized(text);
  if (location && events.length === 1) events[0].venue = location;
  return reviewSchedule(items, spoken);
}
async function reviewSchedule(items, spoken, replacing = []) {
  const events = items.filter(i => i.kind === "event");
  if (events.some(i => i.invalidRange || i.e != null && i.s != null && i.e <= i.s))
    return reply("Nothing saved. One end time is before its start time. Please give the day and the start and end times with AM or PM.");
  const timed = [], untimed = [];
  for (const i of items) {
    if (i.kind !== "event") { timed.push(i); continue; }
    if (i.s == null || i.ambiguous) {
      if (!S.inbox.some(t => t.date === i.date && activityKey(t.title) === activityKey(i.title))) {
        S.inbox.push({ id: uid(), title: i.title, date: i.date, cat: i.cat, venue: i.venue || "", dur: i.durDefault ? 60 : i.dur || 60 });
        untimed.push(i);
      }
    } else timed.push({ ...i, dur: i.e == null && i.durDefault ? 60 : i.dur });
  }
  if (timed.some(i => i.kind === "event")) await commitSchedule(timed, spoken, replacing);
  if (untimed.length) return reply(`No time yet: ${untimed.map(i => `${i.title} on ${fmtDay(i.date, true)}`).join("; ")}. Set a time from Today.`, { view: "today", date: untimed[0].date });
  if (!timed.some(i => i.kind === "event")) return reply("Already on your timetable, or no activity was found.");
}
async function commitSchedule(items, spoken, replacing = []) {
  const events = items.filter(i => i.kind === "event");
  const dates = [...new Set([...events.map(e => e.date), ...replacing.map(b => b.date)])];
  const snaps = dates.map(snapshot);
  for (const old of replacing) day(old.date).blocks = day(old.date).blocks.filter(b => b.id !== old.id);
  const res = placeItems(items, day, { today: today(), now: nowMin(), dayStart: S.profile.dayStart, dayEnd: S.profile.dayEnd });
  if (res.duplicates.length && !res.added.length && !res.unplaced.length) return reply("Already on your timetable.");
  for (const b of [...res.added, ...res.updated]) if (SC.academic(b.title)) {
    const [task] = SC.add([{ title: b.title, kind: "assignment", due: null, dueMin: null, est: null }]);
    b.tid = task.id;
  }
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
  const date = calendarDate(t, today());
  if (date) return { d: date, x: true };
  if (/\btomorrow\b/.test(t)) return { d: addDays(today(), 1), x: true };
  if (/\b(?:today|tonight|this (?:morning|afternoon|evening))\b/.test(t)) return { d: today(), x: true };
  const w = WD.findIndex(n => new RegExp("\\b" + n + "\\b").test(t));
  if (w >= 0) { const n = new Date(today() + "T12:00").getDay(); return { d: addDays(today(), ((w - n + 7) % 7)), x: true }; }
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
    const hits = name.length > 1 ? namedBlocks(name, cand) : at != null ? cand : [];
    if (hits.length) {
      out.push(...hits.map(b => ({ b, d: dd })));
    }
  }
  if (!every && out.length > 1) throw new Error("Which exact timetable item do you mean: "
    + out.map(({ b, d }) => `${b.title} on ${d}, ${sayTime(b.start)} to ${sayTime(b.end)}`).join("; ") + "? Nothing saved.");
  return { d: out[0]?.d || d, list: out.map(o => o.b), pairs: out };
}
function splitClauses(text) {
  return text.split(/\s*(?:[,;]|\.(?:\s|$)|\band then\b|\bthen\b|\band also\b|\balso\b|\band\b|\bplus\b|\bbut\b|\bafter that\b)\s*/i).map(x => x.trim()).filter(Boolean);
}
function exerciseCmd(c) {
  const add = c.match(/^(?:(?:can|could) you |please )?(?:add|put|include|throw in) (?:in )?(?:a |an |the |some )?(.+?) (?:to|into|in|on) (?:my |the )?(?:(push|pull|legs?|upper|lower|full body) )?(?:day|workout|routine|exercises?|exercise list|gym(?: list| plan| day| routine)?)\b/);
  // Vague asks ("an exercise for my chest") need the AI to choose one
  if (add && /^(?:new |another |one more |good |better )?(?:exercises?|workouts?|moves?|something|one|it|that|this)\b|\bfor (?:my |the )?/i.test(add[1])) return "Tell me which exercise to add, like cable crossovers to push day.";
  if (add) {
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
  const schoolDelete = low.match(/^(?:please )?(?:delete|remove|erase|drop) (.+)$/);
  if (schoolDelete && /\b(?:assignment|homework|essay|report|project|school)\b/.test(schoolDelete[1])) {
    const query = schoolDelete[1], recent = /\b(?:just added|last added|just saved)\b/.test(query);
    const needle = query.replace(/\b(?:the|my|school|assignment|homework|that|i|just|last|added|saved|from)\b/g, " ").replace(/\s+/g, " ").trim();
    const tasks = SC.tasks();
    const candidates = recent ? tasks.filter(t => t.id === ui.lastAddedTask)
      : tasks.filter(t => needle && t.title.toLowerCase().includes(needle));
    if (candidates.length !== 1) {
      return reply(candidates.length > 1 ? `Which School assignment should I remove: ${candidates.map(t => t.title).join("; ")}?`
        : "Which exact School assignment should I remove? Nothing changed.", { spoken }), true;
    }
    SC.remove(candidates[0].id); ui.pending = null;
    return reply(`Remove ${candidates[0].title} from School and its future study sessions.`, { view: "school", spoken }), true;
  }
  const move = low.match(/^(?:please )?(?:move|reschedule|change) (?:the |my )?(.+?) to (.+)$/);
  if (move && !/\b(?:timetable|schedule|everything)\b/.test(move[1])) {
    const tg = targets(move[1]), dest = move[2];
    const date = calendarDate(dest, today());
    const clockText = dest.match(/\b\d{1,2}(?::\d\d)?\s*(?:am|pm)\b|\bat \d{1,2}(?::\d\d)?\b/)?.[0]?.replace(/^at /, "");
    if ((date || clockText) && tg.list.length !== 1)
      return reply(`I couldn't find that exact timetable item. Which title and day should I change? Nothing saved.`, { spoken }), true;
    if (tg.list.length === 1 && (date || clockText)) {
      const b = tg.list[0], start = clockText ? parseClock(clockText) : b.start;
      const lines = AG.apply([{ op: "update_block", id: b.id, date: date || tg.d, start, end: start + b.end - b.start }]);
      return reply(lines.join(" "), { view: "today", date: date || tg.d, spoken }), true;
    }
  }
  // Whole-day moves are atomic and never routed through the add-item parser.
  if (/\b(?:move|shift|transfer|reschedule)\b/.test(low) && /\b(?:schedule|timetable|everything|all (?:the |my )?(?:items|things|blocks))\b/.test(low)) {
    const m = low.match(/\bfrom (today|tomorrow|\d{4}-\d{2}-\d{2}) (?:and |over )?(?:to|into|onto) (today|tomorrow|\d{4}-\d{2}-\d{2})\b/)
      || low.match(/\b(tomorrow)'?s? (?:schedule|timetable|plans?) (?:back )?to (today)\b/);
    if (m) { const lines = AG.apply([{ op: "move_day", from: m[1], to: m[2] }]); return reply(lines.join(" "), { view: "today", date: m[2] === "today" ? today() : addDays(today(), 1), spoken }), true; }
    // Let the AI resolve unstructured wording, without a partial delete/add.
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
  for (const a of adds) {
    ui.quiet = []; ui.editing = true;
    try { await handle(a, false); said.push(...ui.quiet); }
    finally { ui.editing = false; ui.quiet = null; }
    acted = true;
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
  if (inDraft()) return;
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
const catVar = c => `--c:${(CATS[c] || CATS.other).color}`;
const bar = p => `<div class="bar"><i style="width:${p}%"></i></div>`;

function viewToday() {
  const d = ui.date, isT = d === today(), bl = blocksOf(d), n = nowMin();
  const cf = conflicts(bl);
  const cur = isT ? current() : null, nx = isT ? upcoming()[0] : null;
  const due = SC.pending().filter(t => isT || t.due === d);
  let h = due.length ? `<section aria-label="Assignments due"><h2 class="sec"><span>${isT ? "Assignments due" : "Due this day"}</span></h2><div class="card due-list">${due.map(t => {
    const hours = t.due ? (+new Date(`${t.due}T00:00:00+08:00`) + (t.dueMin ?? 1439) * 60000 - Date.now()) / 3600000 : null;
    const status = hours == null ? "" : hours < 0 ? "Overdue" : hours <= 24 ? `Due in ${Math.max(1, Math.ceil(hours))} hr` : `Due in ${Math.ceil(hours / 24)} days`;
    return `<div class="set-row ${hours != null && hours < 0 ? "due-overdue" : hours != null && hours <= 48 ? "due-soon" : ""}"><div><strong>${esc(t.title)}</strong><div class="sub">${esc(t.due ? fmtDay(t.due, true) : "No due date")} · ${t.dueMin == null ? "No due time" : fmtTime(t.dueMin)}${status ? ` · ${status}` : ""}</div></div><button class="btn" data-act="task-done" data-id="${esc(t.id)}" aria-label="Mark ${esc(t.title)} done">Done</button></div>`;
  }).join("")}</div></section>` : "";
  h += `<div class="spread"><div class="eyebrow">${esc(fmtDay(d, true))}</div>
    <div class="day-nav"><button class="icon-btn" data-act="day" data-n="-1" aria-label="Previous day"><svg><use href="#i-left"/></svg></button>
    ${isT ? "" : `<button class="chip" data-act="day" data-n="0">Today</button>`}
    <button class="icon-btn" data-act="day" data-n="1" aria-label="Next day"><svg><use href="#i-right"/></svg></button></div></div>
    <h1 class="title">${isT ? "Today" : esc(fmtDay(d))}</h1>`;
  if (isT) { const v = D.verse(); h += `<details class="daily-verse"><summary>Today's verse · ${esc(v.ref)}</summary><p>${esc(v.text)}</p></details>`; }
  if (cur) {
    const pct = Math.round((n - cur.start) / (cur.end - cur.start) * 100);
    h += `<p class="note" aria-label="Happening now">Now: ${esc(cur.title)}, until ${fmtTime(cur.end)} · ${pct}% through. ${coachLink(cur)}</p>`;
  } else if (nx) {
    h += `<p class="note" aria-label="Up next">Next: ${esc(nx.title)}, ${fmtTime(nx.start)} to ${fmtTime(nx.end)} · in ${fmtDur(nx.start - n)}. ${coachLink(nx)}</p>`;
  }
  const unscheduled = [...untimedTasks(S, d, today(), carrySince()), ...(isT ? carryList() : [])];
  const dueGoals = D.goals().filter(g => g.due && (g.due === d || isT && g.due < d));
  if (dueGoals.length) h += `<h2 class="sec"><span>Goals due</span></h2><div class="card">${dueGoals.map(g => `<button class="btn" data-act="goal-edit" data-id="${esc(g.id)}">${esc(g.text)} · ${esc(goalLabel(g))}</button>`).join("")}</div>`;
  if (isT) {
    const c = D.dailyCanto(d, ui.cantoDay === d ? ui.cantoOffset : 0);
    h += `<section class="card"><h2 class="sec"><span>Cantonese today</span></h2><div lang="zh-HK" class="canto-phrase">${esc(c.zh)}</div><p class="note">${esc(c.jp)} · ${esc(c.en)}</p><div class="row wrap"><button class="btn" data-act="canto-play" data-zh="${esc(c.zh)}">Hear it</button><button class="btn" data-act="canto-skip">Another one</button><button class="btn" data-act="canto-learn" data-id="${c.i}">Learned</button></div></section>`;
  }
  if (unscheduled.length) h += `<h2 class="sec"><span>No time yet</span></h2><div class="card">${unscheduled.map(t => `<div class="set-row"><div>${esc(t.title)}${t.venue ? ` · ${esc(t.venue)}` : ""}${isT && t.date && t.date < d ? `<div class="sub">Carried over from ${esc(fmtDay(t.date, true))}</div>` : ""}</div><div class="row"><button class="btn" data-act="inbox-done" data-id="${esc(t.id)}" aria-label="Mark ${esc(t.title)} done">Done</button><button class="btn" data-act="inbox-time" data-id="${esc(t.id)}" aria-label="Set time for ${esc(t.title)}">Set time</button><button class="btn ghost" data-act="inbox-del" data-id="${esc(t.id)}" aria-label="Remove ${esc(t.title)} from this list">Remove</button></div></div>`).join("")}</div>`;
  h += weeklyTable(d);
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
          <div class="blk-title">${esc(b.title)}${b.fixed ? ' <small class="faint">Fixed</small>' : ""}</div>
          <button class="check" data-act="toggle" data-id="${b.id}" aria-label="${b.done ? "Mark not done" : "Mark done"}"><svg><use href="#i-check"/></svg></button>
          <div class="blk-meta"><span class="tag cat" style="${catVar(b.cat)}">${esc((CATS[b.cat] || CATS.other).label)}</span><span class="tnum">${fmtDur(b.end - b.start)}</span>${b.carriedFrom ? `<span class="tag">Carried over</span>` : ""}${b.venue ? `<span>${esc(b.venue)}</span>` : ""}${cf.has(b.id) ? `<span class="tag warn">Overlaps</span>` : ""}${coachLink(b)}</div>
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
  const routines = (S.routines || []).filter(r => r.start == null && onRoutineDay(r, d) && !S.routineSkip?.[`${r.id}:${d}`]);
  h += `<h2 class="sec"><span>Everyday tasks</span><button class="btn sm ghost" data-act="routines-open">Edit routines</button></h2>${routines.length ? `<div class="card"><p class="note">Checking one off only completes it for this day.</p>${routines.map(r => {
    const done = S.routineDone?.[`${r.id}:${d}`];
    return `<div class="set-row"><span>${esc(r.title)}</span><button class="btn sm" data-act="routine-check" data-id="${esc(r.id)}" aria-pressed="${!!done}">${done ? "Done today" : "Mark done"}</button></div>`;
  }).join("")}</div>` : ""}`;
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
    ${D.goals().filter(g => dates.includes(g.due)).map(g => `<button class="btn sm" data-act="goal-edit" data-id="${esc(g.id)}">Goal: ${esc(g.text)} · ${esc(fmtDay(g.due))}</button>`).join("")}
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
    <label class="field"><span>Tasks and total minutes, one per line</span><textarea class="input" name="tasks" rows="5" placeholder="History revision, 90, 1&#10;Practice bass, 30, 3" required>${esc((previous?.tasks || []).map(t => `${t.title}, ${t.minutes}, ${t.priority || 2}${t.due ? `, ${t.due}` : ""}`).join("\n"))}</textarea></label>
    <p class="note">Format: activity, minutes, optional priority (1 must, 2 should, 3 if time), optional date (YYYY-MM-DD). Minutes are for the whole week.</p>
    <label class="alarm-check"><input type="checkbox" name="partial" ${previous?.allowPartial ? "checked" : ""}>Fit what can fit and list unplaced work</label>
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
  h += pantryBuilder();
  h += ms.map(m => recipeCard(m.r, m.when)).join("");
  h += `<p class="note">These meals give about ${F.sum(ms, "p")} g of protein and ${F.sum(ms, "f")} g of fiber.</p>`;
  h += `<h2 class="sec"><span>Know this</span></h2><div class="card list tips">${F.TIPS.map(t => `<details class="tip" ${ui.openTip === t.k ? "open" : ""}><summary>${esc(t.t)}</summary><p>${esc(t.d())}</p><span class="faint tip-src">${esc(t.src)}</span></details>`).join("")}</div>`;
  const inToday = ms.some(m => m.r.k === ui.openRec);
  h += `<details class="fold" ${ui.openRec && !inToday ? "open" : ""}><summary>All recipes</summary>${F.RECIPES.map(r => recipeCard(r)).join("")}</details>`;
  return h;
}
function pantryBuilder() {
  const result = ui.pantryResult;
  return `<section class="card pantry-builder" aria-label="Recipe generator"><h2>What do you have?</h2>
    <p class="note">Type your ingredients. PG matches recipes and tells you what is missing. Your saved food exclusions are respected.</p>
    <form data-form="pantry"><label class="field"><span>Ingredients, separated by commas</span><textarea class="input" name="ingredients" rows="2" placeholder="eggs, tomato, tofu, rice" required>${esc(ui.pantryInput || "")}</textarea></label>
    <button class="btn primary" type="submit">Generate recipes</button></form>
    ${result ? `<div role="status"><p class="note">${result.have.length ? "Recognised: " + result.have.map(k => esc(F.ITEMS[k].n)).join(", ") : "No supported ingredients found."}${result.unknown.length ? " Not recognised: " + result.unknown.map(esc).join(", ") + "." : ""}</p>
      ${result.matches.length ? result.matches.map(x => `<div class="pantry-match"><h3>${esc(x.r.t)}</h3><p class="note">You have: ${x.available.map(k => esc(F.ITEMS[k].n)).join(", ")}.<br>Still needed: ${x.missing.map(k => esc(F.ITEMS[k].n)).join(", ") || "nothing"}.</p>
      ${recipeCard(F.recipe(x.r.k))}</div>`).join("") : "<p class='note'>No recipe match yet. Try ingredients such as chicken, rice, eggs, tomato, tofu or broccoli.</p>"}</div>` : ""}</section>`;
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
  if (ui.folder === "about") h += `<h2 class="sec"><span>Learned things about PraiseGod</span></h2><p class="note">PG can save direct statements like “I prefer studying at night” and show progress from your saved records. It uses fixed rules, not AI. Say “remember that…” to preview a note before saving it.</p>`;
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
      const scheduled = ss.reduce((n, b) => n + b.end - b.start, 0);
      const completed = ss.filter(b => b.done).reduce((n, b) => n + b.end - b.start, 0);
      const pct = Math.min(100, Math.round(completed / Math.max(1, scheduled) * 100));
      return `<div class="task"><div class="task-main"><div class="lbl">${esc(t.title)}</div>
        <div class="sub">${esc(dueLbl(t))} · ${scheduled ? fmtDur(scheduled) + " scheduled" : "No study time scheduled"}${ss.length ? ` · ${dn}/${ss.length} sessions` : ""}</div>${bar(pct)}</div>
        <div class="row"><button class="btn sm" data-act="task-done" data-id="${t.id}">Done</button><button class="icon-btn" data-act="task-del" data-id="${t.id}" aria-label="Remove ${esc(t.title)}"><svg><use href="#i-x"/></svg></button></div></div>`;
    }).join("") + `</div>`;
  } else h += `<p class="note">Tell PG what's due, like: I have a math test next Tuesday and a biology report due the 20th.</p>`;
  const done = SC.tasks().filter(t => t.done).slice(-3).reverse();
  if (done.length) h += `<h2 class="sec"><span>Finished</span></h2><div class="card list">${done.map(t => `<div class="task done"><div class="lbl">${esc(t.title)}</div></div>`).join("")}</div>`;
  h += `<p class="note">Assignments stay here until you mark them done. Tell PG the name and due date. Study time is only a plan, not a change to your deadline.</p>`;
  h += `<details class="fold"><summary>How PG plans</summary><div class="card list tips">${SC.RULES.map(x => `<div class="rule"><b>${esc(x.t)}</b><p>${esc(x.d)}</p><a class="faint tip-src" href="${esc(x.url)}" target="_blank" rel="noopener">Source</a></div>`).join("")}</div></details>`;
  return h;
}
// ================= PG Cloud: sync and passcode =================
const ago = t => { if (!t) return "not yet"; const s = Math.round((Date.now() - t) / 1000); return s < 60 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : fmtTime(new Date(t).getHours() * 60 + new Date(t).getMinutes()); };
function cloudSteps(open) {
  return `<details class="fold" ${open ? "open" : ""}><summary>Set up PG Cloud (about 3 minutes, free)</summary>
    <ol class="steps">
      <li>In Cloudflare, open <a href="https://dash.cloudflare.com/?to=/:account/workers/d1" target="_blank" rel="noopener">D1 SQL database</a>. Press Create Database, name it <b>pg</b>, and press Create.</li>
      <li>Open <a href="https://dash.cloudflare.com/?to=/:account/workers-and-pages/create" target="_blank" rel="noopener">Workers and Pages</a>. Press Create application, then Start with Hello World. Name it <b>pg-cloud</b> and press Deploy.</li>
      <li>Press Edit code. Clear everything in worker.js, paste the PG Cloud code, and press Deploy.</li>
      <li>In the Worker's Bindings tab, add a <b>D1 database</b> named <b>DB</b> and pick <b>pg</b>. No AI binding is needed.</li>
      <li>Copy the Worker's address (it ends in .workers.dev) into PG Cloud address here. Type your passcode and press Connect. The first device you connect sets the passcode.</li>
    </ol>
    <a class="btn" href="https://github.com/PraiseGod07/pg/blob/master/worker/pg-worker.js" target="_blank" rel="noopener">Open PG Cloud code</a></details>`;
}
function cloudSettings() {
  if (SY.on()) return `<h2 class="sec"><span>PG Cloud</span></h2><div class="card">
    <div class="ai-status ${S.dev.cloud?.error ? "err" : "ok"}" role="status"><i></i><span data-sync-status>${esc(SY.status())} · last synced ${esc(ago(SY.last()))}</span></div>
    <p class="note">Assignments, memories, workouts, schedules and daily reminders are saved locally and merged with PG Cloud. Connect both devices to the same PG Cloud. ${S.dev.cloud?.safe ? "" : "Update PG Cloud for protected simultaneous saves."}</p>
    <div class="row"><button class="btn" data-act="cloud-sync">Sync now</button><button class="btn" data-act="cloud-others">Sign out other devices</button><button class="btn ghost" data-act="cloud-off">Stop syncing here</button></div>${cloudSteps(false)}</div>`;
  const st = ui.cloudStatus;
  return `<h2 class="sec"><span>PG Cloud</span></h2><div class="card">
    <p class="note" style="margin-top:0">Unlock and sync your devices using your Cloudflare Worker. No AI service or keys are required.</p>
    ${st ? `<div class="ai-status ${st.err ? "err" : ""}" role="status"><i></i><span>${esc(st.text)}</span></div>` : ""}
    <form class="ai-form" data-form="cloud">
      <label class="field"><span>PG Cloud address</span><input class="input" name="url" value="${esc(SY.url())}" placeholder="https://pg-cloud.yourname.workers.dev" autocomplete="off" spellcheck="false" autocapitalize="off" inputmode="url"></label>
      <label class="field"><span>Passcode</span><input class="input" name="code" type="password" inputmode="numeric" autocomplete="off" placeholder="Your passcode"></label>
      <div class="row"><button class="btn primary" type="submit">Connect</button></div>
    </form>${cloudSteps(!SY.url())}</div>`;
}
async function connectCloud(address, code, done) {
  try {
    const r = await SY.unlock(address, code);
    afterSync(); done?.(null, r);
    toast(r.adopted ? "Connected. This device now has your PG data." : r.first ? "PG Cloud is set up. Your passcode is saved." : "Connected. This device's data is now in PG Cloud.");
  } catch (e) { done?.(e); }
}
function afterSync() { applyAppearance(S.ui); C.syncCustom(); BS.bass(); B.bible(); M.notes(); LN.tracks(); if (!ui.pinDate) ui.date = today(); initCarryover(); paintLock(); paintChat(); render(); }
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
  busy: () => ui.running || inDraft() || voice.mode !== "off" || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || ""),
  changed: () => afterSync(),
  revoked: () => { voice.kill?.(); afterSync(); }
});
function viewSettings() {
  const vs = voice.voices();
  const tm = m => pad(Math.floor(m / 60)) + ":" + pad(m % 60);
  const sw = (act, on, label, dis) => `<label class="switch"><input type="checkbox" data-act="${act}" ${on ? "checked" : ""} ${dis ? "disabled" : ""} aria-label="${label}"><i></i></label>`;
  return `<h1 class="title">More <span class="faint" style="font-size:var(--text-xs);font-family:inherit;font-weight:400">v${PG_VERSION}</span></h1>
  <div class="tiles"><button class="tile wide" data-act="about-folder" style="${catVar("learn")}"><span class="eyebrow">Learned things about PraiseGod</span><b>${M.facts().length} thing${M.facts().length === 1 ? "" : "s"} PG knows about you</b></button><button class="tile" data-view="notes" style="${catVar("learn")}"><span class="eyebrow">Notes</span><b>${M.notes().length} saved</b></button><button class="tile" data-view="school" style="${catVar("study")}"><span class="eyebrow">School</span><b>${SC.pending().length} due</b></button><button class="tile" data-act="goals-open" style="${catVar("gym")}"><span class="eyebrow">Goals</span><b>${D.goals().length ? D.goals().length + " goal" + (D.goals().length > 1 ? "s" : "") : "Add your goals"}</b></button><button class="tile" data-act="canto-open" style="${catVar("social")}"><span class="eyebrow">Cantonese</span><b>${D.learned().length} learned</b></button></div>
  ${cloudSettings()}
  ${alarmSettings()}${appearanceSettings()}
  <h2 class="sec"><span>Voice setup</span></h2><div class="card">
    <div class="set-row"><div class="lbl">Send automatically after recording</div>${sw("autosend", S.voice.autoSend, "Send automatically after recording")}</div>
    <div class="set-row"><div class="lbl">Timetable notifications</div>${sw("alerts", S.voice.alerts, "Timetable notifications")}</div>
    <div class="set-row"><div class="lbl">Speak reminders</div>${sw("alarm-speech", S.voice.alarmSpeech, "Speak reminders")}</div>
    <div class="set-row"><div class="lbl">Heads-up</div><select class="input" style="width:auto" data-act="heads" aria-label="Heads-up minutes">${[0, 5, 10, 15].map(m => `<option value="${m}" ${S.voice.heads === m ? "selected" : ""}>${m ? m + " min before" : "Off"}</option>`).join("")}</select></div>
    <div class="set-row"><div class="lbl">Keep screen awake</div>${sw("awake", S.voice.keepAwake, "Keep screen awake")}</div>
    <div class="grid2" style="margin-top:var(--space-3)">
      <label class="field"><span>Voice on this device</span><select class="input" data-act="voice"><option value="">Automatic (any available voice)</option>${vs.map(v => `<option value="${esc(v.voiceURI)}" ${(voice.voiceURI || voice.voice?.voiceURI) === v.voiceURI ? "selected" : ""}>${esc(v.name)}${isNatural(v) ? " (natural)" : ""}</option>`).join("")}</select></label>
      <label class="field"><span>Speed</span><select class="input" data-act="rate">${[0.9, 1, 1.1, 1.2].map(r => `<option value="${r}" ${S.voice.rate === r ? "selected" : ""}>${r}×</option>`).join("")}</select></label></div>
    <p class="faint" role="status">${voice.voice ? `Free device voice: ${esc(voice.voice.name)}.` : "Using your browser's default voice while the voice list loads."} Any available voice is allowed. This choice stays on this device.</p>
    <p class="faint">Tap to record, tap again to stop, then check the transcript and send. PG does not listen when closed or locked. Your browser may use its own online speech service. Typing works offline.</p>
    <details><summary>Phone voice help</summary><p class="faint">If audio is quiet, check your phone volume, silent mode and Bluetooth output. Use Test selected voice here. You can also choose or install voices in your phone's speech settings. No paid voice service is required. <a href="https://support.google.com/accessibility/android/answer/6006983?hl=en" target="_blank" rel="noopener">Android speech settings</a>; <a href="https://support.apple.com/en-gb/guide/iphone/iph96b214f0/ios" target="_blank" rel="noopener">Apple speech settings</a>.</p></details>
    <button class="btn sm" data-act="refresh-voices">Refresh voices</button>
  </div>
  <h2 class="sec"><span>You</span></h2><div class="card"><div class="grid3">
    <label class="field"><span>PG calls you</span><input class="input" data-act="address" value="${esc(addr())}"></label>
    <label class="field"><span>Day starts</span><input class="input" type="time" data-act="daystart" value="${tm(S.profile.dayStart)}"></label>
    <label class="field"><span>Day ends</span><input class="input" type="time" data-act="dayend" value="${tm(S.profile.dayEnd)}"></label></div>
    <div class="grid2"><label class="field"><span>Gym split</span><select class="input" data-act="split">${Object.entries(SPLITS).map(([k, v]) => `<option value="${k}" ${S.gym.split === k ? "selected" : ""}>${v.label}</option>`).join("")}</select></label>
    <label class="field"><span>Bible version</span><select class="input" data-act="version">${["NKJV", "KJV", "NIV", "ESV", "NLT", "AMP"].map(v => `<option ${B.bible().version === v ? "selected" : ""}>${v}</option>`).join("")}</select></label></div></div>
  <h2 class="sec"><span>Data</span></h2><div class="card"><div class="row">
    <button class="btn" data-act="collections">Collections</button><button class="btn" data-act="routines-open">Everyday tasks</button><button class="btn" data-act="handbook">What can I say?</button><button class="btn" data-act="missed-export">Export missed phrases</button>
    <button class="btn sm" data-act="backup">Back up</button><button class="btn sm" data-act="restore">Restore</button><button class="btn sm" data-act="clear-chat">Clear chat</button><button class="btn sm danger" data-act="reset">Erase all</button>
    <input type="file" id="restoreFile" accept="application/json,.json" hidden></div>
    <p class="note">Web search sends the query to PG Cloud and search providers. It does not send your timetable, notes, goals or collections.</p>
    <p class="note">Install: Safari › Share › Add to Home Screen, or Chrome › Install app.</p></div>
  <h2 class="sec"><span>My phrases</span></h2><div class="card">
    ${S.phrases.map(p => `<div class="set-row"><span>${esc(p.from)} → ${esc(p.to)}</span><button class="btn" data-act="phrase-del" data-id="${esc(p.id)}" aria-label="Remove phrase ${esc(p.from)}">Remove</button></div>`).join("")}
    <form data-form="phrase" class="field"><label class="field"><span>When I say</span><input class="input" name="from" required></label><label class="field"><span>Run this command</span><input class="input" name="to" required></label><button class="btn primary">Save phrase</button></form>
  </div>`;
}

// ================= Edit sheet =================
function openEditor(id) {
  const d = ui.date;
  const b = id ? day(d).blocks.find(x => x.id === id) : null;
  if (b?.routine && S.routines.some(r => r.id === b.routine && !r.disabled)) return openRoutines(b.routine);
  const n = nowMin();
  const start = b ? b.start : (firstGap(day(d).blocks, d === today() ? Math.ceil(n / 15) * 15 : S.profile.dayStart, 60) ?? 540);
  const end = b ? b.end : start + 60;
  const tm = m => pad(Math.floor(m / 60) % 24) + ":" + pad(m % 60);
  const sh = $("#sheet");
  sh.innerHTML = `<form method="dialog" data-form="block" data-id="${b ? b.id : ""}"><h3>${b ? "Edit" : "New"}</h3>
    <p class="note">${esc(fmtDay(d, true))}</p>
    <label class="field"><span>Title</span><input class="input" name="title" value="${esc(b ? b.title : "")}" required></label>
    <div class="grid3"><label class="field"><span>Start</span><input class="input" type="time" name="start" value="${tm(start)}" required></label>
    <label class="field"><span>End</span><input class="input" type="time" name="end" value="${tm(Math.min(end, 1439))}" required></label>
    <label class="field"><span>Type</span><select class="input" name="cat">${Object.entries(CATS).map(([k, v]) => `<option value="${k}" ${(b ? b.cat : "other") === k ? "selected" : ""}>${v.label}</option>`).join("")}</select></label></div>
    <div class="grid2"><label class="field">Venue<input class="input" name="venue" value="${esc(b?.venue || "")}"></label><label class="field">Priority<select class="input" name="priority">${["Must","Should","If time"].map((name,i) => `<option value="${i + 1}" ${(b?.priority || 2) === i + 1 ? "selected" : ""}>${name}</option>`).join("")}</select></label></div><label class="alarm-check"><input type="checkbox" name="fixed" ${b?.fixed !== false ? "checked" : ""}>Keep this time fixed</label>
    <div class="sheet-actions">${b ? `<button type="button" class="btn danger" data-act="del-block" data-id="${b.id}">Delete</button>` : "<span></span>"}
    <span class="row"><button type="button" class="btn ghost" data-act="close-sheet">Cancel</button><button class="btn primary" value="save">Save</button></span></div></form>`;
  sh.showModal();
  setTimeout(() => sh.querySelector("input[name=title]").focus(), 30);
}
function openRoutines(id = "", confirmDelete = false) {
  const sh = $("#sheet"), list = S.routines.filter(r => !r.disabled), r = list.find(r => r.id === id), timed = r?.start != null;
  const label = r => !r.days?.length || r.days.length === 7 ? "Every day" : r.days.map(d => WEEKDAYS[d].slice(0,3)).join(", ");
  sh.innerHTML = `<h3>Everyday tasks</h3>${confirmDelete && r ? `<p>Remove the repeating task ${esc(r.title)}? Past entries are kept.</p><div class="row"><button class="btn danger" data-act="routines-delete" data-id="${esc(r.id)}">Yes, remove</button><button class="btn" data-act="routines-open">Cancel</button></div>` : `
    ${list.map(x => `<div class="set-row"><span>${esc(x.title)}<span class="sub">${label(x)}${x.start == null ? "" : ` · ${fmtTime(x.start)} to ${fmtTime(x.start + x.minutes)}`}</span></span><button class="btn sm" data-act="routines-open" data-id="${esc(x.id)}" aria-label="Edit ${esc(x.title)}">Edit</button></div>`).join("")}
    <form class="field" data-form="routine-edit" data-id="${esc(r?.id || "")}"><h4>${r ? "Edit routine" : "Add routine"}</h4><label class="field">Activity<input class="input" name="titleText" maxlength="100" value="${esc(r?.title || "")}" required></label>
    <div class="grid2"><label class="field">Start (optional)<input class="input" type="time" name="start" value="${timed ? timeValue(r.start) : ""}"></label><label class="field">End (optional)<input class="input" type="time" name="end" value="${timed ? timeValue(Math.min(1439, r.start + r.minutes)) : ""}"></label></div>
    <label class="field">Venue<input class="input" name="venue" maxlength="120" value="${esc(r?.venue || "")}"></label>
    <fieldset><legend>Repeat on</legend>${[1,2,3,4,5,6,0].map(i => `<label class="alarm-check"><input type="checkbox" name="weekday" value="${i}" ${(!r?.days?.length || r.days.includes(i)) ? "checked" : ""}>${WEEKDAYS[i]}</label>`).join("")}</fieldset>
    <div class="row wrap"><button class="btn primary">${r ? "Save routine" : "Add routine"}</button>${r ? `<button class="btn danger" type="button" data-act="routines-confirm" data-id="${esc(r.id)}">Remove routine</button><button class="btn" type="button" data-act="routines-open">New routine</button>` : ""}</div></form><button class="btn" data-act="close-sheet">Close</button>`}`;
  if (!sh.open) sh.showModal();
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
    case "alarms-open": openReminders(); break;
    case "review-open": openReview(today()); break;
    case "review-date": openReview(el.dataset.date); break;
    case "review-action": reviewAction(el.dataset.date, id, el.dataset.kind, el.dataset.choice); break;
    case "alarm-test": unlockSound().then(() => openRing({ id: "test", title: "Test alarm", text: "This is how a PG alarm sounds.", kind: "test", at: Date.now() })); break;
    case "alarm-enable-sound": unlockSound().then(ok => toast(ok ? "Alarm sound is ready on this device." : "Sound is unavailable here; calendar reminders still work.")); break;
    case "alarm-notifications": {
      if (!("Notification" in window)) { toast("Notifications are unavailable here."); break; }
      Notification.requestPermission().then(p => toast(p === "granted" ? "Notifications allowed." : "Notifications aren’t enabled. Check browser settings.")).catch(() => toast("Could not enable notifications."));
      break;
    }
    case "ring-action": settleRing(el.dataset.choice); break;
    case "alarm-calendar": {
      const t = el.dataset.kind === "assignment" ? SC.tasks().find(x => x.id === id) : S.reminders.find(x => x.id === id);
      if (!t) break;
      const at = el.dataset.kind === "assignment" && t.due && t.dueMin != null ? hkAt(t.due, t.dueMin) : t.at;
      exportCalendar({ id, title: t.title || t.text, text: t.text || t.title, at, leads: el.dataset.kind === "assignment" ? S.alarms.assignmentLeads : [0] });
      break;
    }
    case "alarm-remove": {
      const t = S.reminders.find(x => x.id === id);
      if (t) { S.reminders = S.reminders.filter(x => x !== t); save(); openReminders(); toast("Reminder removed.", "Undo", () => { S.reminders.push(t); save(); openReminders(); }); }
      break;
    }
    case "handbook": openHandbook(); break;
    case "try-phrase": {
      const t = commandText(HR.clean(el.dataset.text)), it = intent(t);
      const items = hasCalendarCue(t) && /^(?:add|put|schedule|book)\b/i.test(t)
        ? parseSchedule(t, { date: today(), today: today(), now: nowMin() }).filter(i => i.kind === "event") : [];
      const demo = $("p[data-phrase-demo]");
      if (demo) { demo.textContent = items.length ? items.map(i => `${i.title}: ${i.date}${i.s == null ? ", no time yet" : `, ${fmtTime(i.s)}`}`).join("; ") + ". Nothing saved."
        : `Preview: ${it.type === "unknown" ? "Look for a matching command" : it.type.replaceAll("_", " ")}. Nothing saved.`; demo.scrollIntoView({ block: "nearest" }); }
      break;
    }
    case "phrase-del": S.phrases = S.phrases.filter(p => p.id !== id); save(); render(); break;
    case "collections": openCollections(id); break;
    case "collection-delete": $("#sheet").close(); openAssistant(); run(el.dataset.say); break;
    case "collection-tick":
    case "collection-item-edit": {
      const c = S.collections.find(x => x.id === el.dataset.group), item = c?.items.find(x => x.id === id);
      if (!item) break;
      if (a === "collection-tick") { item.done = !item.done; save(); openCollections(c.id); break; }
      $("#sheet").innerHTML = `<form data-form="collection-item" data-id="${esc(id)}" data-group="${esc(c.id)}"><h3>Edit item</h3><textarea class="input" name="entry" required aria-label="Item text">${esc(item.text)}</textarea><div class="grid2"><label class="field">Date<input class="input" type="date" name="date" value="${esc(item.date || "")}"></label><label class="field">Reminder time (optional)<input class="input" type="time" name="reminder" value="${item.remindMin == null ? "" : timeValue(item.remindMin)}"></label><label class="field">Amount<input class="input" type="number" step="any" name="amount" value="${esc(item.amount ?? "")}"></label><label class="field">Unit<input class="input" name="unit" maxlength="25" value="${esc(item.unit || "")}"></label></div><div class="row wrap"><button class="btn danger" name="choice" value="remove">Remove item</button><button class="btn primary" name="choice" value="save">Save item</button><button type="button" class="btn" data-act="collections" data-id="${esc(c.id)}">Cancel</button></div></form>`;
      break;
    }
    case "fallback-note":
    case "fallback-category": {
      const sh = $("#sheet"), cat = a === "fallback-category";
      sh.innerHTML = `<form data-form="${cat ? "collection" : "note-preview"}" data-folder="${esc(el.dataset.folder || "")}"><h3>${cat ? "Save to a category" : "Save as a note"}</h3>${cat ? `<label class="field"><span>Category name</span><input class="input" name="group" value="${esc(el.dataset.text.trim().split(/\s+/).slice(0, 4).join(" "))}" required></label>` : ""}<label class="field"><span>Text to save</span><textarea class="input" name="entry" required>${esc(el.dataset.text)}</textarea></label><div class="row wrap"><button class="btn primary">Save</button><button type="button" class="btn" data-act="close-sheet">Cancel</button></div></form>`;
      if (!sh.open) sh.showModal();
      break;
    }
    case "fallback-web": showSearch(el.dataset.text); break;
    case "wallpaper-remove": removeWallpaper().then(() => toast("Wallpaper removed.")).catch(() => toast("Wallpaper could not be removed.")); break;
    case "missed-export": {
      const phrases = S.dev.missed || [];
      if (!phrases.length) { toast("No missed phrases to export."); break; }
      const url = URL.createObjectURL(new Blob([phrases.join("\n")], { type: "text/plain" }));
      const a = document.createElement("a"); a.href = url; a.download = "pg-missed-phrases.txt"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); break;
    }
    case "undo-action": undoAction(id); break;
    case "edit-action": {
      const p = (S.dev.actions || []).find(x => x.id === id);
      if (!p) break;
      const targets = p.changes.filter(c => c.path.at(-1) === "blocks").flatMap(c =>
        (c.after || []).filter(b => !(c.before || []).some(a => JSON.stringify(a) === JSON.stringify(b)))
          .filter(b => day(c.path[1]).blocks.some(x => x.id === b.id)).map(b => ({ id: b.id, date: c.path[1] })));
      if (targets.length === 1) { go("today", targets[0].date); openEditor(targets[0].id); }
      else { $("#ask").value = p.original; openAssistant(); $("#ask").focus(); }
      break;
    }
    case "day": ui.date = el.dataset.n === "0" ? today() : addDays(ui.date, +el.dataset.n); ui.pinDate = ui.date !== today(); render(); break;
    case "week": ui.date = addDays(ui.date, +el.dataset.n * 7); ui.pinDate = ui.date !== today(); render(); break;
    case "week-day": go("today", el.dataset.date); break;
    case "week-edit": ui.date = el.dataset.date; ui.pinDate = ui.date !== today(); render(); openEditor(id); break;
    case "week-plan": openWeekPlanner(); break;
    case "add": openEditor(null); break;
    case "edit": if (e.target.closest(".check,.tag.link")) return; openEditor(id); break;
    case "toggle": { e.stopPropagation(); const b = day(d).blocks.find(x => x.id === id); if (b) { b.done = !b.done; if (b.done && b.tid) SC.noteDone(b); save(); render(); } break; }
    case "task-done": { const t = SC.tasks().find(x => x.id === id); if (t) { SC.finish(t); render(); toast(`Done: ${t.title}.`); } break; }
    case "task-del": confirmSheet("Remove this assignment?", "Its study sessions come off your timetable.", "Remove", () => { SC.remove(id); render(); }); break;
    case "replan": openWeekPlanner(); break;
    case "go": e.stopPropagation(); go(el.dataset.v); break;
    case "close-sheet": $("#sheet").close(); break;
    case "goals-open": openGoals(); break;
    case "routines-open": openRoutines(id); break;
    case "routines-confirm": openRoutines(id, true); break;
    case "routines-delete": {
      const r = S.routines.find(r => r.id === id);
      if (!r) break;
      archiveDays(S, today());
      clearFutureInstances(S, id, today(), nowMin()); S.routines = S.routines.filter(x => x !== r);
      save(); render(); openRoutines(); toast(`Removed ${r.title}.`, "Undo", () => { S.routines.push(r); save(); render(); openRoutines(); }); break;
    }
    case "goal-edit": openGoals(el.dataset.id); break;
    case "goal-status": changeGoalStatus(el.dataset.id, el.dataset.status); openGoals(); render(); break;
    case "canto-open": openCanto(); break;
    case "canto-play": sayCanto(el.dataset.zh); break;
    case "canto-learn":
    case "canto-skip": {
      if (a === "canto-learn") D.markCanto(+id);
      const date = today();
      ui.cantoOffset = (ui.cantoDay === date ? ui.cantoOffset : 0) + 1;
      ui.cantoDay = date; render(); break;
    }
    case "canto-more": D.teachDaily(); openCanto(); render(); break;
    case "routine-check": {
      const key = `${id}:${ui.date || today()}`;
      S.routineDone ||= {}; S.routineDone[key] = !S.routineDone[key]; save(); render(); break;
    }
    case "del-block": { const snap = snapshot(d); day(d).blocks = day(d).blocks.filter(x => x.id !== id); save(); $("#sheet").close(); render(); undoable(snap, "Deleted."); break; }
    case "fit": {
      const t = S.inbox.find(x => x.id === id); if (!t) break;
      const n = nowMin(); const from = d === today() ? Math.max(S.profile.dayStart, Math.ceil(n / 15) * 15) : S.profile.dayStart;
      const s = firstGap(day(d).blocks, from, t.dur || 30, 1440);
      if (s == null) { toast("No free slot left that day."); break; }
      day(d).blocks.push({ id: uid(), title: t.title, cat: t.cat, start: s, end: s + (t.dur || 30), flex: true, done: false, date: d, src: "inbox" });
      S.inbox = S.inbox.filter(x => x.id !== id); save(); render(); toast(`${t.title} at ${fmtTime(s)}.`); break;
    }
    case "inbox-done":
    case "inbox-del": {
      const t = getUntimed(id);
      if (!t) break;
      const done = a === "inbox-done";
      if (t.source) {
        t.source.carryResolved = true;
        if (done) { t.source.done = true; t.source.completedOn = today(); }
      } else if (done) { t.done = true; t.completedOn = today(); }
      else S.inbox = S.inbox.filter(x => x !== t);
      save(); render(); toast(`${done ? "Done" : "Removed"}: ${t.title}.`); break;
    }
    case "inbox-time": {
      const t = getUntimed(id);
      if (t) {
        const sh = $("#sheet");
        sh.innerHTML = `<form data-form="inbox-time" data-id="${esc(id)}"><h3>${esc(t.title)}</h3><label class="field"><span>Start time</span><input class="input" type="time" name="time" required></label><div class="sheet-actions"><button type="button" class="btn" data-act="close-sheet">Cancel</button><button class="btn primary">Save time</button></div></form>`;
        sh.showModal();
      } break;
    }
    case "ex": ui.openEx = ui.openEx === el.dataset.k ? null : el.dataset.k; render(); break;
    case "play": ui.playing.add(el.dataset.vid); render(); break;
    case "set": { const p = gymProgress(); const k = el.dataset.k, i = +el.dataset.i; p.sets[k] = p.sets[k] || []; p.sets[k][i] = !p.sets[k][i]; save(); render(); break; }
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
    case "bass-done": completeCoach("bass"); break;
    case "bass-repeat": BS.logTry(); reply(`No problem. We'll stay on ${BS.lesson().t.toLowerCase()} next time.`); break;
    case "speak-bass": reply(BS.brief(minsFor("bass", 30))); break;
    case "bass-jump": BS.jump(+el.dataset.i); renameCoachBlocks(today()); render(); toast(`Lesson ${+el.dataset.i + 1} is up next.`); break;
    case "bible-done": completeCoach("bible"); break;
    case "note-del": M.remove(id); render(); break;
    case "folder": ui.folder = el.dataset.k; render(); break;
    case "cloud-sync": SY.push().then(ok => { render(); toast(ok ? "Saved to PG Cloud." : SY.status()); }); break;
    case "cloud-others": if (confirm("Sign out every other device? They'll need the passcode again, and their copy of PG is cleared.")) SY.signOutOthers().then(() => toast("Other devices are signed out."), e => toast(e.message)); break;
    case "cloud-off": SY.disconnect(); save(true); render(); toast("This device stopped syncing."); break;
    case "about-folder": ui.folder = "about"; ui.q = ""; go("notes"); break;
    case "learn-done": { const tr = LN.tracks().find(t => t.id === id); const r = LN.complete(tr); render(); if (r) { toast(r.next ? `Next: ${r.next.t}` : `${tr.topic} complete.`); } break; }
    case "learn-del": confirmSheet("Remove this learning plan?", "", "Remove", () => { LN.remove(id); render(); }); break;
    case "song-del": S.band.songs = S.band.songs.filter(s => s.id !== id); save(); render(); break;
    case "refresh-voices": voice.pickVoice(); render(); break;
    case "backup": {
      const a2 = document.createElement("a");
      a2.href = URL.createObjectURL(new Blob([JSON.stringify(SY.syncContent(S), null, 1)], { type: "application/json" }));
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
  if (a === "wallpaper") {
    if (el.files[0]) setWallpaper(el.files[0]).then(() => toast("Wallpaper saved on this device.")).catch(() => toast("Could not open that image. Try a JPEG or PNG."));
    el.value = ""; return;
  }
  if (!a) { if (el.id === "restoreFile") restoreFrom(el.files[0]); return; }
  const v = el.value;
  switch (a) {
    case "autosend": S.voice.autoSend = el.checked; save(); break;
    case "alarm-speech": S.voice.alarmSpeech = el.checked; save(); break;
    case "alerts": S.voice.alerts = el.checked; save(); if (el.checked && "Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {}); break;
    case "heads": S.voice.heads = +v; save(); break;
    case "awake": S.voice.keepAwake = el.checked; save(); keepAwake(); break;
    case "voice": S.voice.voiceURI = v; voice.voiceURI = v; voice.pickVoice(); save(); break;
    case "rate": S.voice.rate = +v; voice.rate = +v; save(); break;
    case "address": S.profile.address = v.trim() || "sir"; save(); break;
    case "daystart": { const [h, m] = v.split(":").map(Number); S.profile.dayStart = h * 60 + m; save(); break; }
    case "dayend": { const [h, m] = v.split(":").map(Number); S.profile.dayEnd = h * 60 + m; save(); break; }
    case "split": S.gym.split = v; S.gym.splitChosen = true; S.gym.idx = 0; S.gym.override = null; save(); renameCoachBlocks(today()); break;
    case "version": B.bible().version = v; save(); break;
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
  if (f.dataset.form === "appearance") {
    e.preventDefault(); S.ui = appearanceValues(Object.fromEntries(new FormData(f)));
    applyAppearance(S.ui); save(); toast("Appearance saved."); return;
  }
  if (f.dataset.form === "routine-edit") {
    e.preventDefault(); const v = new FormData(f), title = String(v.get("titleText")).trim(), id = f.dataset.id;
    const start = readTime(v.get("start")), end = readTime(v.get("end")), days = v.getAll("weekday").map(Number);
    if (!title || !days.length || (start == null) !== (end == null) || start != null && end <= start) return toast("Enter an activity and repeat days. Leave both times blank or set an end after the start.");
    if (S.routines.some(r => !r.disabled && r.id !== id && r.title.toLowerCase() === title.toLowerCase())) return toast("That routine already exists.");
    const r = S.routines.find(r => r.id === id);
    archiveDays(S, today());
    const data = { title, days, start, minutes: start == null ? 5 : end - start, fixed: true, venue: String(v.get("venue")).trim() };
    if (r) { clearFutureInstances(S, id, today(), nowMin()); Object.assign(r, data); }
    else S.routines.push({ id: uid(), from: today(), cat: "other", ...data });
    save(); initCarryover(); render(); openRoutines(); toast(`Saved ${title}.`); return;
  }
  if (f.dataset.form === "alarms-settings") {
    e.preventDefault();
    const v = new FormData(f), k = S.alarms;
    const termStart = String(v.get("termStart")), termEnd = String(v.get("termEnd"));
    if (termStart && termEnd && termStart > termEnd) return toast("Term end must be on or after term start.");
    for (const x of ["enabled", "vibrate", "speak", "morning", "morningSpeak", "evening", "goals", "goalsSpeak"]) k[x] = v.has(x);
    for (const x of ["quietStart", "quietEnd"]) k[x] = String(v.get(x) || "");
    k.tone = ["chime", "pulse", "bell"].includes(v.get("tone")) ? v.get("tone") : "chime";
    k.volume = Math.max(0, Math.min(100, +v.get("volume")));
    k.snooze = Math.max(1, Math.min(120, +v.get("snooze") || 10));
    k.repeat = Math.max(0, Math.min(120, +v.get("repeat") || 0));
    k.morningTime = readTime(v.get("morningTime")) ?? 390; k.eveningTime = readTime(v.get("eveningTime")) ?? 1260;
    k.assignmentLeads = [1440, 180, 60, 0].filter(x => v.has(`lead${x}`));
    Object.assign(S.profile, { termStart, termEnd, goalRemindEvery: +v.get("goalRemindEvery") });
    k.goalReviewTime = readTime(v.get("goalReviewTime")) ?? 1080; k.goalReviewDay = +v.get("goalReviewDay");
    save(); render(); toast("Alarm settings saved."); tick(); return;
  }
  if (f.dataset.form === "alarm-new") {
    e.preventDefault();
    const title = f.titleText.value.trim(), minute = readTime(f.whenTime.value);
    const at = minute == null ? NaN : hkAt(f.whenDate.value, minute);
    if (!title || !Number.isFinite(at) || at <= Date.now()) return toast("Choose a future date and time.");
    S.reminders.push({ id: uid(), kind: "custom", title, text: title, at, done: false });
    save(); openReminders(); toast(S.alarms.enabled ? "Reminder saved." : "Saved. Turn on alarms in More to hear it."); return;
  }
  if (f.dataset.form === "handbook") { e.preventDefault(); openHandbook(f.q.value); return; }
  if (f.dataset.form === "phrase") {
    e.preventDefault();
    const from = commandText(HR.clean(f.from.value)), to = f.to.value.trim();
    if (!from || !to) return;
    const prior = S.phrases.find(x => x.from.toLowerCase() === from.toLowerCase());
    if (prior) prior.to = to;
    else S.phrases.push({ id: uid(), from, to });
    save(); render(); toast("Phrase saved."); return;
  }
  if (f.dataset.form === "collection" || f.dataset.form === "note-preview" || f.dataset.form === "collection-item") {
    e.preventDefault();
    const values = new FormData(f);
    const entry = String(values.get("entry") || "").trim();
    if (f.dataset.form === "note-preview") {
      if (!entry) return;
      M.add(entry, { exact: true, folder: f.dataset.folder }); $("#sheet").close(); render(); toast("Note saved."); return;
    }
    if (f.dataset.form === "collection-item") {
      const c = S.collections.find(x => x.id === f.dataset.group), item = c?.items.find(x => x.id === f.dataset.id);
      if (!item) return;
      if (e.submitter?.value === "remove") c.items = c.items.filter(x => x !== item);
      else if (entry) {
        const date = values.get("date"), min = readTime(values.get("reminder")), amount = values.get("amount"), unit = String(values.get("unit")).trim().toLowerCase();
        if (min != null && !date) return toast("Set the date for this reminder.");
        if ((amount !== "") !== !!unit) return toast("Enter both an amount and unit or leave both empty.");
        Object.assign(item, { text: entry, date: date || null, remindMin: min, amount: amount === "" ? null : +amount, unit });
      }
      save(); openCollections(c.id); return;
    }
    try {
      const { c } = saveCollection(S.collections, values.get("group"), entry);
      save(); openCollections(c.id); toast(entry ? `Saved in ${c.name}.` : `Collection: ${c.name}.`);
    } catch (err) { toast(err.message); }
    return;
  }
  if (f.dataset.form === "inbox-time") {
    e.preventDefault();
    const t = getUntimed(f.dataset.id);
    if (!t) return;
    const [h, m] = f.time.value.split(":").map(Number), start = h * 60 + m, end = start + (t.dur || 60);
    if (!Number.isInteger(start) || end > 1440) return toast("Choose an earlier time so the activity ends before midnight.");
    const date = t.date && t.date > today() ? t.date : today();
    const blocks = day(date).blocks;
    if (!blocks.some(b => activityKey(b.title) === activityKey(t.title) && b.start === start && b.end === end))
      blocks.push({ id: uid(), title: t.title, cat: t.cat, start, end, date, venue: t.venue || "", fixed: true, flex: false, priority: t.source?.priority || 2, done: false, src: "manual", ...(t.source?.tid ? { tid: t.source.tid } : {}) });
    if (t.source) t.source.carryResolved = true;
    else S.inbox = S.inbox.filter(x => x !== t);
    save(); $("#sheet").close(); render(); toast(`Scheduled ${t.title} at ${fmtTime(start)}.`); return;
  }
  if (f.dataset.form === "week-plan") {
    e.preventDefault();
    try {
      const values = new FormData(f), week = values.get("week");
      const days = values.getAll("days").map(i => addDays(week, +i));
      const tasks = String(values.get("tasks")).split("\n").filter(s => s.trim()).map(line => {
        const match = line.trim().match(/^(.+?),\s*(\d+)(?:,\s*([123]))?(?:,\s*(\d{4}-\d{2}-\d{2}))?\s*$/);
        if (!match) throw new Error("Use: Activity, minutes, optional priority, optional deadline.");
        const title = match[1].trim(), old = S.weekPlans?.[week]?.tasks.find(t => t.title === title);
        const cat = old?.cat || (/\bbass\b/i.test(title) ? "bass" : /\b(?:gym|workout)\b/i.test(title) ? "gym" : /\b(?:bible|prayer)\b/i.test(title) ? "bible" : /\b(?:rest|break)\b/i.test(title) ? "rest" : "study");
        return { title, minutes: +match[2], priority: +(match[3] || 2), due: match[4], days, cat };
      });
      if (S.weekPlans?.[week] && !f.dataset.replace) {
        f.dataset.replace = "yes"; f.querySelector("[data-week-error]").textContent = "This replaces the saved plan for that week. Press Confirm rebuild to continue.";
        f.querySelector('button[type="submit"]').textContent = "Confirm rebuild"; return;
      }
      const result = planWeek({ weekStart: week, start: values.get("from"), end: values.get("until"),
        focusMinutes: +values.get("focus"), breakMinutes: +values.get("rest"), allowPartial: values.has("partial"), tasks });
      $("#sheet").close(); go("today", days.find(d => d >= today()) || week);
      pushMsg("pg", planSummary(result)); return;
    } catch (error) { f.querySelector("[data-week-error]").textContent = error.message; return; }
  }
  if (f.id === "composer") { e.preventDefault(); if (ui.running) return; const t = $("#ask").value; $("#ask").value = ""; voice.kill(); run(t, "typed"); return; }
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
  if (f.dataset.form === "goal") { e.preventDefault(); const t = f.g.value.trim(); if (t) { D.addGoal(t); openGoals(); render(); } return; }
  if (f.dataset.form === "goal-edit") {
    e.preventDefault(); const g = D.goals().find(x => x.id === f.dataset.id), text = f.g.value.trim();
    if (!g || !text) return;
    Object.assign(g, { text, due: f.due.value || null, term: f.term.value, remindEvery: +f.period.value, notes: f.notes.value.trim() });
    save(); openGoals(); render(); toast("Goal updated."); return;
  }
  if (f.dataset.form === "pantry") {
    e.preventDefault(); ui.pantryInput = f.ingredients.value.trim();
    ui.pantryResult = F.pantryMatches(ui.pantryInput); render(); return;
  }
  if (f.dataset.form === "song") { e.preventDefault(); const n = f.song.value.trim(); if (n) { C.addSong(n); render(); } return; }
  if (f.dataset.form === "note") { e.preventDefault(); const t = f.t.value.trim(); if (t) { const n = M.add(t); ui.folder = "all"; ui.q = ""; render(); toast(`Saved to ${M.FOLDERS[n.folder].label}.`); } return; }
  if (f.dataset.form === "task") { e.preventDefault(); const t = f.t.value.trim(); if (!t || ui.running) return; const input = /\b(?:essay|report|test|exam|quiz|project|presentation|homework|assignment|paper|lab|reading|worksheet)\b/i.test(t) ? t : t + " assignment"; openAssistant(); run("Add " + input, "typed"); return; }
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
    const s = toM(fd.get("start")), en = toM(fd.get("end"));
    if (!Number.isInteger(s) || !Number.isInteger(en) || en <= s) { toast("Choose an end time after the start. For overnight entries, tell PG the next-day finish."); return; }
    const clash = day(d).blocks.find(b => b.id !== f.dataset.id && !b.skipped && !b.studyWindow && s < b.end && b.start < en);
    const fixed = fd.has("fixed");
    const data = { title: String(fd.get("title")).trim() || "Untitled", cat: fd.get("cat"), start: s, end: en, venue: String(fd.get("venue")).trim(), priority: +fd.get("priority"), fixed, flex: !fixed };
    if (f.dataset.id) Object.assign(day(d).blocks.find(x => x.id === f.dataset.id), data);
    else day(d).blocks.push({ id: uid(), ...data, done: false, date: d, src: "manual" });
    if (SC.academic(data.title)) {
      const [task] = SC.add([{ title: data.title, kind: "assignment", due: null, dueMin: null, est: null }]);
      const b = day(d).blocks.find(b => b.id === f.dataset.id) || day(d).blocks.at(-1); b.tid = task.id;
    }
    save(); initCarryover(); $("#sheet").close(); render();
    const stillClashes = clash && day(d).blocks.some(x => x.id === clash.id && s < x.end && en > x.start);
    toast(stillClashes ? `Saved. Overlaps ${clash.title}.` : f.dataset.id ? "Saved." : "Added.");
  }
});
$("#orb").addEventListener("click", () => orbTap());
$("#dockOrb").addEventListener("click", () => { openAssistant(); orbTap(); });
$("#finishTurn").addEventListener("click", () => voice.stop());
$("#scrim").addEventListener("click", closeAssistant);
function orbTap() {
  if (SY.locked()) return;
  if (voice.mode === "command") { voice.stop(); return; }
  if (voice.mode !== "off") return;
  openAssistant();
  $("#heard").textContent = "";
  voice.hush();
  if (!voice.start()) $("#ask").focus();
}
$("#asClose").addEventListener("click", closeAssistant);
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
  if (inDraft()) return;
  const t = $("#toast");
  t.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button class="btn sm">${esc(action)}</button>` : "");
  t.hidden = false;
  if (action) t.querySelector("button").onclick = () => { t.hidden = true; fn(); };
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, action ? 7000 : 3500);
}

// ================= Reminders & wake lock =================
function appearanceSettings() {
  const a = appearanceValues(S.ui);
  return `<h2 class="sec"><span>Appearance</span></h2><div class="card">
    <form data-form="appearance"><div class="grid2">
      <label class="field">Theme<select class="input" name="theme">${["dark","light","auto"].map(t => `<option ${t === a.theme ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <label class="field">Accent<select class="input" name="accent">${Object.keys(accents).map(t => `<option ${t === a.accent ? "selected" : ""}>${t}</option>`).join("")}</select></label></div>
      <label class="field">Text size (1 is normal)<input class="input" name="fontScale" type="number" min="0.8" max="1.6" step="0.05" value="${a.fontScale}" required></label>
      <button class="btn primary">Save appearance</button></form>
    <p class="note">Wallpaper is stored only on this device.</p>
    <label class="field">Choose a wallpaper<input type="file" class="input" accept="image/*" data-act="wallpaper"></label><button class="btn" data-act="wallpaper-remove">Remove wallpaper</button></div>`;
}
function alarmSettings() {
  const a = S.alarms, check = (k, t) => `<label class="alarm-check"><input type="checkbox" name="${k}" ${a[k] ? "checked" : ""}>${t}</label>`;
  const field = (label, name, type, value, extra = "") => `<label class="field"><span>${label}</span><input class="input" type="${type}" name="${name}" value="${esc(value)}" ${extra}></label>`;
  return `<h2 class="sec"><span>Alarms and daily reviews</span></h2><div class="card">
    <div class="row wrap"><button class="btn" data-act="alarms-open">Reminders</button><button class="btn" data-act="review-open">Evening review</button><button class="btn" data-act="alarm-test">Test alarm</button></div>
    <form data-form="alarms-settings">
      ${check("enabled", "Enable alarms")}${check("speak", "Speak reminder messages")}${check("vibrate", "Vibrate if supported")}
      <div class="grid2"><label class="field"><span>Sound</span><select class="input" name="tone">${["chime","pulse","bell"].map(v => `<option ${v === a.tone ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      ${field("Volume", "volume", "range", a.volume, 'min="0" max="100"')}</div>
      <div class="grid2">${field("Snooze minutes", "snooze", "number", a.snooze, 'min="1" max="120"')}${field("Repeat minutes (0 = off)", "repeat", "number", a.repeat, 'min="0" max="120"')}</div>
      <div class="grid2">${field("Quiet starts (Hong Kong)", "quietStart", "time", a.quietStart)}${field("Quiet ends (Hong Kong)", "quietEnd", "time", a.quietEnd)}</div>
      <fieldset><legend>Assignment alerts</legend>${[[1440,"24 hours before"],[180,"3 hours before"],[60,"1 hour before"],[0,"At the deadline"]].map(([n,label]) => `<label class="alarm-check"><input type="checkbox" name="lead${n}" ${a.assignmentLeads.includes(n) ? "checked" : ""}>${label}</label>`).join("")}</fieldset>
      <div class="grid2"><div>${check("morning", "Morning briefing")}${field("Briefing time", "morningTime", "time", timeValue(a.morningTime))}${check("morningSpeak", "Speak the briefing")}</div>
      <div>${check("evening", "Evening review")}${field("Review time", "eveningTime", "time", timeValue(a.eveningTime))}</div></div>
      <fieldset><legend>Goals</legend>${check("goals", "Goal reminders and weekly check")}${check("goalsSpeak", "Speak goal reminders")}<div class="grid2"><label class="field">Weekly check day<select class="input" name="goalReviewDay">${["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map((d,i) => `<option value="${i}" ${i === a.goalReviewDay ? "selected" : ""}>${d}</option>`).join("")}</select></label>${field("Weekly check time", "goalReviewTime", "time", timeValue(a.goalReviewTime))}${field("Default goal reminder interval (days)", "goalRemindEvery", "number", S.profile.goalRemindEvery, 'min="0" max="365" required')}${field("Term starts", "termStart", "date", S.profile.termStart)}${field("Term ends", "termEnd", "date", S.profile.termEnd)}</div></fieldset>
      <button class="btn primary">Save alarm settings</button>
    </form>
    <div class="row wrap"><button class="btn" data-act="alarm-enable-sound">Enable sound</button><button class="btn" data-act="alarm-notifications">Allow notifications</button></div>
    <p class="note">Sound: ${audio?.state === "running" ? "enabled" : "tap Enable sound"} · Notifications: ${"Notification" in window ? Notification.permission : "not supported"} · Keep screen awake: ${S.voice.keepAwake ? "on" : "off"}.</p>
    <p class="note">Times use Hong Kong time. These alarms need PG running. Browsers may pause a background tab or block sound. Export to your phone calendar for reminders when PG is closed.</p>
  </div>`;
}
const hkLabel = at => new Date(at).toLocaleString("en-GB", { timeZone: "Asia/Hong_Kong", dateStyle: "medium", timeStyle: "short" });
function openReminders() {
  const sh = $("#sheet");
  const items = S.reminders.filter(x => !x.done).sort((a, b) => a.at - b.at);
  const assignments = SC.pending().filter(x => x.due && x.dueMin != null);
  sh.innerHTML = `<h3>Reminders</h3><p class="note">Hong Kong time</p>${[...items, ...assignments].map(t => {
    const a = items.includes(t) ? "custom" : "assignment", at = a === "custom" ? t.at : hkAt(t.due, t.dueMin);
    return `<div class="set-row"><div>${esc(t.title || t.text)}<div class="sub">${esc(hkLabel(at))}</div></div><div class="row wrap"><button class="btn" data-act="alarm-calendar" data-id="${esc(t.id)}" data-kind="${a}" aria-label="Add ${esc(t.title || t.text)} to phone calendar">Calendar</button>${a === "custom" ? `<button class="btn" data-act="alarm-remove" data-id="${esc(t.id)}" aria-label="Remove ${esc(t.title)}">Remove</button>` : ""}</div></div>`;
  }).join("") || "<p>No timed reminders yet.</p>"}<form class="field" data-form="alarm-new"><label class="field"><span>Reminder</span><input class="input" name="titleText" required></label><div class="grid2"><label class="field"><span>Date</span><input class="input" name="whenDate" type="date" value="${today()}" required></label><label class="field"><span>Time</span><input class="input" name="whenTime" type="time" required></label></div><button class="btn primary">Add reminder</button></form><button class="btn" data-act="close-sheet">Close</button>`;
  if (!sh.open) sh.showModal();
}
function exportCalendar(data) {
  try {
    const url = URL.createObjectURL(new Blob([calendarFile(data)], { type: "text/calendar;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "pg-reminder.ics"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 15000);
    toast("Open the downloaded file in your calendar and check its alert.");
  } catch (err) { toast(err.message); }
}
function briefText(d) {
  const events = live(d).map(b => `${b.title}, ${sayTime(b.start)} to ${sayTime(b.end)}${b.venue ? ` at ${b.venue}` : ""}`);
  const due = SC.pending().filter(t => t.due && t.due <= d).map(t => `${t.title}${t.dueMin == null ? "" : ` at ${sayTime(t.dueMin)}`}`);
  const habits = reviewDay(S, d).planned.filter(x => x.kind === "routine").map(x => x.title);
  const canto = D.dailyCanto(d);
  return [`Today is ${fmtDay(d, true)}.`, events.length ? events.join("; ") + "." : "No timed activities.",
    due.length && `Assignments due: ${due.join("; ")}.`, habits.length && `Everyday tasks: ${habits.join(", ")}.`,
    `Cantonese: ${canto.jp}. ${canto.en}`].filter(Boolean).join(" ");
}
function openReview(date) {
  const sh = $("#sheet"), r = date === today() ? reviewDay(S, date) : S.history[date] || reviewDay(S, date);
  const buttons = x => date === today() && (x.kind !== "block" || !day(date).blocks.find(b => b.id === x.id)?.routine)
    ? `<div class="row wrap">${[["done","Done now"],["skip","Skip"],...(x.movable ? [["move","Move to tomorrow"]] : [])].map(([choice,label]) => `<button class="btn" data-act="review-action" data-date="${date}" data-id="${esc(x.id)}" data-choice="${choice}" data-kind="${x.kind}" aria-label="${label}: ${esc(x.title)}">${label}</button>`).join("")}</div>` : "";
  sh.innerHTML = `<h3>Evening review</h3><div class="row wrap"><button class="btn" data-act="review-date" data-date="${addDays(date, -1)}">Previous day</button>${date < today() ? `<button class="btn" data-act="review-date" data-date="${addDays(date, 1)}">Next day</button>` : ""}</div><p>${esc(fmtDay(date, true))}: ${r.done.length} of ${r.planned.length} complete.</p>${r.missed.filter(x => !r.moved.some(y => y.id === x.id)).map(x => `<div class="set-row"><span>${esc(x.title)}</span>${buttons(x)}</div>`).join("") || "<p>Nothing left to review.</p>"}${r.moved.map(x => `<p class="sub">Carried forward: ${esc(x.title)}</p>`).join("")}<button class="btn" data-act="close-sheet">Close</button>`;
  if (!sh.open) sh.showModal();
}
function reviewAction(date, id, kind, choice) {
  if (date !== today()) return;
  const x = reviewDay(S, date).missed.find(x => x.id === id && x.kind === kind);
  if (!x || x.moved || choice === "move" && !x.movable) return;
  if (kind === "routine") {
    const map = choice === "done" ? (S.routineDone ||= {}) : (S.routineSkip ||= {});
    map[`${x.linkId}:${date}`] = true;
    const b = day(date).blocks.find(b => b.id === x.id);
    if (b) { if (choice === "done") b.done = true; else b.skipped = true; }
  } else {
    const t = (kind === "block" ? day(date).blocks : S.inbox).find(t => t.id === id);
    if (!t || t.routine) return;
    if (choice === "done") { t.done = true; if (t.tid) SC.noteDone(t); }
    if (choice === "skip") t.skipped = true;
    if (choice === "move") {
      if (kind === "block") { t.carryResolved = true; t.movedByReview = true; }
      else { t.skipped = true; t.movedByReview = true; }
      const dest = addDays(date, 1);
      S.inbox.push({ id: uid(), date: dest, title: t.title, cat: t.cat, dur: t.dur || t.end - t.start || 60, venue: t.venue, tid: t.tid, carryOnDate: true });
    }
  }
  archiveDays(S, date, true); save(); render(); openReview(date);
}
let audio, ringTimer, ringItem;
async function unlockSound() {
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return false;
    audio ||= new Context();
    await audio.resume();
    keepAwake();
    return audio.state === "running";
  } catch { return false; }
}
function tone() {
  if (audio?.state !== "running" || !S.alarms.volume) return;
  const patterns = { chime: [587, 784, 988], pulse: [700, 700, 700], bell: [523, 1046] };
  (patterns[S.alarms.tone] || patterns.chime).forEach((hz, i) => {
    const at = audio.currentTime + i * 0.18, osc = audio.createOscillator(), gain = audio.createGain();
    osc.frequency.value = hz; gain.gain.value = 0.001; gain.gain.setValueAtTime(.001, at);
    gain.gain.exponentialRampToValueAtTime(.16 * S.alarms.volume / 100 + .001, at + .025);
    gain.gain.exponentialRampToValueAtTime(.001, at + .16);
    osc.connect(gain).connect(audio.destination); osc.start(at); osc.stop(at + .17);
  });
}
function openRing(item) {
  if (ringItem || SY.locked()) return;
  const dlg = $("#ring"), d = today();
  ringItem = item;
  const text = item.kind === "brief" ? briefText(d) : item.kind === "review" ? (() => { const r = reviewDay(S, d); return `${r.done.length} of ${r.planned.length} complete.${r.missed.length ? ` Still open: ${r.missed.map(x => x.title).join(", ")}.` : ""}`; })() : item.text || item.title;
  dlg.innerHTML = `<div class="ring-inner"><div class="eyebrow">PG reminder</div><h2 id="ring-title">${esc(item.title)}</h2><p>${esc(text)}</p>
    <div class="row wrap"><button class="btn primary" data-act="ring-action" data-choice="done">Dismiss</button>${item.kind === "test" ? "" : `<button class="btn" data-act="ring-action" data-choice="snooze">Snooze ${S.alarms.snooze} min</button><button class="btn" data-act="ring-action" data-choice="open">Open</button>`}</div>
    ${item.kind === "brief" ? `<button class="btn" data-act="ring-action" data-choice="read">Read briefing</button>` : ""}</div>`;
  dlg.showModal();
  const started = Date.now(), repeat = (item.repeat || S.alarms.repeat || 0) * 60000;
  const play = () => {
    const elapsed = Date.now() - started;
    if ((repeat ? elapsed % repeat : elapsed) >= 45000) return;
    tone(); if (S.alarms.vibrate && !document.hidden) navigator.vibrate?.([160, 80, 160]);
  };
  play(); ringTimer = setInterval(play, 2800);
  if ((item.kind === "brief" ? S.alarms.morningSpeak : item.kind === "goal" ? S.alarms.goalsSpeak : item.kind !== "review" && S.alarms.speak) && voice.mode === "off") voice.say(speakable(text));
  if (item.kind !== "test") systemNotice(text);
}
function settleRing(choice) {
  if (!ringItem) return;
  const item = ringItem;
  if (choice === "read") { voice.say(speakable(briefText(today()))); return; }
  clearInterval(ringTimer); navigator.vibrate?.(0); voice.hush(); $("#ring").close(); ringItem = null;
  if (item.kind !== "test") {
    const receipts = S.dev.alarmReceipts ||= {};
    receipts[item.id] = choice === "snooze" ? { until: Date.now() + S.alarms.snooze * 60000, stamp: Date.now() } : { done: true, stamp: Date.now() };
    if (choice !== "snooze" && item.kind === "custom") {
      const t = S.reminders.find(r => r.id === item.id);
      if (t) { t.done = true; save(); }
    }
    if (choice !== "snooze" && item.kind === "goal" && item.linkId) {
      const g = S.goals.find(g => g.id === item.linkId);
      if (g) { g.lastRemind = today(); save(); }
    }
    save(true);
  }
  if (choice === "open") {
    if (item.kind === "review") openReview(today());
    else if (item.kind === "assignment") go("school");
    else if (item.kind === "brief") go("today", today());
    else if (item.kind === "goal") openGoals();
    else if (item.kind === "collection") openCollections(item.linkId);
    else openReminders();
  }
}
function alarmTick(date, minute, archive = true) {
  const a = S.alarms;
  if (archive && archiveDays(S, date, a.evening && minute >= a.eveningTime)) save();
  if (!a.enabled || ringItem || voice.mode !== "off" || isQuiet(a, minute)) return;
  const receipts = S.dev.alarmReceipts ||= {};
  for (const [key, r] of Object.entries(receipts)) if (r.stamp < Date.now() - 7 * 86400e3) delete receipts[key];
  const next = pendingAlarms(occurrences(S, date, a), receipts, Date.now())[0];
  if (next) openRing(next);
}
const alerted = new Set();
let lastCalendarDay = today();
function tick() {
  if (SY.locked() || inDraft() || ui.running) return;
  initCarryover();
  const n = nowMin(), d = today();
  alarmTick(d, n);
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
  pushMsg("pg", msg);
  if (S.voice.alarmSpeech && !isQuiet(S.alarms, nowMin()) && !ringItem) voice.say(speakable(msg));
  systemNotice(msg);
}
function systemNotice(msg) {
  if (!document.hidden || !("Notification" in window) || Notification.permission !== "granted") return;
  navigator.serviceWorker?.getRegistration().then(reg => reg?.showNotification("PG", { body: msg, icon: "icon-192.png", requireInteraction: true })).catch(() => {});
}
let lock = null;
async function keepAwake() {
  const want = S.voice.keepAwake && !document.hidden;
  try {
    if (want && !lock && navigator.wakeLock) { lock = await navigator.wakeLock.request("screen"); lock.addEventListener("release", () => { lock = null; }); }
    if (!want && lock) { await lock.release(); lock = null; }
  } catch { lock = null; }
}
document.addEventListener("visibilitychange", () => { if (document.hidden) voice.kill(); else if (!SY.locked()) tick(); keepAwake(); });

// ================= Boot =================
renameCoachBlocks(today());
paintChat(); render(); paintVoice("off"); paintLock();
requestAnimationFrame(() => setTimeout(() => {
  if (!SY.locked()) alarmTick(today(), nowMin(), false);
  Promise.resolve(SY.pull()).finally(() => { if (initCarryover()) render(); tick(); });
  if (!SY.locked() && S.dev.aiRetired === "pending") {
    S.dev.aiRetired = "shown"; save(true); toast("AI removed. You can now delete your API keys.");
  }
}, 0));
$("#ring").addEventListener("cancel", e => { e.preventDefault(); settleRing("done"); });
setInterval(tick, 20000);
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
  // Reload once when a new version arrives, but never while recording or typing.
  const had = !!navigator.serviceWorker.controller; let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (!had || reloaded) return; const go = () => { if (voice.mode === "off" && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "")) { reloaded = true; location.reload(); } else setTimeout(go, 3000); }; go(); });
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(r => r.update()).catch(() => {});
}
window.PG = { run, S, voice };

function andWords(a) { return a.length < 2 ? (a[0] || "") : a.slice(0, -1).join(", ") + " and your " + a.at(-1); }
