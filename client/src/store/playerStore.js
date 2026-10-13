import { create } from 'zustand';
import { engine } from '../lib/audioEngine';
import { streamUrl, probeStreamError } from '../lib/api';

const VOLUME_KEY = 'sound:volume';

function loadVolume() {
  try {
    const v = parseFloat(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(v) ? v : 0.8;
  } catch {
    return 0.8;
  }
}

// Evita tratar duas vezes a mesma falha (rejeição do play() + evento 'error').
let handling = null;

export const usePlayerStore = create((set, get) => ({
  // Fila (playlist) atual: snapshot dos resultados no momento em que o usuário deu play.
  queue: [],
  index: -1,
  status: 'idle', // idle | loading | playing | paused | error
  currentTime: 0,
  duration: 0,
  buffered: 0,
  volume: loadVolume(),
  muted: false,
  failed: {}, // id -> mensagem de erro
  notice: null,

  /* ----------------------------- fila ----------------------------- */

  playQueue(queue, index) {
    set({ queue, failed: {} });
    get().playIndex(index);
  },

  playIndex(index) {
    const { queue } = get();
    const track = queue[index];
    if (!track) return;
    const { [track.id]: _retry, ...failed } = get().failed; // nova tentativa explícita
    set({ index, failed, status: 'loading', currentTime: 0, duration: track.duration || 0, buffered: 0 });
    engine.load(streamUrl(track));
    engine.play().catch((err) => get().handleError(err));
  },

  next() {
    const { queue, index } = get();
    if (index < queue.length - 1) get().playIndex(index + 1);
  },

  prev() {
    const { index, currentTime } = get();
    // Comportamento padrão de players: após 3s, "anterior" reinicia a faixa.
    if (currentTime > 3 || index <= 0) engine.seek(0);
    else get().playIndex(index - 1);
  },

  toggle() {
    const { index, queue, status } = get();
    if (index < 0) {
      if (queue.length) get().playIndex(0);
      return;
    }
    if (status === 'playing' || status === 'loading') engine.pause();
    else engine.play().catch((err) => get().handleError(err));
  },

  seek(seconds) {
    engine.seek(seconds);
    set({ currentTime: seconds });
  },

  setVolume(volume) {
    engine.setVolume(volume);
    try {
      localStorage.setItem(VOLUME_KEY, String(volume));
    } catch {
      /* armazenamento indisponível */
    }
    // Mexer no volume desfaz o mudo, como em qualquer player.
    engine.setMuted(false);
    set({ volume, muted: false });
  },

  toggleMute() {
    const muted = !get().muted;
    engine.setMuted(muted);
    set({ muted });
  },

  /* ------------------------ erros / fallback ------------------------ */

  /**
   * Falha de reprodução (vídeo privado, removido, bloqueado...): marca a faixa e
   * avança para a próxima da lista. Para quando todas as restantes falharam.
   */
  async handleError(err) {
    const { queue, index } = get();
    const track = queue[index];
    if (!track || handling === track.id || get().failed[track.id]) return;
    if (err?.name === 'NotAllowedError') {
      // Autoplay bloqueado: não é falha da faixa.
      set({ status: 'paused' });
      return;
    }

    handling = track.id;
    const message = (await probeStreamError(track).finally(() => (handling = null))) || 'Não foi possível reproduzir esta faixa.';
    if (get().queue[get().index]?.id !== track.id) return; // usuário já trocou de faixa

    const failed = { ...get().failed, [track.id]: message };
    const nextIndex = queue.findIndex((t, i) => i > index && !failed[t.id]);
    set({ failed, notice: { id: Date.now(), text: `“${track.title}”: ${message}${nextIndex >= 0 ? ' Pulando…' : ''}` } });

    if (nextIndex >= 0) get().playIndex(nextIndex);
    else set({ status: 'error' });
  },

  dismissNotice() {
    set({ notice: null });
  },
}));

export const selectCurrentTrack = (s) => s.queue[s.index] || null;
