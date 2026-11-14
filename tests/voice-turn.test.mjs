import test from "node:test";
import assert from "node:assert/strict";

class Recognition {
  start() { this.started = true; }
  abort() { this.aborted = true; }
}
globalThis.window = { SpeechRecognition: Recognition };
if (!globalThis.navigator) globalThis.navigator = { language: "en-US" };
const { Voice } = await import("../js/voice.js");
const { Mic } = await import("../js/cloudvoice.js");
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const commands = [], errors = [], heard = [];
  const v = new Voice({ onCommand: t => commands.push(t), onError: e => errors.push(e), onHeard: t => heard.push(t) });
  v.call = true;
  return { v, commands, errors, heard };
}
function result(v, text, final = true) {
  v.onResult({ results: [Object.assign([{ transcript: text }], { isFinal: final })] });
}
async function cloud(stt = async text => text) {
  const f = fixture();
  Object.defineProperty(f.v.mic, "ok", { value: true });
  f.v.mic.open = async () => true;
  f.v.cloud = { ok: () => true, stt };
  await f.v.listen("command");
  return f;
}

test("final recognition and two minutes of silence do not submit or hang up", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { v, commands } = fixture();
  v.listen("command");
  result(v, "What's next?");
  t.mock.timers.tick(120000);
  assert.deepEqual(commands, []);
  assert.equal(v.mode, "command");
  assert.equal(v.call, true);
  result(v, "What's next? Your turn PG");
  assert.deepEqual(commands, ["What's next?"]);
  v.stop();
});

test("recognition restarts retain the whole draft and accept a split punctuated cue", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { v, commands } = fixture();
  v.listen("command");
  result(v, "I have church on Sunday.");
  const first = v.rec;
  first.onend();
  t.mock.timers.tick(1100);
  assert.notEqual(v.rec, first);
  result(v, "And an assignment. Your turn.");
  v.rec.onend();
  t.mock.timers.tick(1100);
  assert.deepEqual(commands, []);
  result(v, "P. G.");
  assert.deepEqual(commands, ["I have church on Sunday. And an assignment."]);
  assert.equal(v.mode, "thinking");
  v.afterReply();
  assert.equal(v.cmd(), "");
  v.stop();
});

test("interim revisions and cumulative results do not duplicate or submit early", () => {
  const { v, commands } = fixture();
  v.listen("command");
  result(v, "I have church Your turn PG", false);
  assert.deepEqual(commands, []);
  result(v, "I have church and an assignment", false);
  v.onResult({ results: [
    Object.assign([{ transcript: "I have church" }], { isFinal: true }),
    Object.assign([{ transcript: "and an assignment Your turn PG" }], { isFinal: true })
  ] });
  assert.deepEqual(commands, ["I have church and an assignment"]);
  assert.equal(v.rec, null);
  v.stop();
});

test("only explicit tap submits a draft without the cue", () => {
  const { v, commands } = fixture();
  v.listen("command");
  result(v, "Please show my timetable", false);
  v.finish();
  assert.deepEqual(commands, []);
  v.tap();
  assert.deepEqual(commands, ["Please show my timetable"]);
  v.stop();
});

test("Done speaking flushes final browser words rather than aborting them", async () => {
  const { v, commands } = fixture();
  v.listen("command");
  result(v, "An unfinished transcription", false);
  const r = v.rec;
  r.stop = () => queueMicrotask(() => {
    result(v, "All the words including the final ones");
    r.onend?.();
  });
  v.tap(); v.tap();
  assert.deepEqual(commands, []);
  assert.equal(v.tapFinishing, true);
  await settle();
  assert.deepEqual(commands, ["All the words including the final ones"]);
  v.stop();
});

test("manual finish is bounded when a browser omits its final end event", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { v, commands } = fixture();
  v.listen("command"); v.rec.stop = () => {};
  result(v, "Keep this draft", false);
  v.tap(); t.mock.timers.tick(1600);
  assert.deepEqual(commands, ["Keep this draft"]);
  assert.equal(v.tapFinishing, false);
  t.mock.timers.tick(300);
  v.stop();
});

test("hang-up cancels a pending Done speaking flush", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { v, commands } = fixture();
  v.listen("command"); v.rec.stop = () => {};
  result(v, "Discard this", false);
  v.tap(); v.hangUp(); t.mock.timers.tick(2000);
  assert.deepEqual(commands, []);
  assert.equal(v.mode, "off");
});

