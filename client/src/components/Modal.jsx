import { useEffect, useRef } from 'react';

/**
 * Janela modal do app. Com `onClose`, fecha pelo Esc e pelo fundo; sem ele é bloqueante
 * (só sai pelos botões de dentro). Acima do painel de letra e da PlayerBar.
 */
export default function Modal({ title, onClose, children, labelledBy = 'modal-title' }) {
  const box = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const prev = document.activeElement;
    const el = box.current;
    (el?.querySelector('[data-autofocus]') || el?.querySelector('button, input'))?.focus();
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation(); // não fecha o painel de letra que está por baixo
      closeRef.current?.();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-4 sm:items-center" onClick={onClose}>
      <div
        ref={box}
        role={onClose ? 'dialog' : 'alertdialog'}
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="w-full max-w-sm rounded-2xl border border-surface-600 bg-surface-800 p-6 text-sm text-zinc-300 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <h2 id={labelledBy} className="mb-3 text-lg font-semibold text-white">
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>
  );
}

const base = 'rounded-full px-4 py-2 text-sm font-semibold transition disabled:opacity-40';
export const btnPrimary = `${base} bg-white text-black hover:bg-zinc-200`;
export const btnDanger = `${base} bg-red-500 text-white hover:bg-red-400`;
export const btnSecondary = `${base} bg-surface-700 text-zinc-200 hover:bg-surface-600`;
