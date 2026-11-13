// Voice engine: "Hi PG" wake word, command capture, and spoken replies.
import { findWake } from "./nlu.js";

const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
let actx = null;
export function chime(kind = "up") {
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
    if (this.ttsSupported) { this.pickVoice(); speechSynthesis.onvoiceschanged = () => this.pickVoice(); }
  }
  set(mode) { this.mode = mode; this.h.onState?.(mode); }

  voices() { return this.ttsSupported ? speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang)) : []; }
  pickVoice() {
    const vs = this.voices();
    this.voice = vs.find(v => v.voiceURI === this.voiceURI)
      || vs.find(v => /daniel|google uk english male|arthur|oliver|guy|ryan|thomas|alex|aaron|microsoft (?:guy|ryan|david|mark)/i.test(v.name))
      || vs.find(v => /en[-_](GB|US)/i.test(v.lang) && !/female|zira|susan|samantha|karen|moira|tessa|fiona|victoria/i.test(v.name))
      || vs[0] || null;
  }

  // ---- listening ----
  enableHandsFree(on) {
    this.handsFree = on;
    if (on && (this.mode === "off")) this.listen("wake");
    if (!on && this.mode === "wake") this.stop();
  }
  listen(mode) {
    if (!this.supported) { this.h.onError?.("unsupported"); return; }
    this.kill();
    this.set(mode);
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
      if (this.mode === "wake" || this.mode === "command") {
        const wait = Date.now() - this.lastStart < 1000 ? 1500 : this.restartDelay;
        setTimeout(() => { if (this.mode === "wake" && !this.rec) this.listen("wake"); else if (this.mode === "command" && !this.rec) this.listen("command"); }, wait);
      }
    };
    this.rec = r; this.lastStart = Date.now();
    try { r.start(); this.restartDelay = 250; } catch { this.rec = null; }
    if (mode === "command") {
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => { if (this.mode === "command" && !this.cmd()) { this.h.onIdle?.(); } }, this.call ? 10000 : 9000);
    }
  }
  cmd() { return this.full.slice(this.offset).replace(/^[\s,.!?]+/, "").trim(); }
  onResult(e) {
    let t = "", lastFinal = true;
    for (let i = 0; i < e.results.length; i++) { t += e.results[i][0].transcript + " "; lastFinal = e.results[i].isFinal; }
    this.full = t.replace(/\s+/g, " ");
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
    this.h.onHeard?.(c);
    clearTimeout(this.timer);
    if (!c) {
      // Woke with nothing else said: greet like Siri, then listen for the request
      this.timer = setTimeout(() => { if (this.mode === "command" && !this.cmd()) this.h.onGreet?.(); }, 1300);
    } else {
      this.timer = setTimeout(() => this.finish(), lastFinal ? (this.call ? 1400 : 1900) : 2600);
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

  // ---- speaking ----
  hush() { try { speechSynthesis.cancel(); } catch {} clearTimeout(this.sayTimer); }
  say(text, then) {
    this.kill();
    if (!this.ttsSupported || !text) { then ? then() : this.afterReply(); return; }
    this.set("speaking");
    this.hush();
    const parts = String(text).replace(/\s+/g, " ").match(/[^.!?]+[.!?]*/g) || [text];
    let i = 0, done = false;
    const end = () => { if (done) return; done = true; clearTimeout(this.sayTimer); then ? then() : this.afterReply(); };
    const next = () => {
      if (i >= parts.length) { end(); return; }
      const u = new SpeechSynthesisUtterance(parts[i++].trim());
      if (this.voice) u.voice = this.voice;
      u.rate = this.rate; u.pitch = 1;
      u.onend = next; u.onerror = next;
      clearTimeout(this.sayTimer);
      this.sayTimer = setTimeout(next, 2500 + u.text.length * 95);
      speechSynthesis.speak(u);
    };
    setTimeout(next, 60);
  }
}
