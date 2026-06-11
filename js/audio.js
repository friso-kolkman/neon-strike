// NEON STRIKE — procedural audio engine. Zero assets, pure WebAudio synthesis.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.noiseBuf = null;
    this.muted = false;
    this.musicOn = false;
    this.intensity = 0;
    this.root = 110;
    this.tempo = 128;
    this._seqTimer = null;
    this._nextNoteTime = 0;
    this._step = 0;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 7;
    comp.connect(this.ctx.destination);
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    this.master.connect(comp);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.15;
    this.musicGain.connect(this.master);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.55;
  }

  duckMusic(d) { if (this.musicGain) this.musicGain.gain.value = d ? 0.045 : 0.15; }

  // ---- synthesis primitives ----
  _osc(type, freq, dur, vol, freqEnd, dest, when = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, freq), t0);
    if (freqEnd !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(dest || this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  _oscAt(type, freq, t0, dur, vol, freqEnd, dest) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, freq), t0);
    if (freqEnd !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(dest || this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  _noise(dur, vol, filterFreq, type = 'lowpass', q = 1, dest, when = 0, freqEnd) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(filterFreq, t0);
    if (freqEnd !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f);
    f.connect(g);
    g.connect(dest || this.master);
    s.start(t0);
    s.stop(t0 + dur + 0.03);
  }

  _noiseAt(t0, dur, vol, filterFreq, type, q, dest) {
    if (!this.ctx) return;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type || 'lowpass';
    f.frequency.value = filterFreq;
    f.Q.value = q || 1;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f);
    f.connect(g);
    g.connect(dest || this.master);
    s.start(t0);
    s.stop(t0 + dur + 0.03);
  }

  // ---- sfx ----
  shoot(id) {
    if (!this.ctx) return;
    if (id === 'blaster') {
      this._osc('square', 880, 0.1, 0.16, 220);
      this._noise(0.05, 0.1, 3000, 'highpass');
    } else if (id === 'scatter') {
      this._noise(0.22, 0.5, 1400, 'lowpass', 1, undefined, 0, 200);
      this._osc('sine', 150, 0.16, 0.5, 50);
    } else if (id === 'smg') {
      this._osc('square', 620 + Math.random() * 80, 0.06, 0.14, 280);
      this._noise(0.04, 0.08, 4000, 'highpass');
    } else if (id === 'rocket') {
      this._noise(0.4, 0.4, 600, 'bandpass', 2, undefined, 0, 120);
      this._osc('sawtooth', 220, 0.3, 0.3, 70);
    }
  }

  explosion(big = false) {
    if (!this.ctx) return;
    this._noise(big ? 0.8 : 0.45, big ? 0.8 : 0.55, 1100, 'lowpass', 1, undefined, 0, 60);
    this._osc('sine', big ? 140 : 110, big ? 0.6 : 0.35, 0.8, 28);
    this._osc('triangle', 60, big ? 0.5 : 0.3, 0.5, 30);
  }

  hit() { this._osc('triangle', 1100 + Math.random() * 200, 0.05, 0.14, 700); }

  headshot() {
    this._osc('sine', 1567, 0.07, 0.22);
    this._osc('sine', 2093, 0.12, 0.18, undefined, undefined, 0.05);
  }

  hurt() {
    this._osc('sawtooth', 200, 0.22, 0.4, 80);
    this._noise(0.15, 0.25, 700, 'lowpass');
  }

  pickup(kind = 'item') {
    if (kind === 'weapon') {
      this._osc('square', 330, 0.09, 0.2);
      this._osc('square', 440, 0.09, 0.2, undefined, undefined, 0.08);
      this._osc('square', 660, 0.16, 0.22, undefined, undefined, 0.16);
    } else if (kind === 'overdrive') {
      this._osc('sawtooth', 220, 0.5, 0.3, 880);
      this._noise(0.4, 0.15, 2000, 'highpass');
    } else {
      this._osc('sine', 660, 0.07, 0.2);
      this._osc('sine', 990, 0.12, 0.18, undefined, undefined, 0.06);
    }
  }

  jump() { this._osc('triangle', 280, 0.1, 0.12, 460); }
  dash() { this._noise(0.22, 0.3, 2400, 'highpass', 1, undefined, 0, 500); }
  land() { this._noise(0.08, 0.15, 300, 'lowpass'); }
  enemyShoot() { this._osc('square', 700, 0.09, 0.08, 320); }
  noAmmo() { this._osc('square', 120, 0.04, 0.12); }
  ui() { this._osc('sine', 520, 0.06, 0.12, 700); }

  spawn() {
    this._osc('sawtooth', 100, 0.3, 0.1, 600);
    this._noise(0.2, 0.06, 3000, 'highpass');
  }

  portal() {
    [523, 659, 784, 1047].forEach((f, i) => this._osc('sine', f, 0.5, 0.14, undefined, undefined, i * 0.09));
    this._noise(0.8, 0.08, 4000, 'highpass');
  }

  streak(n) {
    const notes = [523, 659, 784, 1047, 1319, 1568];
    for (let i = 0; i < Math.min(n, 6); i++) this._osc('square', notes[i], 0.1, 0.13, undefined, undefined, i * 0.06);
  }

  playerDie() {
    this._osc('sawtooth', 300, 1.1, 0.5, 40);
    this._noise(0.9, 0.3, 800, 'lowpass', 1, undefined, 0, 60);
  }

  bossRoar() {
    this._osc('sawtooth', 90, 0.9, 0.55, 36);
    this._osc('sawtooth', 134, 0.9, 0.4, 50);
    this._noise(0.7, 0.3, 400, 'lowpass');
  }

  fanfare() {
    const seq = [523, 523, 784, 1047, 1319, 1568];
    seq.forEach((f, i) => {
      this._osc('square', f, 0.22, 0.16, undefined, undefined, i * 0.13);
      this._osc('triangle', f / 2, 0.3, 0.12, undefined, undefined, i * 0.13);
    });
  }

  killChime(idx) {
    // minor-pentatonic ladder: each kill in a chain plays the next note up
    const PENTA = [220, 261.6, 293.7, 329.6, 392, 440, 523.3, 587.3];
    const i = Math.max(0, Math.min(idx, PENTA.length - 1));
    this._osc('triangle', PENTA[i], 0.09, 0.2);
    if (i >= PENTA.length - 1) [440, 523, 880].forEach((f, n) => this._osc('square', f, 0.08, 0.12, undefined, undefined, n * 0.06));
  }

  hoot() {
    // ape chest-beat hoot: two quick rising whoops
    this._osc('square', 300, 0.12, 0.16, 620);
    this._osc('square', 460, 0.14, 0.14, 880, undefined, 0.12);
  }

  apeRoar(big = false) {
    this._osc('sawtooth', big ? 90 : 150, big ? 0.7 : 0.45, 0.35, big ? 38 : 65);
    this._noise(big ? 0.6 : 0.35, 0.22, 500, 'lowpass', 1, undefined, 0, 110);
  }

  riser() { this._osc('sawtooth', 200, 0.95, 0.07, 800); }
  denied() { this._osc('square', 1000, 0.05, 0.22); this._noise(0.09, 0.2, 3500, 'highpass'); }
  graze() { this._noise(0.09, 0.2, 1200, 'bandpass', 2); }
  perfect() { this._osc('sine', 880, 0.3, 0.2, 1760); this._noise(0.25, 0.1, 6000, 'highpass'); }
  siren() { for (let i = 0; i < 4; i++) this._osc('square', i % 2 ? 750 : 600, 0.12, 0.14, undefined, undefined, i * 0.13); }
  miteBeep(f) { this._osc('square', f, 0.05, 0.09); }

  // ---- music: lookahead step sequencer, layers grow with intensity ----
  startMusic(root = 110, tempo = 128) {
    if (!this.ctx) return;
    this.stopMusic();
    this.root = root;
    this.tempo = tempo;
    this.musicOn = true;
    this._step = 0;
    this._nextNoteTime = this.ctx.currentTime + 0.06;
    this._seqTimer = setInterval(() => this._schedule(), 40);
  }

  stopMusic() {
    this.musicOn = false;
    if (this._seqTimer) { clearInterval(this._seqTimer); this._seqTimer = null; }
  }

  _schedule() {
    if (!this.musicOn || !this.ctx) return;
    const spb = 60 / this.tempo / 2; // 8th notes
    while (this._nextNoteTime < this.ctx.currentTime + 0.14) {
      this._playStep(this._step, this._nextNoteTime);
      this._nextNoteTime += spb;
      this._step = (this._step + 1) % 16;
    }
  }

  _playStep(step, t) {
    const semis = [0, 0, 3, 0, 7, 0, 3, 5, 0, 0, 3, 0, 10, 7, 5, 3];
    // kick
    if (step % 4 === 0) this._oscAt('sine', 130, t, 0.13, 0.85, 40, this.musicGain);
    // hats on offbeats
    if (step % 2 === 1) this._noiseAt(t, 0.03, 0.16, 7000, 'highpass', 1, this.musicGain);
    // driving bass
    const f = (this.root / 2) * Math.pow(2, semis[step] / 12);
    this._oscAt('sawtooth', f, t, 0.16, 0.3, undefined, this.musicGain);
    // snare layer
    if (this.intensity >= 1 && step % 8 === 4) this._noiseAt(t, 0.12, 0.3, 1800, 'bandpass', 1.5, this.musicGain);
    // arp layer
    if (this.intensity >= 2 && step % 2 === 0) {
      const af = this.root * 2 * Math.pow(2, semis[(step + 4) % 16] / 12);
      this._oscAt('square', af, t, 0.09, 0.07, undefined, this.musicGain);
    }
    // high stab layer (boss / final waves)
    if (this.intensity >= 3 && step % 4 === 2) {
      const hf = this.root * 4 * Math.pow(2, semis[step] / 12);
      this._oscAt('sawtooth', hf, t, 0.12, 0.06, hf * 0.5, this.musicGain);
    }
  }
}
