import test from "node:test";
import assert from "node:assert/strict";
import { activeGoals, goalCommand, goalDeadline, parseGoal } from "../js/goals.js";
import { anchorCommand, clearFutureInstances, exactClock, onRoutineDay } from "../js/routines.js";
import { archiveDays, goalAlarms, reviewDay } from "../js/alarms.js";
import { DEFAULTS, migrate } from "../js/store.js";
import { appearanceValues } from "../js/appearance.js";
import { collectionCommand, collectionTotals, findCollection, mergeCollections } from "../js/collections.js";

const base = "2026-11-20";
test("goal phrases extract deadlines in Hong Kong calendar days", () => {
  for (const [phrase, date] of [
    ["by the end of the month", "2026-11-30"], ["by month end", "2026-11-30"],
    ["by the end of November", "2026-11-30"], ["by the end of the term", "2027-01-05"],
    ["by the end of the year", "2026-12-31"], ["before Monday", "2026-11-22"],
    ["in two weeks", "2026-12-04"], ["by the 30th", "2026-11-30"],
    ["the 15th", "2026-12-15"], ["due December 10", "2026-12-10"]
  ]) assert.equal(goalDeadline(phrase, base, "2027-01-05"), date, phrase);
  assert.equal(goalDeadline("in one month", "2028-01-31"), "2028-02-29");
  assert.equal(goalDeadline("by 2026-02-30", base), null);
});
test("goal commands preserve title and leave an unknown term date blank", () => {
  const cases = [
    ["My goal this term is to finish my CAD portfolio by the end of November", "finish my CAD portfolio", "short", "2026-11-30"],
    ["Short-term goal: pass physics, due December 10", "pass physics", "short", "2026-12-10"],
    ["Long-term goal: start a company", "start a company", "long", null],
    ["My goal this term is to improve at bass", "improve at bass", "short", null],
    ["My goal is to graduate by the end of the term", "graduate", "long", null],
    ["My goal is to work in Hong Kong", "work in Hong Kong", "long", null]
  ];
  for (const [phrase, title, term, due] of cases) {
    const c = goalCommand(phrase);
    const g = parseGoal(c.text, base, "", 21, c.qualifier);
    assert.deepEqual([g.text, g.term, g.due, g.remindEvery], [title, term, due, 21]);
  }
});
test("old goal records retain IDs and fortnightly and due alerts only include active goals", () => {
  const s = migrate({ ...DEFAULTS(), goals: [{ id: "old", text: "Stay active", made: base }] });
  assert.equal(s.goals[0].remindEvery, 14);
  assert.equal(s.goals[0].id, "old");
  s.goals.push({ id: "work", text: "CAD", status: "active", made: base, due: "2026-12-07", remindEvery: 0 },
    { id: "closed", text: "Closed", status: "dropped", due: "2026-12-04" });
  assert.deepEqual(activeGoals(s).map(g => g.id), ["work", "old"]);
  assert.deepEqual(goalAlarms(s, "2026-12-04", s.alarms).map(g => g.linkId), ["work", "old"]);
});
test("anchors reject ambiguous and invalid time and use 24-hour input literally", () => {
  assert.equal(exactClock("06:15"), 375);
  assert.equal(exactClock("6"), null);
  assert.equal(exactClock("13 pm"), null);
  assert.equal(exactClock("midnight"), 0);
  assert.deepEqual(anchorCommand("Lessons 9:00 to 12:00 on weekdays"), { title: "Lessons", start: 540, minutes: 180, days: [1,2,3,4,5] });
  assert.throws(() => anchorCommand("Eat 7 to 8 pm every day"), /AM\/PM/);
  assert.throws(() => anchorCommand("Eat 21:00 to 08:00 every day"), /after/);
  assert.equal(onRoutineDay({ days: [1,2,3,4,5] }, "2026-11-21"), false);
});
test("routine changes preserve completed and already-started instances and archived history", () => {
  const s = { days: { [base]: { blocks: [
    { id: "past", routine: "habit", start: 300 }, { id: "done", routine: "habit", start: 500, done: true },
    { id: "future", routine: "habit", start: 500 }, { id: "one-off", start: 500, fixed: true }
  ] } }, routines: [{ id: "habit", title: "Vitamins", from: "2026-11-16" }] };
  archiveDays(s, base);
  assert.equal(s.history["2026-11-17"].planned[0].title, "Vitamins");
  clearFutureInstances(s, "habit", base, 400);
  assert.deepEqual(s.days[base].blocks.map(x => x.id), ["past", "done", "one-off"]);
  assert.equal(reviewDay(s, base).done.length, 1);
  s.routines = [];
  archiveDays(s, "2026-11-21");
  assert.equal(s.history["2026-11-17"].planned[0].title, "Vitamins");
});
test("appearance is clamped to allowed sizes, themes and accents", () => {
  assert.deepEqual(appearanceValues({ fontScale: 90, theme: "light", accent: "rose" }), { fontScale: 1.6, theme: "light", accent: "rose" });
  assert.deepEqual(appearanceValues({ fontScale: "bogus", theme: "random", accent: "constructor" }), { fontScale: 1, theme: "dark", accent: "gold" });
});
test("collection merging keeps dated items, aliases and separate amounts by unit", () => {
  const from = { name: "Cooking", items: [{ id: "one", text: "Rice", amount: 1, unit: "kg", date: base }] };
  const dest = { name: "Shopping notes", items: [{ id: "two", text: "Chicken", amount: 2, unit: "kg" }, { id: "three", text: "Stock", amount: 1, unit: "L" }] };
  assert.equal(collectionCommand("Merge Cooking into Shopping notes").op, "merge");
  const merged = mergeCollections([from, dest], from, dest);
  assert.equal(findCollection(merged, "Cooking"), dest);
  assert.deepEqual(collectionTotals(dest), ["3 kg", "1 L"]);
  assert.equal(dest.items.find(x => x.id === "one").date, base);
});
