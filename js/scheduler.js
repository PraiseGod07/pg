// Turns parsed items into timetable blocks, fitting flexible tasks into free time.
import { uid } from "./util.js";
import { DEFAULT_MIN } from "./library.js";

const overlaps = (a, b) => a.start < b.end && b.start < a.end;
const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function firstGap(blocks, from, dur, until = 1440) {
  const sorted = blocks.filter(b => !b.skipped).slice().sort((a, b) => a.start - b.start);
  let s = from;
  for (const b of sorted) {
    if (b.end <= s) continue;
    if (s + dur <= b.start) break;
    s = Math.max(s, b.end);
  }
  return s + dur <= until ? s : null;
}

// items: from nlu.parseSchedule. getDay(date) returns {blocks:[]}. Returns {added, updated, unplaced}
export function placeItems(items, getDay, opts) {
  const added = [], updated = [], unplaced = [];
  let cursor = null, curDate = null;
  for (const it of items) {
    if (it.date !== curDate) { curDate = it.date; cursor = null; }
    const day = getDay(it.date);
    if (it.kind === "anchor") { if (it.b != null) cursor = Math.max(cursor ?? 0, it.b); continue; }
    let start = it.s, end = it.e;
    const dur = it.dur || DEFAULT_MIN[it.cat] || 30;
    let flex = false;
    if (start == null && end != null) start = (cursor != null && cursor < end && it.durDefault) ? cursor : Math.max(cursor ?? end - dur, end - dur);
    if (start == null) {
      flex = true;
      const earliest = cursor ?? (it.date === opts.today ? Math.max(opts.dayStart, Math.ceil(opts.now / 15) * 15) : opts.dayStart);
      start = firstGap(day.blocks, earliest, dur, opts.dayEnd);
      if (start == null) start = firstGap(day.blocks, earliest, dur, 1440);
      if (start == null) { unplaced.push({ title: it.title, cat: it.cat, dur, date: it.date }); continue; }
    }
    if (end == null) end = start + dur;
    if (end > 1440) end = 1440;
    // Same activity already at about the same time: update instead of duplicating
    const dupe = day.blocks.find(b => !b.done && (norm(b.title) === norm(it.title) || ((it.cat === "gym" || it.cat === "band") && b.cat === it.cat)) && (overlaps(b, { start, end }) || flex || it.cat === "gym" || it.cat === "band"));
    if (dupe) {
      if (!flex || dupe.flex) { dupe.start = start; dupe.end = end; dupe.flex = flex && dupe.flex; }
      updated.push(dupe);
      cursor = dupe.end;
      continue;
    }
    const block = { id: uid(), title: it.title, cat: it.cat, start, end, flex, done: false, date: it.date, src: "voice" };
    day.blocks.push(block);
    added.push(block);
    cursor = end;
  }
  return { added, updated, unplaced };
}

export function conflicts(blocks) {
  const ids = new Set();
  const live = blocks.filter(b => !b.skipped);
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++)
    if (overlaps(live[i], live[j])) { ids.add(live[i].id); ids.add(live[j].id); }
  return ids;
}

// Free gaps between blocks inside a window
export function gaps(blocks, from, to, min = 20) {
  const out = [];
  const sorted = blocks.filter(b => !b.skipped).slice().sort((a, b) => a.start - b.start);
  let s = from;
  for (const b of sorted) {
    if (b.start - s >= min) out.push({ start: s, end: b.start });
    s = Math.max(s, b.end);
  }
  if (to - s >= min) out.push({ start: s, end: to });
  return out;
}
