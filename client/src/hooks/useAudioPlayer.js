import { useEffect } from 'react';
import { engine } from '../lib/audioEngine';
import { appPath } from '../lib/base';
import { logEvent } from '../lib/playerLog';
import { usePlayerStore, selectCurrentTrack, watchStall, stopStallWatch, takePauseIntent } from '../store/playerStore';

/** Barra de progresso na tela de bloqueio / notificação (posição real do <audio>). */
function syncPosition() {
  const a = engine.audio;
  const ms = 'mediaSession' in navigator ? navigator.mediaSession : null;
  if (!ms?.setPositionState || !Number.isFinite(a.duration) || a.duration <= 0) return;
  try {
    ms.setPositionState({ duration: a.duration, position: Math.min(a.currentTime, a.duration), playbackRate: a.playbackRate });
  } catch {
    /* estado inválido durante troca de faixa */
  }
}

/**
 * Conecta o <audio> (engine) ao store: eventos de mídia -> estado React, fim da faixa -> próxima,
 * erros -> recuperação/fallback, Media Session e atalhos de teclado. Restaura a fila salva do
 * usuário. Deve ser montado uma única vez (no Player).
 */
export function useAudioPlayer(userId) {
  const track = usePlayerStore(selectCurrentTrack);
  const lockSkip = usePlayerStore((s) => s.lockSkip);

  useEffect(() => {
    usePlayerStore.getState().init(userId);
  }, [userId]);

  useEffect(() => {
    const a = engine.audio;
    const store = usePlayerStore;
    engine.setVolume(store.getState().volume);

    const ms = 'mediaSession' in navigator ? navigator.mediaSession : null;

    const handlers = {
      waiting: () => {
        store.setState({ status: 'loading' });
        watchStall();
      },
      playing: () => {
        store.getState().onPlaying();
        if (ms) ms.playbackState = 'playing';
        syncPosition();
      },
      pause: () => {
        stopStallWatch();
        const s = store.getState();
        // Pausa que não veio do app nem da tela de bloqueio: sistema (fone desconectado, ligação,
        // outro app tocando, economia de bateria...). Fica no diário para diagnóstico.
        if (!takePauseIntent() && !a.ended) {
          logEvent('pause', { reason: 'system', id: selectCurrentTrack(s)?.id, pos: Math.round(a.currentTime) });
        }
        if (s.status !== 'offline') store.setState({ status: a.ended ? 'idle' : 'paused' });
        if (ms) ms.playbackState = 'paused';
        syncPosition();
        s.savePosition(true);
      },
      seeked: syncPosition,
      durationchange: () => {
        if (Number.isFinite(a.duration)) store.setState({ duration: a.duration });
        syncPosition();
      },
      timeupdate: () => {
        if (a.readyState === 0) return; // troca de src zera o tempo antes de carregar
        store.setState({ currentTime: a.currentTime });
        store.getState().savePosition();
        store.getState().maybePrefetchNext();
      },
      progress: () => {
        if (a.buffered.length) store.setState({ buffered: a.buffered.end(a.buffered.length - 1) });
        store.getState().maybePrefetchNext();
      },
      ended: () => store.getState().onEnded(),
      error: () => {
        // Ignora erros de um src vazio (ex.: após reset).
        if (!a.currentSrc) return;
        store.getState().handleError(a.error);
      },
    };

    // Tela bloqueada / app em segundo plano: guarda a posição e registra no diário.
    const onVisibility = () => {
      const s = store.getState();
      const current = selectCurrentTrack(s);
      if (!current) return;
      logEvent(document.visibilityState === 'hidden' ? 'hidden' : 'visible', { st: s.status, pos: Math.round(s.currentTime) });
      if (document.visibilityState === 'hidden') s.savePosition(true);
      else s.retryNow();
    };
    const onPageHide = () => store.getState().savePosition(true);

    for (const [evt, fn] of Object.entries(handlers)) a.addEventListener(evt, fn);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      for (const [evt, fn] of Object.entries(handlers)) a.removeEventListener(evt, fn);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  // Media Session: controles na tela de bloqueio/notificação, fone Bluetooth e teclas de mídia.
  // Pular faixa e arrastar a barra só com a opção ligada (Conta → Reprodução): esbarrões no bolso
  // trocavam de música. O Android usa as mesmas ações para a tela de bloqueio e para o fone.
  // Arrastar precisa de um handler que ignora o gesto: sem handler, o Chrome faz o seek sozinho.
  // (Não registre seekforward/seekbackward: o Android passaria a mostrar botões de ±10 s.)
  useEffect(() => {
    if (!('mediaSession' in navigator) || !track) return;
    const { play, pause, next, prev, seek } = usePlayerStore.getState();
    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album || '',
      artwork: track.thumbnail
        ? [{ src: track.thumbnail, sizes: '250x250' }]
        : [{ src: appPath('icons/icon-512.png'), sizes: '512x512', type: 'image/png' }],
    });
    const actions = {
      play: () => play(),
      pause: () => pause('lockscreen'),
      nexttrack: lockSkip ? () => next('lockscreen') : null,
      previoustrack: lockSkip ? () => prev('lockscreen') : null,
      seekto: (d) => {
        logEvent('seek', { via: 'lockscreen', to: Math.round(d.seekTime), done: lockSkip ? 1 : 0 });
        if (lockSkip) seek(d.seekTime);
        else syncPosition(); // devolve a barra à posição real
      },
    };
    for (const [k, fn] of Object.entries(actions)) {
      try {
        navigator.mediaSession.setActionHandler(k, fn);
      } catch {
        /* ação não suportada */
      }
    }
  }, [track, lockSkip]);

  // Atalhos: espaço (play/pause), Shift+←/→ (anterior/próxima), ←/→ (±5s).
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest('input, textarea, [contenteditable]')) return;
      const s = usePlayerStore.getState();
      if (e.code === 'Space') {
        e.preventDefault();
        s.toggle();
      } else if (e.key === 'ArrowRight') {
        e.shiftKey ? s.next() : s.seek(Math.min(s.duration, s.currentTime + 5));
      } else if (e.key === 'ArrowLeft') {
        e.shiftKey ? s.prev() : s.seek(Math.max(0, s.currentTime - 5));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    document.title = track ? `${track.title} · ${track.artist}` : 'Sound — Music Discovery';
  }, [track]);
}
