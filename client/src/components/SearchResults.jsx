import { useSearchStore } from '../store/searchStore';
import TrackList from './TrackList';
import { Spinner } from './Icons';

const LABELS = { all: 'Tudo', recordings: 'Gravações', videos: 'YouTube' };

function Tabs({ tab, setTab, counts }) {
  return (
    <div role="tablist" aria-label="Tipo de resultado" className="mb-6 flex gap-2">
      {Object.entries(LABELS).map(([key, label]) => {
        const active = tab === key;
        const { count, loading } = counts[key];
        return (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition ${
              active ? 'bg-white text-black' : 'bg-surface-700 text-zinc-300 hover:bg-surface-600'
            }`}
          >
            {label}
            {loading ? (
              <Spinner className="h-3.5 w-3.5 opacity-60" />
            ) : (
              <span className={`text-xs tabular-nums ${active ? 'text-zinc-600' : 'text-zinc-500'}`}>{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-bold">{title}</h2>
      {subtitle && <p className="mb-4 text-xs text-zinc-500">{subtitle}</p>}
      {children}
    </section>
  );
}

export default function SearchResults() {
  const { query, searched, tab, setTab, recordings, videos } = useSearchStore();
  if (!searched) return null;

  // Na aba "Tudo", vídeos que já tocam em algum card de gravação não se repetem.
  const usedVideos = new Set(recordings.items.map((t) => t.sourceId));
  const extraVideos = videos.items.filter((v) => !usedVideos.has(v.sourceId));

  const counts = {
    all: { count: recordings.items.length + extraVideos.length, loading: recordings.loading || videos.loading },
    recordings: { count: recordings.items.length, loading: recordings.loading },
    videos: { count: videos.items.length, loading: videos.loading },
  };

  const recordingList = (
    <TrackList
      tracks={recordings.items}
      variant="recording"
      loading={recordings.loading}
      error={recordings.error}
      emptyText={`Nenhuma gravação catalogada encontrada para “${query}”.`}
    />
  );

  return (
    <div>
      <Tabs tab={tab} setTab={setTab} counts={counts} />

      {tab === 'recordings' && recordingList}

      {tab === 'videos' && (
        <TrackList
          tracks={videos.items}
          variant="video"
          loading={videos.loading}
          error={videos.error}
          emptyText={`Nenhum vídeo encontrado para “${query}”.`}
          skeleton={8}
        />
      )}

      {tab === 'all' && (
        <>
          <Section title="Gravações" subtitle="Catálogo MusicBrainz: álbum, versão e capa oficiais">
            {recordingList}
          </Section>
          {(videos.loading || videos.error || extraVideos.length > 0) && (
            <Section title="Também no YouTube" subtitle="Clipes, uploads e versões fora do catálogo">
              <TrackList tracks={extraVideos} variant="video" loading={videos.loading} error={videos.error} skeleton={4} />
            </Section>
          )}
        </>
      )}
    </div>
  );
}
