import { create } from 'zustand';
import { getLyrics, translateLyrics } from '../lib/api';

let controller = null;
let translateController = null;

const TRANSLATE_KEY = 'sound:lyricsTranslate';

function readTranslatePref() {
  try {
    return localStorage.getItem(TRANSLATE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Linhas da letra na ordem em que são exibidas (a tradução vem alinhada a elas). */
export function lyricsLines(lyrics) {
  if (lyrics?.synced) return lyrics.synced.map((l) => l.text);
  if (lyrics?.plain) return lyrics.plain.split(/\r?\n/);
  return null;
}

export const useLyricsStore = create((set, get) => ({
  open: false,
  trackId: null, // faixa a que `lyrics`/`status` se referem
  status: 'idle', // idle | loading | ready | error
  lyrics: null,
  cache: {}, // track.id -> resposta (evita refazer ao voltar para uma faixa)

  // Tradução (pt-BR): desligada por padrão; ligar/desligar é lembrado entre visitas.
  translateOn: readTranslatePref(),
  translation: {}, // track.id -> { status: loading | ready | error, same?, lines?, message? }

  setOpen(open) {
    set({ open });
  },

  setTranslateOn(on) {
    try {
      localStorage.setItem(TRANSLATE_KEY, on ? '1' : '0');
    } catch {
      /* armazenamento indisponível: vale só nesta visita */
    }
    set({ translateOn: on });
  },

  /** Busca a tradução da letra atual (uma vez por faixa; erro pode ser refeito religando). */
  async loadTranslation() {
    const { trackId, lyrics, status, translation } = get();
    const lines = status === 'ready' ? lyricsLines(lyrics) : null;
    const prev = translation[trackId];
    if (!trackId || !lines || prev?.status === 'loading' || prev?.status === 'ready') return;

    translateController?.abort();
    translateController = new AbortController();
    const { signal } = translateController;
    const put = (entry) => set((s) => ({ translation: { ...s.translation, [trackId]: entry } }));
    put({ status: 'loading' });
    try {
      const r = await translateLyrics(lines, { signal });
      put({ status: 'ready', same: r.same, lines: r.translations });
    } catch (err) {
      if (signal.aborted) {
        set((s) => {
          const { [trackId]: _, ...rest } = s.translation;
          return { translation: rest };
        });
        return;
      }
      put({ status: 'error', message: err.message });
    }
  },

  /** Busca de novo a letra que falhou (botão "Tentar de novo" do painel). */
  retry(track) {
    if (!track || get().trackId !== track.id || get().status !== 'error') return;
    set({ trackId: null });
    get().load(track);
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
