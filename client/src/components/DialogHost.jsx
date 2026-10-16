import { useState } from 'react';
import { useDialogStore } from '../lib/dialog';
import Modal, { btnPrimary, btnDanger, btnSecondary } from './Modal';

/** Mostra o primeiro diálogo da fila (confirmDialog/promptDialog). */
export default function DialogHost() {
  const dialog = useDialogStore((s) => s.queue[0]);
  if (!dialog) return null;
  return <Dialog key={dialog.id} dialog={dialog} />;
}

function Dialog({ dialog }) {
  const close = useDialogStore((s) => s.close);
  const [text, setText] = useState('');
  const isPrompt = dialog.type === 'prompt';
  const cancel = () => close(isPrompt ? null : false);

  return (
    <Modal title={dialog.title} onClose={cancel} labelledBy="app-dialog-title">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          close(isPrompt ? text.trim() : true);
        }}
      >
        {dialog.message && <p className="mb-4 whitespace-pre-line">{dialog.message}</p>}
        {isPrompt && (
          <label className="mb-4 block">
            {dialog.label && <span className="mb-1 block text-xs text-zinc-400">{dialog.label}</span>}
            <input
              data-autofocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={dialog.placeholder}
              maxLength={dialog.maxLength}
              className="w-full rounded-lg bg-surface-700 px-3 py-2 text-white outline-none focus:ring-1 focus:ring-accent"
            />
          </label>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={cancel} className={btnSecondary}>
            {dialog.cancelLabel}
          </button>
          <button type="submit" data-autofocus={isPrompt || dialog.danger ? undefined : true} className={dialog.danger ? btnDanger : btnPrimary}>
            {dialog.confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
