import test from "node:test";
import assert from "node:assert/strict";
import { commandText } from "../js/phrasebook.js";
import { intent, parseSchedule, hasCalendarCue } from "../js/nlu.js";
import { placeItems } from "../js/scheduler.js";
import { syncContent } from "../js/sync.js";
import { webQuery, extractAnswers, calculate } from "../js/web.js";
import { collectionCommand, reservedCollection } from "../js/collections.js";

test("an echoed command and a duplicate submission produce one block, not a conflict", () => {
  const date = "2026-11-19", ctx = { date, today: date, now: 540, dayStart: 360, dayEnd: 1320 };
  const phrase = "add gym at 5 pm";
  const items = parseSchedule(commandText(`PG, ${phrase}, ${phrase}`), ctx);
  const day = { blocks: [] };
  assert.equal(placeItems(items, () => day, ctx).added.length, 1);
  assert.equal(placeItems(items, () => day, ctx).duplicates.length, 1);
  assert.equal(day.blocks.length, 1);
});
test("personal questions stay local and general questions can search", () => {
  for (const t of ["What do I have today?", "When am I free tomorrow?", "Find pizza", "Search my notes for salt"]) assert.equal(webQuery(t), "");
  assert.equal(webQuery("Who invented nylon?"), "Who invented nylon?");
  assert.equal(webQuery("Search the web for can I eat mango"), "can I eat mango");
  assert.equal(intent("where is uk").type, "ask");
  assert.equal(hasCalendarCue("purple marshmallows"), false);
});
test("search extracts matching fact sentences without treating unrelated text or links as answers", () => {
  const pages = [
    { title: "Test data", url: "https://example.org/fixture", text: "The fictional Violet Town was founded in 1812. The sea is quite cold in winter." },
    { title: "Unrelated", url: "https://example.com", text: "A frozen dessert with an orange peel." },
    { title: "Unsafe protocol", url: "javascript:alert(1)", text: "Violet Town was founded in 1812." }
  ];
  assert.deepEqual(extractAnswers("When was Violet Town founded?", pages).map(x => x.text), ["The fictional Violet Town was founded in 1812."]);
});
test("local maths and compatible units work without rates or executing input", () => {
  assert.equal(calculate("What is 25 + 13?"), "38");
  assert.equal(calculate("Convert 3 km to miles"), "1.864113577 miles");
  assert.equal(calculate("Convert 5 USD to HKD"), null);
  assert.equal(calculate("5 kg to miles"), null);
  assert.equal(calculate("5 / 0"), null);
});
test("explicit collection destinations never take over built-in areas", () => {
  assert.equal(collectionCommand("Add Atomic Habits to my books").name, "books");
  assert.equal(collectionCommand("add bench press to push day"), null);
  assert.equal(collectionCommand("add gym to my timetable tomorrow 5 pm"), null);
  assert.ok(reservedCollection(collectionCommand("create a category called gym").name));
});
test("sync strips retired AI settings and any nested API key while retaining data", () => {
  assert.deepEqual(syncContent({ ai: { key: "fixture" }, dev: { token: "fixture" }, voice: { cloudVoice: true, autoSend: false }, notes: [{ apiKey: "fixture", key: "note-label", text: "Keep this" }] }), { voice: { autoSend: false }, notes: [{ key: "note-label", text: "Keep this" }] });
});
