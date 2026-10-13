import { streamUrl } from './api';
import { cachedBlob } from './trackCache';

/**
 * Grade de batidas da faixa inteira (para o dançarino).
 *
 * Detectar a batida ao vivo pelo AnalyserNode só enxerga o passado e erra a fase; aqui o
 * áudio é baixado e decodificado uma vez, o worker calcula todas as batidas e o dançarino
 * as consulta pelo tempo de reprodução (`audio.currentTime`). Resultado em cache na memória
 * e no localStorage (só os tempos das batidas, poucos KB por faixa).
 */
const SAMPLE_RATE = 22050; // suficiente para ritmo e corta pela metade a memória da decodificação
const MAX_DURATION_S = 15 * 60;
const STORE_KEY = 'sound:beats';
const STORE_MAX = 40;

const memory = new Map(); // track.id -> grade
let worker = null;
const pending = new Map(); // id -> { resolve, reject } (resposta do worker)
const inflight = new Map(); // id -> Promise (evita baixar a mesma faixa duas vezes)

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./beatWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      if (data.error) p.reject(new Error(data.error));
      else p.resolve(data);
    };
  }
  return worker;
}

function readStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
  } catch {
    return {};
  }
}

// Tempos em ms, codificados como diferenças (números pequenos = JSON curto).
function save(id, grid) {
  try {
    const all = readStore();
    let last = 0;
    const d = Array.from(grid.beats, (b) => {
      const ms = Math.round(b * 1000);
      const delta = ms - last;
      last = ms;
      return delta;
    });
    all[id] = { d, bpm: Math.round(grid.bpm * 10) / 10, db: grid.downbeat, at: Date.now() };
    const ids = Object.keys(all);
    if (ids.length > STORE_MAX) {
      ids.sort((a, b) => all[a].at - all[b].at);
      for (const old of ids.slice(0, ids.length - STORE_MAX)) delete all[old];
    }
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    /* sem armazenamento: fica só na memória */
  }
}

function load(id) {
  const e = readStore()[id];
  if (!e?.d?.length) return null;
  let t = 0;
  const beats = Float32Array.from(e.d, (delta) => (t += delta) / 1000);
  return { beats, bpm: e.bpm, downbeat: e.db || 0 };
}

async function decodeMono(buffer) {
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const audio = await new Ctx(1, 1, SAMPLE_RATE).decodeAudioData(buffer);
  if (audio.numberOfChannels === 1) return audio.getChannelData(0).slice(); // cópia: vai ser transferida
  const out = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const ch = audio.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += ch[i];
  }
  const k = 1 / audio.numberOfChannels;
  for (let i = 0; i < out.length; i++) out[i] *= k;
  return out;
}

let active = null; // { id, controller }: análise em andamento (uma faixa por vez)

/**
 * Devolve `{ beats: Float32Array (s), bpm, downbeat }` ou null se não der para analisar.
 * O download segue mesmo se o dançarino for remontado (troca de layout do painel); só é
 * cancelado quando outra faixa é pedida ou por `cancelBeatGrid()`.
 */
export function getBeatGrid(track) {
  if (!track?.id || !track.streamUrl || track.duration > MAX_DURATION_S) return Promise.resolve(null);
  const hit = memory.get(track.id) || load(track.id);
  if (hit) {
    memory.set(track.id, hit);
    return Promise.resolve(hit);
  }
  if (inflight.has(track.id)) return inflight.get(track.id);
  cancelBeatGrid();
  const controller = new AbortController();
  active = { id: track.id, controller };
  const p = analyze(track, controller.signal).finally(() => {
    if (inflight.get(track.id) === p) inflight.delete(track.id);
    if (active?.controller === controller) active = null;
  });
  inflight.set(track.id, p);
  return p;
}

/** Cancela a análise em andamento (dançarino desligado ou outra faixa). */
export function cancelBeatGrid() {
  if (!active) return;
  active.controller.abort();
  inflight.delete(active.id);
  active = null;
}

async function analyze(track, signal) {
  // Faixa já baixada para a memória (próxima da fila): sem segundo download.
  let buffer;
  const blob = cachedBlob(track.id);
  if (blob) {
    buffer = await blob.arrayBuffer();
  } else {
    const res = await fetch(streamUrl(track), { credentials: 'include', signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buffer = await res.arrayBuffer();
  }
  const samples = await decodeMono(buffer);
  signal?.throwIfAborted();

  const grid = await new Promise((resolve, reject) => {
    pending.set(track.id, { resolve, reject });
    getWorker().postMessage({ id: track.id, samples, sampleRate: SAMPLE_RATE }, [samples.buffer]);
  });
  if (grid.beats.length < 8) return null;
  const out = { beats: grid.beats, bpm: grid.bpm, downbeat: grid.downbeat };
  memory.set(track.id, out);
  if (memory.size > STORE_MAX) memory.delete(memory.keys().next().value);
  save(track.id, out);
  return out;
}
