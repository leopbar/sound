import { useEffect, useState } from 'react';
import { useSearchStore } from '../store/searchStore';
import { useChartStore } from '../store/chartStore';
import TrackList from './TrackList';
import { ListIcon, GridIcon } from './Icons';

const VIEW_KEY = 'sound:searchView';
const VIEWS = [
  { key: 'list', label: 'Lista', Icon: ListIcon },
  { key: 'grid', label: 'Grade', Icon: GridIcon },
];

function loadView() {
  try {
    return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}

function ViewToggle({ view, setView }) {
  return (
    <div role="group" aria-label="Visualização" className="flex rounded-full bg-surface-700 p-1">
      {VIEWS.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          aria-pressed={view === key}
          aria-label={label}
          title={label}
          onClick={() => setView(key)}
          className={`flex h-8 w-8 items-center justify-center rounded-full transition ${
            view === key ? 'bg-white text-black' : 'text-zinc-400 hover:text-zinc-100'
          }`}
        >
          <Icon width={16} height={16} />
        </button>
      ))}
    </div>
  );
}

/** Tela inicial: as 30 mais tocadas no mundo (Top 50 - Global do Spotify). */
function TopChart({ view, toggle }) {
  const { tracks, loading, error, load } = useChartStore();
  useEffect(() => load(), [load]);

  return (
    <section aria-labelledby="top-chart-title">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 id="top-chart-title" className="text-xl font-bold">Mais tocadas no mundo</h2>
          <p className="text-xs text-zinc-500">Top 50 Global do Spotify · atualizada todo dia</p>
        </div>
        {toggle}
      </div>
      {error ? (
        <div className="py-10 text-center text-zinc-400">
          <p>Não foi possível carregar as mais tocadas.</p>
          <button
            type="button"
            onClick={load}
            className="mt-3 rounded-full border border-surface-600 px-4 py-1.5 text-sm transition hover:border-zinc-400"
          >
            Tentar de novo
          </button>
        </div>
      ) : (
        <TrackList tracks={tracks} view={view} loading={loading} ranked skeleton={view === 'list' ? 10 : 8} />
      )}
    </section>
  );
}

/** Resultados da busca; sem busca, as mais tocadas. */
export default function SearchResults() {
  const { query, searched, items, loading, error } = useSearchStore();
  const [view, setViewState] = useState(loadView);

  const setView = (v) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* armazenamento indisponível */
    }
  };
  const toggle = <ViewToggle view={view} setView={setView} />;

  if (!searched) return <TopChart view={view} toggle={toggle} />;

  return (
    <div>
      <div className="mb-4 flex justify-end">{toggle}</div>
      <TrackList
        tracks={items}
        view={view}
        loading={loading}
        error={error}
        emptyText={`Nenhum vídeo encontrado para “${query}”.`}
        skeleton={view === 'list' ? 10 : 8}
      />
    </div>
  );
}
