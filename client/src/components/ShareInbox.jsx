import { useEffect } from 'react';
import { useShareStore } from '../store/shareStore';
import Modal, { btnPrimary, btnSecondary } from './Modal';

/**
 * Avisos de compartilhamento que ficam na tela até o usuário responder (sem Esc nem clique
 * fora): primeiro os convites recebidos (Aceitar/Recusar), depois as respostas aos enviados (OK).
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
      <Modal key={share.id} title="Lista compartilhada" labelledBy="share-invite-title">
        <p className="mb-1">
          O usuário <strong className="text-white">{share.senderName}</strong> quer compartilhar a lista dele com você.
        </p>
        <p className="mb-5 text-zinc-400">
          “{share.playlistName}” · {share.trackCount} {share.trackCount === 1 ? 'faixa' : 'faixas'}
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={() => respond(share, false)} className={btnSecondary}>
            Recusar
          </button>
          <button type="button" data-autofocus disabled={busy} onClick={() => respond(share, true)} className={btnPrimary}>
            Aceitar
          </button>
        </div>
      </Modal>
    );
  }

  if (outcome) {
    const accepted = outcome.status === 'accepted';
    return (
      <Modal key={outcome.id} title={accepted ? 'Lista aceita' : 'Lista recusada'} labelledBy="share-outcome-title">
        <p className="mb-1">
          {accepted ? 'Oba, ' : ''}
          <strong className="text-white">{outcome.recipientName}</strong> {accepted ? 'aceitou' : 'recusou'} sua Lista.
        </p>
        <p className="mb-5 text-zinc-400">“{outcome.playlistName}”</p>
        <div className="flex justify-end">
          <button type="button" data-autofocus onClick={() => acknowledge(outcome)} className={btnPrimary}>
            OK
          </button>
        </div>
      </Modal>
    );
  }

  return null;
}
