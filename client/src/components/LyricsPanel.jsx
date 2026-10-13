import { useEffect, useRef } from 'react';
import { usePlayerStore, selectCurrentTrack } from '../store/playerStore';
import { useLyricsStore } from '../store/lyricsStore';
import { useDancerStore } from '../store/dancerStore';
import Dancer from './Dancer';
import { CloseIcon, Spinner } from './Icons';

// O `timeupdate` chega a cada ~250 ms: adiantar um pouco faz a linha acender junto com a voz.
const LEAD_S = 0.3;
// Depois que o usuário rola a letra, a rolagem automática espera um pouco antes de voltar.
const MANUAL_SCROLL_PAUSE_MS = 4000;

function activeIndex(lines, time) {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= time + LEAD_S) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

function SyncedLyrics({ lines, compact }) {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const seek = usePlayerStore((s) => s.seek);
  const active = activeIndex(lines, currentTime);
  const listRef = useRef(null);
  const manualUntil = useRef(0);

  useEffect(() => {
    if (Date.now() < manualUntil.current) return;
    const el = listRef.current?.children[Math.max(active, 0)];
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [active]);

  const pauseAuto = () => (manualUntil.current = Date.now() + MANUAL_SCROLL_PAUSE_MS);

  return (
    <ol ref={listRef} onWheel={pauseAuto} onTouchMove={pauseAuto} className={`space-y-4 ${compact ? 'py-[12vh]' : 'py-[30vh]'}`}>
      {lines.map((line, i) => (
        <li key={`${line.time}-${i}`}>
          <button
            type="button"
            onClick={() => {
              manualUntil.current = 0;
              seek(line.time);
            }}
            className={`text-left text-2xl font-bold leading-snug transition-colors duration-300 md:text-3xl ${
              i === active ? 'text-white' : i < active ? 'text-zinc-500 hover:text-zinc-300' : 'text-zinc-600 hover:text-zinc-300'
            }`}
          >
            {line.text || '♪'}
          </button>
        </li>
      ))}
    </ol>
  );
}

function Message({ children }) {
  return <p className="py-[8vh] text-center text-lg text-zinc-400">{children}</p>;
}

export default function LyricsPanel() {
  const open = useLyricsStore((s) => s.open);
  const setOpen = useLyricsStore((s) => s.setOpen);
  const status = useLyricsStore((s) => s.status);
  const lyrics = useLyricsStore((s) => s.lyrics);
  const lyricsTrackId = useLyricsStore((s) => s.trackId);
  const dancerOn = useDancerStore((s) => s.on);
  const track = usePlayerStore(selectCurrentTrack);
  const visible = open || dancerOn;

  // Fechar o painel desliga a letra e o dançarino.
  const close = () => {
    setOpen(false);
    useDancerStore.getState().setOn(false);
  };

  useEffect(() => {
    if (!visible) return;
    const onKey = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!visible || !track) return null;

  // Faixa nova ainda não tocou: a letra só é buscada depois do play.
  const pending = lyricsTrackId !== track.id;
  let body;
  if (pending || status === 'loading') {
    body = (
      <div className="flex justify-center py-[8vh] text-zinc-500">
        <Spinner className="h-6 w-6" />
      </div>
    );
  } else if (status === 'error') {
    body = <Message>{lyrics?.message || 'Não foi possível carregar a letra.'}</Message>;
  } else if (lyrics?.instrumental) {
    body = <Message>♪ Faixa instrumental ♪</Message>;
  } else if (lyrics?.synced) {
    body = <SyncedLyrics lines={lyrics.synced} compact={dancerOn} />;
  } else if (lyrics?.plain) {
    body = <p className="whitespace-pre-line py-8 text-xl font-semibold leading-relaxed text-zinc-200 md:text-2xl">{lyrics.plain}</p>;
  } else {
    body = <Message>Letra não encontrada para esta faixa.</Message>;
  }

  return (
    <section
      aria-label={open ? 'Letra' : 'Dançarino'}
      className="fixed inset-0 z-10 flex flex-col bg-surface-900/95 pb-36 backdrop-blur-md md:pb-28"
    >
      <header className="flex shrink-0 items-center gap-3 px-4 pb-2 pt-4">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-bold">{track.title}</p>
            <p className="truncate text-sm text-zinc-400">{track.artist}</p>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-full bg-surface-700 p-2 text-zinc-300 transition hover:bg-surface-600 hover:text-white"
            aria-label="Fechar"
          >
            <CloseIcon />
          </button>
        </div>
      </header>
      {dancerOn && <Dancer className="min-h-0 flex-1" />}
      {open && (
        <div className="min-h-0 flex-1 overflow-y-auto [mask-image:linear-gradient(transparent,#000_8%,#000_92%,transparent)]">
          <div className="mx-auto max-w-3xl px-4">
            {body}
            {status === 'ready' && lyrics?.found && (
              <p className="pb-6 text-xs text-zinc-600">Letra: {lyrics.source}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
