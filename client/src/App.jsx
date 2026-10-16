import { useEffect, useState } from 'react';
import SearchBar from './components/SearchBar';
import SearchResults from './components/SearchResults';
import PlayerBar from './components/PlayerBar';
import PlaylistsView from './components/PlaylistsView';
import AuthScreen from './components/AuthScreen';
import AccountView from './components/AccountView';
import AdminView from './components/AdminView';
import ForcePasswordChange from './components/ForcePasswordChange';
import InstallButton from './components/InstallButton';
import DialogHost from './components/DialogHost';
import ShareInbox from './components/ShareInbox';
import ValidationBubble from './components/ValidationBubble';
import { Spinner } from './components/Icons';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { usePlaylistStore } from './store/playlistStore';
import { authClient } from './lib/authClient';
import { API_BASE } from './lib/base';

const DEFAULT_CONFIG = { providers: [], emailVerification: false, signUp: true };

/** Só renderiza o app com sessão válida; sem ela, mostra a tela de login. */
export default function App() {
  const { data: session, isPending } = authClient.useSession();
  const [config, setConfig] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/auth-config`)
      .then((r) => (r.ok ? r.json() : DEFAULT_CONFIG))
      .catch(() => DEFAULT_CONFIG)
      .then(setConfig);
  }, []);

  if (isPending || !config) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-900 text-zinc-500">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  return (
    <>
      {!session ? (
        <AuthScreen config={config} />
      ) : session.user.mustChangePassword ? (
        <ForcePasswordChange user={session.user} />
      ) : (
        <Player key={session.user.id} session={session} config={config} />
      )}
      <DialogHost />
      <ValidationBubble />
    </>
  );
}

function Player({ session, config }) {
  useAudioPlayer(session.user.id);
  const [view, setView] = useState('search'); // search | playlists | admin | account
  const isAdmin = session.user.role === 'admin';

  useEffect(() => {
    usePlaylistStore.getState().load();
    return () => usePlaylistStore.getState().reset();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-surface-700 via-surface-900 to-surface-900 pb-36 md:pb-28">
      <nav className="mx-auto flex max-w-screen-2xl flex-wrap justify-end gap-2 px-4 pt-4 text-sm">
        <InstallButton />
        {[
          ['search', 'Buscar'],
          ['playlists', 'Playlists'],
          ...(isAdmin ? [['admin', 'Admin']] : []),
          ['account', session.user.name.split(' ')[0] || 'Conta'],
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
        <header className="mx-auto flex max-w-3xl flex-col items-center px-4 pt-8">
          <h1 className="mb-5 text-2xl font-bold tracking-tight">
            <span className="text-accent">♪</span> Sound
          </h1>
          <SearchBar />
        </header>
      )}

      <main className="mx-auto mt-10 max-w-screen-2xl px-4">
        <div hidden={view !== 'search'}>
          <SearchResults />
        </div>
        {view === 'playlists' && <PlaylistsView />}
        {view === 'admin' && isAdmin && <AdminView currentUserId={session.user.id} />}
        {view === 'account' && <AccountView session={session} config={config} />}
      </main>

      <PlayerBar />
      <ShareInbox />
    </div>
  );
}
