import { create } from 'zustand';
import { getTopChart } from '../lib/api';

/** Mais tocadas no mundo (tela inicial). Carrega uma vez por sessão do app; erro permite tentar de novo. */
export const useChartStore = create((set, get) => ({
  tracks: [],
  loading: false,
  error: null,
  loaded: false,

  load() {
    if (get().loading || get().loaded) return;
    set({ loading: true, error: null });
    getTopChart()
      .then(({ tracks }) => set({ tracks: tracks || [], loading: false, loaded: true }))
      .catch((err) => set({ loading: false, error: err.message || 'Não foi possível carregar as mais tocadas.' }));
  },
}));
