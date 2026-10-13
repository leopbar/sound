import { create } from 'zustand';
import { engine } from '../lib/audioEngine';
import { streamUrl, probeStream, warmStream } from '../lib/api';
import { logEvent, clearPlayerLog } from '../lib/playerLog';

const VOLUME_KEY = 'sound:volume';
const LOCK_SKIP_KEY = 'sound:lockSkip';

function readJSON(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* armazenamento indisponível/cheio: vale só nesta visita */
  }
}

function loadVolume() {
  try {
    const v = parseFloat(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(v) ? v : 0.8;
  } catch {
    return 0.8;
  }
}

function readLockSkip() {
  try {
    return localStorage.getItem(LOCK_SKIP_KEY) === '1';
  } catch {
    return false;
  }
}

/* ------------- fila e posição salvas (sobrevivem a fechar o app) ------------- */

let userId = null;
const queueKey = (id = userId) => `sound:player:${id}`;
const posKey = (id = userId) => `sound:player:${id}:pos`;
const MAX_SAVED_TRACKS = 1000;
const POSITION_SAVE_MS = 5000;
let lastPositionSave = 0;

/** Ao sair da conta: apaga fila, posição e diário deste usuário do aparelho. */
export function forgetPlayerState(id) {
  try {
    localStorage.removeItem(queueKey(id));
    localStorage.removeItem(posKey(id));
  } catch {
    /* nada a fazer */
  }
  clearPlayerLog();
}

/* ------------------------- recuperação de rede ------------------------- */

// Espera entre tentativas com rede (~1 min no total). Sem rede, não conta tentativa: espera o
// evento `online` (ou confere a cada 30 s) indefinidamente, como os apps de música.
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 15_000, 30_000];
const OFFLINE_CHECK_MS = 30_000;
// Carregando sem sair do lugar por este tempo (primeira carga ou travada no meio): recarrega.
const STALL_MS = 30_000;

let recovery = null; // { id, attempts, since, timer, onOnline }
let stallTimer = null;
let handling = null; // evita tratar duas vezes a mesma falha (rejeição do play() + evento 'error')
let pauseIntent = null; // quem pediu a pausa em curso ('user' | 'lockscreen'); sem isso foi o sistema
let generation = 0; // muda quando o usuário pausa ou troca de faixa: invalida tratamentos em andamento
const warmed = new Set();

function clearRecovery() {
  if (!recovery) return;
  clearTimeout(recovery.timer);
  window.removeEventListener('online', recovery.onOnline);
  recovery = null;
}

/** Vigia a carga: se ficar "carregando" por STALL_MS, recarrega do ponto onde parou. */
export function watchStall(restart = false) {
  if (stallTimer && !restart) return;
  clearTimeout(stallTimer);
  stallTimer = setTimeout(() => {
    stallTimer = null;
    const s = usePlayerStore.getState();
    if (s.status !== 'loading') return;
    logEvent('stall', { id: s.queue[s.index]?.id, pos: Math.round(s.currentTime) });
    s.recover('stall');
  }, STALL_MS);
}

export function stopStallWatch() {
  clearTimeout(stallTimer);
  stallTimer = null;
}

/** Pausa pedida pelo usuário/tela de bloqueio (consumida no evento 'pause'); null = sistema. */
export function takePauseIntent() {
  const v = pauseIntent;
  pauseIntent = null;
  return v;
}

