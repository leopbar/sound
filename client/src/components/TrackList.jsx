import { usePlayerStore, selectCurrentTrack } from '../store/playerStore';
import { formatTime, formatViews } from '../lib/format';
import Artwork from './Artwork';
import AddToPlaylist from './AddToPlaylist';
import { PlayIcon, PauseIcon, Spinner } from './Icons';

const GRID = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';
const LIST = 'flex flex-col gap-1';

function Equalizer() {
  return (
    <span className="flex h-4 items-end gap-0.5" aria-label="Tocando">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1 animate-pulse rounded-sm bg-accent"
          style={{ height: `${[60, 100, 40][i]}%`, animationDelay: `${i * 0.2}s`, animationDuration: '0.8s' }}
        />
      ))}
    </span>
  );
}

function Skeleton({ view, count }) {
  if (view === 'list') {
    return (
      <div className={LIST}>
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="flex animate-pulse items-center gap-3 rounded-lg px-2 py-2">
            <div className="h-9 w-16 shrink-0 rounded bg-surface-700" />
            <div className="flex-1">
              <div className="h-3.5 w-2/3 rounded bg-surface-700" />
              <div className="mt-2 h-3 w-1/3 rounded bg-surface-700" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={GRID}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="animate-pulse rounded-xl bg-surface-800 p-3">
          <div className="aspect-video rounded-lg bg-surface-700" />
          <div className="mt-3 h-4 w-3/4 rounded bg-surface-700" />
          <div className="mt-2 h-3 w-1/2 rounded bg-surface-700" />
        </div>
      ))}
    </div>
  );
}

const viewsLabel = (track, error) =>
  error ? 'Indisponível' : track.views ? `${formatViews(track.views)} visualizações` : '';

/** Linha inferior do card: views e duração. */
function Meta({ track, error }) {
  return (
    <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-500">
      <span className="truncate pr-2">{viewsLabel(track, error)}</span>
      <span className="shrink-0 tabular-nums">{track.duration ? formatTime(track.duration) : ''}</span>
    </div>
  );
}

function Card({ track, active, status, err, onSelect }) {
  const playing = active && status === 'playing';
  return (
    <li className="group/card relative">
      <AddToPlaylist track={track} />
      <button
        type="button"
        onClick={onSelect}
        title={err || `${track.title} — ${track.artist}`}
        className={`group relative w-full rounded-xl p-3 text-left transition ${
          active ? 'bg-surface-600' : 'bg-surface-800 hover:bg-surface-700'
        } ${err ? 'opacity-50' : ''}`}
      >
        <div className="relative overflow-hidden rounded-lg shadow-lg shadow-black/40">
          <Artwork track={track} className="aspect-video w-full" />
          <span
            className={`absolute bottom-2 right-2 flex h-11 w-11 items-center justify-center rounded-full bg-accent text-black shadow-xl transition ${
              active ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100'
            }`}
          >
            {active && status === 'loading' ? <Spinner /> : playing ? <PauseIcon /> : <PlayIcon />}
          </span>
        </div>
        <div className="mt-3 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className={`line-clamp-2 text-sm font-semibold ${active ? 'text-accent' : ''}`}>{track.title}</p>
            <p className="truncate text-xs text-zinc-400">{track.artist}</p>
          </div>
          {playing && <Equalizer />}
        </div>
        <Meta track={track} error={err} />
      </button>
    </li>
  );
}

/** Linha da lista: miniatura pequena, nome, canal · views, duração e o "+". */
function Row({ track, active, status, err, onSelect }) {
  const playing = active && status === 'playing';
  const meta = [track.artist, viewsLabel(track, err)].filter(Boolean).join(' · ');
  return (
    <li
      className={`group/card flex items-center gap-2 rounded-lg pr-2 transition ${
        active ? 'bg-surface-600' : 'hover:bg-surface-800'
      } ${err ? 'opacity-50' : ''}`}
    >
      <button
        type="button"
        onClick={onSelect}
        title={err || `${track.title} — ${track.artist}`}
        className="group flex min-w-0 flex-1 items-center gap-3 px-2 py-2 text-left"
      >
        <div className="relative h-9 w-16 shrink-0 overflow-hidden rounded">
          <Artwork track={track} className="h-full w-full" />
          <span
            className={`absolute inset-0 flex items-center justify-center bg-black/50 text-white transition ${
              active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
          >
            {active && status === 'loading' ? (
              <Spinner className="h-4 w-4" />
            ) : playing ? (
              <PauseIcon width={16} height={16} />
            ) : (
              <PlayIcon width={16} height={16} />
            )}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className={`line-clamp-2 text-sm font-medium sm:truncate ${active ? 'text-accent' : ''}`}>{track.title}</p>
          <p className="truncate text-xs text-zinc-500">{meta}</p>
        </div>
        {playing && <Equalizer />}
        <span className="shrink-0 text-xs tabular-nums text-zinc-500">
          {track.duration ? formatTime(track.duration) : ''}
        </span>
      </button>
      <AddToPlaylist track={track} variant="row" />
    </li>
  );
}

/**
 * Resultados da busca (vídeos do YouTube). `view`: 'list' (linhas compactas) ou 'grid'
 * (cards com thumbnail 16:9). Clicar toca a faixa usando `tracks` como fila.
 */
export default function TrackList({ tracks, view = 'list', loading, error, emptyText, skeleton = 8 }) {
  const current = usePlayerStore(selectCurrentTrack);
  const status = usePlayerStore((s) => s.status);
  const failed = usePlayerStore((s) => s.failed);
  const { playQueue, toggle } = usePlayerStore.getState();

  if (loading) return <Skeleton view={view} count={skeleton} />;
  if (error) return <p className="py-10 text-center text-red-400">{error}</p>;
  if (!tracks.length) return emptyText ? <p className="py-10 text-center text-zinc-400">{emptyText}</p> : null;

  const Item = view === 'list' ? Row : Card;
  return (
    <ul className={view === 'list' ? LIST : GRID}>
      {tracks.map((track, i) => {
        const active = current?.id === track.id;
        return (
          <Item
            key={track.id}
            track={track}
            active={active}
            status={status}
            err={failed[track.id]}
            onSelect={() => (active ? toggle() : playQueue(tracks, i))}
          />
        );
      })}
    </ul>
  );
}
