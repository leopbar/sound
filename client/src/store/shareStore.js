import { create } from 'zustand';
import { sharesApi } from '../lib/api';
import { usePlaylistStore } from './playlistStore';
import { usePlayerStore } from './playerStore';

const POLL_MS = 20_000;

const notify = (text) => usePlayerStore.setState({ notice: { id: Date.now(), text } });

let timer = null;
let inflight = null;

/**
 * Convites de compartilhamento: os recebidos (aguardando aceitar/recusar) e as respostas aos
 * enviados. Consulta o servidor a cada 20 s com a tela visível e quando ela volta a aparecer.
 */
export const useShareStore = create((set, get) => ({
  incoming: [],
  outcomes: [],
  busy: false,

  refresh() {
    if (inflight) return inflight;
    inflight = sharesApi
      .inbox()
      .then(({ incoming, outcomes }) => timer && set({ incoming, outcomes }))
      .catch(() => {}) // sem rede: tenta na próxima rodada
      .finally(() => {
        inflight = null;
      });
    return inflight;
  },

  start() {
    get().stop();
    const tick = () => document.visibilityState === 'visible' && get().refresh();
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('online', tick);
    timer = { id: setInterval(tick, POLL_MS), tick };
    tick();
  },

  stop() {
    if (timer) {
      clearInterval(timer.id);
      document.removeEventListener('visibilitychange', timer.tick);
      window.removeEventListener('online', timer.tick);
      timer = null;
    }
    set({ incoming: [], outcomes: [], busy: false });
  },

  async respond(share, accept) {
    if (get().busy) return;
    set({ busy: true });
    try {
      if (accept) {
        const playlist = await sharesApi.accept(share.id);
        const { playlists } = usePlaylistStore.getState();
        if (!playlists.some((p) => p.id === playlist.id)) usePlaylistStore.setState({ playlists: [...playlists, playlist] });
        notify(`“${playlist.name}” foi adicionada às suas playlists.`);
      } else {
        await sharesApi.decline(share.id);
      }
      set({ incoming: get().incoming.filter((s) => s.id !== share.id) });
    } catch (err) {
      notify(err.message || 'Não foi possível responder ao convite.');
      // Convite que já não vale (lista apagada, respondido em outro aparelho): sai da tela.
      if (err.status === 404 || err.status === 410) set({ incoming: get().incoming.filter((s) => s.id !== share.id) });
    } finally {
      set({ busy: false });
    }
  },

  async acknowledge(outcome) {
    set({ outcomes: get().outcomes.filter((o) => o.id !== outcome.id) });
    await sharesApi.seen(outcome.id).catch(() => {});
  },
}));
