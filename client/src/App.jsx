import { useState } from 'react';
import SearchBar from './components/SearchBar';
import SearchResults from './components/SearchResults';
import PlayerBar from './components/PlayerBar';
import PlaylistsView from './components/PlaylistsView';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { useSearchStore } from './store/searchStore';

export default function App() {
  useAudioPlayer();
  const hasSearched = useSearchStore((s) => s.searched);
  const [view, setView] = useState('search'); // search | playlists

  return (
    <div className="min-h-screen bg-gradient-to-b from-surface-700 via-surface-900 to-surface-900 pb-36 md:pb-28">
      <nav className="mx-auto flex max-w-screen-2xl justify-end gap-2 px-4 pt-4 text-sm">
        {[
          ['search', 'Buscar'],
          ['playlists', 'Playlists'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setView(key)}
            aria-current={view === key ? 'page' : undefined}
            className={`rounded-full px-4 py-1.5 font-medium transition ${
              view === key ? 'bg-white text-black' : 'bg-surface-700 text-zinc-300 hover:bg-surface-600'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {view === 'search' && (
      <header
        className={`mx-auto flex max-w-3xl flex-col items-center px-4 transition-all duration-500 ${
          hasSearched ? 'pt-8' : 'pt-[22vh]'
        }`}
      >
        <h1 className={`font-bold tracking-tight transition-all ${hasSearched ? 'mb-5 text-2xl' : 'mb-2 text-5xl'}`}>
          <span className="text-accent">♪</span> Sound
        </h1>
        {!hasSearched && (
          <p className="mb-8 text-center text-zinc-400">Busque qualquer gravação do mundo e ouça na hora.</p>
        )}
        <SearchBar compact={hasSearched} />
      </header>
      )}

      <main className="mx-auto mt-10 max-w-screen-2xl px-4">
        <div hidden={view !== 'search'}>
          <SearchResults />
        </div>
        {view === 'playlists' && <PlaylistsView />}
      </main>

      <PlayerBar />
    </div>
  );
}
