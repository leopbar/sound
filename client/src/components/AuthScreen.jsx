import { useEffect, useState } from 'react';
import { authClient, authErrorMessage } from '../lib/authClient';
import { Spinner } from './Icons';
import { APP_BASE, appPath } from '../lib/base';

const PROVIDERS = {
  google: {
    label: 'Google',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
        <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.2 14.6 2.2 12 2.2 6.6 2.2 2.2 6.6 2.2 12s4.4 9.8 9.8 9.8c5.7 0 9.4-4 9.4-9.6 0-.6-.1-1.1-.2-1.6H12z" />
      </svg>
    ),
  },
  github: {
    label: 'GitHub',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
        <path d="M12 .5a11.5 11.5 0 0 0-3.6 22.4c.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.4 11.4 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6A11.5 11.5 0 0 0 12 .5z" />
      </svg>
    ),
  },
};

const URL_ERRORS = {
  INVALID_TOKEN: 'Link inválido ou expirado. Peça um novo.',
  TOKEN_EXPIRED: 'Link expirado. Peça um novo.',
  access_denied: 'Login cancelado.',
};

let urlState = null;

/** Lê (uma vez) e limpa da barra de endereço o que os links de e-mail/OAuth trazem na URL. */
function readUrlState() {
  if (urlState) return urlState;
  const params = new URLSearchParams(window.location.search);
  urlState = {
    resetToken: window.location.pathname === appPath('reset-password') ? params.get('token') : null,
    error: params.get('error'),
  };
  if (urlState.resetToken || urlState.error || window.location.pathname !== APP_BASE) {
    window.history.replaceState(null, '', APP_BASE);
  }
  return urlState;
}

function Field({ label, ...props }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-400">{label}</span>
      <input
        {...props}
        className="w-full rounded-lg border border-surface-600 bg-surface-800 px-3 py-2.5 outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
      />
    </label>
  );
}

function PasswordField({ label, ...props }) {
  const [show, setShow] = useState(false);
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-400">{label}</span>
      <span className="relative block">
        <input
          {...props}
          type={show ? 'text' : 'password'}
          className="w-full rounded-lg border border-surface-600 bg-surface-800 py-2.5 pl-3 pr-16 outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute inset-y-0 right-0 px-3 text-xs text-zinc-400 hover:text-white"
          aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
        >
          {show ? 'Ocultar' : 'Mostrar'}
        </button>
      </span>
    </label>
  );
}

