import { create } from 'zustand';
import { getLyrics } from '../lib/api';

let controller = null;

export const useLyricsStore = create((set, get) => ({
  open: false,
  trackId: null, // faixa a que `lyrics`/`status` se referem
  status: 'idle', // idle | loading | ready | error
  lyrics: null,
  cache: {}, // track.id -> resposta (evita refazer ao voltar para uma faixa)

  setOpen(open) {
    set({ open });
  },

  /**
   * Carrega a letra da faixa e abre o painel (chamado quando ela começa a tocar).
   * Pausar/retomar a mesma faixa não reabre o painel se o usuário o fechou.
   */
  async load(track) {
    if (!track || get().trackId === track.id) return;
    controller?.abort();
    const hit = get().cache[track.id];
    if (hit) {
      set({ trackId: track.id, status: 'ready', lyrics: hit, open: true });
      return;
    }

    controller = new AbortController();
    const { signal } = controller;
    set({ trackId: track.id, status: 'loading', lyrics: null, open: true });
    try {
      const lyrics = await getLyrics(track, { signal });
      set((s) => ({ status: 'ready', lyrics, cache: { ...s.cache, [track.id]: lyrics } }));
    } catch (err) {
      if (signal.aborted) return;
      set({ status: 'error', lyrics: { message: err.message } });
    }
  },
}));
