import { useEffect, useState } from 'react';
import { usePwaStore, selectCanInstall } from '../lib/pwa';
import { InstallIcon, ShareIcon } from './Icons';
import { appPath } from '../lib/base';

/** "Instalar app": só aparece quando o navegador permite instalar e o app ainda não está instalado. */
export default function InstallButton() {
  const canInstall = usePwaStore(selectCanInstall);
  const [iosHelp, setIosHelp] = useState(false);

  if (!canInstall) return null;

  const onClick = async () => {
    if ((await usePwaStore.getState().install()) === 'ios') setIosHelp(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        title="Instalar o Sound como aplicativo"
        className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 font-semibold text-black transition hover:bg-accent-dim sm:px-4"
      >
        <InstallIcon className="h-4 w-4" />
        <span className="hidden sm:inline">Instalar app</span>
        <span className="sm:hidden">Instalar</span>
      </button>
      {iosHelp && <IosHelp onClose={() => setIosHelp(false)} />}
    </>
  );
}

function IosHelp({ onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ios-install-title"
        className="w-full max-w-sm rounded-2xl border border-surface-600 bg-surface-800 p-6 text-sm text-zinc-300 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-3">
          <img src={appPath('icons/icon-192.png')} alt="" className="h-12 w-12 rounded-xl" />
          <h2 id="ios-install-title" className="text-lg font-semibold text-white">Instalar o Sound</h2>
        </div>
        <ol className="space-y-3">
          <li className="flex items-center gap-2">
            <span className="font-semibold text-accent">1.</span> Toque em <ShareIcon className="h-5 w-5 text-sky-400" />
            <strong className="text-white">Compartilhar</strong> no Safari.
          </li>
          <li>
            <span className="font-semibold text-accent">2.</span> Escolha <strong className="text-white">Adicionar à Tela de Início</strong>.
          </li>
          <li>
            <span className="font-semibold text-accent">3.</span> Toque em <strong className="text-white">Adicionar</strong>.
          </li>
        </ol>
        <button
          type="button"
          onClick={onClose}
          className="mt-6 w-full rounded-full bg-white py-2 font-semibold text-black transition hover:bg-zinc-200"
        >
          Entendi
        </button>
      </div>
    </div>
  );
}
