import test from "node:test";
import assert from "node:assert/strict";
import { carriedTasks, planCarryover, untimedTasks } from "../js/carryover.js";

const first = "2026-11-16", next = "2026-11-17", week = "2026-11-23";
const block = (id, overrides = {}) => ({ id, title: "Finish portfolio", cat: "work", start: 1020, end: 1080, ...overrides });
test("unfinished one-offs carry without copying a time or editing their original date", () => {
  const state = { days: { [first]: { blocks: [block("a")] } }, inbox: [] };
  const original = structuredClone(state);
  assert.deepEqual(carriedTasks(state, first, first), []);
  const [item] = carriedTasks(state, next, first);
  assert.equal(item.date, first);
  assert.equal(item.dur, 60);
  assert.equal(item.start, undefined);
  assert.equal(carriedTasks(state, week, first)[0].id, item.id);
  assert.equal(state.days[week], undefined);
  assert.deepEqual(state, original);
  item.source.carryResolved = true;
  assert.deepEqual(carriedTasks(state, week, first), []);
});
test("completed, recurring, appointments, and finished assignments do not carry", () => {
  const state = { days: { [first]: { blocks: [
    block("a", { done: true }), block("b", { routine: "r" }), block("c", { cat: "meeting" }),
    block("d", { title: "Dentist appointment", cat: "other" }), block("e", { cat: "study", tid: "assignment" }),
    block("f", { cat: "study", tid: "pending" }), block("g", { cat: "class" })
  ] } }, school: { tasks: [{ id: "assignment", done: true }, { id: "pending", done: false }] } };
  assert.deepEqual(carriedTasks(state, next, first).map(t => t.source.id), ["f"]);
  assert.deepEqual(carriedTasks(state, next, next), []);
});
test("untimed tasks carry only to Today, not to future dates", () => {
  const state = { inbox: [{ date: first, id: "a" }, { date: first, id: "b", done: true }, { date: week, id: "c" }] };
  assert.deepEqual(untimedTasks(state, next, next, first).map(t => t.id), ["a"]);
  assert.deepEqual(untimedTasks(state, week, next, first).map(t => t.id), ["c"]);
});
test("rollover reserves real free time by priority, without moving today's anchors", () => {
  const state = { profile: { dayStart: 540, dayEnd: 720 }, inbox: [],
    days: { [first]: { blocks: [block("later", { priority: 3 }), block("urgent", { priority: 1 })] } } };
  const anchor = block("class", { title: "Class", start: 570, end: 630, cat: "class", fixed: true });
  const blocks = [structuredClone(anchor)];
  const { added } = planCarryover(state, next, first, blocks, 535);
  assert.deepEqual(added.map(x => [x.start, x.end, x.carryOrigin]), [[630, 690, "urgent"]]);
  assert.equal(added[0].flex, true);
  assert.deepEqual(blocks[0], anchor);
  assert.deepEqual(carriedTasks(state, next, first).map(x => x.source.id), ["later"]);
  assert.deepEqual(planCarryover(state, next, first, blocks, 535), { added: [], changed: false });
});
test("an incomplete carried block can move one day forward without leaving duplicate tasks", () => {
  const state = { profile: { dayStart: 540, dayEnd: 720 }, inbox: [],
    days: { [first]: { blocks: [block("work")] }, [next]: { blocks: [] } } };
  planCarryover(state, next, first, state.days[next].blocks, 540);
  const dayAfter = "2026-11-18", entries = [];
  const { added } = planCarryover(state, dayAfter, first, entries, 540);
  assert.equal(added.length, 1);
  assert.equal(added[0].carriedFrom, next);
  assert.equal(added[0].carryOrigin, "work");
  assert.equal(state.days[first].blocks[0].start, 1020);
  assert.deepEqual(planCarryover(state, dayAfter, first, entries, 540), { added: [], changed: false });
});
test("a new appointment displaces only an unstarted carried task and keeps overflow", () => {
  const state = { profile: { dayStart: 540, dayEnd: 650 }, inbox: [],
    days: { [first]: { blocks: [block("work")] } } };
  const schedule = [];
  assert.equal(planCarryover(state, next, first, schedule, 530).added[0].start, 540);
  schedule.push(block("class", { start: 540, end: 600, cat: "class", fixed: true }));
  assert.deepEqual(planCarryover(state, next, first, schedule, 530), { added: [], changed: true });
  assert.deepEqual(schedule.map(b => b.id), ["class"]);
  assert.equal(state.inbox[0].title, "Finish portfolio");
  schedule.pop();
  assert.equal(planCarryover(state, next, first, schedule, 530).added.length, 1);
  assert.equal(state.inbox.length, 0);
});
