import { useCallback, useEffect, useState } from 'react';
import { authClient, authErrorMessage } from '../lib/authClient';
import { adminApi } from '../lib/api';
import { Spinner } from './Icons';

const PAGE = 50;
const btn = 'rounded-full px-3 py-1 text-xs font-medium transition disabled:opacity-40';
const formatDate = (d) => new Date(d).toLocaleDateString('pt-BR');

const unwrap = ({ data, error }) => {
  if (error) throw error;
  return data;
};

const field =
  'min-w-0 rounded-lg border border-surface-600 bg-surface-900 px-3 py-2 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent';

/** Cadastro de usuário pelo admin: o sistema gera a senha temporária. */
function CreateUserForm({ onCreated }) {
  const [form, setForm] = useState({ name: '', email: '', role: 'user' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          const { user, password } = await adminApi.createUser(form);
          setForm({ name: '', email: '', role: 'user' });
          onCreated(user, password);
        } catch (err) {
          setError(err.message);
        } finally {
          setBusy(false);
        }
      }}
      className="mb-4 rounded-2xl border border-surface-600 bg-surface-800 p-4"
    >
      <h3 className="mb-3 font-semibold">Novo usuário</h3>
      <div className="grid gap-2 sm:grid-cols-[1fr_1.3fr_auto_auto]">
        <input value={form.name} onChange={set('name')} required maxLength={60} placeholder="Nome" aria-label="Nome" className={field} />
        <input type="email" value={form.email} onChange={set('email')} required maxLength={254} placeholder="E-mail" aria-label="E-mail" autoComplete="off" className={field} />
        <select value={form.role} onChange={set('role')} aria-label="Papel" className={field}>
          <option value="user">Usuário</option>
          <option value="admin">Administrador</option>
        </select>
        <button type="submit" disabled={busy} className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-black hover:bg-accent-dim disabled:opacity-50">
          {busy ? 'Criando…' : 'Criar'}
        </button>
      </div>
      <p className="mt-2 text-xs text-zinc-500">Uma senha temporária é gerada automaticamente. O usuário terá de trocá-la no primeiro login.</p>
      {error && <p role="alert" className="mt-2 text-sm text-red-400">{error}</p>}
    </form>
  );
}

