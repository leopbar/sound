import { usePlayerStore, selectCurrentTrack } from '../store/playerStore';
import { formatTime, formatViews, SOURCE_LABEL } from '../lib/format';
import Artwork from './Artwork';
import { PlayIcon, PauseIcon, Spinner } from './Icons';

const GRID = {
  recording: 'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5',
  video: 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
};
const ASPECT = { recording: 'aspect-square', video: 'aspect-video' };

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

function SkeletonGrid({ variant, count }) {
  return (
    <div className={GRID[variant]}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="animate-pulse rounded-xl bg-surface-800 p-3">
          <div className={`${ASPECT[variant]} rounded-lg bg-surface-700`} />
          <div className="mt-3 h-4 w-3/4 rounded bg-surface-700" />
          <div className="mt-2 h-3 w-1/2 rounded bg-surface-700" />
        </div>
      ))}
    </div>
  );
}

/** Linha inferior do card: álbum (gravação) ou views (vídeo), e a duração. */
function Meta({ track, variant, error }) {
  let left;
  if (error) left = 'Indisponível';
  else if (variant === 'video') left = track.views ? `${formatViews(track.views)} visualizações` : '';
  else left = track.album || '—';
  return (
    <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-500">
      <span className="truncate pr-2">{left}</span>
      <span className="shrink-0 tabular-nums">{track.duration ? formatTime(track.duration) : ''}</span>
    </div>
  );
}

/**
 * Grid de faixas. `variant`: 'recording' (capa de álbum, quadrada) ou 'video'
 * (thumbnail 16:9, canal e views). Clicar toca a faixa usando `tracks` como fila.
 */
export default function TrackList({ tracks, variant = 'recording', loading, error, emptyText, skeleton = 10 }) {
  const current = usePlayerStore(selectCurrentTrack);
  const status = usePlayerStore((s) => s.status);
  const failed = usePlayerStore((s) => s.failed);
  const { playQueue, toggle } = usePlayerStore.getState();

  if (loading) return <SkeletonGrid variant={variant} count={skeleton} />;
  if (error) return <p className="py-10 text-center text-red-400">{error}</p>;
  if (!tracks.length) return emptyText ? <p className="py-10 text-center text-zinc-400">{emptyText}</p> : null;

  const onSelect = (track, i) => {
    if (current?.id === track.id) toggle();
    else playQueue(tracks, i);
  };

  return (
    <ul className={GRID[variant]}>
      {tracks.map((track, i) => {
        const active = current?.id === track.id;
        const playing = active && status === 'playing';
        const err = failed[track.id];
        return (
          <li key={track.id}>
            <button
              type="button"
              onClick={() => onSelect(track, i)}
              title={err || `${track.title} — ${track.artist}`}
              className={`group relative w-full rounded-xl p-3 text-left transition ${
                active ? 'bg-surface-600' : 'bg-surface-800 hover:bg-surface-700'
              } ${err ? 'opacity-50' : ''}`}
            >
              <div className="relative overflow-hidden rounded-lg shadow-lg shadow-black/40">
                <Artwork track={track} className={`${ASPECT[variant]} w-full`} />
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
                  <p
                    className={`text-sm font-semibold ${active ? 'text-accent' : ''} ${
                      variant === 'video' ? 'line-clamp-2' : 'truncate'
                    }`}
                  >
                    {track.title}
                  </p>
                  <p className="truncate text-xs text-zinc-400">{track.artist}</p>
                  {track.version && <p className="truncate text-[11px] italic text-zinc-500">{track.version}</p>}
                </div>
                {playing && <Equalizer />}
              </div>
              <Meta track={track} variant={variant} error={err} />
              {track.source !== 'youtube' && (
                <span className="absolute left-5 top-5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-zinc-200">
                  {SOURCE_LABEL[track.source]}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
