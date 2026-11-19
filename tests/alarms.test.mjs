import test from "node:test";
import assert from "node:assert/strict";
import { alarmDefaults, archiveDays, assignmentAlarms, calendarFile, hkAt, isQuiet, occurrences, pendingAlarms } from "../js/alarms.js";

const date = "2026-11-20";
test("assignment reminders use the actual Hong Kong deadline, never an invented time", () => {
  const list = assignmentAlarms([{ id: "a", title: "Physics", due: date, dueMin: 1260 }, { id: "b", due: date }, { id: "c", due: date, dueMin: 0, done: true }], date, alarmDefaults());
  assert.deepEqual(list.map(x => new Date(x.at).toISOString()), ["2026-11-19T13:00:00.000Z", "2026-11-20T10:00:00.000Z", "2026-11-20T12:00:00.000Z", "2026-11-20T13:00:00.000Z"]);
  assert.equal(hkAt(date, 1260), list.at(-1).at);
});
test("quiet hours cross midnight and snooze does not ring again early", () => {
  const cfg = { ...alarmDefaults(), quietStart: "22:00", quietEnd: "07:00" };
  assert.equal(isQuiet(cfg, 10), true);
  assert.equal(isQuiet(cfg, 420), false);
  const list = [{ id: "due", at: 50, kind: "assignment" }];
  assert.deepEqual(pendingAlarms(list, { due: { until: 150 } }, 149), []);
  assert.deepEqual(pendingAlarms(list, { due: { until: 150 } }, 150), list);
  assert.deepEqual(pendingAlarms(list, { due: { done: true } }, 151), []);
  assert.deepEqual(occurrences({ reminders: list }, date, cfg), []);
});
test("calendar export emits UTC and VALARM and prevents field injection", () => {
  const text = calendarFile({ id: "r1", title: "功課, Physics\nATTENDEE:bad", at: hkAt(date, 1260), leads: [60, 0] }, hkAt(date, 0));
  assert.match(text, /DTSTART:20261120T130000Z\r\n/);
  assert.match(text, /TRIGGER:-PT60M\r\n/);
  assert.match(text, /TRIGGER:PT0M\r\n/);
  assert.doesNotMatch(text, /\r\nATTENDEE:/);
  assert.ok(text.split("\r\n").every(line => new TextEncoder().encode(line).length <= 75));
});
test("history snapshots distinguish missed, moved, and done and remove records beyond retention", () => {
  const s = { history: { "2020-01-01": {} }, days: { "2026-11-19": { blocks: [
    { id: "a", title: "Class", done: true }, { id: "b", title: "Study", carryResolved: true }, { id: "c", title: "Errand", done: true, completedOn: date }
  ] } }, routines: [{ id: "habit", title: "Vitamins", from: "2026-11-19" }] };
  assert.equal(archiveDays(s, date), true);
  assert.deepEqual(s.history["2026-11-19"].done.map(x => x.id), ["a"]);
  assert.deepEqual(s.history["2026-11-19"].missed.map(x => x.id), ["c", "routine:habit:2026-11-19"]);
  assert.deepEqual(s.history["2026-11-19"].moved.map(x => x.id), ["b"]);
  assert.equal(s.history["2020-01-01"], undefined);
  assert.equal(archiveDays(s, date), false);
});
