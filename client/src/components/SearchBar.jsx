import { useState } from 'react';
import { useSearchStore } from '../store/searchStore';
import { SearchIcon, Spinner } from './Icons';

export default function SearchBar() {
  const [value, setValue] = useState('');
  const search = useSearchStore((s) => s.search);
  const clear = useSearchStore((s) => s.clear);
  const loading = useSearchStore((s) => s.loading);

  const submit = (e) => {
    e.preventDefault();
    search(value);
  };

  const change = (e) => {
    setValue(e.target.value);
    // Campo apagado (inclusive pelo "x" do input): volta para as mais tocadas.
    if (!e.target.value.trim()) clear();
  };

  return (
    <form onSubmit={submit} role="search" className="relative w-full">
      <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400" />
      <input
        type="search"
        value={value}
        onChange={change}
        placeholder="Música e artista — ex.: Bohemian Rhapsody - Queen"
        aria-label="Buscar música"
        className="h-11 w-full rounded-full border border-surface-600 bg-surface-700 pl-12 pr-28 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30"
      />
      <button
        type="submit"
        disabled={loading || !value.trim()}
        className="absolute right-1.5 top-1/2 flex h-[calc(100%-12px)] -translate-y-1/2 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-black transition hover:bg-accent-dim disabled:opacity-50"
      >
        {loading ? <Spinner className="h-4 w-4" /> : 'Buscar'}
      </button>
    </form>
  );
}
