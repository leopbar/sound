/**
 * Singleton que encapsula o <audio> nativo e o grafo da Web Audio API.
 * Fica fora do React para sobreviver a re-renders e ao StrictMode.
 */
class AudioEngine {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.crossOrigin = 'anonymous'; // necessário para o AnalyserNode ler amostras
    this.ctx = null;
    this.analyser = null;
    this.beatAnalyser = null;
  }

  /** O AudioContext só pode ser criado/retomado após um gesto do usuário. */
  ensureGraph() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    const source = this.ctx.createMediaElementSource(this.audio);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;
    // Analisador do ritmo (dançarino): mais resolução nos graves e sem suavização, que apagaria os ataques.
    this.beatAnalyser = this.ctx.createAnalyser();
    this.beatAnalyser.fftSize = 1024;
    this.beatAnalyser.smoothingTimeConstant = 0;
    // Analisadores repassam o áudio intacto; ficam em série para serem sempre processados.
    source.connect(this.beatAnalyser);
    this.beatAnalyser.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
  }

  load(src) {
    this.audio.src = src;
    this.audio.load();
  }

  async play() {
    this.ensureGraph();
    try {
      await this.audio.play();
    } catch (err) {
      // AbortError: um novo load() interrompeu o play() anterior — esperado ao trocar rápido de faixa.
      if (err.name !== 'AbortError') throw err;
    }
  }

  pause() {
    this.audio.pause();
  }

  seek(seconds) {
    if (Number.isFinite(seconds)) this.audio.currentTime = seconds;
  }

  setVolume(v) {
    this.audio.volume = Math.min(1, Math.max(0, v));
  }

  setMuted(m) {
    this.audio.muted = m;
  }
}

export const engine = new AudioEngine();
