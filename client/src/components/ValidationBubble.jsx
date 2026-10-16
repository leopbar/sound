import { useEffect, useState } from 'react';

/**
 * Troca o balão nativo de validação do navegador ("Preencha este campo", e-mail inválido…)
 * por um balão do app. Vale para todos os formulários: o evento `invalid` é capturado no
 * documento e cancelado; a mensagem (já traduzida pelo navegador) aparece sob o campo.
 */
export default function ValidationBubble() {
  const [bubble, setBubble] = useState(null);

  useEffect(() => {
    let pending = false;
    const onInvalid = (e) => {
      e.preventDefault(); // sem o balão do navegador
      if (pending) return; // um submit dispara `invalid` em cada campo: mostra só o primeiro
      pending = true;
      setTimeout(() => (pending = false)); // microtask não serve: roda entre um `invalid` e outro
      const el = e.target;
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setBubble({ el, text: el.validationMessage, id: Date.now() });
    };
    document.addEventListener('invalid', onInvalid, true);
    return () => document.removeEventListener('invalid', onInvalid, true);
  }, []);

  useEffect(() => {
    if (!bubble) return;
    const hide = () => setBubble(null);
    const t = setTimeout(hide, 5000);
    bubble.el.addEventListener('input', hide);
    bubble.el.addEventListener('blur', hide);
    return () => {
      clearTimeout(t);
      bubble.el.removeEventListener('input', hide);
      bubble.el.removeEventListener('blur', hide);
    };
  }, [bubble]);

  // Acompanha o campo enquanto a página rola até ele.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!bubble) return;
    let raf;
    const loop = () => {
      setTick((n) => n + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const stop = setTimeout(() => cancelAnimationFrame(raf), 800);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(stop);
    };
  }, [bubble]);

  if (!bubble || !bubble.el.isConnected) return null;
  const r = bubble.el.getBoundingClientRect();
  return (
    <div
      role="alert"
      style={{ top: r.bottom + 8, left: Math.max(8, Math.min(r.left, window.innerWidth - 288)) }}
      className="pointer-events-none fixed z-[70] max-w-[280px] rounded-lg bg-amber-300 px-3 py-2 text-sm font-medium text-black shadow-xl"
    >
      <span className="absolute -top-1.5 left-4 h-3 w-3 rotate-45 bg-amber-300" />
      <span className="relative">{bubble.text}</span>
    </div>
  );
}
