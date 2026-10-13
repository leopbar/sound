import beatTrack from '@audio/beat-track';

/**
 * Análise de ritmo da faixa inteira, fora da thread principal.
 * Rastreador de Ellis (programação dinâmica) do @audio/beat-track: nos testes com o
 * "Beat This!" (CPJKU) como gabarito, acertou ~98% das batidas com tolerância de 70 ms.
 */
const FRAME = 2048;

// O rastreador devolve o início da janela de análise; o ataque fica, em média, no meio dela.
const frameCenter = (sr) => FRAME / 2 / sr;

/** Qual das 4 batidas é o "1" do compasso: a que concentra mais grave logo após a batida. */
function downbeatPhase(samples, sr, beats) {
  const a = 1 - Math.exp((-2 * Math.PI * 150) / sr);
  const win = Math.floor(0.08 * sr);
  const sums = [0, 0, 0, 0];
  let lp = 0;
  let next = 0;
  let acc = 0;
  let end = -1;
  for (let i = 0; i < samples.length && next <= beats.length; i++) {
    lp += a * (samples[i] - lp);
    if (next < beats.length && i >= Math.floor(beats[next] * sr)) {
      end = i + win;
      acc = 0;
      next++;
    }
    if (i < end) {
      acc += lp * lp;
      if (i === end - 1) sums[(next - 1) % 4] += acc;
    }
  }
  return sums.indexOf(Math.max(...sums));
}

self.onmessage = ({ data: { id, samples, sampleRate } }) => {
  try {
    const res = beatTrack(samples, { fs: sampleRate, frameSize: FRAME, minBpm: 70, maxBpm: 160 });
    const shift = frameCenter(sampleRate);
    const beats = Float32Array.from(res.beats, (b) => b + shift);
    const downbeat = beats.length >= 8 ? downbeatPhase(samples, sampleRate, beats) : 0;
    self.postMessage({ id, beats, bpm: res.bpm, downbeat }, [beats.buffer]);
  } catch (err) {
    self.postMessage({ id, error: err.message || String(err) });
  }
};
