// One browser recognition session per tap. PG never uploads audio to its Worker.
export class Voice {
  constructor(hooks = {}, engine = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition) {
    this.h = hooks; this.engine = engine; this.mode = "off"; this.rate = 1;
    globalThis.speechSynthesis?.addEventListener?.("voiceschanged", () => this.pickVoice());
  }
  get supported() { return !!this.engine; }
  set(mode) { this.mode = mode; this.h.onState?.(mode); }
  start() {
    if (this.mode !== "off") return false;
    if (!this.engine) { this.h.onError?.("unsupported"); return false; }
    const r = this.rec = new this.engine();
    r.lang = "en-HK"; r.continuous = false; r.interimResults = false;
    const results = new Map();
    let error;
    r.onresult = e => {
      if (this.rec !== r) return;
      for (let i = e.resultIndex ?? 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) results.set(i, e.results[i][0].transcript);
      }
    };
    r.onerror = e => {
      if (this.rec === r) error = e.error;
    };
    r.onend = () => {
      if (this.rec !== r) return;
      this.rec = null; clearTimeout(this.timer); this.set("off");
      const text = [...results].sort(([a], [b]) => a - b).map(([, value]) => value.trim()).filter(Boolean).join(" ");
      if (text) this.h.onTranscript?.(text);
      else this.h.onError?.(error || "no-speech");
    };
    this.set("command");
    try { r.start(); }
    catch { this.kill(); this.h.onError?.("not-allowed"); return false; }
    return true;
  }
  stop() {
    if (!this.rec || this.mode !== "command") return;
    const r = this.rec;
    this.set("thinking");
    this.timer = setTimeout(() => {
      if (this.rec === r) { r.onend(); try { r.abort(); } catch {} }
    }, 2500);
    try { r.stop(); } catch { r.onend(); }
  }
  kill() {
    const r = this.rec;
    this.rec = null; clearTimeout(this.timer);
    try { r?.abort(); } catch {}
    if (this.mode !== "off") this.set("off");
  }
  voices() { return globalThis.speechSynthesis?.getVoices() || []; }
  pickVoice() {
    const all = this.voices();
    this.voice = all.find(v => v.voiceURI === this.voiceURI) || all.find(v => /^en/i.test(v.lang) && v.localService) || all.find(v => /^en/i.test(v.lang));
  }
  yueVoice() { return this.voices().find(v => /^(?:yue|zh[-_]HK)/i.test(v.lang)); }
  hush() { globalThis.speechSynthesis?.cancel(); }
  say(text) {
    if (!text || !globalThis.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") return;
    this.kill(); this.hush(); this.pickVoice();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = this.voice?.lang || "en"; u.rate = this.rate;
    if (this.voice) u.voice = this.voice;
    this.utterance = u;
    const end = () => { if (this.utterance === u) this.utterance = null; };
    u.onend = end; u.onerror = end;
    try { speechSynthesis.speak(u); } catch { end(); }
  }
}
