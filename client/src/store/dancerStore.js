import { create } from 'zustand';

const KEY = 'sound:dancer';
export const CHARACTER_COUNT = 5;

function readPref() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Dançarino: liga/desliga (lembrado entre visitas) e personagem sorteado por faixa. */
export const useDancerStore = create((set, get) => ({
  on: readPref(),
  trackId: null,
  character: Math.floor(Math.random() * CHARACTER_COUNT),

  setOn(on) {
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {
      /* armazenamento indisponível: vale só nesta visita */
    }
    set({ on });
  },

  /** Sorteia um personagem diferente do anterior quando a faixa muda. */
  pick(trackId) {
    const { trackId: prev, character } = get();
    if (!trackId || trackId === prev) return;
    const next = (character + 1 + Math.floor(Math.random() * (CHARACTER_COUNT - 1))) % CHARACTER_COUNT;
    set({ trackId, character: prev == null ? character : next });
  },
}));
