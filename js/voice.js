// Voice engine: "Hi PG" wake word, command capture, and spoken replies.
import { findWake, isEndCall, splitVoiceTurn } from "./nlu.js";
import { chunks, voiceScore, isNatural } from "./speech.js";
import { Mic, Player } from "./cloudvoice.js";
import { approval } from "./commands.js";

const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
let actx = null;
export async function chime(kind = "up") {
  if (kind !== "success" && kind !== "unlock") return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    await actx.resume();
    if (kind === "unlock") return;
    const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(880, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.32);
    return await new Promise(resolve => { o.onended = resolve; setTimeout(resolve, 500); });
  } catch {}
}
export function joinTranscript(previous, incoming) {
  const a = String(previous || "").trim().split(/\s+/).filter(Boolean);
  const b = String(incoming || "").trim().split(/\s+/).filter(Boolean);
  const norm = s => s.toLowerCase().replace(/[.,!?;:]/g, "");
  for (let n = Math.min(a.length, b.length); n >= 4; n--)
    if (a.slice(-n).every((w, i) => norm(w) === norm(b[i]))) return [...a, ...b.slice(n)].join(" ");
  return [...a, ...b].join(" ");
}

export class Voice {
  constructor(h) {
    this.h = h; // { onState, onHeard, onCommand, onWake, onError }
    // cloud: { tts(text, voice) -> Blob, stt(wav) -> text, ok() } when PG Cloud can talk and listen
    this.cloud = null; this.cloudVoice = "apollo";
    this.player = new Player();
    this.mic = new Mic({ onStart: () => this.micStart(), onUtter: b => this.micUtter(b), onNoise: () => this.micNoise() });
    this.ttsSupported = typeof speechSynthesis !== "undefined";
    this.handsFree = false;
    this.call = false;       // on a call: keep listening after every reply until you say bye
    this.mode = "off";       // off | wake | command | speaking | thinking
    this.rec = null; this.full = ""; this.offset = 0; this.timer = null; this.idleTimer = null;
    this.turnBuffer = ""; this.listenId = 0; this.sttQueue = Promise.resolve(); this.sttPending = 0;
    this.audioSegments = new WeakSet(); this.rawSegments = []; this.duplicateWarning = false;
    this.voice = null; this.voiceURI = ""; this.rate = 1;
    this.restartDelay = 250; this.lastStart = 0;
    // Do not open a phone microphone during playback. During the user's turn,
    // recognition-session endings must resume listening, not finish the turn.
    this.calm = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
    this.silent = 0;
    if (this.ttsSupported) { this.pickVoice(); speechSynthesis.onvoiceschanged = () => this.pickVoice(); }
  }
  get supported() { return !!SR || this.useCloud(); }
  useCloud() { return !!(this.cloud?.ok() && this.mic.ok); }
  set(mode) { this.mode = mode; this.h.onState?.(mode); }

  voices() {
    try { return this.ttsSupported ? speechSynthesis.getVoices().slice().sort((a, b) =>
      Number(/^en/i.test(b.lang)) - Number(/^en/i.test(a.lang)) || voiceScore(b) - voiceScore(a)) : []; }
    catch { return []; }
  }
  pickVoice() {
    const vs = this.voices();
    this.voice = vs.find(v => v.voiceURI === this.voiceURI)
      || vs.find(v => /^en/i.test(v.lang)) || vs.find(v => v.default) || vs[0] || null;
  }

