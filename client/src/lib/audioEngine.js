import { logEvent } from './playerLog';

/**
 * Singleton que encapsula o <audio> nativo e o grafo da Web Audio API.
 * Fica fora do React para sobreviver a re-renders e ao StrictMode.
 *
 * O grafo (AudioContext + analisadores) só é criado quando alguém precisa analisar o som
 * (visualizador na tela, dançarino ligado): `createMediaElementSource` desvia para sempre a saída
 * do <audio> para o AudioContext, e um contexto parado ou com defeito no aparelho deixa a música
 * tocando muda. Sem quem analise, o <audio> toca direto, como em qualquer site.
 */
class AudioEngine {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.crossOrigin = 'anonymous'; // necessário para o AnalyserNode ler amostras
    this.trackId = null; // faixa carregada no <audio>
    this.ctx = null;
    this.analyser = null;
    this.beatAnalyser = null;
    this.graphUsers = 0; // componentes que leem os analisadores
    this.ctxRan = false; // o contexto já chegou a tocar (daí em diante, mudanças vão para o diário)
    // Contexto parado com o <audio> tocando = música muda: tenta retomar.
    this.audio.addEventListener('playing', () => this.resumeGraph());
  }

  /** Estado do áudio para o diário: `none` sem grafo (o <audio> toca direto). */
  get graphState() {
    return this.ctx ? this.ctx.state : 'none';
  }

  /**
   * Visualizador/dançarino avisam que precisam (ou não) dos analisadores. O grafo nasce no próximo
   * play (gesto do usuário) ou já, se a música estiver tocando; depois de criado, fica.
   */
  wantGraph(on) {
    this.graphUsers = Math.max(0, this.graphUsers + (on ? 1 : -1));
    if (on && !this.audio.paused) this.ensureGraph();
  }

  /** O AudioContext só pode ser criado/retomado após um gesto do usuário. */
  ensureGraph() {
    if (this.ctx) {
      this.resumeGraph();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.ctx.addEventListener('statechange', () => this.onGraphState());
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
    this.resumeGraph();
  }

  /** Retoma o contexto se ele parou (ou nasceu parado) enquanto há música tocando. */
  resumeGraph() {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
    ctx.resume().catch(() => {
      /* sem permissão agora: tenta de novo no próximo play/gesto */
    });
  }

  onGraphState() {
    const { state } = this.ctx;
    if (state === 'running' && !this.ctxRan) {
      this.ctxRan = true; // início normal (nasce 'suspended' e passa a 'running'): não registra
      return;
    }
    logEvent('audio', { st: state, pos: Math.round(this.audio.currentTime), paused: this.audio.paused ? 1 : 0 });
    if (state !== 'running' && !this.audio.paused) this.resumeGraph();
  }

  /**
   * Carrega a faixa `trackId` de `src` (rede ou cópia local blob:); `startAt` (s) começa dali
   * (fragmento de mídia `#t=`, o navegador pede o Range certo).
   */
  load(src, startAt = 0, trackId = null) {
    this.trackId = trackId;
    this.audio.src = startAt > 0.5 ? `${src}#t=${startAt.toFixed(1)}` : src;
    this.audio.load();
  }

  /** O <audio> está com esta faixa e em condições de tocar (sem erro)? */
  isReady(trackId) {
    return this.trackId === trackId && !this.audio.error;
  }

  async play() {
    // Grafo já criado: a saída passa por ele, então precisa estar rodando.
    if (this.ctx || this.graphUsers > 0) this.ensureGraph();
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

  /** Volume que de fato sai (0 = mudo), para o diário. */
  get effectiveVolume() {
    return this.audio.muted ? 0 : Math.round(this.audio.volume * 100) / 100;
  }
}

export const engine = new AudioEngine();
