import { useState } from 'react';
import { useSearchStore } from '../store/searchStore';
import { SearchIcon, Spinner } from './Icons';

const EXAMPLES = ['Bohemian Rhapsody - Queen', 'Clair de Lune - Debussy', 'Garota de Ipanema - Tom Jobim'];

export default function SearchBar({ compact }) {
  const [value, setValue] = useState('');
  const search = useSearchStore((s) => s.search);
  const loading = useSearchStore((s) => s.loading);

  const submit = (e) => {
    e.preventDefault();
    search(value);
  };

  return (
    <div className="w-full">
      <form onSubmit={submit} role="search" className="relative">
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400" />
        <input
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Música e artista — ex.: Bohemian Rhapsody - Queen"
          aria-label="Buscar música"
          autoFocus
          className={`w-full rounded-full border border-surface-600 bg-surface-700 pl-12 pr-28 text-zinc-100 placeholder:text-zinc-500 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30 ${
            compact ? 'h-11 text-sm' : 'h-14 text-base'
          }`}
        />
        <button
          type="submit"
          disabled={loading || !value.trim()}
          className="absolute right-1.5 top-1/2 flex h-[calc(100%-12px)] -translate-y-1/2 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-black transition hover:bg-accent-dim disabled:opacity-50"
        >
          {loading ? <Spinner className="h-4 w-4" /> : 'Buscar'}
        </button>
      </form>
      {!compact && (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => {
                setValue(ex);
                search(ex);
              }}
              className="rounded-full border border-surface-600 px-3 py-1 text-xs text-zinc-400 transition hover:border-zinc-400 hover:text-zinc-200"
            >
              {ex}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