  // ---- listening ----
  enableHandsFree(on) {
    this.handsFree = on;
    if (on && (this.mode === "off")) this.listen("wake");
    if (!on && this.mode === "wake") this.stop();
  }
  listen(mode, keepMode = false, carry = "") {
    if (mode === "command" && this.useCloud()) return this.cloudListen(keepMode, carry);
    if (!SR) { if (mode === "wake") { this.set("off"); return; } this.h.onError?.("unsupported"); return; }
    if (!this.supported) { this.h.onError?.("unsupported"); return; }
    this.kill();
    if (!keepMode) this.set(mode);
    this.turnBuffer = carry; this.full = carry; this.offset = 0;
    if (mode === "command") this.h.onHeard?.(carry);
    const epoch = this.listenId;
    const r = new SR();
    r.continuous = true; r.interimResults = true; r.lang = navigator.language?.startsWith("en") ? navigator.language : "en-US";
    r.onresult = e => this.onResult(e);
    r.onerror = e => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") { this.handsFree = false; this.h.onError?.("blocked"); this.kill(); this.set("off"); }
      else if (e.error === "network") { this.h.onError?.("network"); this.restartDelay = 3000; }
      else if (e.error === "audio-capture") { this.h.onError?.("nomic"); this.handsFree = false; this.call = false; this.kill(); this.set("off"); }
    };
    r.onend = () => {
      if (this.rec !== r) return;
      this.rec = null;
      if (this.mode === "command") {
        // Phone browsers can stop a recognition session after a pause. Resume
        // with the entire draft, rather than submitting or losing that draft.
        const draft = this.cmd();
        const wait = Date.now() - this.lastStart < 1000 ? 1000 : this.restartDelay;
        setTimeout(() => {
          if (this.listenId === epoch && this.mode === "command" && !this.rec) this.listen("command", false, draft);
        }, wait);
        return;
      }
      if (this.mode === "speaking") { setTimeout(() => { if (this.mode === "speaking" && !this.rec) this.barge(); }, 300); return; }
      if (this.mode === "wake" || this.mode === "command") {
        const wait = Date.now() - this.lastStart < 1000 ? 1500 : this.restartDelay;
        setTimeout(() => { if (this.mode === "wake" && !this.rec) this.listen("wake"); else if (this.mode === "command" && !this.rec) this.listen("command"); }, wait);
      }
    };
    this.rec = r; this.lastStart = Date.now();
    try { r.start(); this.restartDelay = 250; this.startFailures = 0; }
    catch {
      this.startFailures = (this.startFailures || 0) + 1;
      if (this.startFailures < 3) r.onend();
      else { this.h.onError?.("nomic"); this.call = false; this.kill(); this.set("off"); }
    }
    clearTimeout(this.idleTimer);
  }
  cmd() { return this.full.slice(this.offset).replace(/^[\s,.!?]+/, "").trim(); }
  onResult(e) {
    let t = "", lastFinal = true;
    let prior = "";
    for (let i = 0; i < e.results.length; i++) {
      const part = e.results[i][0].transcript.trim();
      if (part.split(/\s+/).length >= 4 && part.toLowerCase() === prior.toLowerCase()) {
        this.duplicateWarning = true; this.h.onError?.("repeated");
      } else t += part + " ";
      prior = part; lastFinal = e.results[i].isFinal;
    }
    this.full = joinTranscript(this.turnBuffer, t).replace(/\s+/g, " ");
    if (this.turnBuffer && this.full.trim() !== [this.turnBuffer.trim(), t.trim()].filter(Boolean).join(" ")) {
      this.duplicateWarning = true; this.h.onError?.("repeated");
    }
    if (this.mode === "speaking") { if (lastFinal) this.checkBarge(); return; }
    if (this.mode === "wake") {
      const w = findWake(this.full);
      if (!w) { if (this.full.length > 400) this.listen("wake"); return; }
      this.offset = w.end;
      this.call = true;
      this.set("command");
      chime("up");
      this.h.onWake?.();
      clearTimeout(this.idleTimer);
    }
    if (this.mode !== "command") return;
    const c = this.cmd();
    if (c) this.silent = 0;
    this.h.onHeard?.(c);
    clearTimeout(this.timer);
    if (!c) {
      // Woke with nothing else said: greet like Siri, then listen for the request
      if (this.offset > 0) this.timer = setTimeout(() => { if (this.mode === "command" && !this.cmd()) this.h.onGreet?.(); }, 1300);   // only after "Hey PG"; the button already greets
    } else if (lastFinal && this.h.awaitingConfirmation?.() && approval(c)) this.finish(true);
    else if (lastFinal && splitVoiceTurn(c).complete) this.finish();
  }
  finish(manual = false) {
    const turn = splitVoiceTurn(this.cmd());
    if (!manual && !turn.complete) return;
    clearTimeout(this.timer); clearTimeout(this.idleTimer);
    const c = turn.text;
    if (this.duplicateWarning && c) {
      this.duplicateWarning = false; this.h.onError?.("repeated");
      this.tapFinishing = false; this.set("command"); return;
    }
    this.kill();
    this.turnBuffer = ""; this.full = ""; this.offset = 0;
    this.set("thinking");
    if (c) this.h.onCommand?.(c); else this.afterReply();
  }
  // Tap the orb: if already listening for a command, finish now; otherwise start a command.
  tap() {
    if (this.cloud?.ok()) this.player.unlock();
    if (this.mode === "speaking") { this.hush(); if (this.call) this.listen("command"); else this.afterReply(); return; }
    if (this.mode === "command") {
      if (this.tapFinishing) return;
      if (this.useCloud() && (this.mic.rec || this.sttPending)) {
        this.tapFinishing = true;
        this.set("command");
        const epoch = this.listenId, pending = this.mic.flush();
        this.mic.armed = false;
        Promise.resolve(pending || this.sttQueue).then(() => {
          if (this.listenId === epoch && this.mode === "command") this.finish(true);
        }).finally(() => { this.tapFinishing = false; });
        return;
      }
      if (this.rec && typeof this.rec.stop === "function") {
        // stop(), unlike abort(), asks the browser to deliver the last words.
        // The draft remains editable by final results until recognition ends.
        const r = this.rec, epoch = this.listenId;
        this.tapFinishing = true; this.set("command");
        let timer, done = false;
        const submit = (ended = true) => {
          if (done) return; done = true; clearTimeout(timer);
          if (this.listenId !== epoch || this.mode !== "command") return;
          this.tapFinishing = false;
          if (ended) { if (this.rec === r) this.rec = null; r.onend = r.onresult = r.onerror = null; }
          this.finish(true);
        };
        r.onend = () => submit();
        this.finishTimer = timer = setTimeout(() => submit(false), 1500);
        try { r.stop(); } catch { submit(false); }
        return;
      }
      if (this.cmd()) this.finish(true); else this.hangUp(); return;
    }
    if (this.mode === "thinking") return;
    chime("up");
    this.call = true;
    this.listen("command");
  }
  kill() {
    this.listenId++;
    this.tapFinishing = false;
    clearTimeout(this.finishTimer);
    this.sttPending = 0; this.sttQueue = Promise.resolve();
    clearTimeout(this.timer);
    this.mic.armed = false; this.mic.reset();
    const r = this.rec; this.rec = null;
    if (r) {
      // Wait for the recognizer to release its audio session before playback.
      // A bounded fallback covers browsers that omit the abort end event.
      let resolve, timer;
      const released = new Promise(done => { resolve = done; });
      const release = () => { clearTimeout(timer); r.onend = null; if (this.micReleased === released) this.micReleased = null; resolve(); };
      this.micReleased = released;
      r.onend = release; r.onresult = null; r.onerror = null;
      timer = setTimeout(release, 250);
      try { r.abort(); } catch { release(); }
    }
  }
  stop() { this.kill(); this.turnBuffer = ""; this.full = ""; this.offset = 0; this.mic.close(); clearTimeout(this.idleTimer); this.set("off"); }
  afterReply() {
    if (this.call) { this.listen("command"); return; }
    if (this.handsFree) this.listen("wake"); else this.set("off");
  }
  // End the call and go back to waiting for "Hi PG"
  hangUp() { this.call = false; this.kill(); this.turnBuffer = ""; this.full = ""; this.offset = 0; this.mic.close(); clearTimeout(this.idleTimer); chime("down"); this.h.onHangUp?.(); this.set("off"); if (this.handsFree) setTimeout(() => { if (this.mode === "off" && this.handsFree) this.listen("wake"); }, 5000); }   // pause before "Hi PG" listening, so PG's own goodbye can't restart a call

  // ---- playback interruption ----
  // A deliberate tap interrupts PG; automatic microphone barge-in is disabled.
  barge() {
    // Half-duplex on every device: a tap can interrupt, but PG must not hear
    // itself or reclaim the device's audio session while a reply is playing.
    return;
  }
  checkBarge() {
    const heard = this.full.toLowerCase().replace(/[^a-z' ]/g, " ").split(/\s+/).filter(Boolean);
    if (!heard.length) return;
    const echo = this.spokenWords || new Set();
    const novelIdx = heard.findIndex(w => !echo.has(w));
    const novel = heard.filter(w => !echo.has(w));
    const said = novel.join(" ");
    const stop = /\b(stop|wait|hold on|hang on|pause|shh+|quiet|enough|cancel|never ?mind|one sec(?:ond)?|excuse me|listen|pg|okay okay|ok ok|no no)\b/.test(said);
    const talking = novel.length >= 5 && novel.length / heard.length > 0.65;
    if (!stop && !talking && !isEndCall(said)) return;
    this.hush();
    this.call = true;
    this.set("command");
    chime("up");
    // Start the command where your own words begin, and drop the stop word itself
    if (stop && !talking && !splitVoiceTurn(this.full).complete) this.offset = this.full.length;
    else { const w = heard[novelIdx]; const at = this.full.toLowerCase().indexOf(w); this.offset = at > 0 ? at : 0; }
    this.h.onInterrupt?.();
    clearTimeout(this.idleTimer);
    this.h.onHeard?.(this.cmd());
    if (splitVoiceTurn(this.cmd()).complete) this.finish();
  }

  // ---- speaking ----
  hush() { this.sayId = (this.sayId || 0) + 1; this.cancelSpeech?.(); this.player.stop(); try { speechSynthesis.cancel(); } catch {} clearTimeout(this.sayTimer); clearInterval(this.keep); }
  // Text can carry Cantonese for PG to say in a Hong Kong voice: ⟦yue:你好⟧
  parts(text) {
    const out = [];
    String(text).split(/(⟦yue:[^⟧]*⟧)/).forEach(seg => {
      const m = seg.match(/^⟦yue:([^⟧]*)⟧$/);
      if (m) { if (m[1].trim()) out.push({ t: m[1].trim(), yue: true }); }
      else chunks(seg).forEach(t => { if (/[a-z0-9]/i.test(t)) out.push({ t }); });
    });
    return out;
  }
  yueVoice() { try { return speechSynthesis.getVoices().filter(v => /^(zh|yue)[-_](HK|Hant-HK)/i.test(v.lang) || /yue/i.test(v.lang)).sort((a, b) => voiceScore(b) - voiceScore(a))[0] || null; } catch { return null; } }
  synth(p, id, retry = 0) {
    return new Promise((res, reject) => {
      if (!this.ttsSupported || this.sayId !== id) return res();
      const u = new SpeechSynthesisUtterance(p.t);
      this.utterance = u; // Retain a strong reference until the browser has finished.
      if (p.yue) { const v = this.yueVoice(); u.lang = v ? v.lang.replace(/_/g, "-") : "zh-HK"; if (v) u.voice = v; u.rate = 0.85; }
      else {
        this.pickVoice();
        u.lang = "en-US";
        if (this.voice && !retry) { u.voice = this.voice; u.lang = this.voice.lang.replace(/_/g, "-"); }
        const nat = this.voice && isNatural(this.voice);
        u.rate = this.rate * (nat ? 1 : 0.96); u.pitch = nat ? 1 : (/\?\s*$/.test(p.t) ? 1.04 : 0.98);
      }
      let settled = false, at = 0, timer;
      const finish = err => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        u.onend = u.onerror = u.onboundary = null;
        if (this.utterance === u) { this.utterance = null; this.cancelSpeech = null; }
        if (this.sayId !== id || !err) return res();
        try { speechSynthesis.cancel(); } catch {}
        if (!retry && !/not-allowed/.test(err)) {
          this.synth({ ...p, t: p.t.slice(at) }, id, 1).then(res, reject);
        } else reject(new Error(err));
      };
      this.cancelSpeech = () => finish();
      u.onboundary = e => { if (e.name === "word" && Number.isInteger(e.charIndex)) at = e.charIndex; };
      u.onend = () => finish();
      u.onerror = e => finish(e.error || "speech-failed");
      timer = setTimeout(() => finish("speech-timeout"), 8000 + p.t.length * 130 / (u.rate || 1));
      try { if (speechSynthesis.paused) speechSynthesis.resume(); speechSynthesis.speak(u); } catch { finish("speech-failed"); }
    });
  }
  say(text, then, preview = false) {
    this.kill();
    this.mic.close();
    const canCloud = this.cloud?.ok() && !this.cloudTtsBad;
    if ((!this.ttsSupported && !canCloud) || !text) { then ? then() : this.afterReply(); return; }
    this.set("speaking");
    this.hush();
    const id = this.sayId;
    this.spokenWords = new Set(String(text).toLowerCase().replace(/[^a-z' ]/g, " ").split(/\s+/).filter(Boolean));
    const parts = this.parts(text);
    let done = false;
    const end = () => { if (done || this.sayId !== id) return; done = true; this.kill(); clearInterval(this.keep); then ? then() : this.afterReply(); };
    clearInterval(this.keep);
    this.keep = setInterval(() => { try { if (speechSynthesis.paused) speechSynthesis.resume(); } catch {} }, 5000);
    // Natural cloud voice: fetch each phrase ahead so there are no gaps.
    const got = [];
    const fetchOne = i => got[i] ||= (parts[i] && !parts[i].yue && canCloud && !this.cloudTtsBad ? this.cloud.tts(parts[i].t, this.cloudVoice).catch(e => { if (e.status === 404 || e.status === 405) this.cloudTtsBad = true; return null; }) : Promise.resolve(null));
    (async () => {
      if (this.micReleased) await this.micReleased;
      if (this.sayId !== id) return;
      for (let i = 0; i < parts.length; i++) {
        if (this.sayId !== id) return;
        const p = parts[i];
        if (!p.yue && canCloud && !this.cloudTtsBad) {
          const blob = await fetchOne(i); fetchOne(i + 1);
          if (this.sayId !== id) return;
          if (blob && await this.player.play(blob)) continue;
        }
        await this.synth(p, id);
        if (i + 1 < parts.length) await new Promise(r => setTimeout(r, 90));
      }
      end();
    })().catch(() => { if (this.sayId === id) { this.h.onError?.("speech"); end(); } });
  }

  // ---- cloud listening: one open mic for the whole call ----
  async cloudListen(keepMode, carry = "") {
    this.kill();
    if (!keepMode) this.set("command");
    this.turnBuffer = carry; this.full = carry; this.offset = 0;
    const epoch = this.listenId;
    const ok = await this.mic.open();
    if (this.listenId !== epoch) { if (this.mode === "off" || this.mode === "wake") this.mic.close(); return; }
    if (!ok) { const n = this.mic.err?.name; this.call = false; this.set("off"); this.h.onError?.(n === "NotAllowedError" || n === "SecurityError" ? "blocked" : "nomic"); return; }
    if (this.mode !== "command" || this.listenId !== epoch) return;
    this.mic.strict = false; this.mic.armed = true;
    this.h.onHeard?.(this.cmd());
    clearTimeout(this.idleTimer);
  }
  micStart() {
    if (this.mode === "command") { clearTimeout(this.idleTimer); this.h.onHeard?.([this.cmd(), "…"].filter(Boolean).join(" ")); }
    else if (this.mode === "speaking") this.player.duck(true);
  }
  micNoise() { if (this.mode === "speaking") this.player.duck(false); else if (this.mode === "command") this.h.onHeard?.(this.cmd()); }
  micUtter(blob) {
    const mode = this.mode, id = this.sayId, epoch = this.listenId;
    if (mode !== "command" && mode !== "speaking") return;
    if (blob && typeof blob === "object") {
      if (this.audioSegments.has(blob)) return this.sttQueue;
      this.audioSegments.add(blob);
    }
    this.sttPending++;
    // Keep recording while earlier audio is transcribed; serialize results so
    // speech separated by pauses cannot be lost or arrive in the wrong order.
    this.sttQueue = this.sttQueue.catch(() => {}).then(async () => {
      if (this.listenId !== epoch || this.mode !== mode) return;
      let text = "";
      try { text = String(await this.cloud.stt(blob) || ""); }
      catch (e) { console.warn(e); if (this.listenId === epoch) this.h.onError?.("hearing"); return; }
      if (this.listenId !== epoch || this.mode !== mode) return;
      text = text.replace(/^[\s.,!?]+|[\s]+$/g, "");
      if (mode === "speaking") {
        if (this.sayId !== id) return;
        if (!this.bargeWith(text)) { this.player.duck(false); if (this.mode === "speaking") this.mic.armed = true; }
        return;
      }
      if (!text || !/[a-z0-9]/i.test(text)) { this.h.onHeard?.(this.cmd()); return; }
      this.rawSegments = [...this.rawSegments.slice(-19), { epoch, text }];
      const joined = joinTranscript(this.cmd(), text);
      if (joined === this.cmd() && text.split(/\s+/).length >= 4) {
        this.duplicateWarning = true; this.h.onError?.("repeated"); return;
      }
      this.full = joined; this.offset = 0;
      this.turnBuffer = this.full;
      this.h.onHeard?.(this.cmd());
      if (this.h.awaitingConfirmation?.() && approval(this.cmd())) this.finish(true);
      else if (splitVoiceTurn(this.cmd()).complete) this.finish();
    }).catch(e => {
      console.warn(e); if (this.listenId === epoch) this.h.onError?.("hearing");
    }).finally(() => { if (this.listenId === epoch) this.sttPending = Math.max(0, this.sttPending - 1); });
    return this.sttQueue;
  }
  // Something was said while PG talked. Cut in only if it's really him, not PG's own voice.
  bargeWith(text) {
    const heard = text.toLowerCase().replace(/[^a-z' ]/g, " ").split(/\s+/).filter(Boolean);
    if (!heard.length) return false;
    const echo = this.spokenWords || new Set();
    const novel = heard.filter(w => !echo.has(w)), said = novel.join(" ");
    const stop = /\b(stop|wait|hold on|hang on|pause|shh+|quiet|enough|cancel|never ?mind|one sec(?:ond)?|excuse me|listen|pg|okay okay|ok ok|no no)\b/.test(said);
    const talking = novel.length >= 5 && novel.length / heard.length > 0.65;
    if (!stop && !talking && !isEndCall(said)) return false;
    this.hush(); this.call = true;
    this.h.onInterrupt?.();
    if (isEndCall(said) || talking || splitVoiceTurn(text).complete) {
      this.listen("command", false, text);
      if (splitVoiceTurn(text).complete) this.finish();
      return true;
    }
    this.listen("command");
    return true;
  }
}
