import { useEffect, useState } from 'react';
import { sharesApi } from '../lib/api';
import { usePlayerStore } from '../store/playerStore';
import Modal, { btnPrimary, btnSecondary } from './Modal';
import { Spinner } from './Icons';

/** Escolha do usuário que vai receber o convite para a playlist. */
export default function ShareDialog({ playlist, onClose }) {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    sharesApi.users().then(setUsers, (err) => setError(err.message || 'Não foi possível carregar os usuários.'));
  }, []);

  const q = filter.trim().toLowerCase();
  const shown = users?.filter((u) => !q || u.name.toLowerCase().includes(q)) ?? [];

  const send = async () => {
    if (!selected || sending) return;
    setSending(true);
    setError('');
    try {
      await sharesApi.send(playlist.id, selected.id);
      usePlayerStore.setState({ notice: { id: Date.now(), text: `Convite enviado para ${selected.name}.` } });
      onClose();
    } catch (err) {
      setError(err.message || 'Não foi possível enviar o convite.');
      setSending(false);
    }
  };

  return (
    <Modal title="Compartilhar lista" onClose={onClose} labelledBy="share-dialog-title">
      <p className="mb-3 text-zinc-400">Escolha quem vai receber “{playlist.name}”. Se aceitar, a pessoa recebe uma cópia.</p>
      {users && users.length > 6 && (
        <input
          data-autofocus
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Procurar usuário"
          aria-label="Procurar usuário"
          className="mb-2 w-full rounded-lg bg-surface-700 px-3 py-2 text-white outline-none focus:ring-1 focus:ring-accent"
        />
      )}
      <div className="mb-4 max-h-64 overflow-y-auto rounded-lg bg-surface-900/50">
        {!users && !error ? (
          <div className="flex justify-center py-6 text-zinc-500">
            <Spinner className="h-5 w-5" />
          </div>
        ) : users && !users.length ? (
          <p className="p-4 text-center text-zinc-500">Não há outros usuários no app.</p>
        ) : users && !shown.length ? (
          <p className="p-4 text-center text-zinc-500">Nenhum usuário encontrado.</p>
        ) : (
          <ul role="listbox" aria-label="Usuários">
            {shown.map((u) => {
              const active = selected?.id === u.id;
              return (
                <li key={u.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => setSelected(u)}
                    className={`flex w-full items-center gap-3 px-3 py-2 text-left transition ${active ? 'bg-accent/20 text-white' : 'hover:bg-surface-700'}`}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-600 text-xs font-semibold uppercase text-white">
                      {u.name.trim()[0] || '?'}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{u.name}</span>
                    {active && <span className="text-accent">✓</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {error && <p className="mb-3 text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={btnSecondary}>
          Cancelar
        </button>
        <button type="button" disabled={!selected || sending} onClick={send} className={btnPrimary}>
          {sending ? 'Enviando…' : 'Enviar'}
        </button>
      </div>
    </Modal>
  );
}
