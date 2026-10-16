import { useEffect } from 'react';
import { useShareStore } from '../store/shareStore';
import Modal, { btnPrimary } from './Modal';

const btn = 'rounded-full px-5 py-2 text-sm font-semibold text-white transition disabled:opacity-40';
const btnAccept = `${btn} bg-green-600 hover:bg-green-500`;
const btnDecline = `${btn} bg-red-600 hover:bg-red-500`;

/**
 * Avisos de compartilhamento que ficam na tela até o usuário responder (sem Esc nem clique
 * fora): primeiro os convites recebidos (Quero ouvir/Agora não), depois as respostas aos enviados (OK).
 */
export default function ShareInbox() {
  const share = useShareStore((s) => s.incoming[0]);
  const outcome = useShareStore((s) => s.outcomes[0]);
  const busy = useShareStore((s) => s.busy);
  const { respond, acknowledge } = useShareStore.getState();

  useEffect(() => {
    useShareStore.getState().start();
    return () => useShareStore.getState().stop();
  }, []);

  if (share) {
    return (
      <Modal key={share.id} labelledBy="share-invite-title">
        <div className="text-center">
          <div aria-hidden="true" className="mb-3 text-3xl tracking-[0.3em]">
            🎸🥁🎤🎹🎺
          </div>
          <h2 id="share-invite-title" className="mb-2 text-lg font-semibold text-white">
            Bora ouvir junto?
          </h2>
          <p>
            O usuário <strong className="text-white">{share.senderName}</strong> quer compartilhar a lista dele com você.
          </p>
          <p className="mt-1 text-zinc-400">
            “{share.playlistName}” · {share.trackCount} {share.trackCount === 1 ? 'faixa' : 'faixas'}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button type="button" disabled={busy} onClick={() => respond(share, false)} className={btnDecline}>
              🙅 Agora não
            </button>
            <button type="button" data-autofocus disabled={busy} onClick={() => respond(share, true)} className={btnAccept}>
              🎶 Quero ouvir!
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  if (outcome) {
    const accepted = outcome.status === 'accepted';
    return (
      <Modal key={outcome.id} labelledBy="share-outcome-title">
        <div className="text-center">
          <div aria-hidden="true" className="mb-2 text-5xl">
            {accepted ? '🤩' : '🤷'}
          </div>
          <h2 id="share-outcome-title" className="mb-1 text-base font-normal">
            {accepted ? 'Oba, ' : ''}
            <strong className="text-white">{outcome.recipientName}</strong> {accepted ? 'aceitou sua Lista!' : 'recusou sua Lista.'}
          </h2>
          <p className="mb-5 text-zinc-400">“{outcome.playlistName}”</p>
          <button type="button" data-autofocus onClick={() => acknowledge(outcome)} className={btnPrimary}>
            OK
          </button>
        </div>
      </Modal>
    );
  }

  return null;
}
