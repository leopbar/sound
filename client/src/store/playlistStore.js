import { create } from 'zustand';
import { playlistsApi } from '../lib/api';
import { usePlayerStore } from './playerStore';

// Playlists da versão sem login, guardadas só no navegador: importadas na primeira entrada.
const LEGACY_KEY = 'sound:playlists';

function takeLegacy() {
  try {
    const data = JSON.parse(localStorage.getItem(LEGACY_KEY));
    return Array.isArray(data) && data.length ? data : null;
  } catch {
    return null;
  }
}

const notify = (text) => usePlayerStore.setState({ notice: { id: Date.now(), text } });

let loading = null;

/**
 * Playlists do usuário logado, guardadas no servidor. As alterações aparecem na hora
 * (otimistas) e são desfeitas se o servidor recusar.
 */
export const usePlaylistStore = create((set, get) => {
  /**
   * Aplica a mudança local e chama o servidor. Se ele recusar, recarrega o estado real
   * (restaurar um snapshot poderia desfazer outras alterações feitas nesse meio-tempo).
   */
  async function optimistic(change, call) {
    set({ playlists: change(get().playlists) });
    try {
      await call();
    } catch (err) {
      notify(err.message || 'Não foi possível salvar a alteração.');
      if (err.status !== 401) get().load();
    }
  }

  async function replaceFromServer(id, call, fallback) {
    try {
      const updated = await call();
      set({ playlists: get().playlists.map((p) => (p.id === id ? updated : p)) });
    } catch (err) {
      notify(err.message || fallback);
      if (err.status !== 401) get().load();
    }
  }

  const mapOne = (id, fn) => (list) => list.map((p) => (p.id === id ? fn(p) : p));

  return {
    playlists: [],
    status: 'idle', // idle | loading | ready | error

    load() {
      if (loading) return loading;
      set({ status: 'loading' });
      loading = (async () => {
        try {
          const legacy = takeLegacy();
          if (legacy) {
            await playlistsApi.import(legacy);
            localStorage.removeItem(LEGACY_KEY);
            notify(`${legacy.length} playlist(s) deste navegador foram salvas na sua conta.`);
          }
          set({ playlists: await playlistsApi.list(), status: 'ready' });
        } catch {
          set({ status: 'error' });
        } finally {
          loading = null;
        }
      })();
      return loading;
    },

    reset() {
      set({ playlists: [], status: 'idle' });
    },

    async create(name, track) {
      try {
        const playlist = await playlistsApi.create(name.trim() || 'Nova playlist', track);
        set({ playlists: [...get().playlists, playlist] });
        return playlist.id;
      } catch (err) {
        notify(err.message || 'Não foi possível criar a playlist.');
        return null;
      }
    },

    rename(id, name) {
      const clean = name.trim();
      if (!clean) return;
      optimistic(mapOne(id, (p) => ({ ...p, name: clean })), () => playlistsApi.rename(id, clean));
    },

    remove(id) {
      optimistic((list) => list.filter((p) => p.id !== id), () => playlistsApi.remove(id));
    },

    addTrack(id, track) {
      optimistic(
        mapOne(id, (p) => (p.tracks.some((t) => t.id === track.id) ? p : { ...p, tracks: [...p.tracks, track] })),
        () => playlistsApi.addTrack(id, track),
      );
    },

    moveTrack(id, from, to) {
      const p = get().playlists.find((x) => x.id === id);
      if (!p || from === to || !p.tracks[from] || to < 0 || to >= p.tracks.length) return;
      const tracks = [...p.tracks];
      tracks.splice(to, 0, tracks.splice(from, 1)[0]);
      optimistic(mapOne(id, (x) => ({ ...x, tracks })), () => playlistsApi.reorder(id, tracks.map((t) => t.id)));
    },

    /** Embaralhar/restaurar: a ordem é decidida no servidor, então espera a resposta. */
    async shuffle(id) {
      await replaceFromServer(id, () => playlistsApi.shuffle(id), 'Não foi possível embaralhar.');
    },

    async restoreOrder(id) {
      await replaceFromServer(id, () => playlistsApi.restoreOrder(id), 'Não foi possível restaurar a ordem.');
    },

    removeTrack(id, trackId) {
      optimistic(
        mapOne(id, (p) => ({ ...p, tracks: p.tracks.filter((t) => t.id !== trackId) })),
        () => playlistsApi.removeTrack(id, trackId),
      );
    },
  };
});
