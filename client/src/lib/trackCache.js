import { streamUrl } from './api';
import { logEvent } from './playerLog';
import { engine } from './audioEngine';

/**
 * Próxima faixa guardada na memória do aparelho (Blob).
 *
 * Com a tela apagada, o Android só deixa o app usar a rede enquanto há som tocando: quando a
 * faixa termina, a rede é cortada (Doze/economia de bateria) e a próxima, pedida pela rede,
 * fica travada até a tela acender. Baixando a próxima durante a atual, a troca não depende de rede.
 */
const MAX_ENTRIES = 3; // anterior, atual e próxima
const MAX_DURATION_S = 15 * 60;

const RETRY_AFTER_MS = 30_000;

const entries = new Map(); // track.id -> { blob, url } (ordem de inserção = mais antigo primeiro)
const inflight = new Set();
const failedAt = new Map(); // track.id -> quando falhou (espera antes de tentar de novo)

export function cachedUrl(id) {
  return entries.get(id)?.url || null;
}

export function cachedBlob(id) {
  return entries.get(id)?.blob || null;
}

/** Descarta a cópia (ex.: deu erro ao tocar: a próxima tentativa vai pela rede). */
export function dropCached(id) {
  const e = entries.get(id);
  if (!e) return;
  entries.delete(id);
  URL.revokeObjectURL(e.url);
}

/** Baixa a faixa inteira para a memória (uma vez; falhas são silenciosas). */
export async function prefetchTrack(track) {
  if (!track?.id || !track.streamUrl || entries.has(track.id) || inflight.has(track.id)) return;
  if (track.duration > MAX_DURATION_S || Date.now() - (failedAt.get(track.id) || 0) < RETRY_AFTER_MS) return;
  inflight.add(track.id);
  const started = Date.now();
  try {
    const res = await fetch(streamUrl(track), { credentials: 'include', signal: AbortSignal.timeout(180_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const expected = Number(res.headers.get('Content-Length')) || 0;
    const blob = await res.blob();
    if (!blob.size || (expected && blob.size !== expected)) throw new Error('incompleto');
    entries.set(track.id, { blob, url: URL.createObjectURL(blob) });
    // Libera as mais antigas, nunca a que está tocando.
    for (const id of [...entries.keys()]) {
      if (entries.size <= MAX_ENTRIES) break;
      if (id !== engine.trackId && id !== track.id) dropCached(id);
    }
    logEvent('prefetch', { id: track.id, ok: 1, kb: Math.round(blob.size / 1024), s: Math.round((Date.now() - started) / 1000) });
  } catch (err) {
    failedAt.set(track.id, Date.now());
    logEvent('prefetch', { id: track.id, ok: 0, err: err.name === 'TimeoutError' ? 'timeout' : String(err.message).slice(0, 30) });
  } finally {
    inflight.delete(track.id);
  }
}
