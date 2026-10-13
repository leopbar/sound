import { useEffect, useState } from 'react';
import { usePlayerStore, selectCurrentTrack } from '../store/playerStore';
import { useLyricsStore } from '../store/lyricsStore';
import { formatTime, SOURCE_LABEL } from '../lib/format';
import Artwork from './Artwork';
import Visualizer from './Visualizer';
import LyricsPanel from './LyricsPanel';
import { PlayIcon, PauseIcon, NextIcon, PrevIcon, VolumeIcon, LyricsIcon, Spinner } from './Icons';

function Seekbar() {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const buffered = usePlayerStore((s) => s.buffered);
  const seek = usePlayerStore((s) => s.seek);
  // Enquanto arrasta, mostramos o valor local e só fazemos seek ao soltar (evita dezenas de requests Range).
  const [drag, setDrag] = useState(null);

  const value = drag ?? currentTime;
  const pct = duration ? (value / duration) * 100 : 0;
  const bufPct = duration ? Math.min(100, (buffered / duration) * 100) : 0;
  const commit = () => {
    if (drag != null) seek(drag);
    setDrag(null);
  };

  return (
    <div className="flex w-full items-center gap-2 text-[11px] tabular-nums text-zinc-400">
      <span className="w-10 text-right">{formatTime(value)}</span>
      <div className="relative flex flex-1 items-center">
        <div className="pointer-events-none absolute inset-x-0 h-1 rounded-full bg-zinc-600/40" style={{ clipPath: `inset(0 ${100 - bufPct}% 0 0)` }} />
        <input
          type="range"
          className="range relative"
          min={0}
          max={duration || 0}
          step={0.1}
          value={value}
          disabled={!duration}
          style={{ '--pct': `${pct}%` }}
          onChange={(e) => setDrag(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          aria-label="Progresso"
          aria-valuetext={`${formatTime(value)} de ${formatTime(duration)}`}
        />
      </div>
      <span className="w-10">{formatTime(duration)}</span>
    </div>
  );
}

function Volume() {
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const { setVolume, toggleMute } = usePlayerStore.getState();
  const shown = muted ? 0 : volume;
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={toggleMute} className="text-zinc-400 transition hover:text-white" aria-label={muted ? 'Ativar som' : 'Silenciar'}>
        <VolumeIcon level={volume} muted={muted} />
      </button>
      <input
        type="range"
        className="range w-24"
        min={0}
        max={1}
        step={0.01}
        value={shown}
        style={{ '--pct': `${shown * 100}%` }}
        onChange={(e) => setVolume(Number(e.target.value))}
        aria-label="Volume"
      />
    </div>
  );
}

function Notice() {
  const notice = usePlayerStore((s) => s.notice);
  const dismiss = usePlayerStore((s) => s.dismissNotice);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(dismiss, 5000);
    return () => clearTimeout(t);
  }, [notice, dismiss]);
  if (!notice) return null;
  return (
    <div role="status" className="absolute -top-14 left-1/2 max-w-[90vw] -translate-x-1/2 truncate rounded-lg bg-zinc-100 px-4 py-2 text-sm text-zinc-900 shadow-xl">
      {notice.text}
    </div>
  );
}

function LyricsButton({ track }) {
  const open = useLyricsStore((s) => s.open);
  const setOpen = useLyricsStore((s) => s.setOpen);
  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      disabled={!track}
      aria-pressed={open}
      className={`transition disabled:opacity-30 ${open ? 'text-accent' : 'text-zinc-400 hover:text-white'}`}
      aria-label={open ? 'Fechar letra' : 'Mostrar letra'}
      title="Letra"
    >
      <LyricsIcon />
    </button>
  );
}

export default function PlayerBar() {
  const track = usePlayerStore(selectCurrentTrack);
  const status = usePlayerStore((s) => s.status);
  const index = usePlayerStore((s) => s.index);
  const queueLength = usePlayerStore((s) => s.queue.length);
  const { toggle, next, prev } = usePlayerStore.getState();

  const playing = status === 'playing';
  const hasNext = index >= 0 && index < queueLength - 1;

  // A letra é buscada quando a faixa de fato começa a tocar (não a cada troca rápida de faixa).
  useEffect(() => {
    if (playing && track) useLyricsStore.getState().load(track);
  }, [playing, track]);

  return (
    <>
    <LyricsPanel />
    <footer data-player-bar className="fixed inset-x-0 bottom-0 z-20 border-t border-surface-600 bg-surface-800/95 backdrop-blur">
      <Notice />
      <div className="mx-auto grid h-20 max-w-screen-2xl grid-cols-[1fr_auto] items-center gap-4 px-4 md:grid-cols-[1fr_2fr_1fr]">
        {/* Faixa atual */}
        <div className="flex min-w-0 items-center gap-3">
          {track ? (
            <>
              <Artwork track={track} className="h-14 w-14 shrink-0 rounded" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{track.title}</p>
                <p className="truncate text-xs text-zinc-400">{track.artist}</p>
                <p className="truncate text-[10px] uppercase tracking-wide text-zinc-500">
                  via {SOURCE_LABEL[track.source] || track.source}
                </p>
              </div>
            </>
          ) : (
            <p className="text-sm text-zinc-500">Nada tocando</p>
          )}
        </div>

        {/* Controles + seekbar */}
        <div className="flex flex-col items-center gap-1">
          <div className="flex items-center gap-5">
            <button type="button" onClick={prev} disabled={!track} className="text-zinc-400 transition hover:text-white disabled:opacity-30" aria-label="Anterior">
              <PrevIcon />
            </button>
            <button
              type="button"
              onClick={toggle}
              disabled={!track && !queueLength}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-black transition hover:scale-105 disabled:opacity-30"
              aria-label={playing ? 'Pausar' : 'Tocar'}
            >
              {status === 'loading' ? <Spinner /> : playing ? <PauseIcon /> : <PlayIcon className="translate-x-px" />}
            </button>
            <button type="button" onClick={next} disabled={!hasNext} className="text-zinc-400 transition hover:text-white disabled:opacity-30" aria-label="Próxima">
              <NextIcon />
            </button>
            <span className="md:hidden">
              <LyricsButton track={track} />
            </span>
          </div>
          <div className="hidden w-full md:block">
            <Seekbar />
          </div>
        </div>

        {/* Visualizador + volume */}
        <div className="hidden items-center justify-end gap-4 md:flex">
          <Visualizer className="hidden h-10 w-32 lg:block" />
          <LyricsButton track={track} />
          <Volume />
        </div>
      </div>
      <div className="px-4 pb-2 md:hidden">
        <Seekbar />
      </div>
    </footer>
    </>
  );
}
