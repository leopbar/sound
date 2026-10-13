import { useEffect, useRef, useState } from 'react';
import { usePlaylistStore } from '../store/playlistStore';
import { PlusIcon, CheckIcon } from './Icons';

/**
 * Botão "+" para adicionar a faixa a uma playlist (ou criar uma nova). Vira "✓" quando a
 * faixa já está em alguma playlist; o menu continua abrindo para incluí-la em outras.
 * `variant="card"`: canto do card (aparece no hover). `variant="bar"`: na PlayerBar (menu abre para cima).
 */
export default function AddToPlaylist({ track, variant = 'card' }) {
  const playlists = usePlaylistStore((s) => s.playlists);
  const { create, addTrack } = usePlaylistStore.getState();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (e.type === 'keydown' ? e.key === 'Escape' : !ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  // Fecha o menu se a faixa mudar (na PlayerBar, ao avançar para a próxima).
  useEffect(() => setOpen(false), [track?.id]);

  if (!track) return null;

  const inLists = playlists.filter((p) => p.tracks.some((t) => t.id === track.id));
  const saved = inLists.length > 0;
  const label = saved ? `Na playlist: ${inLists.map((p) => p.name).join(', ')}` : 'Adicionar à playlist';

  const submit = (e) => {
    e.preventDefault();
    create(name, track);
    setName('');
    setOpen(false);
  };

  const bar = variant === 'bar';
  const buttonClass = bar
    ? `flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow transition hover:scale-105 ${
        saved ? 'bg-accent text-black' : 'bg-white text-black'
      }`
    : `flex h-8 w-8 items-center justify-center rounded-full shadow transition ${
        saved
          ? 'bg-accent text-black opacity-100'
          : `bg-black/70 text-white hover:bg-accent hover:text-black ${
              open ? 'opacity-100' : 'opacity-0 focus:opacity-100 group-hover/card:opacity-100 [@media(hover:none)]:opacity-100'
            }`
      }`;

  return (
    <div ref={ref} className={bar ? 'relative shrink-0' : 'absolute right-5 top-5 z-10'}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-expanded={open}
        title={label}
        className={buttonClass}
      >
        {saved ? <CheckIcon width={18} height={18} /> : <PlusIcon width={18} height={18} />}
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute w-56 rounded-lg border border-surface-600 bg-surface-800 p-2 text-sm shadow-xl ${
            bar ? 'bottom-full left-0 mb-2' : 'right-0 mt-2'
          }`}
        >
          <p className="px-2 pb-1 text-[11px] uppercase tracking-wide text-zinc-500">Adicionar à playlist</p>
          <ul className="max-h-40 overflow-y-auto">
            {playlists.map((p) => {
              const has = inLists.includes(p);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={has}
                    onClick={() => {
                      addTrack(p.id, track);
                      setOpen(false);
                    }}
                    className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-surface-700 disabled:cursor-default disabled:text-zinc-500 disabled:hover:bg-transparent"
                  >
                    <span className="truncate">{p.name}</span>
                    {has && <CheckIcon width={14} height={14} className="ml-2 shrink-0 text-accent" />}
                  </button>
                </li>
              );
            })}
          </ul>
          <form onSubmit={submit} className="mt-1 flex gap-1 border-t border-surface-600 pt-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nova playlist"
              maxLength={60}
              className="min-w-0 flex-1 rounded bg-surface-700 px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-accent"
            />
            <button type="submit" className="rounded bg-accent px-2 py-1 text-sm font-medium text-black">
              Criar
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
