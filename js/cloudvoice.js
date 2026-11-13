// PG's natural voice and ears through PG Cloud (Deepgram Aura-2 and Nova-3 on Workers AI).
// The microphone opens once per call and stays open, so phones don't beep on and off,
// and PG can tell when you start and stop talking by itself.

// ---- recording ----
export class Mic {
  constructor(o = {}) { this.o = o; this.floor = 0.006; this.hang = 1200; this.armed = false; this.strict = false; this.reset(); }
  get ok() { return !!navigator.mediaDevices?.getUserMedia; }
  async open() {
    if (this.stream && this.stream.active) { await this.ctx?.resume?.().catch(() => {}); return true; }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    } catch (e) { this.err = e; return false; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!this.ctx || this.ctx.state === "closed") this.ctx = new AC();
    await this.ctx.resume().catch(() => {});
    this.rate = this.ctx.sampleRate;
    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.proc = this.ctx.createScriptProcessor(2048, 1, 1);
    const sink = this.ctx.createGain(); sink.gain.value = 0;
    this.src.connect(this.proc); this.proc.connect(sink); sink.connect(this.ctx.destination);
    this.proc.onaudioprocess = e => this.frame(e.inputBuffer.getChannelData(0));
    this.reset();
    return true;
  }
  close() {
    this.armed = false; this.reset();
    try { this.proc && (this.proc.onaudioprocess = null); this.proc?.disconnect(); this.src?.disconnect(); } catch {}
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null; this.proc = null; this.src = null;
  }
  reset() { this.pre = []; this.rec = null; this.loud = 0; this.quiet = 0; this.dur = 0; this.voiced = 0; }
  frame(x) {
    if (!this.armed) { if (this.rec || this.pre.length) this.reset(); return; }
    const f = new Float32Array(x);
    let s = 0; for (let i = 0; i < f.length; i++) s += f[i] * f[i];
    const rms = Math.sqrt(s / f.length), ms = f.length / this.rate * 1000;
    const thr = Math.max(this.floor * (this.strict ? 5 : 2.8), this.strict ? 0.03 : 0.012);
    if (!this.rec) {
      this.pre.push(f); while (this.pre.length * ms > 400) this.pre.shift();
      if (rms > thr) {
        this.loud += ms;
        if (this.loud >= (this.strict ? 320 : 180)) { this.rec = [...this.pre]; this.dur = this.pre.length * ms; this.voiced = this.loud; this.quiet = 0; this.o.onStart?.(); }
      } else {
        this.loud = Math.max(0, this.loud - ms * 0.5);
        this.floor = Math.min(0.05, Math.max(0.002, this.floor * 0.97 + rms * 0.03));   // learns the room's noise
      }
      return;
    }
    this.rec.push(f); this.dur += ms;
    if (rms < thr * 0.8) this.quiet += ms; else { this.quiet = 0; this.voiced += ms; }
    if (this.quiet >= this.hang || this.dur > 30000) {
      const parts = this.rec, voiced = this.voiced; this.reset();
      if (voiced < 260) { this.o.onNoise?.(); return; }
      this.o.onUtter?.(wav(parts, this.rate));
    }
  }
}
// 16 kHz mono WAV, small enough to send quickly
export function wav(parts, rate, to = 16000) {
  const n = parts.reduce((a, p) => a + p.length, 0), all = new Float32Array(n);
  let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
  const k = rate / to, len = Math.floor(n / k), pcm = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    const a = Math.floor(i * k), b = Math.min(n, Math.floor((i + 1) * k)); let s = 0;
    for (let j = a; j < b; j++) s += all[j];
    const v = Math.max(-1, Math.min(1, s / Math.max(1, b - a)));
    pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  const buf = new ArrayBuffer(44 + pcm.byteLength), d = new DataView(buf);
  const w = (p, s) => { for (let i = 0; i < s.length; i++) d.setUint8(p + i, s.charCodeAt(i)); };
  w(0, "RIFF"); d.setUint32(4, 36 + pcm.byteLength, true); w(8, "WAVE"); w(12, "fmt ");
  d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true); d.setUint32(24, to, true);
  d.setUint32(28, to * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); w(36, "data"); d.setUint32(40, pcm.byteLength, true);
  new Int16Array(buf, 44).set(pcm);
  return new Blob([buf], { type: "audio/wav" });
}

// ---- playback ----
export class Player {
  constructor() { this.a = typeof Audio !== "undefined" ? new Audio() : null; if (this.a) { this.a.preload = "auto"; this.a.setAttribute?.("playsinline", ""); } this.url = ""; }
  // Phones only let a page play sound after a tap. Call this from the tap.
  unlock() { if (!this.a || this.unlocked) return; this.unlocked = true; try { this.a.src = URL.createObjectURL(wav([new Float32Array(800)], 16000)); this.a.volume = 0; const p = this.a.play(); p?.then?.(() => { this.a.pause(); this.a.volume = 1; }).catch(() => { this.unlocked = false; this.a.volume = 1; }); } catch { this.unlocked = false; } }
  play(blob) {
    return new Promise(res => {
      if (!this.a) return res(false);
      this.stop();
      this.url = URL.createObjectURL(blob);
      const a = this.a, done = ok => { a.onended = a.onerror = null; clearTimeout(this.guard); res(ok); };
      a.onended = () => done(true); a.onerror = () => done(false);
      a.src = this.url; a.volume = 1;
      a.play().catch(() => done(false));
      this.guard = setTimeout(() => done(true), 60000);
      this.cancel = () => done(true);
    });
  }
  duck(on) { if (this.a) this.a.volume = on ? 0.25 : 1; }
  stop() { if (!this.a) return; try { this.a.pause(); } catch {} if (this.url) { URL.revokeObjectURL(this.url); this.url = ""; } const c = this.cancel; this.cancel = null; c?.(); }
}

// ---- talking to PG Cloud ----
export function cloudApi(base, token) {
  const h = { authorization: "Bearer " + token() };
  return {
    async tts(text, voice) {
      const r = await fetch(base() + "/v1/tts", { method: "POST", headers: { ...h, authorization: "Bearer " + token(), "content-type": "application/json" }, body: JSON.stringify({ text, voice }) });
      if (!r.ok) { const e = new Error("tts " + r.status); e.status = r.status; throw e; }
      const b = await r.blob(); if (b.size < 200) throw new Error("tts empty");
      return b;
    },
    async stt(blob) {
      const r = await fetch(base() + "/v1/stt", { method: "POST", headers: { authorization: "Bearer " + token(), "content-type": "audio/wav" }, body: blob });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { const e = new Error(j.error?.message || "stt " + r.status); e.status = r.status; throw e; }
      return String(j.text || "").trim();
    }
  };
}

// The voices you can pick. Aura-2 is English only, so Cantonese is spoken by the device's own Hong Kong voice.
export const VOICES = [
  { id: "apollo", name: "Apollo", kind: "Male, relaxed and casual" },
  { id: "arcas", name: "Arcas", kind: "Male, smooth and natural" },
  { id: "orion", name: "Orion", kind: "Male, warm and easy" },
  { id: "aries", name: "Aries", kind: "Male, warm and caring" },
  { id: "odysseus", name: "Odysseus", kind: "Male, calm and professional" },
  { id: "thalia", name: "Thalia", kind: "Female, clear and upbeat" },
  { id: "luna", name: "Luna", kind: "Female, friendly and natural" },
  { id: "andromeda", name: "Andromeda", kind: "Female, casual and expressive" },
  { id: "helena", name: "Helena", kind: "Female, warm and caring" }
];
