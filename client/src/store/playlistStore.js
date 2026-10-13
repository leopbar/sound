import { create } from 'zustand';

const KEY = 'sound:playlists';

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function save(playlists) {
  try {
    localStorage.setItem(KEY, JSON.stringify(playlists));
  } catch {
    /* armazenamento indisponível */
  }
}

const newId = () => `pl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Playlists do usuário, guardadas localmente. Cada faixa é salva por inteiro para poder tocar sem nova busca. */
export const usePlaylistStore = create((set, get) => {
  const update = (fn) => {
    const playlists = fn(get().playlists);
    save(playlists);
    set({ playlists });
  };

  return {
    playlists: load(),

    create(name, track) {
      const id = newId();
      update((list) => [...list, { id, name: name.trim() || 'Nova playlist', tracks: track ? [track] : [] }]);
      return id;
    },

    rename(id, name) {
      const clean = name.trim();
      if (!clean) return;
      update((list) => list.map((p) => (p.id === id ? { ...p, name: clean } : p)));
    },

    remove(id) {
      update((list) => list.filter((p) => p.id !== id));
    },

    addTrack(id, track) {
      update((list) =>
        list.map((p) => (p.id === id && !p.tracks.some((t) => t.id === track.id) ? { ...p, tracks: [...p.tracks, track] } : p)),
      );
    },

    moveTrack(id, from, to) {
      update((list) =>
        list.map((p) => {
          if (p.id !== id || from === to || !p.tracks[from] || to < 0 || to >= p.tracks.length) return p;
          const tracks = [...p.tracks];
          tracks.splice(to, 0, tracks.splice(from, 1)[0]);
          return { ...p, tracks };
        }),
      );
    },

    removeTrack(id, trackId) {
      update((list) => list.map((p) => (p.id === id ? { ...p, tracks: p.tracks.filter((t) => t.id !== trackId) } : p)));
    },
  };
});
