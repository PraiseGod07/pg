import test from "node:test";
import assert from "node:assert/strict";
import { changes, applyProposal, approval, validateChanges, reconcileWindows } from "../js/commands.js";
import { calendarDate } from "../js/dates.js";
import { parseSchedule } from "../js/nlu.js";

const context = { date: "2026-11-15", today: "2026-11-15", now: 450 };
const block = (id, start, end) => ({ id, title: id, start, end });
test("confirmation variants are accepted without accepting corrections", () => {
  for (const yes of ["yes", "yes it is correct", "yes that's correct", "correct", "go ahead", "yes sir"])
    assert.equal(approval(yes), "yes", yes);
  for (const no of ["no", "wrong", "cancel"]) assert.equal(approval(no), "no");
  for (const correction of ["yes but change it", "no move it to Tuesday"]) assert.equal(approval(correction), null);
});
test("private roots and incidental chat never enter a proposal", () => {
  const before = { ai: { key: "dummy" }, dev: {}, chat: [], daily: {}, days: {} };
  const after = { ...before, ai: { key: "changed" }, dev: { trusted: true }, chat: ["hello"], daily: { seen: true } };
  assert.deepEqual(changes(before, after), []);
});
test("proposal applies exact values once, without re-running interpretation", () => {
  const state = { days: {} }, after = { days: { "2026-11-16": { blocks: [block("Meeting", 1020, 1080)] } } };
  const p = { id: "a", changes: changes(state, after) };
  assert.deepEqual(state.days, {});
  assert.equal(applyProposal(state, p), true);
  assert.deepEqual(state.days, after.days);
  assert.equal(applyProposal(state, p), false);
  assert.equal(state.days["2026-11-16"].blocks.length, 1);
});
test("changed data rejects a stale proposal before applying any of it", () => {
  const before = { profile: { address: "sir", dayStart: 420 } };
  const p = { id: "b", changes: changes(before, { profile: { address: "friend", dayStart: 480 } }) };
  const state = structuredClone(before); state.profile.dayStart = 500;
  assert.throws(() => applyProposal(state, p), /data changed/);
  assert.equal(state.profile.address, "sir");
});
test("new conflicts and invalid clocks are rejected", () => {
  const before = { days: { "2026-11-16": { blocks: [block("Church", 570, 900)] } } };
  const after = structuredClone(before);
  after.days["2026-11-16"].blocks.push(block("Meeting", 800, 960));
  assert.throws(() => validateChanges(before, after, changes(before, after)), /not feasible/);
  after.days["2026-11-16"].blocks.at(-1).start = NaN;
  assert.throws(() => validateChanges(before, after, changes(before, after)), /valid date/);
});
test("removing study slots invalidates their regeneration metadata", () => {
  const w = block("study", 960, 1020);
  const before = { days: { "2026-11-16": { blocks: [{ ...w, id: "free", containerId: "study" }] } },
    studyWindows: { "2026-11-16": [w] } };
  const after = structuredClone(before); after.days["2026-11-16"].blocks = [];
  reconcileWindows(before, after);
  assert.deepEqual(after.studyWindows, {});
});
test("weekday activities retain distinct dates", () => {
  const items = parseSchedule("Church on Monday from 9 am to 10 am then Meeting on Tuesday from 5 pm to 6 pm", context);
  assert.deepEqual(items.map(x => [x.date, x.s, x.e]), [["2026-11-16", 540, 600], ["2026-11-17", 1020, 1080]]);
  assert.deepEqual(items.map(x => x.title), ["Church", "Meeting"]);
});
test("all seven ranges and overnight end survive the supplied schedule", () => {
  const items = parseSchedule("church from 9:30 am to 3 pm rest from 3 pm to 4 pm assignment from 4 pm to 5 pm meeting from 5 pm to 6 pm cooking from 6 pm to 7 pm eating from 7 pm to 7:30 pm assignment from 7:30 pm to 1 am next morning", context);
  assert.deepEqual(items.map(x => [x.s, x.e]), [[570,900],[900,960],[960,1020],[1020,1080],[1080,1140],[1140,1170],[1170,1500]]);
  assert.equal(items.at(-1).endDate, "2026-11-16");
  assert.match(items.at(-1).title, /assignment/i);
});
test("calendar dates reject invalid dates and weekday contradictions", () => {
  assert.equal(calendarDate("on November 17, 2026", context.today), "2026-11-17");
  assert.equal(calendarDate("Tuesday", context.today), "2026-11-17");
  assert.throws(() => calendarDate("Monday November 17, 2026", context.today), /not monday/);
  assert.throws(() => calendarDate("2026-02-30", context.today), /invalid/);
});
test("School additions require a matching timetable slot and exclude personal activities", () => {
  const before = { school: { tasks: [] }, days: {} };
  const after = structuredClone(before);
  after.school.tasks.push({ id: "s", title: "Physics assignment" });
  assert.throws(() => validateChanges(before, after, changes(before, after)), /day, start time/);
  after.days["2026-11-16"] = { blocks: [block("Physics assignment", 960, 1020)] };
  assert.doesNotThrow(() => validateChanges(before, after, changes(before, after)));
  after.school.tasks[0].title = "Gym";
  assert.throws(() => validateChanges(before, after, changes(before, after)), /only for schoolwork/);
});