/** Painel do administrador: usuários, papéis, suspensão, senhas temporárias e sessões. */
export default function AdminView({ currentUserId }) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [result, setResult] = useState(null); // { users, total }
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState(null); // { type: 'error' | 'ok', text }
  const [temp, setTemp] = useState(null); // { email, password, title }

  const load = useCallback(async () => {
    try {
      const data = unwrap(
        await authClient.admin.listUsers({
          query: {
            limit: PAGE,
            offset: page * PAGE,
            sortBy: 'createdAt',
            sortDirection: 'desc',
            ...(query ? { searchValue: query, searchField: 'email', searchOperator: 'contains' } : {}),
          },
        }),
      );
      setResult({ users: data.users, total: data.total });
    } catch (err) {
      setMessage({ type: 'error', text: authErrorMessage(err) });
      setResult({ users: [], total: 0 });
    }
  }, [page, query]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(user, fn, okText) {
    setBusyId(user.id);
    setMessage(null);
    try {
      await fn();
      if (okText) setMessage({ type: 'ok', text: okText });
      await load();
    } catch (err) {
      setMessage({ type: 'error', text: authErrorMessage(err) });
    } finally {
      setBusyId(null);
    }
  }

  const actions = (u) => {
    const self = u.id === currentUserId;
    const isAdmin = u.role === 'admin';
    return [
      !self && {
        label: isAdmin ? 'Remover admin' : 'Tornar admin',
        run: () =>
          act(u, async () => unwrap(await authClient.admin.setRole({ userId: u.id, role: isAdmin ? 'user' : 'admin' })), `${u.email}: papel atualizado.`),
      },
      !self && {
        label: u.banned ? 'Reativar' : 'Suspender',
        danger: !u.banned,
        run: () => {
          if (u.banned) return act(u, async () => unwrap(await authClient.admin.unbanUser({ userId: u.id })), `${u.email} reativado.`);
          const reason = window.prompt(`Suspender ${u.email}? Motivo (opcional):`);
          if (reason === null) return;
          return act(u, async () => unwrap(await authClient.admin.banUser({ userId: u.id, banReason: reason || undefined })), `${u.email} suspenso e desconectado.`);
        },
      },
      !self &&
        u.mustChangePassword && {
          label: 'Ver senha',
          run: () =>
            act(u, async () => {
              const { password } = await adminApi.getTempPassword(u.id);
              setTemp({ email: u.email, password, title: 'Senha temporária' });
            }),
        },
      !self && {
        label: 'Nova senha temporária',
        run: () =>
          window.confirm(`Gerar uma nova senha temporária para ${u.email}? A senha atual deixa de valer e as sessões são encerradas.`) &&
          act(u, async () => {
            const { password } = await adminApi.resetTempPassword(u.id);
            setTemp({ email: u.email, password, title: 'Nova senha temporária' });
          }),
      },
      !self && {
        label: 'Desconectar',
        run: () => act(u, async () => unwrap(await authClient.admin.revokeUserSessions({ userId: u.id })), `${u.email} desconectado de todos os dispositivos.`),
      },
      !self && {
        label: 'Excluir',
        danger: true,
        run: () =>
          window.confirm(`Excluir ${u.email} e todas as playlists dessa conta? Não é possível desfazer.`) &&
          act(u, async () => unwrap(await authClient.admin.removeUser({ userId: u.id })), `${u.email} excluído.`),
      },
    ].filter(Boolean);
  };

  const pages = result ? Math.max(1, Math.ceil(result.total / PAGE)) : 1;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Administração</h2>
          <p className="text-sm text-zinc-400">{result ? `${result.total} usuário(s)` : 'Carregando…'}</p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setPage(0);
            setQuery(search.trim());
          }}
          className="flex gap-2"
        >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por e-mail"
            aria-label="Buscar por e-mail"
            className="w-56 rounded-lg border border-surface-600 bg-surface-800 px-3 py-1.5 text-sm outline-none focus:border-accent"
          />
          <button type="submit" className={`${btn} bg-surface-700 px-4 text-sm hover:bg-surface-600`}>
            Buscar
          </button>
        </form>
      </div>

      <CreateUserForm
        onCreated={(user, password) => {
          setTemp({ email: user.email, password, title: 'Usuário criado! Senha temporária' });
          setMessage(null);
          setPage(0);
          setQuery('');
          setSearch('');
          load();
        }}
      />

      {temp && (
        <div role="status" className="mb-4 rounded-xl border border-accent/40 bg-accent/10 p-4 text-sm">
          <p>
            {temp.title} de <strong>{temp.email}</strong> — envie por um canal seguro:
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded bg-black/40 px-3 py-1.5 font-mono text-base text-accent">{temp.password}</code>
            <button type="button" onClick={() => navigator.clipboard?.writeText(temp.password)} className={`${btn} bg-surface-700 hover:bg-surface-600`}>
              Copiar
            </button>
            <button type="button" onClick={() => setTemp(null)} className={`${btn} text-zinc-400 hover:text-white`}>
              Fechar
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-400">
            Fica disponível em “Ver senha” até o usuário entrar e definir a própria senha — depois disso ela é apagada.
          </p>
        </div>
      )}

      {message && (
        <p role={message.type === 'error' ? 'alert' : 'status'} className={`mb-4 text-sm ${message.type === 'error' ? 'text-red-400' : 'text-accent'}`}>
          {message.text}
        </p>
      )}

      {!result ? (
        <div className="flex justify-center py-10 text-zinc-500">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <ul className="divide-y divide-surface-700 rounded-2xl border border-surface-600 bg-surface-800">
          {result.users.map((u) => (
            <li key={u.id} className={`flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between ${u.banned ? 'opacity-60' : ''}`}>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{u.name}</span>
                  {u.role === 'admin' && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">admin</span>}
                  {u.banned && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs text-red-300">suspenso</span>}
                  {u.mustChangePassword && <span className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-xs text-yellow-300">senha temporária</span>}
                  {u.id === currentUserId && <span className="text-xs text-zinc-500">(você)</span>}
                </p>
                <p className="truncate text-sm text-zinc-400">
                  {u.email} · desde {formatDate(u.createdAt)}
                  {u.banned && u.banReason ? ` · ${u.banReason}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-1.5">
                {busyId === u.id ? (
                  <Spinner className="h-4 w-4 text-zinc-500" />
                ) : (
                  actions(u).map((a) => (
                    <button
                      key={a.label}
                      type="button"
                      disabled={busyId !== null}
                      onClick={a.run}
                      className={`${btn} ${a.danger ? 'bg-red-500/10 text-red-300 hover:bg-red-500/20' : 'bg-surface-700 hover:bg-surface-600'}`}
                    >
                      {a.label}
                    </button>
                  ))
                )}
              </div>
            </li>
          ))}
          {!result.users.length && <li className="p-6 text-center text-sm text-zinc-500">Nenhum usuário encontrado.</li>}
        </ul>
      )}

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className={`${btn} bg-surface-700 hover:bg-surface-600`}>
            ← Anterior
          </button>
          <span className="text-zinc-400">
            {page + 1} / {pages}
          </span>
          <button type="button" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} className={`${btn} bg-surface-700 hover:bg-surface-600`}>
            Próxima →
          </button>
        </div>
      )}
    </div>
  );
}
