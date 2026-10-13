import { useEffect } from 'react';
import { engine } from '../lib/audioEngine';
import { appPath } from '../lib/base';
import { usePlayerStore, selectCurrentTrack } from '../store/playerStore';

/**
 * Conecta o <audio> (engine) ao store: eventos de mídia -> estado React,
 * fim da faixa -> próxima, erros -> fallback, Media Session e atalhos de teclado.
 * Deve ser montado uma única vez (no App).
 */
export function useAudioPlayer() {
  const track = usePlayerStore(selectCurrentTrack);

  useEffect(() => {
    const a = engine.audio;
    const store = usePlayerStore;
    engine.setVolume(store.getState().volume);

    const ms = 'mediaSession' in navigator ? navigator.mediaSession : null;
    // Barra de progresso na tela de bloqueio / notificação.
    const syncPosition = () => {
      if (!ms?.setPositionState || !Number.isFinite(a.duration) || a.duration <= 0) return;
      try {
        ms.setPositionState({ duration: a.duration, position: Math.min(a.currentTime, a.duration), playbackRate: a.playbackRate });
      } catch {
        /* estado inválido durante troca de faixa */
      }
    };

    const handlers = {
      loadstart: () => store.setState({ status: 'loading' }),
      waiting: () => store.setState({ status: 'loading' }),
      playing: () => {
        store.setState({ status: 'playing' });
        if (ms) ms.playbackState = 'playing';
        syncPosition();
      },
      pause: () => {
        store.setState({ status: a.ended ? 'idle' : 'paused' });
        if (ms) ms.playbackState = 'paused';
        syncPosition();
      },
      seeked: syncPosition,
      durationchange: () => {
        if (Number.isFinite(a.duration)) store.setState({ duration: a.duration });
        syncPosition();
      },
      timeupdate: () => store.setState({ currentTime: a.currentTime }),
      progress: () => {
        if (a.buffered.length) store.setState({ buffered: a.buffered.end(a.buffered.length - 1) });
      },
      ended: () => {
        const { index, queue, next } = store.getState();
        if (index < queue.length - 1) next();
        else store.setState({ status: 'idle' });
      },
      error: () => {
        // Ignora erros de um src vazio (ex.: após reset).
        if (!a.currentSrc) return;
        store.getState().handleError(a.error);
      },
    };

    for (const [evt, fn] of Object.entries(handlers)) a.addEventListener(evt, fn);
    return () => {
      for (const [evt, fn] of Object.entries(handlers)) a.removeEventListener(evt, fn);
    };
  }, []);

  // Media Session: teclas de mídia do teclado/fones e controles na tela de bloqueio.
  useEffect(() => {
    if (!('mediaSession' in navigator) || !track) return;
    const { toggle, next, prev, seek } = usePlayerStore.getState();
    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album || '',
      artwork: track.thumbnail
        ? [{ src: track.thumbnail, sizes: '250x250' }]
        : [{ src: appPath('icons/icon-512.png'), sizes: '512x512', type: 'image/png' }],
    });
    const actions = {
      play: toggle,
      pause: toggle,
      nexttrack: next,
      previoustrack: prev,
      seekto: (d) => seek(d.seekTime),
    };
    for (const [k, fn] of Object.entries(actions)) {
      try {
        navigator.mediaSession.setActionHandler(k, fn);
      } catch {
        /* ação não suportada */
      }
    }
  }, [track]);

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
