import { create } from 'zustand';

/**
 * Diálogos do próprio app no lugar de window.alert/confirm/prompt (que o navegador desenha
 * fora do sistema). Renderizados pelo <DialogHost />; um por vez, em fila.
 */
export const useDialogStore = create((set, get) => ({
  queue: [],
  open(dialog) {
    return new Promise((resolve) => set({ queue: [...get().queue, { ...dialog, id: Math.random(), resolve }] }));
  },
  close(value) {
    const [first, ...rest] = get().queue;
    if (!first) return;
    set({ queue: rest });
    first.resolve(value);
  },
}));

/** Pergunta sim/não. Resolve true (confirmou) ou false. */
export const confirmDialog = ({ title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false }) =>
  useDialogStore.getState().open({ type: 'confirm', title, message, confirmLabel, cancelLabel, danger }).then(Boolean);

/** Pede um texto. Resolve a string digitada ou null (cancelou). */
export const promptDialog = ({ title, message, label, placeholder = '', confirmLabel = 'OK', cancelLabel = 'Cancelar', danger = false, maxLength = 200 }) =>
  useDialogStore.getState().open({ type: 'prompt', title, message, label, placeholder, confirmLabel, cancelLabel, danger, maxLength });
