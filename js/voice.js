// Voice engine: "Hi PG" wake word, command capture, and spoken replies.
import { findWake, isEndCall } from "./nlu.js";
import { chunks, voiceScore, isNatural } from "./speech.js";

const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
let actx = null;
export function chime(kind = "up") {
  return; // PG stays quiet: no beeps. (Kept so older calls still work.)
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
    o.type = "sine";
    const [a, b] = kind === "up" ? [660, 990] : kind === "down" ? [880, 520] : [740, 740];
    o.frequency.setValueAtTime(a, t); o.frequency.exponentialRampToValueAtTime(b, t + 0.14);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.24);
  } catch {}
}

export class Voice {
  constructor(h) {
    this.h = h; // { onState, onHeard, onCommand, onWake, onError }
    this.supported = !!SR;
    this.ttsSupported = typeof speechSynthesis !== "undefined";
    this.handsFree = false;
    this.call = false;       // on a call: keep listening after every reply until you say bye
    this.mode = "off";       // off | wake | command | speaking | thinking
    this.rec = null; this.full = ""; this.offset = 0; this.timer = null; this.idleTimer = null;
    this.voice = null; this.voiceURI = ""; this.rate = 1;
    this.restartDelay = 250; this.lastStart = 0;
    // Phones beep every time the mic turns on. There, PG never listens while talking and doesn't keep restarting the mic.
    this.calm = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
    this.silent = 0;
    if (this.ttsSupported) { this.pickVoice(); speechSynthesis.onvoiceschanged = () => this.pickVoice(); }
  }
  set(mode) { this.mode = mode; this.h.onState?.(mode); }

