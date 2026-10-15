import { create } from 'zustand';
import { searchVideos } from '../lib/api';

let controller;

/** Busca de músicas (vídeos do YouTube). Uma busca nova cancela a anterior. */
export const useSearchStore = create((set) => ({
  query: '',
  searched: false,
  items: [],
  loading: false,
  error: null,

  search(query) {
    const q = query.trim();
    if (!q) return;
    controller?.abort();
    controller = new AbortController();
    set({ query: q, searched: true, loading: true, error: null });
    searchVideos(q, { signal: controller.signal })
      .then((items) => set({ items, loading: false, error: null }))
      .catch((err) => {
        if (err.name !== 'AbortError') set({ items: [], loading: false, error: err.message });
      });
  },

  /** Campo de busca esvaziado: volta para as mais tocadas. */
  clear() {
    controller?.abort();
    set({ query: '', searched: false, items: [], loading: false, error: null });
  },
}));
