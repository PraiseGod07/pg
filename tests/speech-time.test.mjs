// Run: node --test tests/speech-time.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { speakable, chunks, isMale } from "../js/speech.js";
import { parseSchedule } from "../js/nlu.js";

const context = { date: "2026-11-15", today: "2026-11-15", now: 450 };
test("long spoken replies retain their final words", () => {
  const text = "Read every word of this reply. ".repeat(50) + "The final words.";
  assert.equal(speakable(text), text);
  assert.equal(chunks(speakable(text)).join(" "), text);
});
test("every chunk is bounded even without punctuation", () => {
  const text = "continuous speech ".repeat(200).trim();
  assert(chunks(text).every(c => c.length <= 150));
  assert.equal(chunks(text).join(" "), text);
  assert(chunks("x".repeat(1000)).every(c => c.length <= 150));
});
test("church and assignment keep their own exact ranges", () => {
  const result = parseSchedule("from 9:30 to 3:30 I have church and then from 4:00 pm to 5:00 pm I have assignment", context);
  assert.deepEqual(result.map(i => [i.cat, i.s, i.e]), [["church",570,930],["study",960,1020]]);
  assert.equal(result[0].ambiguous, true);
  assert.equal(result[1].ambiguous, false);
});
test("explicit AM/PM is immutable, even in reverse chronological order", () => {
  const result = parseSchedule("assignment from 4 pm to 5 pm then church from 9:30 am to 3:30 pm", context);
  assert.deepEqual(result.map(i => [i.s,i.e,i.ambiguous]), [[960,1020,false],[570,930,false]]);
  const invalid = parseSchedule("church from 9 pm to 8 pm", context)[0];
  assert.equal(invalid.s,1260);
  assert.equal(invalid.e,1200);
  assert.equal(invalid.invalidRange,true);
});
test("male voice detection checks names and mobile identifiers, not defaults", () => {
  assert(isMale({name:"Daniel",voiceURI:"apple.daniel"}));
  assert(isMale({name:"English",voiceURI:"en-us-x-iom-local"}));
  assert(!isMale({name:"English",voiceURI:"en-US"}));
  assert(!isMale({name:"Google UK English Female",voiceURI:"female"}));
  assert(!isMale({name:"Samantha",voiceURI:"samantha"}));
});
