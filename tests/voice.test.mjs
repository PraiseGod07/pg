import test from "node:test";
import assert from "node:assert/strict";
import { Voice } from "../js/voice.js";

class Engine {
  start() { this.started = (this.started || 0) + 1; }
  stop() { this.onend(); }
  abort() { this.onend(); }
}
function fixture(engine = Engine) {
  const transcript = [], errors = [];
  const voice = new Voice({ onTranscript: t => transcript.push(t), onError: e => errors.push(e) }, engine);
  return { voice, transcript, errors };
}
const final = transcript => Object.assign([{ transcript }], { isFinal: true });
test("one recognition session, with no duplicate phrase when result indexes repeat", () => {
  const { voice, transcript } = fixture();
  assert.equal(voice.start(), true);
  const rec = voice.rec;
  assert.equal(rec.continuous, false);
  rec.onresult({ resultIndex: 0, results: [final("Add Gym"), [{ transcript: "noise" }]] });
  rec.onresult({ resultIndex: 0, results: [final("Add Gym"), final(" at five")] });
  rec.onend();
  assert.deepEqual(transcript, ["Add Gym at five"]);
  assert.equal(rec.started, 1);
  assert.equal(voice.rec, null);
});
test("silence, offline transcription failure, and cancel return to idle", () => {
  const { voice, transcript, errors } = fixture();
  voice.start(); voice.stop();
  voice.start(); voice.rec.onerror({ error: "network" }); voice.rec.onend();
  voice.start(); voice.rec.onresult({ results: [final("Gym")] }); voice.kill();
  assert.deepEqual(errors, ["no-speech", "network"]);
  assert.deepEqual(transcript, []);
  assert.equal(voice.mode, "off");
});
test("missing or blocked microphone is recoverable", () => {
  const f = fixture(null);
  assert.equal(f.voice.start(), false);
  assert.deepEqual(f.errors, ["unsupported"]);
  const g = fixture(class { start() { throw new Error("blocked"); } });
  assert.equal(g.voice.start(), false);
  assert.deepEqual(g.errors, ["not-allowed"]);
  assert.equal(g.voice.mode, "off");
});
