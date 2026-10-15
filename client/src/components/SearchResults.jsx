import { useState } from 'react';
import { useSearchStore } from '../store/searchStore';
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

export default function SearchResults() {
  const { query, searched, items, loading, error } = useSearchStore();
  const [view, setViewState] = useState(loadView);
  if (!searched) return null;

  const setView = (v) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* armazenamento indisponível */
    }
  };

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <ViewToggle view={view} setView={setView} />
      </div>
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