  voices() { return this.ttsSupported ? speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang)).sort((a, b) => voiceScore(b) - voiceScore(a)) : []; }
  pickVoice() {
    const vs = this.voices();
    this.voice = vs.find(v => v.voiceURI === this.voiceURI) || vs[0] || null;
  }

  // ---- listening ----
  enableHandsFree(on) {
    this.handsFree = on;
    if (on && (this.mode === "off")) this.listen("wake");
    if (!on && this.mode === "wake") this.stop();
  }
  listen(mode, keepMode = false) {
    if (!this.supported) { this.h.onError?.("unsupported"); return; }
    this.kill();
    if (!keepMode) this.set(mode);
    this.full = ""; this.offset = 0;
    const r = new SR();
    r.continuous = true; r.interimResults = true; r.lang = navigator.language?.startsWith("en") ? navigator.language : "en-US";
    r.onresult = e => this.onResult(e);
    r.onerror = e => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") { this.handsFree = false; this.h.onError?.("blocked"); this.kill(); this.set("off"); }
      else if (e.error === "network") { this.h.onError?.("network"); this.restartDelay = 3000; }
      else if (e.error === "audio-capture") { this.h.onError?.("nomic"); this.handsFree = false; }
    };
    r.onend = () => {
      if (this.rec !== r) return;
      this.rec = null;
      if (this.mode === "command" && this.cmd()) { this.finish(); return; }
      if (this.mode === "speaking") { setTimeout(() => { if (this.mode === "speaking" && !this.rec) this.barge(); }, 300); return; }
      if (this.mode === "command" && this.calm && !this.cmd()) {
        // Heard nothing. Try once more, then go quiet until he presses the button again.
        if (++this.silent >= 2) { this.silent = 0; this.call = false; clearTimeout(this.idleTimer); this.h.onHangUp?.(); this.set("off"); return; }
      }
      if (this.mode === "wake" || this.mode === "command") {
        const wait = Date.now() - this.lastStart < 1000 ? 1500 : this.restartDelay;
        setTimeout(() => { if (this.mode === "wake" && !this.rec) this.listen("wake"); else if (this.mode === "command" && !this.rec) this.listen("command"); }, wait);
      }
    };
    this.rec = r; this.lastStart = Date.now();
    try { r.start(); this.restartDelay = 250; } catch { this.rec = null; }
    if (mode === "command" && !keepMode) {
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => { if (this.mode === "command" && !this.cmd()) { this.h.onIdle?.(); } }, this.call ? 20000 : 9000);
    }
  }
  cmd() { return this.full.slice(this.offset).replace(/^[\s,.!?]+/, "").trim(); }
  onResult(e) {
    let t = "", lastFinal = true;
    for (let i = 0; i < e.results.length; i++) { t += e.results[i][0].transcript + " "; lastFinal = e.results[i].isFinal; }
    this.full = t.replace(/\s+/g, " ");
    if (this.mode === "speaking") { this.checkBarge(); return; }
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
      this.timer = setTimeout(() => { if (this.mode === "command" && !this.cmd()) this.h.onGreet?.(); }, 1300);
    } else {
      // Ending the call should feel instant
      const quick = isEndCall(c) ? 500 : null;
      this.timer = setTimeout(() => this.finish(), quick ?? (lastFinal ? (this.call ? 1400 : 1900) : 2600));
    }
  }
  finish() {
    clearTimeout(this.timer); clearTimeout(this.idleTimer);
    const c = this.cmd();
    this.kill();
    this.set("thinking");
    if (c) this.h.onCommand?.(c); else this.afterReply();
  }
  // Tap the orb: if already listening for a command, finish now; otherwise start a command.
  tap() {
    if (this.mode === "speaking") { this.hush(); if (this.call) this.listen("command"); else this.afterReply(); return; }
    if (this.mode === "command") { if (this.cmd()) this.finish(); else this.hangUp(); return; }
    if (this.mode === "thinking") return;
    chime("up");
    this.call = true;
    this.listen("command");
  }
  kill() {
    clearTimeout(this.timer);
    const r = this.rec; this.rec = null;
    if (r) { r.onend = null; r.onresult = null; r.onerror = null; try { r.abort(); } catch {} }
  }
  stop() { this.kill(); clearTimeout(this.idleTimer); this.set("off"); }
  afterReply() {
    if (this.call) { this.listen("command"); return; }
    if (this.handsFree) this.listen("wake"); else this.set("off");
  }
  // End the call and go back to waiting for "Hi PG"
  hangUp() { this.call = false; this.kill(); clearTimeout(this.idleTimer); chime("down"); this.h.onHangUp?.(); if (this.handsFree) this.listen("wake"); else this.set("off"); }

  // ---- talking over PG (barge-in) ----
  // While PG speaks, the mic stays open. Saying "stop", "wait", "hold on" cuts PG off and it listens.
  // Anything else you start saying (that isn't PG's own voice echoing back) also cuts in.
  barge() {
    if (!this.supported || this.calm || !(this.call || this.handsFree) || this.mode !== "speaking") return;
    this.listen("command", true);
  }
  checkBarge() {
    const heard = this.full.toLowerCase().replace(/[^a-z' ]/g, " ").split(/\s+/).filter(Boolean);
    if (!heard.length) return;
    const echo = this.spokenWords || new Set();
    const novelIdx = heard.findIndex(w => !echo.has(w));
    const novel = heard.filter(w => !echo.has(w));
    const said = novel.join(" ");
    if (isEndCall(said)) { this.hush(); this.set("command"); this.offset = 0; this.full = said; this.finish(); return; }
    const stop = /\b(stop|wait|hold on|hang on|pause|shh+|quiet|enough|cancel|never ?mind|one sec(?:ond)?|excuse me|listen|pg|okay okay|ok ok|no no)\b/.test(said);
    const talking = novel.length >= 3 && novel.length / heard.length > 0.5;
    if (!stop && !talking) return;
    this.hush();
    this.call = true;
    this.set("command");
    chime("up");
    // Start the command where your own words begin, and drop the stop word itself
    if (stop && !talking) this.offset = this.full.length;
    else { const w = heard[novelIdx]; const at = this.full.toLowerCase().indexOf(w); this.offset = at > 0 ? at : 0; }
    this.h.onInterrupt?.();
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => { if (this.mode === "command" && !this.cmd()) this.h.onIdle?.(); }, 10000);
    if (this.cmd()) { clearTimeout(this.timer); this.timer = setTimeout(() => this.finish(), 2200); }
  }

  // ---- speaking ----
  hush() { this.sayId = (this.sayId || 0) + 1; try { speechSynthesis.cancel(); } catch {} clearTimeout(this.sayTimer); clearInterval(this.keep); }
  say(text, then) {
    this.kill();
    if (!this.ttsSupported || !text) { then ? then() : this.afterReply(); return; }
    this.set("speaking");
    this.hush();
    const id = this.sayId;
    this.spokenWords = new Set(String(text).toLowerCase().replace(/[^a-z' ]/g, " ").split(/\s+/).filter(Boolean));
    const parts = chunks(text);
    let i = 0, done = false;
    // Keep listening while talking so you can interrupt, but give the speaker a moment to start first
    setTimeout(() => { if (this.sayId === id && this.mode === "speaking") this.barge(); }, 350);
    const end = () => { if (done || this.sayId !== id) return; this.kill(); done = true; clearTimeout(this.sayTimer); clearInterval(this.keep); then ? then() : this.afterReply(); };
    // Chrome pauses long speech after ~15 s; a gentle resume keeps it going.
    clearInterval(this.keep);
    this.keep = setInterval(() => { try { if (speechSynthesis.speaking && !speechSynthesis.paused) { speechSynthesis.pause(); speechSynthesis.resume(); } } catch {} }, 10000);
    const next = () => {
      if (done || this.sayId !== id) return;
      if (i >= parts.length) { end(); return; }
      const txt = parts[i++];
      const u = new SpeechSynthesisUtterance(txt);
      if (this.voice) { u.voice = this.voice; u.lang = this.voice.lang; }
      // Natural voices sound best at their own pace; older voices get a touch slower and warmer.
      const nat = this.voice && isNatural(this.voice);
      u.rate = this.rate * (nat ? 1 : 0.96);
      u.pitch = nat ? 1 : (/\?\s*$/.test(txt) ? 1.04 : 0.98);
      u.onend = () => { clearTimeout(this.sayTimer); setTimeout(next, i < parts.length ? 90 : 0); }; u.onerror = next;
      clearTimeout(this.sayTimer);
      this.sayTimer = setTimeout(next, 4000 + txt.length * 85 / (u.rate || 1));
      speechSynthesis.speak(u);
    };
    setTimeout(next, 60);
  }
}