export const usePlayerStore = create((set, get) => {
  const current = () => get().queue[get().index] || null;
  const position = () => Math.round(get().currentTime);
  const saveQueue = () => {
    if (userId) writeJSON(queueKey(), { queue: get().queue.slice(0, MAX_SAVED_TRACKS), index: get().index });
  };

  return {
    // Fila (playlist) atual: snapshot dos resultados no momento em que o usuário deu play.
    queue: [],
    index: -1,
    status: 'idle', // idle | loading | offline | playing | paused | error
    currentTime: 0,
    duration: 0,
    buffered: 0,
    resumeAt: 0, // de onde retomar quando o <audio> precisar recarregar (queda de rede, app reaberto)
    volume: loadVolume(),
    muted: false,
    failed: {}, // id -> mensagem de erro
    notice: null,
    lockSkip: readLockSkip(), // pular faixa pela tela de bloqueio / fone (desligado por padrão)

    /* --------------------------- sessão --------------------------- */

    /** Na entrada do usuário: restaura a fila e a posição salvas (pausado, sem tocar sozinho). */
    init(id) {
      userId = id;
      if (get().queue.length) return;
      const saved = readJSON(queueKey());
      if (!Array.isArray(saved?.queue) || !saved.queue.length) return;
      const index = Math.min(Math.max(0, saved.index | 0), saved.queue.length - 1);
      const track = saved.queue[index];
      if (!track?.id || !track.streamUrl) return;
      const pos = readJSON(posKey());
      const t = pos?.id === track.id && Number.isFinite(pos.t) && pos.t > 0 ? pos.t : 0;
      set({ queue: saved.queue, index, status: 'paused', currentTime: t, resumeAt: t, duration: track.duration || 0 });
      logEvent('boot', { id: track.id, pos: Math.round(t), was: pos?.playing ? 'playing' : 'paused' });
    },

    /** Guarda a posição (no máximo a cada 5 s, ou já com `force`). */
    savePosition(force = false) {
      const track = current();
      if (!userId || !track) return;
      const now = Date.now();
      if (!force && now - lastPositionSave < POSITION_SAVE_MS) return;
      lastPositionSave = now;
      const { status, currentTime, resumeAt } = get();
      // Recarregando, o <audio> volta a 0 por um instante: vale o ponto de retomada.
      const t = status === 'loading' || status === 'offline' ? Math.max(resumeAt, currentTime) : currentTime;
      writeJSON(posKey(), { id: track.id, t: Math.round(t * 10) / 10, playing: status === 'playing' });
    },

    /* ----------------------------- fila ----------------------------- */

    playQueue(queue, index) {
      set({ queue, failed: {} });
      get().playIndex(index);
    },

    /** Toca a faixa `index`; `startAt` retoma do meio; `retry` = nova tentativa da recuperação. */
    playIndex(index, { startAt = 0, retry = false } = {}) {
      const track = get().queue[index];
      if (!track) return;
      if (!retry) {
        clearRecovery();
        generation++;
      }
      const { [track.id]: _retry, ...failed } = get().failed; // nova tentativa explícita
      set({
        index,
        failed,
        status: 'loading',
        currentTime: startAt,
        resumeAt: startAt,
        duration: retry ? get().duration : track.duration || 0,
        buffered: 0,
      });
      saveQueue();
      get().savePosition(true);
      engine.load(streamUrl(track), startAt);
      watchStall(true);
      engine.play().catch((err) => get().handleError(err));
    },

    play() {
      const { index, queue } = get();
      const track = queue[index];
      if (!track) {
        if (queue.length) get().playIndex(0);
        return;
      }
      // App reaberto, erro ou desistência depois de quedas de rede: recarrega do ponto onde parou.
      if (!engine.isReady(streamUrl(track))) {
        get().playIndex(index, { startAt: get().resumeAt || get().currentTime });
        return;
      }
      engine.play().catch((err) => get().handleError(err));
    },

    /** `via`: 'user' (botão no app) ou 'lockscreen' (tela de bloqueio, fone, teclas de mídia). */
    pause(via = 'user') {
      generation++;
      // Pausou no meio de uma recuperação: o próximo play recarrega do ponto salvo.
      if (recovery) engine.url = '';
      clearRecovery();
      stopStallWatch();
      logEvent('pause', { reason: via, id: current()?.id, pos: position() });
      if (engine.audio.paused) {
        // Carregando, sem rede ou com erro: o <audio> não vai emitir 'pause'.
        set({ status: get().index >= 0 ? 'paused' : 'idle' });
      } else {
        pauseIntent = via;
        engine.pause();
      }
    },

    toggle(via = 'user') {
      const { status } = get();
      if (status === 'playing' || status === 'loading' || status === 'offline') get().pause(via);
      else get().play();
    },

    next(via = 'user') {
      const { queue, index } = get();
      if (index >= queue.length - 1) return;
      logEvent('next', { via, id: current()?.id, pos: position() });
      get().playIndex(index + 1);
    },

    prev(via = 'user') {
      const { index, currentTime } = get();
      logEvent('prev', { via, id: current()?.id, pos: position() });
      // Comportamento padrão de players: após 3s, "anterior" reinicia a faixa.
      if (currentTime > 3 || index <= 0) get().seek(0);
      else get().playIndex(index - 1);
    },

    onEnded() {
      const { index, queue } = get();
      logEvent('ended', { id: current()?.id });
      if (index < queue.length - 1) get().playIndex(index + 1);
      else set({ status: 'idle' });
    },

    seek(seconds) {
      if (!Number.isFinite(seconds)) return;
      const track = current();
      // Sem o <audio> pronto (app reaberto, recuperando): vale para quando ele recarregar.
      if (track && engine.isReady(streamUrl(track))) engine.seek(seconds);
      set({ currentTime: seconds, resumeAt: seconds });
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

    setLockSkip(on) {
      try {
        localStorage.setItem(LOCK_SKIP_KEY, on ? '1' : '0');
      } catch {
        /* vale só nesta visita */
      }
      set({ lockSkip: on });
    },

    /** O <audio> começou a sair som. */
    onPlaying() {
      stopStallWatch();
      set({ status: 'playing' });
      const track = current();
      if (recovery && track && recovery.id === track.id) {
        logEvent('resumed', { id: track.id, pos: position(), after: Math.round((Date.now() - recovery.since) / 1000) });
        clearRecovery();
        set({ notice: { id: Date.now(), text: 'Conexão de volta: reprodução retomada.' } });
      }
      // Servidor já resolve a próxima faixa: a troca fica imediata (e funciona melhor em 2º plano).
      const nextTrack = get().queue[get().index + 1];
      if (nextTrack && !warmed.has(nextTrack.id)) {
        if (warmed.size > 500) warmed.clear();
        warmed.add(nextTrack.id);
        warmStream(nextTrack);
      }
    },

    /* ------------------------ erros / recuperação ------------------------ */

    /**
     * Falha de reprodução. Queda de rede ou conexão instável: tenta de novo e retoma do ponto
     * onde parou (sem pular a faixa). Só pula quando o servidor confirma que a faixa não toca
     * (vídeo privado, removido, bloqueado...) ou o navegador não sabe tocar o formato.
     */
    async handleError(err) {
      const track = current();
      if (!track || handling === track.id || get().failed[track.id]) return;
      if (err?.name === 'NotAllowedError') {
        // Autoplay bloqueado: não é falha da faixa.
        logEvent('blocked', { id: track.id });
        set({ status: 'paused' });
        return;
      }

      stopStallWatch();
      const code = engine.audio.error?.code || 0; // 2 = rede, 3 = decodificação, 4 = fonte/formato
      const gen = generation;
      handling = track.id;
      let probe;
      try {
        probe = navigator.onLine === false ? { kind: 'network' } : await probeStream(track);
      } finally {
        handling = null;
      }
      if (gen !== generation || current()?.id !== track.id) return; // usuário pausou ou trocou de faixa
      logEvent('error', { id: track.id, code, probe: probe.kind, pos: position() });

      if (probe.kind === 'auth') {
        set({ status: 'paused' });
        return;
      }
      // Faixa boa no servidor, mas o navegador recusou o formato: uma nova tentativa e depois pula.
      const formatRefused = probe.kind === 'ok' && code === 4 && recovery?.id === track.id && recovery.attempts > 0;
      if ((probe.kind === 'network' || probe.kind === 'ok') && !formatRefused) {
        get().recover(probe.kind === 'network' ? 'network' : `media${code}`);
        return;
      }

      clearRecovery();
      const message = probe.message || 'Não foi possível reproduzir esta faixa.';
      const { queue, index } = get();
      const failed = { ...get().failed, [track.id]: message };
      const nextIndex = queue.findIndex((t, i) => i > index && !failed[t.id]);
      logEvent('skip', { id: track.id });
      set({ failed, notice: { id: Date.now(), text: `“${track.title}”: ${message}${nextIndex >= 0 ? ' Pulando…' : ''}` } });

      if (nextIndex >= 0) get().playIndex(nextIndex);
      else set({ status: 'error' });
    },

    /** Agenda uma nova tentativa da faixa atual a partir do ponto onde parou. */
    recover(why) {
      const track = current();
      if (!track) return;
      stopStallWatch();
      const fresh = !recovery || recovery.id !== track.id;
      if (fresh) {
        clearRecovery();
        recovery = { id: track.id, attempts: 0, since: Date.now(), timer: null, onOnline: null };
      } else {
        clearTimeout(recovery.timer);
        window.removeEventListener('online', recovery.onOnline);
      }
      // O <audio> pode estar adiantado em relação ao último timeupdate.
      const t = Math.max(get().resumeAt, engine.url === streamUrl(track) ? engine.audio.currentTime || 0 : 0, get().currentTime);
      const offline = navigator.onLine === false;
      const delay = offline ? OFFLINE_CHECK_MS : RETRY_DELAYS[recovery.attempts];

      if (delay === undefined) {
        logEvent('gaveup', { id: track.id, pos: Math.round(t), why });
        clearRecovery();
        engine.pause();
        engine.url = ''; // o próximo play recarrega do ponto salvo
        set({ status: 'paused', resumeAt: t, notice: { id: Date.now(), text: 'Sem conexão estável. Toque ▶ para continuar de onde parou.' } });
        return;
      }
      if (!offline) recovery.attempts++;
      logEvent('retry', { id: track.id, why, n: recovery.attempts, pos: Math.round(t) });
      set({
        status: offline ? 'offline' : 'loading',
        resumeAt: t,
        currentTime: t,
        ...(fresh && {
          notice: {
            id: Date.now(),
            text: offline ? 'Sem conexão: a música continua quando a rede voltar.' : 'Conexão instável: retomando…',
          },
        }),
      });

      const attempt = () => {
        if (!recovery || recovery.id !== track.id) return;
        clearTimeout(recovery.timer);
        window.removeEventListener('online', recovery.onOnline);
        if (navigator.onLine === false) {
          get().recover(why); // continua esperando a rede
          return;
        }
        get().playIndex(get().index, { startAt: get().resumeAt, retry: true });
      };
      recovery.onOnline = attempt;
      window.addEventListener('online', attempt);
      recovery.timer = setTimeout(attempt, delay);
    },

    dismissNotice() {
      set({ notice: null });
    },
  };
});

export const selectCurrentTrack = (s) => s.queue[s.index] || null;