test("hang-up cancels the pending browser restart and draft", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { v, commands } = fixture();
  v.listen("command");
  result(v, "Don't save this unfinished request");
  v.rec.onend();
  v.hangUp();
  t.mock.timers.tick(120000);
  assert.equal(v.mode, "off");
  assert.equal(v.rec, null);
  assert.equal(v.cmd(), "");
  assert.deepEqual(commands, []);
});

test("cloud segments remain armed, stay ordered, and submit only the final cue", async () => {
  const { v, commands } = await cloud();
  const a = v.micUtter("First request.");
  const b = v.micUtter("And more detail. Your turn.");
  await Promise.all([a, b]);
  assert.equal(v.mic.armed, true);
  assert.deepEqual(commands, []);
  await v.micUtter("PG.");
  assert.deepEqual(commands, ["First request. And more detail."]);
  assert.equal(v.sttPending, 0);
  v.stop();
});

test("manual cloud finish waits for in-flight transcription", async () => {
  let release;
  const { v, commands } = await cloud(() => new Promise(resolve => { release = resolve; }));
  const pending = v.micUtter("audio");
  await settle();
  v.tap();
  assert.deepEqual(commands, []);
  assert.equal(v.mic.armed, false);
  release("All the words I said.");
  await pending;
  await settle();
  assert.deepEqual(commands, ["All the words I said."]);
  assert.equal(v.sttPending, 0);
  v.stop();
});

test("manual cloud finish flushes current WAV recording before submitting", async () => {
  let size = 0;
  const { v, commands } = await cloud(async blob => { size = blob.size; return "Final recorded words."; });
  v.full = "Earlier words.";
  v.mic.rate = 16000;
  v.mic.rec = [new Float32Array(1600)];
  v.tap();
  await settle();
  assert.ok(size > 44);
  assert.deepEqual(commands, ["Earlier words. Final recorded words."]);
  v.stop();
});

test("a cancelled cloud request cannot block or leak into a new turn", async () => {
  let release;
  const { v, commands } = await cloud(text => text === "old" ? new Promise(resolve => { release = resolve; }) : Promise.resolve(text));
  const old = v.micUtter("old");
  await settle();
  v.hangUp();
  v.call = true;
  await v.listen("command");
  await v.micUtter("New request. Your turn PG");
  assert.deepEqual(commands, ["New request."]);
  release("Old private draft. Your turn PG");
  await old;
  assert.deepEqual(commands, ["New request."]);
  assert.equal(v.sttPending, 0);
  v.stop();
});

test("a failed cloud segment preserves the earlier draft and reports the gap", async t => {
  t.mock.method(console, "warn", () => {});
  const { v, commands, errors } = await cloud(async text => {
    if (text === "bad") throw new Error("test transcription failure");
    return text;
  });
  await v.micUtter("Earlier words.");
  await v.micUtter("bad");
  assert.equal(v.cmd(), "Earlier words.");
  assert.deepEqual(commands, []);
  assert.deepEqual(errors, ["hearing"]);
  await v.micUtter("Repeated missing part. Your turn PG");
  assert.deepEqual(commands, ["Earlier words. Repeated missing part."]);
  v.stop();
});

test("microphone capture errors stop honestly rather than loop listening", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { v, errors } = fixture();
  v.listen("command");
  v.rec.onerror({ error: "audio-capture" });
  t.mock.timers.tick(120000);
  assert.equal(v.mode, "off");
  assert.equal(v.rec, null);
  assert.deepEqual(errors, ["nomic"]);
});

test("repeated recognition start failures are bounded and reported", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(Recognition.prototype, "start", () => { throw new Error("unavailable"); });
  const { v, errors } = fixture();
  v.listen("command");
  t.mock.timers.tick(1100);
  t.mock.timers.tick(1100);
  assert.equal(v.mode, "off");
  assert.equal(v.rec, null);
  assert.deepEqual(errors, ["nomic"]);
});

test("hang-up closes a late microphone permission result without listening", async () => {
  const { v } = fixture();
  Object.defineProperty(v.mic, "ok", { value: true });
  let release, closes = 0;
  v.cloud = { ok: () => true };
  v.mic.open = () => new Promise(resolve => { release = resolve; });
  v.mic.close = () => { closes++; };
  const opening = v.listen("command");
  v.mic.rec = [new Float32Array(100)];
  v.hangUp();
  assert.equal(v.mic.rec, null);
  release(true);
  await opening;
  assert.equal(v.mode, "off");
  assert.equal(v.mic.armed, false);
  assert.equal(closes, 2);
});

