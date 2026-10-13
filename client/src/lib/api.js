const BASE = import.meta.env.VITE_API_URL || '';

async function getResults(path, query, signal) {
  const res = await fetch(`${BASE}${path}?q=${encodeURIComponent(query)}`, { signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || `Erro ${res.status} na busca`);
  return body.results || [];
}

/** Gravações (MusicBrainz -> fonte de áudio). */
export const searchTracks = (query, { signal } = {}) => getResults('/api/search', query, signal);

/** Vídeos na ordem do próprio YouTube. */
export const searchVideos = (query, { signal } = {}) => getResults('/api/search/youtube', query, signal);

export function streamUrl(track) {
  return `${BASE}${track.streamUrl}`;
}

/**
 * O <audio> não expõe o corpo de respostas de erro. Quando a reprodução falha,
 * sondamos a rota para ler o JSON explicativo devolvido pelo backend (status 502).
 */
export async function probeStreamError(track) {
  try {
    const res = await fetch(streamUrl(track), { headers: { Range: 'bytes=0-1' } });
    if (res.ok) {
      res.body?.cancel();
      return null;
    }
    const body = await res.json().catch(() => ({}));
    return body.message || `Erro ${res.status}`;
  } catch {
    return null;
  }
}
