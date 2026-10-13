import { engine } from './audioEngine';

/**
 * Acompanha o ritmo da música em tempo real a partir do `beatAnalyser` do engine.
 *
 * 1. Detecção de ataques (onsets): fluxo espectral (aumento de energia entre quadros),
 *    com peso dobrado nos graves (bumbo/baixo), comparado a um limiar adaptativo.
 * 2. Andamento: histograma dos intervalos entre os ataques dos últimos segundos
 *    (inclui múltiplos do período), com preferência suave por ~120 BPM.
 * 3. Fase: um oscilador avança `beats` continuamente no período estimado e, a cada
 *    ataque, é puxado para a grade que melhor explica os ataques recentes (com peso
 *    maior para os graves). Assim os movimentos caem na batida mesmo entre ataques.
 */
const MIN_PERIOD = 60 / 160; // 160 BPM
const MAX_PERIOD = 60 / 70; //  70 BPM
const DEFAULT_PERIOD = 0.5; // 120 BPM
const HISTORY_S = 8;
const FLUX_WINDOW = 45; // ~0,75 s de quadros para o limiar adaptativo
const PHASE_WINDOW_S = 5;
const TAU = Math.PI * 2;

export class BeatTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.prev = null;
    this.fluxHist = [];
    this.onsets = []; // { t, s (força), w (peso na fase) }
    this.bassAvg = 1;
    this.lastOnset = -1;
    this.period = DEFAULT_PERIOD;
    this.candidate = null; // período novo esperando confirmação
    this.candidateHits = 0;
    this.beats = 0; // contador contínuo de batidas (parte inteira = batida, fração = fase)
    this.lastT = null;
    this.peak = 1e-3; // controle automático de ganho da energia
    this.energy = 0; // 0..1 (graves, normalizado)
    this.pulse = 0; // 0..1, salta a cada ataque e decai
    this.locked = 0; // 0..1, confiança no andamento
  }

  /** Avança um quadro. `active` = tocando. Retorna o estado atual. */
  update(t, active) {
    const dt = this.lastT == null ? 0 : Math.min(0.1, t - this.lastT);
    this.lastT = t;
    this.beats += dt / this.period;
    this.pulse *= Math.exp(-dt / 0.12);

    const an = engine.beatAnalyser;
    if (!active || !an) {
      this.energy *= Math.exp(-dt / 0.3);
      this.prev = null;
      return this;
    }

    const bins = an.frequencyBinCount;
    if (!this.buf || this.buf.length !== bins) this.buf = new Uint8Array(bins);
    const cur = this.buf;
    an.getByteFrequencyData(cur);

    const hz = an.context.sampleRate / an.fftSize;
    const bassEnd = Math.max(2, Math.round(180 / hz));
    const midEnd = Math.min(bins, Math.round(2500 / hz));

    let bass = 0;
    for (let k = 1; k < bassEnd; k++) bass += cur[k];
    bass /= (bassEnd - 1) * 255;
    this.peak = Math.max(bass, this.peak * Math.exp(-dt / 6));
    const level = this.peak > 0.02 ? bass / this.peak : 0;
    this.energy += (level - this.energy) * Math.min(1, dt / 0.08);

    let flux = 0;
    let bassFlux = 0;
    if (this.prev) {
      for (let k = 1; k < midEnd; k++) {
        const d = cur[k] - this.prev[k];
        if (d <= 0) continue;
        if (k < bassEnd) {
          flux += 2 * d;
          bassFlux += d;
        } else flux += d;
      }
      flux /= midEnd;
      bassFlux /= bassEnd - 1;
    } else {
      this.prev = new Uint8Array(bins);
    }
    this.prev.set(cur);

    const hist = this.fluxHist;
    if (hist.length >= 8) {
      let mean = 0;
      for (const f of hist) mean += f;
      mean /= hist.length;
      let v = 0;
      for (const f of hist) v += (f - mean) ** 2;
      const thr = mean + 1.4 * Math.sqrt(v / hist.length) + 0.5;
      if (flux > thr && t - this.lastOnset > 0.18) this.onset(t, (flux - thr) / (thr + 1e-6), bassFlux);
    }
    hist.push(flux);
    if (hist.length > FLUX_WINDOW) hist.shift();
    return this;
  }

  onset(t, strength, bassFlux) {
    this.lastOnset = t;
    const s = Math.min(1, 0.35 + strength);
    this.pulse = Math.max(this.pulse, s);
    this.bassAvg += (bassFlux - this.bassAvg) * 0.05;
    // Ataques com grave (bumbo) pesam mais: costumam cair na batida; chimbal/contratempo, não.
    const w = s * (0.25 + Math.min(2, bassFlux / (this.bassAvg + 1e-6)));
    this.onsets.push({ t, s, w });
    while (this.onsets.length && t - this.onsets[0].t > HISTORY_S) this.onsets.shift();

    this.estimateTempo();
    this.alignPhase(t);
  }

  /**
   * Fase da grade de batidas que melhor explica os ataques recentes (média circular
   * ponderada), e puxa o oscilador suavemente para ela.
   */
  alignPhase(t) {
    let x = 0;
    let y = 0;
    let total = 0;
    for (const o of this.onsets) {
      if (t - o.t > PHASE_WINDOW_S) continue;
      const a = (TAU * (o.t - t)) / this.period;
      x += o.w * Math.cos(a);
      y += o.w * Math.sin(a);
      total += o.w;
    }
    if (!total) return;
    // Batidas em t + k·período + atan2(y, x)/TAU·período ⇒ a fração de `beats` agora deveria ser:
    const want = -Math.atan2(y, x) / TAU;
    let err = this.beats - want;
    err -= Math.round(err);
    this.locked = Math.hypot(x, y) / total;
    this.beats -= err * 0.3 * Math.min(1, this.locked * 2);
  }

  estimateTempo() {
    const on = this.onsets;
    if (on.length < 5) return;
    const steps = 100;
    const scores = new Float32Array(steps + 1);
    for (let i = 0; i < on.length; i++) {
      for (let j = i + 1; j < on.length; j++) {
        const d = on[j].t - on[i].t;
        if (d > 3.5) break;
        const w = on[i].s * on[j].s;
        for (let n = 1; n <= 4; n++) {
          const p = d / n;
          if (p < MIN_PERIOD) break;
          if (p > MAX_PERIOD) continue;
          const x = ((p - MIN_PERIOD) / (MAX_PERIOD - MIN_PERIOD)) * steps;
          const i0 = Math.floor(x);
          scores[i0] += (w / n) * (1 - (x - i0));
          if (i0 < steps) scores[i0 + 1] += (w / n) * (x - i0);
        }
      }
    }
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i <= steps; i++) {
      const p = MIN_PERIOD + (i / steps) * (MAX_PERIOD - MIN_PERIOD);
      // Suaviza o histograma e prefere andamentos perto de 120 BPM (evita meia/dupla velocidade).
      const sc = ((scores[i - 1] || 0) + 2 * scores[i] + (scores[i + 1] || 0)) * Math.exp(-0.5 * (Math.log2(p / 0.5) / 0.5) ** 2);
      if (sc > bestScore) {
        bestScore = sc;
        best = p;
      }
    }
    if (best < 0) return;

    if (Math.abs(best - this.period) / this.period < 0.06) {
      this.period += (best - this.period) * 0.25;
      this.candidate = null;
    } else if (this.candidate && Math.abs(best - this.candidate) / this.candidate < 0.06) {
      // Só troca de andamento depois de algumas confirmações seguidas.
      if (++this.candidateHits >= 3) {
        this.period = best;
        this.candidate = null;
      }
    } else {
      this.candidate = best;
      this.candidateHits = 1;
    }
  }
}
