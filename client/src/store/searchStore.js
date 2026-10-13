import { create } from 'zustand';
import { searchTracks, searchVideos } from '../lib/api';

const TAB_KEY = 'sound:tab';
export const TABS = ['all', 'recordings', 'videos'];

function loadTab() {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return TABS.includes(t) ? t : 'all';
  } catch {
    return 'all';
  }
}

let controller;

/**
 * Duas buscas independentes e em paralelo — cada aba mostra a sua assim que chega
 * (a de vídeos costuma responder bem antes da de gravações).
 */
export const useSearchStore = create((set) => ({
  query: '',
  searched: false,
  tab: loadTab(),
  recordings: { items: [], loading: false, error: null },
  videos: { items: [], loading: false, error: null },

  setTab(tab) {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      /* armazenamento indisponível */
    }
    set({ tab });
  },

  search(query) {
    const q = query.trim();
    if (!q) return;
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    set({ query: q, searched: true });

    const run = (key, fn) => {
      set((s) => ({ [key]: { ...s[key], loading: true, error: null } }));
      fn(q, { signal })
        .then((items) => set({ [key]: { items, loading: false, error: null } }))
        .catch((err) => {
          if (err.name !== 'AbortError') set({ [key]: { items: [], loading: false, error: err.message } });
        });
    };
    run('recordings', searchTracks);
    run('videos', searchVideos);
  },
}));
