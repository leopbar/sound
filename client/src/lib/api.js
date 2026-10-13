import { authClient } from './authClient';
import { API_BASE as BASE } from './base';

/** Sessão expirou/foi revogada em outro dispositivo: o useSession refaz a consulta e volta ao login. */
function checkAuth(res) {
  if (res.status === 401 || res.status === 403) authClient.$store.notify('$sessionSignal');
}

async function request(path, { method = 'GET', body, signal } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    signal,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  checkAuth(res);
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || `Erro ${res.status}`), { status: res.status, code: data.error });
  return data;
}

async function getResults(path, query, signal) {
  const body = await request(`${path}?q=${encodeURIComponent(query)}`, { signal });
  return body.results || [];
}

/** Gravações (MusicBrainz -> fonte de áudio). */
export const searchTracks = (query, { signal } = {}) => getResults('/api/search', query, signal);

/** Vídeos na ordem do próprio YouTube. */
export const searchVideos = (query, { signal } = {}) => getResults('/api/search/youtube', query, signal);

/** Letra (LRCLIB) da faixa: { found, instrumental, synced: [{ time, text }] | null, plain }. */
export function getLyrics(track, { signal } = {}) {
  const params = new URLSearchParams({ title: track.title || '', artist: track.artist || '' });
  if (track.album) params.set('album', track.album);
  if (track.duration) params.set('duration', String(Math.round(track.duration)));
  if (track.kind === 'video') params.set('kind', 'video');
  return request(`/api/lyrics?${params}`, { signal });
}

/* ---------------------------- playlists ---------------------------- */

const pl = (id) => `/api/playlists/${encodeURIComponent(id)}`;

export const playlistsApi = {
  list: () => request('/api/playlists').then((r) => r.playlists),
  create: (name, track) => request('/api/playlists', { method: 'POST', body: { name, track } }),
  import: (playlists) => request('/api/playlists/import', { method: 'POST', body: { playlists } }).then((r) => r.playlists),
  rename: (id, name) => request(pl(id), { method: 'PATCH', body: { name } }),
  remove: (id) => request(pl(id), { method: 'DELETE' }),
  addTrack: (id, track) => request(`${pl(id)}/tracks`, { method: 'POST', body: { track } }),
  removeTrack: (id, trackId) => request(`${pl(id)}/tracks/${encodeURIComponent(trackId)}`, { method: 'DELETE' }),
  reorder: (id, ids) => request(`${pl(id)}/order`, { method: 'PUT', body: { ids } }),
  shuffle: (id) => request(`${pl(id)}/shuffle`, { method: 'POST', body: {} }),
  restoreOrder: (id) => request(`${pl(id)}/restore-order`, { method: 'POST', body: {} }),
};

/** Admin: cadastro de usuários e senhas temporárias (troca obrigatória no próximo login). */
const adminUser = (id) => `/api/admin/users/${encodeURIComponent(id)}`;

export const adminApi = {
  createUser: ({ name, email, role }) => request('/api/admin/users', { method: 'POST', body: { name, email, role } }),
  getTempPassword: (userId) => request(`${adminUser(userId)}/temp-password`),
  resetTempPassword: (userId) => request(`${adminUser(userId)}/temp-password`, { method: 'POST', body: {} }),
};

export function streamUrl(track) {
  return `${BASE}${track.streamUrl}`;
}

/**
 * O <audio> não expõe o corpo de respostas de erro. Quando a reprodução falha,
 * sondamos a rota para ler o JSON explicativo devolvido pelo backend (status 502).
 */
export async function probeStreamError(track) {
  try {
    const res = await fetch(streamUrl(track), { headers: { Range: 'bytes=0-1' }, credentials: 'include' });
    checkAuth(res);
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