test("WAV flush sends exactly one recording and clears its buffer", () => {
  const blobs = [];
  const mic = new Mic({ onUtter: blob => blobs.push(blob) });
  mic.rate = 16000; mic.rec = [new Float32Array(1600)];
  mic.flush(); mic.flush();
  assert.equal(blobs.length, 1);
  assert.equal(blobs[0].type, "audio/wav");
  assert.equal(mic.rec, null);
});

function speech(t, initial = []) {
  const previous = [globalThis.speechSynthesis, globalThis.SpeechSynthesisUtterance];
  const played = [];
  let voices = initial;
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; this.rate = 1; } };
  globalThis.speechSynthesis = {
    getVoices: () => voices, cancel() {}, resume() {},
    speak(u) { played.push(u); queueMicrotask(() => u.onend?.()); }
  };
  t.after(() => {
    if (previous[0] === undefined) delete globalThis.speechSynthesis; else globalThis.speechSynthesis = previous[0];
    if (previous[1] === undefined) delete globalThis.SpeechSynthesisUtterance; else globalThis.SpeechSynthesisUtterance = previous[1];
  });
  return { played, voices: next => { voices = next; } };
}

test("female-only devices can speak the greeting and every subsequent reply", async t => {
  const samantha = { name: "Samantha", voiceURI: "samantha", lang: "en-US" };
  const s = speech(t, [samantha]), { v, errors } = fixture();
  v.voiceURI = "a-missing-male-voice";
  await new Promise(resolve => v.say("Hi sir. How may I help you?", resolve));
  await new Promise(resolve => v.say("Here is your actual answer, sir.", resolve));
  assert.deepEqual(s.played.map(u => u.text), ["Hi sir. How may I help you?", "Here is your actual answer, sir."]);
  assert.ok(s.played.every(u => u.voice === samantha));
  assert.deepEqual(errors, []);
});

test("an empty voice list speaks immediately with the browser default", async t => {
  const s = speech(t), { v } = fixture();
  const done = new Promise(resolve => v.say("Default voice is allowed.", resolve));
  assert.equal(s.played.length, 1, "first speak call stays inside the initiating gesture");
  await done;
  assert.equal(s.played[0].voice, undefined);
  s.voices([{ name: "Available later", voiceURI: "later", lang: "en-US" }]);
  await new Promise(resolve => v.say("Now use the loaded voice.", resolve));
  assert.equal(s.played[1].voice.voiceURI, "later");
});

test("all languages are selectable and an explicit voice choice is honored", async t => {
  const french = { name: "Amelie", voiceURI: "french", lang: "fr-FR" };
  const s = speech(t, [french, { name: "English", voiceURI: "english", lang: "en-US" }]);
  const { v } = fixture();
  assert.equal(v.voices().length, 2);
  v.voiceURI = "french";
  await new Promise(resolve => v.say("A selected voice.", resolve));
  assert.equal(s.played[0].voice, french);
});

test("reply playback never opens recognition or automatically barges in", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = speech(t, [{ name: "Samantha", voiceURI: "female", lang: "en-US" }]);
  speechSynthesis.speak = u => s.played.push(u);
  const { v } = fixture();
  v.say("Keep reading until the complete reply is over.");
  t.mock.timers.tick(1000); v.barge();
  assert.equal(v.mode, "speaking");
  assert.equal(v.rec, null);
  assert.equal(v.mic.armed, false);
  v.hush(); v.stop();
  await settle();
});

test("speech waits for microphone release after recognition abort", async t => {
  const s = speech(t), { v } = fixture();
  v.listen("command");
  const r = v.rec;
  const done = new Promise(resolve => v.say("Speak after the microphone stops.", resolve));
  assert.equal(s.played.length, 0);
  r.onend();
  await done;
  assert.equal(s.played.length, 1);
});

test("an unavailable selected voice retries once with the default voice", async t => {
  const s = speech(t, [{ name: "Samantha", voiceURI: "female", lang: "en-US" }]);
  speechSynthesis.speak = u => {
    s.played.push(u);
    queueMicrotask(() => u.voice ? u.onerror?.({ error: "voice-unavailable" }) : u.onend?.());
  };
  const { v, errors } = fixture();
  await new Promise(resolve => v.say("Read these final words too.", resolve));
  assert.equal(s.played.length, 2);
  assert.equal(s.played[1].voice, undefined);
  assert.equal(s.played[1].text, "Read these final words too.");
  assert.deepEqual(errors, []);
});
