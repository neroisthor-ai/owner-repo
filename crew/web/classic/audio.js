// Temp sound for the animatic. Everything is scheduled at an explicit time on
// an AudioContext, so the same code plays live and renders offline for export.
// Live dialogue uses browser TTS voices; exports (which can't record TTS) get a
// voiced "walla" track that keeps the real line timing.

const CHORDS = { tense: [55, 58.27, 82.41], warm: [130.81, 164.81, 196], sad: [110, 130.81, 164.81], upbeat: [196, 246.94, 293.66], mystery: [146.83, 207.65, 277.18], comic: [98, 123.47, 146.83] };

export class SoundEngine {
  constructor(ctx) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(ctx.destination);
    this.duck = ctx.createGain();
    this.duck.connect(this.master);
    this.beds = { music: null, amb: null };
    this.noiseBuf = null;
  }

  noise() {
    if (!this.noiseBuf) {
      const b = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = b;
    }
    return this.noiseBuf;
  }

  burst(at, len, freq, q = 1, gain = 0.4, type = "bandpass") {
    const ctx = this.ctx, s = ctx.createBufferSource();
    s.buffer = this.noise();
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, at); g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    s.connect(f).connect(g).connect(this.duck); s.start(at); s.stop(at + len + 0.05);
  }

  tone(at, freq, len, gain = 0.2, type = "sine", glide = 0) {
    const ctx = this.ctx, o = ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, at);
    if (glide) o.frequency.exponentialRampToValueAtTime(freq * glide, at + len);
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, at); g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o.connect(g).connect(this.duck); o.start(at); o.stop(at + len + 0.05);
  }

  sfx(at, name, dur = 0.5) {
    const base = (name ?? "").split(".")[0];
    switch (name) {
      case "door.creak": this.tone(at, 180, 1.1, 0.08, "sawtooth", 1.6); this.burst(at, 0.15, 300, 2, 0.3); return;
      case "fridge.hum": this.tone(at, 60, dur, 0.06); this.tone(at, 120, dur, 0.02); return;
      case "fridge.open": this.burst(at, 0.25, 900, 0.7, 0.35); this.tone(at, 70, 1.2, 0.05); return;
      case "light.switch": this.burst(at, 0.04, 3000, 3, 0.5); return;
    }
    switch (base) {
      case "door": this.burst(at, 0.3, 160, 1, 0.8, "lowpass"); return;
      case "knock": for (const d of [0, 0.18, 0.36]) this.burst(at + d, 0.08, 400, 2, 0.8); return;
      case "footsteps": for (let i = 0; i < Math.max(2, dur / 0.45); i++) this.burst(at + i * 0.45, 0.06, 250, 1.5, 0.35); return;
      case "glass": case "mug": case "plate": case "fork": this.tone(at, 2000, 0.4, 0.08, "triangle"); return;
      case "phone": for (const d of [0, 0.4, 0.8]) { this.tone(at + d, 880, 0.3, 0.06, "square"); this.tone(at + d, 1100, 0.3, 0.04, "square"); } return;
      case "sting": this.tone(at, 110, 1.2, 0.25, "sawtooth", 0.5); this.tone(at, 55, 1.4, 0.2, "square", 0.5); this.burst(at, 0.4, 2000, 0.5, 0.3, "highpass"); return;
      case "whoosh": this.burst(at, 0.5, 800, 0.3, 0.4); return;
      case "thunder": this.burst(at, 2, 90, 0.5, 1.2, "lowpass"); return;
      case "crash": this.burst(at, 0.8, 1500, 0.4, 0.9); return;
      case "clock": for (let i = 0; i < 4; i++) this.burst(at + i * 0.5, 0.02, 4000, 4, 0.5); return;
      case "rain": case "wind": this.burst(at, dur, base === "rain" ? 2500 : 500, 0.3, 0.3); return;
      default: this.tone(at, 440, 0.2, 0.05);
    }
  }

  bed(at, slot, name) {
    const cur = this.beds[slot];
    if ((cur?.name ?? null) === name) return;
    if (cur) {
      cur.g.gain.cancelScheduledValues(at);
      cur.g.gain.setTargetAtTime(0.0001, at, 0.2);
      for (const n of cur.nodes) try { n.stop(at + 1.2); } catch { /* not started */ }
      this.beds[slot] = null;
    }
    if (!name) return;
    const ctx = this.ctx, g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(slot === "music" ? 0.05 : 0.025, at + 1.2);
    g.connect(this.duck);
    const nodes = [];
    if (slot === "music") {
      for (const f of CHORDS[name] ?? CHORDS.warm) {
        const o = ctx.createOscillator(); o.type = name === "tense" ? "sawtooth" : "triangle"; o.frequency.value = f;
        const lfo = ctx.createOscillator(); lfo.frequency.value = 0.15 + (f % 7) * 0.03;
        const lg = ctx.createGain(); lg.gain.value = f * 0.004; lfo.connect(lg).connect(o.frequency);
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = name === "tense" ? 500 : 1400;
        o.connect(lp).connect(g); o.start(at); lfo.start(at); nodes.push(o, lfo);
      }
    } else {
      const s = ctx.createBufferSource(); s.buffer = this.noise(); s.loop = true;
      const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = name === "rain" ? 2500 : name === "street" ? 900 : 400;
      s.connect(f).connect(g); s.start(at); nodes.push(s);
      if (name === "kitchen") { const o = ctx.createOscillator(); o.frequency.value = 60; const og = ctx.createGain(); og.gain.value = 0.3; o.connect(og).connect(g); o.start(at); nodes.push(o); }
    }
    this.beds[slot] = { name, g, nodes };
  }

  silence(at, dur) {
    const g = this.duck.gain;
    g.setTargetAtTime(0.0001, at, 0.05);
    g.setTargetAtTime(1, at + dur, 0.15);
  }

  /** a voiced murmur with the line's real timing, for exports */
  walla(at, e, cast) {
    const ctx = this.ctx, female = /female|woman/i.test(cast[e.char]?.voice ?? "");
    const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = female ? 205 : 118;
    const f1 = ctx.createBiquadFilter(); f1.type = "bandpass"; f1.frequency.value = 700; f1.Q.value = 3;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, at);
    const syll = Math.max(1, Math.round(e.text.split(/\s+/).length * 1.4));
    for (let i = 0; i < syll; i++) {
      const t = at + (i / syll) * e.dur;
      g.gain.linearRampToValueAtTime(e.verb === "whisper" ? 0.05 : 0.16, t + 0.03);
      g.gain.linearRampToValueAtTime(0.02, t + (e.dur / syll) * 0.8);
      o.frequency.setValueAtTime((female ? 205 : 118) * (1 + 0.06 * Math.sin(i * 1.7)), t);
    }
    g.gain.linearRampToValueAtTime(0, at + e.dur + 0.05);
    o.connect(f1).connect(g).connect(this.duck); o.start(at); o.stop(at + e.dur + 0.1);
  }

  /** schedule every event in [from, to) of the cut, relative to ctx time `origin` (= cut time `from`) */
  schedule(events, cast, from, to, origin, { walla = false, stateAt = true } = {}) {
    if (stateAt) {
      let music = null, amb = null;
      for (const e of events) { if (e.t >= from) break; if (e.type === "music") music = e.name === "stop" ? null : e.name; if (e.type === "ambience") amb = e.name === "stop" ? null : e.name; }
      this.bed(origin, "music", music); this.bed(origin, "amb", amb);
    }
    for (const e of events) {
      if (e.t < from || e.t >= to) continue;
      const at = origin + (e.t - from);
      if (e.type === "sfx") this.sfx(at, e.name, e.dur);
      else if (e.type === "music") this.bed(at, "music", e.name === "stop" ? null : e.name);
      else if (e.type === "ambience") this.bed(at, "amb", e.name === "stop" ? null : e.name);
      else if (e.type === "silence") this.silence(at, e.dur);
      else if (e.type === "say" && walla) this.walla(at, e, cast);
    }
  }

  stop() { const t = this.ctx.currentTime; this.bed(t, "music", null); this.bed(t, "amb", null); }
}

