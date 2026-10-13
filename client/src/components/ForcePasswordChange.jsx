import { useState } from 'react';
import { authClient, authErrorMessage } from '../lib/authClient';
import { Spinner } from './Icons';
import { APP_BASE } from '../lib/base';

const input =
  'w-full rounded-lg border border-surface-600 bg-surface-800 px-3 py-2.5 outline-none transition focus:border-accent focus:ring-1 focus:ring-accent';

/** Bloqueia o app até o usuário trocar a senha temporária criada pelo administrador. */
export default function ForcePasswordChange({ user }) {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (form.next !== form.confirm) return setError('As senhas não conferem.');
    if (form.next === form.current) return setError('A nova senha precisa ser diferente da temporária.');
    setBusy(true);
    setError('');
    const { error: err } = await authClient.changePassword({
      currentPassword: form.current,
      newPassword: form.next,
      revokeOtherSessions: true,
    });
    if (err) {
      setError(authErrorMessage(err));
      setBusy(false);
      return;
    }
    window.location.assign(APP_BASE);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-surface-700 via-surface-900 to-surface-900 px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="mb-8 text-center text-4xl font-bold tracking-tight">
          <span className="text-accent">♪</span> Sound
        </h1>
        <div className="rounded-2xl border border-surface-600 bg-surface-800/80 p-6 shadow-2xl">
          <h2 className="text-xl font-semibold">Defina sua senha</h2>
          <p className="mb-5 mt-1 text-sm text-zinc-400">
            Olá, {user.name}! Você entrou com uma senha temporária. Escolha uma senha definitiva para continuar.
          </p>
          {error && (
            <p role="alert" className="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}
          <form onSubmit={submit} className="space-y-3">
            <input type="password" value={form.current} onChange={set('current')} required placeholder="Senha temporária" aria-label="Senha temporária" autoComplete="current-password" className={input} />
            <input type="password" value={form.next} onChange={set('next')} required minLength={10} maxLength={128} placeholder="Nova senha (mín. 10 caracteres)" aria-label="Nova senha" autoComplete="new-password" className={input} />
            <input type="password" value={form.confirm} onChange={set('confirm')} required minLength={10} maxLength={128} placeholder="Repita a nova senha" aria-label="Repita a nova senha" autoComplete="new-password" className={input} />
            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-accent py-2.5 font-semibold text-black transition hover:bg-accent-dim disabled:opacity-60"
            >
              {busy && <Spinner className="h-4 w-4" />}
              Salvar e continuar
            </button>
          </form>
          <button
            type="button"
            onClick={async () => {
              await authClient.signOut();
              window.location.assign(APP_BASE);
            }}
            className="mt-4 w-full text-center text-sm text-zinc-400 hover:text-white"
          >
            Sair
          </button>
        </div>
      </div>
    </div>
  );
}
