import { useCallback, useEffect, useState } from 'react';
import { authClient, authErrorMessage } from '../lib/authClient';
import { Spinner } from './Icons';

const input =
  'w-full rounded-lg border border-surface-600 bg-surface-900 px-3 py-2 outline-none transition focus:border-accent focus:ring-1 focus:ring-accent';
const btn = 'rounded-full px-4 py-1.5 text-sm font-medium transition disabled:opacity-50';
const primary = `${btn} bg-accent text-black hover:bg-accent-dim`;
const secondary = `${btn} bg-surface-700 hover:bg-surface-600`;

const formatDate = (d) => new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

function describeAgent(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} · ${os}` : browser;
}

const unwrap = ({ data, error }) => {
  if (error) throw error;
  return data;
};

/** Estado de uma ação assíncrona com mensagem de erro/sucesso por seção. */
function useAction() {
  const [state, setState] = useState({ busy: false, error: '', ok: '' });
  const run = useCallback(async (fn, okMessage) => {
    setState({ busy: true, error: '', ok: '' });
    try {
      await fn();
      setState({ busy: false, error: '', ok: okMessage || '' });
    } catch (err) {
      setState({ busy: false, error: authErrorMessage(err), ok: '' });
    }
  }, []);
  return [state, run];
}

function Section({ title, description, state, children }) {
  return (
    <section className="rounded-2xl border border-surface-600 bg-surface-800 p-5">
      <h3 className="font-semibold">{title}</h3>
      {description && <p className="mt-1 text-sm text-zinc-400">{description}</p>}
      <div className="mt-4">{children}</div>
      {state?.error && <p role="alert" className="mt-3 text-sm text-red-400">{state.error}</p>}
      {state?.ok && <p role="status" className="mt-3 text-sm text-accent">{state.ok}</p>}
    </section>
  );
}

function Profile({ user, emailVerification }) {
  const [name, setName] = useState(user.name);
  const [state, run] = useAction();
  return (
    <Section title="Perfil" state={state}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => unwrap(await authClient.updateUser({ name: name.trim() })), 'Nome atualizado.');
        }}
        className="flex flex-wrap gap-2"
      >
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required aria-label="Nome" autoComplete="name" className={`${input} min-w-0 flex-1`} />
        <button type="submit" disabled={state.busy || !name.trim() || name.trim() === user.name} className={primary}>
          Salvar
        </button>
      </form>
      <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-zinc-300">
        {user.email}
        {user.emailVerified ? (
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">verificado</span>
        ) : (
          <span className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-xs text-yellow-300">não verificado</span>
        )}
        {!user.emailVerified && emailVerification && (
          <button
            type="button"
            disabled={state.busy}
            onClick={() => run(async () => unwrap(await authClient.sendVerificationEmail({ email: user.email, callbackURL: '/' })), 'Link de confirmação enviado.')}
            className="text-xs text-zinc-400 underline hover:text-white"
          >
            reenviar confirmação
          </button>
        )}
      </p>
    </Section>
  );
}

function Passkeys() {
  const [list, setList] = useState(null);
  const [state, run] = useAction();
  const supported = typeof window !== 'undefined' && 'PublicKeyCredential' in window;

  const refresh = useCallback(async () => setList(unwrap(await authClient.passkey.listUserPasskeys()) || []), []);
  useEffect(() => {
    refresh().catch(() => setList([]));
  }, [refresh]);

  return (
    <Section
      title="Passkeys"
      description="Entre com a digital, o rosto ou o PIN do dispositivo — sem senha, e imune a phishing."
      state={state}
    >
      {list === null ? (
        <Spinner className="h-5 w-5 text-zinc-500" />
      ) : (
        <ul className="mb-3 divide-y divide-surface-700">
          {list.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate">{p.name || 'Passkey'}</span>
                <span className="block text-xs text-zinc-500">
                  criada em {formatDate(p.createdAt)}
                  {p.backedUp ? ' · sincronizada' : ''}
                </span>
              </span>
              <button
                type="button"
                disabled={state.busy}
                onClick={() =>
                  window.confirm('Remover esta passkey?') &&
                  run(async () => {
                    unwrap(await authClient.passkey.deletePasskey({ id: p.id }));
                    await refresh();
                  }, 'Passkey removida.')
                }
                className="shrink-0 text-xs text-zinc-400 hover:text-red-400"
              >
                Remover
              </button>
            </li>
          ))}
          {!list.length && <li className="py-2 text-sm text-zinc-500">Nenhuma passkey cadastrada.</li>}
        </ul>
      )}
      <button
        type="button"
        disabled={!supported || state.busy}
        onClick={() =>
          run(async () => {
            unwrap(await authClient.passkey.addPasskey({ name: describeAgent(navigator.userAgent) }));
            await refresh();
          }, 'Passkey cadastrada. Na próxima vez, use “Entrar com passkey”.')
        }
        className={primary}
      >
        {supported ? 'Adicionar passkey' : 'Navegador sem suporte a passkeys'}
      </button>
    </Section>
  );
}

function ChangePassword() {
  const [form, setForm] = useState({ current: '', next: '' });
  const [state, run] = useAction();
  return (
    <Section title="Senha" description="Ao trocar a senha, as sessões nos outros dispositivos são encerradas." state={state}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            unwrap(await authClient.changePassword({ currentPassword: form.current, newPassword: form.next, revokeOtherSessions: true }));
            setForm({ current: '', next: '' });
          }, 'Senha alterada.');
        }}
        className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
      >
        <input type="password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} required placeholder="Senha atual" aria-label="Senha atual" autoComplete="current-password" className={input} />
        <input type="password" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} required minLength={10} maxLength={128} placeholder="Nova senha (mín. 10)" aria-label="Nova senha" autoComplete="new-password" className={input} />
        <button type="submit" disabled={state.busy} className={primary}>
          Alterar
        </button>
      </form>
    </Section>
  );
}

function Sessions({ currentSessionId }) {
  const [list, setList] = useState(null);
  const [state, run] = useAction();

  const refresh = useCallback(async () => setList(unwrap(await authClient.listSessions()) || []), []);
  useEffect(() => {
    refresh().catch(() => setList([]));
  }, [refresh]);

  const others = list?.filter((s) => s.id !== currentSessionId) || [];

  return (
    <Section title="Dispositivos conectados" description="Sessões ativas na sua conta. Encerre as que você não reconhecer." state={state}>
      {list === null ? (
        <Spinner className="h-5 w-5 text-zinc-500" />
      ) : (
        <ul className="mb-3 divide-y divide-surface-700">
          {[...list]
            .sort((a, b) => (a.id === currentSessionId ? -1 : b.id === currentSessionId ? 1 : new Date(b.updatedAt) - new Date(a.updatedAt)))
            .map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate">
                    {describeAgent(s.userAgent)}
                    {s.id === currentSessionId && <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">este dispositivo</span>}
                  </span>
                  <span className="block text-xs text-zinc-500">
                    {s.ipAddress ? `${s.ipAddress} · ` : ''}desde {formatDate(s.createdAt)}
                  </span>
                </span>
                {s.id !== currentSessionId && (
                  <button
                    type="button"
                    disabled={state.busy}
                    onClick={() =>
                      run(async () => {
                        unwrap(await authClient.revokeSession({ token: s.token }));
                        await refresh();
                      }, 'Sessão encerrada.')
                    }
                    className="shrink-0 text-xs text-zinc-400 hover:text-red-400"
                  >
                    Encerrar
                  </button>
                )}
              </li>
            ))}
        </ul>
      )}
      <button
        type="button"
        disabled={state.busy || !others.length}
        onClick={() =>
          run(async () => {
            unwrap(await authClient.revokeOtherSessions());
            await refresh();
          }, 'Os outros dispositivos foram desconectados.')
        }
        className={secondary}
      >
        Sair dos outros dispositivos
      </button>
    </Section>
  );
}

function DeleteAccount({ hasPassword }) {
  const [password, setPassword] = useState('');
  const [state, run] = useAction();
  return (
    <Section title="Excluir conta" description="Apaga sua conta e todas as suas playlists. Não é possível desfazer." state={state}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!window.confirm('Excluir sua conta e todas as playlists definitivamente?')) return;
          run(async () => {
            unwrap(await authClient.deleteUser(hasPassword ? { password } : {}));
            window.location.assign('/');
          });
        }}
        className="flex flex-wrap gap-2"
      >
        {hasPassword && (
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="Confirme sua senha" aria-label="Senha" autoComplete="current-password" className={`${input} min-w-0 flex-1`} />
        )}
        <button type="submit" disabled={state.busy} className={`${btn} bg-red-500/15 text-red-300 hover:bg-red-500/25`}>
          Excluir minha conta
        </button>
      </form>
    </Section>
  );
}

/** Tela "Conta": perfil, passkeys, senha, sessões ativas e exclusão. */
export default function AccountView({ session, config }) {
  const [hasPassword, setHasPassword] = useState(null);

  useEffect(() => {
    authClient
      .listAccounts()
      .then(({ data }) => setHasPassword(Boolean(data?.some((a) => a.providerId === 'credential'))))
      .catch(() => setHasPassword(false));
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl font-bold">Sua conta</h2>
        <button
          type="button"
          onClick={async () => {
            await authClient.signOut();
            window.location.assign('/'); // limpa player, filas e playlists da memória
          }}
          className={secondary}
        >
          Sair
        </button>
      </div>
      <Profile user={session.user} emailVerification={config.emailVerification} />
      <Passkeys />
      {hasPassword && <ChangePassword />}
      <Sessions currentSessionId={session.session.id} />
      {hasPassword !== null && <DeleteAccount hasPassword={hasPassword} />}
    </div>
  );
}
