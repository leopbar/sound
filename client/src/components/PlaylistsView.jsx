import { useState } from 'react';
import { usePlaylistStore } from '../store/playlistStore';
import { usePlayerStore, selectCurrentTrack } from '../store/playerStore';
import { formatTime } from '../lib/format';
import Artwork from './Artwork';
import { PlayIcon, PauseIcon, Spinner } from './Icons';

function CreateForm() {
  const create = usePlaylistStore((s) => s.create);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim() || busy) return;
        setBusy(true);
        if (await create(name)) setName('');
        setBusy(false);
      }}
      className="mb-6 flex gap-2"
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nome da nova playlist"
        maxLength={60}
        className="min-w-0 flex-1 rounded-lg bg-surface-700 px-3 py-2 outline-none focus:ring-1 focus:ring-accent"
      />
      <button type="submit" disabled={!name.trim() || busy} className="rounded-lg bg-accent px-4 py-2 font-medium text-black disabled:opacity-40">
        Criar
      </button>
    </form>
  );
}

function PlaylistDetail({ playlist, onBack }) {
  const { rename, remove, removeTrack, moveTrack } = usePlaylistStore.getState();
  const current = usePlayerStore(selectCurrentTrack);
  const status = usePlayerStore((s) => s.status);
  const failed = usePlayerStore((s) => s.failed);
  const { playQueue, toggle } = usePlayerStore.getState();
  const [name, setName] = useState(playlist.name);
  const [drag, setDrag] = useState(null); // { from, over }

  const onSelect = (track, i) => {
    if (current?.id === track.id) toggle();
    else playQueue(playlist.tracks, i);
  };

  return (
    <div>
      <button type="button" onClick={onBack} className="mb-4 text-sm text-zinc-400 hover:text-white">
        ← Playlists
      </button>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => (name.trim() ? rename(playlist.id, name) : setName(playlist.name))}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          maxLength={60}
          aria-label="Nome da playlist"
          className="min-w-0 flex-1 rounded bg-transparent text-2xl font-bold outline-none focus:bg-surface-700 focus:px-2"
        />
        <button
          type="button"
          disabled={!playlist.tracks.length}
          onClick={() => playQueue(playlist.tracks, 0)}
          className="flex items-center gap-1 rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-black disabled:opacity-40"
        >
          <PlayIcon className="h-4 w-4" /> Tocar tudo
        </button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Excluir a playlist “${playlist.name}”?`)) {
              remove(playlist.id);
              onBack();
            }
          }}
          className="rounded-full bg-surface-700 px-4 py-1.5 text-sm text-red-400 hover:bg-surface-600"
        >
          Excluir
        </button>
      </div>

      {!playlist.tracks.length ? (
        <p className="py-10 text-center text-zinc-400">Playlist vazia. Use o botão “+” nos resultados da busca para adicionar faixas.</p>
      ) : (
        <ul className="divide-y divide-surface-700">
          {playlist.tracks.map((track, i) => {
            const active = current?.id === track.id;
            const playing = active && status === 'playing';
            const err = failed[track.id];
            return (
              <li
                key={track.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  setDrag({ from: i, over: i });
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (drag && drag.over !== i) setDrag({ ...drag, over: i });
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (drag) moveTrack(playlist.id, drag.from, i);
                  setDrag(null);
                }}
                onDragEnd={() => setDrag(null)}
                className={`flex items-center gap-3 py-2 ${err ? 'opacity-50' : ''} ${
                  drag && drag.over === i && drag.from !== i ? 'bg-surface-700' : ''
                } ${drag?.from === i ? 'opacity-40' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => onSelect(track, i)}
                  title={err || `${track.title} — ${track.artist}`}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 text-left hover:bg-surface-800"
                >
                  <span className="w-5 shrink-0 text-center text-xs text-zinc-500">
                    {playing ? <PauseIcon className="mx-auto h-4 w-4 text-accent" /> : i + 1}
                  </span>
                  <Artwork track={track} className="h-10 w-10 shrink-0 rounded" />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm font-semibold ${active ? 'text-accent' : ''}`}>{track.title}</span>
                    <span className="block truncate text-xs text-zinc-400">{err || track.artist}</span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-zinc-500">{track.duration ? formatTime(track.duration) : ''}</span>
                </button>
                <span className="flex shrink-0 flex-col text-[10px] leading-none text-zinc-500">
                  <button
                    type="button"
                    disabled={i === 0}
                    onClick={() => moveTrack(playlist.id, i, i - 1)}
                    aria-label={`Mover ${track.title} para cima`}
                    title="Mover para cima"
                    className="px-1.5 py-0.5 hover:text-white disabled:opacity-20 disabled:hover:text-zinc-500"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    disabled={i === playlist.tracks.length - 1}
                    onClick={() => moveTrack(playlist.id, i, i + 1)}
                    aria-label={`Mover ${track.title} para baixo`}
                    title="Mover para baixo"
                    className="px-1.5 py-0.5 hover:text-white disabled:opacity-20 disabled:hover:text-zinc-500"
                  >
                    ▼
                  </button>
                </span>
                <button
                  type="button"
                  onClick={() => removeTrack(playlist.id, track.id)}
                  aria-label={`Remover ${track.title} da playlist`}
                  title="Remover da playlist"
                  className="shrink-0 px-2 text-zinc-500 hover:text-red-400"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Tela de playlists: lista (com criação) e detalhe de uma playlist. */
export default function PlaylistsView() {
  const playlists = usePlaylistStore((s) => s.playlists);
  const status = usePlaylistStore((s) => s.status);
  const [openId, setOpenId] = useState(null);
  const open = playlists.find((p) => p.id === openId);

  if (open) return <PlaylistDetail key={open.id} playlist={open} onBack={() => setOpenId(null)} />;

  return (
    <div className="mx-auto max-w-3xl">
      <h2 className="mb-4 text-2xl font-bold">Suas playlists</h2>
      <CreateForm />
      {status === 'error' && !playlists.length ? (
        <p className="py-10 text-center text-zinc-400">
          Não foi possível carregar suas playlists.{' '}
          <button type="button" onClick={() => usePlaylistStore.getState().load()} className="text-white underline">
            Tentar de novo
          </button>
        </p>
      ) : status !== 'ready' && !playlists.length ? (
        <div className="flex justify-center py-10 text-zinc-500">
          <Spinner className="h-6 w-6" />
        </div>
      ) : !playlists.length ? (
        <p className="py-10 text-center text-zinc-400">Você ainda não tem playlists.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {playlists.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setOpenId(p.id)}
                className="flex w-full items-center gap-3 rounded-xl bg-surface-800 p-3 text-left transition hover:bg-surface-700"
              >
                {p.tracks[0] ? (
                  <Artwork track={p.tracks[0]} className="h-14 w-14 shrink-0 rounded" />
                ) : (
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-surface-700 text-zinc-500">♪</span>
                )}
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{p.name}</span>
                  <span className="block text-xs text-zinc-400">
                    {p.tracks.length} {p.tracks.length === 1 ? 'faixa' : 'faixas'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