function Submit({ busy, children }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="flex w-full items-center justify-center gap-2 rounded-full bg-accent py-2.5 font-semibold text-black transition hover:bg-accent-dim disabled:opacity-60"
    >
      {busy && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

/** Tela de entrada: e-mail/senha, passkey, Google/GitHub, cadastro e recuperação de senha. */
export default function AuthScreen({ config }) {
  const [{ resetToken, error: urlError }] = useState(readUrlState);
  const [mode, setMode] = useState(resetToken ? 'reset' : 'signin'); // signin | signup | forgot | reset | sent
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(urlError ? URL_ERRORS[urlError] || 'Não foi possível concluir o login.' : '');
  const [info, setInfo] = useState('');

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const go = (next) => {
    setMode(next);
    setError('');
    setInfo('');
  };

  // Autopreenchimento de passkey (conditional UI): o navegador sugere a passkey no campo de e-mail.
  useEffect(() => {
    if (mode !== 'signin') return;
    window.PublicKeyCredential?.isConditionalMediationAvailable?.().then((ok) => {
      if (ok) authClient.signIn.passkey({ autoFill: true }).catch(() => {});
    });
  }, [mode]);

  async function run(fn) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const unwrap = ({ data, error: err }) => {
    if (err) throw err;
    return data;
  };

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      if (mode === 'signin') {
        unwrap(await authClient.signIn.email({ email: form.email, password: form.password, rememberMe: true }));
      } else if (mode === 'signup') {
        const data = unwrap(
          await authClient.signUp.email({ name: form.name.trim(), email: form.email, password: form.password, callbackURL: APP_BASE }),
        );
        if (!data?.token) {
          setMode('sent');
          setInfo(`Enviamos um link de confirmação para ${form.email}. Abra-o para ativar sua conta.`);
        }
      } else if (mode === 'forgot') {
        unwrap(await authClient.requestPasswordReset({ email: form.email, redirectTo: appPath('reset-password') }));
        setMode('sent');
        setInfo(`Se existir uma conta com ${form.email}, você vai receber um link para criar uma nova senha.`);
      } else if (mode === 'reset') {
        unwrap(await authClient.resetPassword({ newPassword: form.password, token: resetToken }));
        setForm((f) => ({ ...f, password: '' }));
        go('signin');
        setInfo('Senha alterada. Entre com a nova senha.');
      }
    });
  };

  const passkeySignIn = () => run(async () => unwrap(await authClient.signIn.passkey()));
  const social = (provider) => run(async () => unwrap(await authClient.signIn.social({ provider, callbackURL: APP_BASE, errorCallbackURL: APP_BASE })));

  const titles = {
    signin: 'Entrar no Sound',
    signup: 'Criar sua conta',
    forgot: 'Recuperar senha',
    reset: 'Criar nova senha',
    sent: 'Verifique seu e-mail',
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-surface-700 via-surface-900 to-surface-900 px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center text-4xl font-bold tracking-tight">
          <span className="text-accent">♪</span> Sound
        </h1>
        <p className="mb-8 text-center text-sm text-zinc-400">Busque qualquer gravação do mundo e ouça na hora.</p>

        <div className="rounded-2xl border border-surface-600 bg-surface-800/80 p-6 shadow-2xl backdrop-blur">
          <h2 className="mb-5 text-xl font-semibold">{titles[mode]}</h2>

          {error && (
            <p role="alert" className="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}
          {info && (
            <p role="status" className="mb-4 rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent">
              {info}
            </p>
          )}

          {mode === 'sent' ? (
            <button type="button" onClick={() => go('signin')} className="w-full rounded-full bg-surface-700 py-2.5 font-medium hover:bg-surface-600">
              Voltar para o login
            </button>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {mode === 'signup' && (
                <Field label="Nome" value={form.name} onChange={set('name')} required maxLength={60} autoComplete="name" />
              )}
              {mode !== 'reset' && (
                <Field
                  label="E-mail"
                  type="email"
                  value={form.email}
                  onChange={set('email')}
                  required
                  autoComplete={mode === 'signin' ? 'username webauthn' : 'email'}
                  autoFocus
                />
              )}
              {mode !== 'forgot' && (
                <PasswordField
                  label={mode === 'reset' ? 'Nova senha' : 'Senha'}
                  value={form.password}
                  onChange={set('password')}
                  required
                  minLength={mode === 'signin' ? undefined : 10}
                  maxLength={128}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                />
              )}
              {(mode === 'signup' || mode === 'reset') && (
                <p className="-mt-2 text-xs text-zinc-500">Mínimo de 10 caracteres. Senhas que já vazaram na internet são recusadas.</p>
              )}
              {mode === 'signin' && (
                <button type="button" onClick={() => go('forgot')} className="-mt-2 block text-xs text-zinc-400 hover:text-white">
                  Esqueci minha senha
                </button>
              )}
              <Submit busy={busy}>
                {{ signin: 'Entrar', signup: 'Criar conta', forgot: 'Enviar link', reset: 'Salvar nova senha' }[mode]}
              </Submit>
            </form>
          )}

          {mode === 'signin' && (
            <>
              <div className="my-5 flex items-center gap-3 text-xs text-zinc-500">
                <span className="h-px flex-1 bg-surface-600" /> ou <span className="h-px flex-1 bg-surface-600" />
              </div>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={passkeySignIn}
                  disabled={busy}
                  className="flex w-full items-center justify-center gap-2 rounded-full border border-surface-600 py-2.5 font-medium hover:bg-surface-700 disabled:opacity-60"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                    <circle cx="9" cy="8" r="4" />
                    <path d="M2 21v-1a6 6 0 0 1 9.5-4.9M19 13a3 3 0 1 0-3 3l-1 1v2h2v-1h1v-1.5l.6-.6A3 3 0 0 0 19 13z" />
                  </svg>
                  Entrar com passkey
                </button>
                {config.providers.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => social(p)}
                    disabled={busy}
                    className="flex w-full items-center justify-center gap-2 rounded-full border border-surface-600 py-2.5 font-medium hover:bg-surface-700 disabled:opacity-60"
                  >
                    {PROVIDERS[p]?.icon} Continuar com {PROVIDERS[p]?.label || p}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-sm text-zinc-400">
          {mode === 'sent' ? null : mode === 'signin' ? (
            config.signUp && (
              <>
                Não tem conta?{' '}
                <button type="button" onClick={() => go('signup')} className="font-medium text-white hover:text-accent">
                  Criar conta
                </button>
              </>
            )
          ) : (
            <>
              {mode === 'signup' && 'Já tem conta? '}
              <button type="button" onClick={() => go('signin')} className="font-medium text-white hover:text-accent">
                {mode === 'signup' ? 'Entrar' : 'Voltar para o login'}
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
