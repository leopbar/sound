import { useEffect, useRef, useState } from 'react';

const LONG_PRESS_MS = 350; // segurar a linha com o dedo por esse tempo inicia o arrasto
const TOUCH_SLOP = 10; // mexeu mais que isso antes do long-press = é rolagem, não arrasto
const MOUSE_SLOP = 5;
const EDGE = 72; // distância da borda da tela que liga a rolagem automática
const MAX_SPEED = 18; // px por quadro

const mid = (r) => r.top + r.h / 2;

/**
 * Reordenação de uma lista vertical por arrasto, com mouse ou toque.
 * - Mouse: clicar em qualquer ponto da linha e arrastar.
 * - Toque: segurar a linha (~350 ms) e arrastar, ou arrastar direto pela alça.
 * Durante o arrasto só aplica `transform`; a ordem real muda no fim, via onMove(from, to).
 * Perto das bordas da tela (e acima do PlayerBar) a página rola sozinha.
 */
export function useSortable({ count, onMove }) {
  const [drag, setDrag] = useState(null); // { from, over, dy, h }
  const [settling, setSettling] = useState(false);
  const els = useRef([]);
  const gesture = useRef(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  function cleanup() {
    const g = gesture.current;
    if (!g) return;
    clearTimeout(g.timer);
    cancelAnimationFrame(g.raf);
    g.listeners.forEach(([type, fn, opts]) => window.removeEventListener(type, fn, opts));
    gesture.current = null;
  }

  function listen(type, fn, opts) {
    window.addEventListener(type, fn, opts);
    gesture.current.listeners.push([type, fn, opts]);
  }

  function update(clientY) {
    const g = gesture.current;
    g.lastY = clientY;
    if (!g.active) return;
    const { rects, from } = g;
    const first = rects[0].top;
    const last = rects[rects.length - 1].top + rects[rects.length - 1].h;
    // Mantém o centro da linha arrastada dentro da lista.
    const raw = clientY + window.scrollY - g.startDoc;
    const dy = Math.min(Math.max(raw, first - mid(rects[from])), last - mid(rects[from]));
    const center = mid(rects[from]) + dy;
    let over = from;
    for (let i = from + 1; i < rects.length && center > mid(rects[i]); i++) over = i;
    for (let i = from - 1; i >= 0 && center < mid(rects[i]); i--) over = i;
    g.over = over;
    setDrag({ from, over, dy, h: rects[from].h });
  }

  function begin(clientY) {
    const g = gesture.current;
    const rects = els.current.slice(0, count).map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top + window.scrollY, h: r.height };
    });
    if (rects.length !== count || !rects[g.from]) return cleanup();
    const bar = document.querySelector('[data-player-bar]');
    Object.assign(g, {
      active: true,
      rects,
      over: g.from,
      startDoc: clientY + window.scrollY,
      bottom: () => (bar ? bar.getBoundingClientRect().top : window.innerHeight),
    });
    if (g.kind === 'touch') navigator.vibrate?.(15);
    update(clientY);

    const tick = () => {
      const s = gesture.current;
      if (!s?.active) return;
      const y = s.lastY;
      const bottom = s.bottom();
      let v = 0;
      if (y < EDGE) v = -Math.min(MAX_SPEED, Math.ceil((EDGE - y) / 3));
      else if (y > bottom - EDGE) v = Math.min(MAX_SPEED, Math.ceil((y - (bottom - EDGE)) / 3));
      if (v) {
        window.scrollBy(0, v);
        update(y);
      }
      s.raf = requestAnimationFrame(tick);
    };
    g.raf = requestAnimationFrame(tick);
  }

  function finish(commit) {
    const g = gesture.current;
    if (!g) return;
    const { active, from, over } = g;
    cleanup();
    if (!active) return;
    if (commit && over !== from) onMoveRef.current(from, over);
    // Sem transição no quadro em que a lista é reordenada (senão as linhas "voltam" animando).
    setSettling(true);
    setDrag(null);
    requestAnimationFrame(() => requestAnimationFrame(() => setSettling(false)));
  }

  function start(kind, from, x, y) {
    gesture.current = { kind, from, startX: x, startY: y, lastY: y, active: false, listeners: [] };
    listen('keydown', (e) => e.key === 'Escape' && finish(false));
  }

  function onPointerDown(e, i) {
    if (e.pointerType !== 'mouse' || e.button !== 0 || gesture.current) return;
    start('mouse', i, e.clientX, e.clientY);
    listen('pointermove', (ev) => {
      const g = gesture.current;
      if (!g.active && Math.hypot(ev.clientX - g.startX, ev.clientY - g.startY) > MOUSE_SLOP) begin(g.startY);
      update(ev.clientY);
    });
    listen('pointerup', () => {
      if (gesture.current.active) {
        // O clique que vem depois do arrasto não deve tocar a faixa.
        const block = (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        window.addEventListener('click', block, true);
        setTimeout(() => window.removeEventListener('click', block, true), 0);
      }
      finish(true);
    });
    listen('pointercancel', () => finish(false));
  }

  function onTouchStart(e, i, immediate) {
    if (gesture.current || e.touches.length !== 1) return;
    const t = e.touches[0];
    start('touch', i, t.clientX, t.clientY);
    const g = gesture.current;
    const touch = (ev) => [...ev.changedTouches].find((x) => x.identifier === t.identifier);
    listen(
      'touchmove',
      (ev) => {
        const p = touch(ev);
        if (!p || !gesture.current) return;
        if (gesture.current.active) {
          ev.preventDefault(); // impede a rolagem da página enquanto arrasta
          update(p.clientY);
        } else if (Math.hypot(p.clientX - g.startX, p.clientY - g.startY) > TOUCH_SLOP) {
          finish(false); // é rolagem
        } else {
          gesture.current.lastY = p.clientY;
        }
      },
      { passive: false },
    );
    listen(
      'touchend',
      (ev) => {
        if (!touch(ev)) return;
        if (gesture.current?.active) ev.preventDefault(); // evita o clique sintético
        finish(true);
      },
      { passive: false },
    );
    listen('touchcancel', () => finish(false));
    if (immediate) begin(t.clientY);
    else g.timer = setTimeout(() => gesture.current === g && begin(g.lastY), LONG_PRESS_MS);
  }

  // A lista mudou (faixa removida/adicionada) no meio do gesto: cancela.
  useEffect(() => () => finish(false), [count]); // eslint-disable-line react-hooks/exhaustive-deps

  function style(i) {
    if (!drag) return settling ? { transition: 'none' } : undefined;
    const { from, over, dy, h } = drag;
    if (i === from) return { transform: `translateY(${dy}px)`, transition: 'none', position: 'relative', zIndex: 10 };
    let shift = 0;
    if (from < over && i > from && i <= over) shift = -h;
    else if (over < from && i >= over && i < from) shift = h;
    return { transform: shift ? `translateY(${shift}px)` : undefined, transition: 'transform 150ms ease' };
  }

  return {
    drag,
    rowProps: (i) => ({
      ref: (el) => {
        els.current[i] = el;
      },
      style: style(i),
      onPointerDown: (e) => onPointerDown(e, i),
      onTouchStart: (e) => onTouchStart(e, i, false),
      onContextMenu: (e) => gesture.current && e.preventDefault(),
      onDragStart: (e) => e.preventDefault(), // sem arrasto nativo de imagem/link
    }),
    handleProps: (i) => ({
      onTouchStart: (e) => onTouchStart(e, i, true),
      style: { touchAction: 'none' },
    }),
  };
}
