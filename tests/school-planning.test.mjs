import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as SC from "../js/school.js";
import * as AG from "../js/agent.js";
import { S, beginDraft, endDraft, inDraft, day } from "../js/store.js";
import { planWeek, weekOf } from "../js/timetable.js";
import { today, addDays } from "../js/util.js";
import { changes, validateChanges, reconcileWindows } from "../js/commands.js";

beforeEach(() => {
  if (inDraft()) endDraft();
  S.days = {}; S.school = {}; S.weekPlans = {}; S.studyWindows = {}; S.routines = [];
});
test("study slot and due date/time are parsed independently", () => {
  const [t] = SC.parse("Add Physics assignment on Thursday from 2 pm to 3 pm due Friday at 5 pm", "2026-11-15");
  assert.equal(t.title, "Physics assignment");
  assert.equal(t.due, "2026-11-20");
  assert.equal(t.dueMin, 1020);
});
test("assignment title is retained and pronoun it does not become IT", () => {
  const [t] = SC.parse("Add AI is a tool for language learning assignment due Tuesday at 5 pm", "2026-11-15");
  assert.equal(t.title, "AI is a tool for language learning assignment");
  assert(!SC.parse("I have an assignment and it is due Monday", "2026-11-15").some(t => /^IT /.test(t.title)));
});
test("personal activities are never classified as academic", () => {
  for (const text of ["Gym", "Church", "Cooking", "Shopping", "Bible reading", "Bass practice"])
    assert.equal(SC.academic(text), false, text);
  assert(SC.academic("History assignment"));
});
test("agent adds an assignment to both stores and links the session", () => {
  const date = addDays(today(), 1);
  AG.apply([{ op: "add_block", title: "Physics assignment", date, start: "16:00", end: "17:00", cat: "study" }]);
  assert.equal(SC.tasks().length, 1);
  assert.equal(day(date).blocks[0].tid, SC.tasks()[0].id);
  assert.equal(SC.upcomingStudy()?.tid, SC.tasks()[0].id);
  SC.remove(SC.tasks()[0].id);
  assert.equal(day(date).blocks.length, 0);
});
test("agent batch rollback preserves all data on an invalid later op", () => {
  assert.throws(() => AG.apply([
    { op: "add_block", title: "Meeting", date: "2026-11-16", start: "16:00", end: "17:00" },
    { op: "add_block", title: "Gym", date: "2026-11-16", start: "25:00", end: "26:00" }
  ]), /valid|start|time/i);
  assert.equal(Object.values(S.days).flatMap(d => d.blocks).length, 0);
});
test("explicit agent time update can overlap without moving the other block", () => {
  AG.apply([
    { op: "add_block", title: "Church", date: "2026-11-16", start: "09:30", end: "15:00" },
    { op: "add_block", title: "Meeting", date: "2026-11-16", start: "17:00", end: "18:00" }
  ]);
  const meeting = day("2026-11-16").blocks.find(b => b.title === "Meeting");
  AG.apply([{ op: "update_block", id: meeting.id, start: "14:00", end: "15:00" }]);
  assert.equal(day("2026-11-16").blocks.find(b => b.id === meeting.id).start, 840);
  assert.equal(day("2026-11-16").blocks.find(b => b.title === "Church").end, 900);
});
test("due-only assignments are accepted and private edits are rejected", () => {
  AG.apply([{ op: "add_assignment", title: "History assignment", due: "2026-11-20", dueMin: 1260 }]);
  assert.equal(SC.tasks()[0].dueMin, 1260);
  assert.equal(Object.values(S.days).flatMap(d => d.blocks).length, 0);
  assert.throws(() => AG.apply([{ op: "set", path: "ai.key", value: "dummy" }]), /private/);
});
test("study allocation preserves fixed commitments and fails atomically when full", () => {
  const week = weekOf(addDays(today(), 14));
  const fixed = { id: "church", title: "Church", start: 570, end: 900, cat: "church", date: week };
  day(week).blocks = [fixed, { id: "window", title: "Assignment", start: 960, end: 1080, cat: "study", studyWindow: true, date: week }];
  const input = { weekStart: week, start: "09:00", end: "18:00", focusMinutes: 50, breakMinutes: 10,
    tasks: [{ title: "SolidWorks", minutes: 100, cat: "study", days: [week] }] };
  const result = planWeek(input);
  assert.equal(result.placed.length, 2);
  assert.deepEqual(day(week).blocks.find(b => b.id === "church"), fixed);
  assert.equal(day(week).blocks.filter(b => b.title === "Rest break").length, 2);
  const before = JSON.stringify(S.days);
  assert.throws(() => planWeek({ ...input, tasks: [{ ...input.tasks[0], minutes: 300 }] }), /not feasible/);
  assert.equal(JSON.stringify(S.days), before);
  const old = structuredClone(S);
  beginDraft(); day(week).blocks = []; const after = endDraft();
  reconcileWindows(old, after);
  assert.equal(after.studyWindows[week], undefined);
  validateChanges(old, after, changes(old, after));
});
test("the weekly planner respects priority, deadlines, routine anchors and unplaced work", () => {
  const week = weekOf(addDays(today(), 14));
  S.routines = [{ id: "lessons", title: "Lessons", start: 540, minutes: 60, days: [1], from: today() }];
  day(week).blocks.push({ id: "done", title: "Completed work", start: 660, end: 690, done: true, src: "weekly-plan" });
  const result = planWeek({ weekStart: week, start: "09:00", end: "11:30", focusMinutes: 50, breakMinutes: 10, allowPartial: true,
    tasks: [{ title: "Low", minutes: 50, days: [week], priority: 3 }, { title: "Must", minutes: 50, days: [week], priority: 1 },
      { title: "Too late", minutes: 50, days: [week], priority: 1, due: addDays(week, -1) }] });
  assert.deepEqual(result.placed.map(b => [b.title, b.start]), [["Must", 600]]);
  assert.deepEqual(result.missing.map(b => [b.title, b.minutes]), [["Too late", 50], ["Low", 50]]);
  assert.equal(day(week).blocks.find(b => b.id === "done").start, 660);
  assert.equal(day(week).blocks.find(b => b.routine === "lessons").start, 540);
});
