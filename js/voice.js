// Voice engine: "Hi PG" wake word, command capture, and spoken replies.
import { findWake, isEndCall } from "./nlu.js";
import { chunks, voiceScore, isNatural, isMale } from "./speech.js";
import { Mic, Player } from "./cloudvoice.js";

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
    // cloud: { tts(text, voice) -> Blob, stt(wav) -> text, ok() } when PG Cloud can talk and listen
    this.cloud = null; this.cloudVoice = "apollo";
    this.player = new Player();
    this.mic = new Mic({ onStart: () => this.micStart(), onUtter: b => this.micUtter(b), onNoise: () => this.micNoise() });
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
  get supported() { return !!SR || this.useCloud(); }
  useCloud() { return !!(this.cloud?.ok() && this.mic.ok); }
  set(mode) { this.mode = mode; this.h.onState?.(mode); }

  voices() { return this.ttsSupported ? speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang)).sort((a, b) => voiceScore(b) - voiceScore(a)) : []; }
  pickVoice() {
    const vs = this.voices();
    const males = vs.filter(isMale), pool = males.length ? males : vs;
    this.voice = pool.find(v => v.voiceURI === this.voiceURI) || pool[0] || null;
  }

  // ---- listening ----
  enableHandsFree(on) {
    this.handsFree = on;
    if (on && (this.mode === "off")) this.listen("wake");
    if (!on && this.mode === "wake") this.stop();
  }
  listen(mode, keepMode = false) {
    if (mode === "command" && this.useCloud()) return this.cloudListen(keepMode);
    if (!SR) { if (mode === "wake") { this.set("off"); return; } this.h.onError?.("unsupported"); return; }
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
      if (this.offset > 0) this.timer = setTimeout(() => { if (this.mode === "command" && !this.cmd()) this.h.onGreet?.(); }, 1300);   // only after "Hey PG"; the button already greets
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
    this.player.unlock();
    if (this.mode === "speaking") { this.hush(); if (this.call) this.listen("command"); else this.afterReply(); return; }
    if (this.mode === "command") { if (this.useCloud() && this.mic.rec) { this.mic.quiet = 1e9; return; } if (this.cmd()) this.finish(); else this.hangUp(); return; }
    if (this.mode === "thinking") return;
    chime("up");
    this.call = true;
    this.listen("command");
  }
  kill() {
    clearTimeout(this.timer);
    this.mic.armed = false;
    const r = this.rec; this.rec = null;
    if (r) { r.onend = null; r.onresult = null; r.onerror = null; try { r.abort(); } catch {} }
  }
  stop() { this.kill(); this.mic.close(); clearTimeout(this.idleTimer); this.set("off"); }
  afterReply() {
    if (this.call) { this.listen("command"); return; }
    if (this.handsFree) this.listen("wake"); else this.set("off");
  }
  // End the call and go back to waiting for "Hi PG"
  hangUp() { this.call = false; this.kill(); this.mic.close(); clearTimeout(this.idleTimer); chime("down"); this.h.onHangUp?.(); this.set("off"); if (this.handsFree) setTimeout(() => { if (this.mode === "off" && this.handsFree) this.listen("wake"); }, 5000); }   // pause before "Hi PG" listening, so PG's own goodbye can't restart a call

  // ---- talking over PG (barge-in) ----
  // While PG speaks, the mic stays open. Saying "stop", "wait", "hold on" cuts PG off and it listens.
  // Anything else you start saying (that isn't PG's own voice echoing back) also cuts in.
  barge() {
    if (this.useCloud()) { if (this.call && this.mode === "speaking") { this.mic.strict = true; this.mic.armed = !!this.mic.stream; } return; }
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
  hush() { this.sayId = (this.sayId || 0) + 1; this.player.stop(); try { speechSynthesis.cancel(); } catch {} clearTimeout(this.sayTimer); clearInterval(this.keep); }
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
  synth(p, id) {
    return new Promise(res => {
      if (!this.ttsSupported || this.sayId !== id) return res();
      const u = new SpeechSynthesisUtterance(p.t);
      if (p.yue) { const v = this.yueVoice(); u.lang = v ? v.lang : "zh-HK"; if (v) u.voice = v; u.rate = 0.85; }
      else {
        if (this.voice) { u.voice = this.voice; u.lang = this.voice.lang; }
        const nat = this.voice && isNatural(this.voice);
        u.rate = this.rate * (nat ? 1 : 0.96); u.pitch = nat ? 1 : (/\?\s*$/.test(p.t) ? 1.04 : 0.98);
      }
      const t = setTimeout(res, 4000 + p.t.length * 120 / (u.rate || 1));
      u.onend = u.onerror = () => { clearTimeout(t); res(); };
      speechSynthesis.speak(u);
    });
  }
  say(text, then) {
    this.kill();
    const canCloud = this.cloud?.ok() && !this.cloudTtsBad;
    if ((!this.ttsSupported && !canCloud) || !text) { then ? then() : this.afterReply(); return; }
    this.set("speaking");
    this.hush();
    const id = this.sayId;
    this.spokenWords = new Set(String(text).toLowerCase().replace(/[^a-z' ]/g, " ").split(/\s+/).filter(Boolean));
    const parts = this.parts(text);
    let done = false;
    setTimeout(() => { if (this.sayId === id && this.mode === "speaking") this.barge(); }, 350);
    const end = () => { if (done || this.sayId !== id) return; done = true; this.kill(); clearInterval(this.keep); then ? then() : this.afterReply(); };
    clearInterval(this.keep);
    this.keep = setInterval(() => { try { if (speechSynthesis.speaking && !speechSynthesis.paused) { speechSynthesis.pause(); speechSynthesis.resume(); } } catch {} }, 10000);
    // Natural cloud voice: fetch each phrase ahead so there are no gaps.
    const got = [];
    const fetchOne = i => got[i] ||= (parts[i] && !parts[i].yue && canCloud && !this.cloudTtsBad ? this.cloud.tts(parts[i].t, this.cloudVoice).catch(e => { if (e.status === 404 || e.status === 405) this.cloudTtsBad = true; return null; }) : Promise.resolve(null));
    (async () => {
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
    })();
  }

  // ---- cloud listening: one open mic for the whole call ----
  async cloudListen(keepMode) {
    this.kill();
    if (!keepMode) this.set("command");
    this.full = ""; this.offset = 0;
    const ok = await this.mic.open();
    if (!ok) { const n = this.mic.err?.name; this.call = false; this.set("off"); this.h.onError?.(n === "NotAllowedError" || n === "SecurityError" ? "blocked" : "nomic"); return; }
    if (this.mode !== "command") return;
    this.mic.strict = false; this.mic.armed = true;
    this.h.onHeard?.("");
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => { if (this.mode === "command" && !this.mic.rec) { this.mic.armed = false; this.h.onIdle?.(); } }, this.call ? 30000 : 12000);
  }
  micStart() {
    if (this.mode === "command") { clearTimeout(this.idleTimer); this.h.onHeard?.("…"); }
    else if (this.mode === "speaking") this.player.duck(true);
  }
  micNoise() { if (this.mode === "speaking") this.player.duck(false); else if (this.mode === "command") this.h.onHeard?.(""); }
  async micUtter(blob) {
    const mode = this.mode, id = this.sayId;
    if (mode !== "command" && mode !== "speaking") return;
    if (mode === "command") { this.mic.armed = false; this.set("thinking"); }
    let text = "";
    try { text = await this.cloud.stt(blob); } catch (e) { console.warn(e); }
    text = text.replace(/^[\s.,!?]+|[\s]+$/g, "");
    if (mode === "speaking") {
      if (this.sayId !== id || this.mode !== "speaking") return;
      if (!this.bargeWith(text)) { this.player.duck(false); if (this.mode === "speaking") this.mic.armed = true; }
      return;
    }
    if (!text || !/[a-z0-9]/i.test(text)) { if (this.mode === "thinking") { this.set("command"); this.mic.armed = true; this.h.onHeard?.(""); } return; }
    this.full = text; this.offset = 0; this.silent = 0;
    this.h.onHeard?.(text);
    this.finish();
  }
  // Something was said while PG talked. Cut in only if it's really him, not PG's own voice.
  bargeWith(text) {
    const heard = text.toLowerCase().replace(/[^a-z' ]/g, " ").split(/\s+/).filter(Boolean);
    if (!heard.length) return false;
    const echo = this.spokenWords || new Set();
    const novel = heard.filter(w => !echo.has(w)), said = novel.join(" ");
    const stop = /\b(stop|wait|hold on|hang on|pause|shh+|quiet|enough|cancel|never ?mind|one sec(?:ond)?|excuse me|listen|pg|okay okay|ok ok|no no)\b/.test(said);
    const talking = novel.length >= 2 && novel.length / heard.length > 0.5;
    if (!stop && !talking && !isEndCall(said)) return false;
    this.hush(); this.call = true;
    this.h.onInterrupt?.();
    if (isEndCall(said) || talking) { this.set("thinking"); this.full = text; this.offset = 0; this.h.onHeard?.(text); this.finish(); return true; }
    this.listen("command");
    return true;
  }
}