/** Live playback: Web Audio for sfx/music, browser TTS for dialogue. */
export class LiveSound {
  constructor() {
    this.engine = null;
    this.muted = false;
    this.voices = [];
    if ("speechSynthesis" in window) {
      const load = () => { this.voices = speechSynthesis.getVoices(); };
      load();
      speechSynthesis.onvoiceschanged = load;
    }
  }
  ensure() {
    if (!this.engine) this.engine = new SoundEngine(new AudioContext());
    if (this.engine.ctx.state === "suspended") this.engine.ctx.resume();
    return this.engine;
  }
  setMuted(m) { this.muted = m; if (this.engine) this.engine.master.gain.value = m ? 0 : 0.8; if (m) this.stop(); }
  /** called when playback starts or seeks: rebuild bed state */
  start(events, t) { if (this.muted) return; const e = this.ensure(); e.schedule(events, {}, t, t, e.ctx.currentTime); }
  /** called every tick with the time window just played */
  tick(events, cast, from, to) {
    if (this.muted || to <= from) return;
    const e = this.ensure();
    e.schedule(events, cast, from, to, e.ctx.currentTime, { stateAt: false });
    for (const ev of events) if (ev.type === "say" && ev.t >= from && ev.t < to) this.say(ev, cast);
  }
  say(e, cast) {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(e.text);
    const c = cast[e.char] ?? {};
    const en = this.voices.filter((v) => v.lang?.startsWith("en"));
    const female = /female|woman/i.test(c.voice ?? "");
    const pick = en.find((v) => (female ? /female|samantha|victoria|karen|moira|tessa|fiona|zira|susan/i : /male|daniel|alex|fred|oliver|arthur|david|mark|rishi/i).test(v.name)) ?? en[0];
    if (pick) u.voice = pick;
    const words = e.text.split(/\s+/).length;
    u.rate = Math.max(0.7, Math.min(1.6, words / Math.max(0.5, e.dur) / 2.7));
    u.pitch = female ? 1.15 : 0.9;
    u.volume = e.verb === "whisper" ? 0.45 : 1;
    speechSynthesis.speak(u);
  }
  stop() { if ("speechSynthesis" in window) speechSynthesis.cancel(); this.engine?.stop(); }
}

/** Render the cut's sound offline (for MP4 export). */
export async function renderAudio(events, cast, from, to, sampleRate = 48000) {
  const len = Math.max(1, Math.ceil((to - from) * sampleRate));
  const ctx = new OfflineAudioContext(2, len, sampleRate);
  const eng = new SoundEngine(ctx);
  eng.schedule(events, cast, from, to, 0, { walla: true });
  return ctx.startRendering();
}
