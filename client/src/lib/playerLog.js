import { API_BASE } from './base';

/**
 * Diário do player: pausas (e quem pausou), erros, quedas de rede e retomadas. Fica guardado no
 * aparelho e é enviado ao servidor quando há rede; lá aparece no log como `[client] ...`.
 * Serve para diagnosticar o que aconteceu no celular (ex.: "a música parou com a tela bloqueada").
 */
const KEY = 'sound:playerLog';
const MAX = 200;
const BATCH = 100;

let events = read();
let timer = null;
let sending = false;

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify(events));
  } catch {
    /* sem armazenamento: fica só na memória */
  }
}

function schedule(delay) {
  if (!timer) timer = setTimeout(flush, delay);
}

/** Registra um evento (`data`: só números e textos curtos). */
export function logEvent(type, data = {}) {
  const fields = Object.fromEntries(Object.entries(data).filter(([, v]) => ['string', 'number'].includes(typeof v)));
  events.push({
    at: Date.now(),
    type,
    ...fields,
    vis: document.visibilityState === 'visible' ? 1 : 0,
    net: navigator.onLine === false ? 0 : 1,
  });
  if (events.length > MAX) events = events.slice(-MAX);
  write();
  schedule(10_000);
}

export async function flush() {
  clearTimeout(timer);
  timer = null;
  if (sending || !events.length || navigator.onLine === false) return;
  sending = true;
  const batch = events.slice(0, BATCH);
  try {
    const res = await fetch(`${API_BASE}/api/client-log`, {
      method: 'POST',
      credentials: 'include',
      keepalive: true, // continua mesmo se a página for fechada
      signal: AbortSignal.timeout(20_000), // rede pendurada não segura os próximos envios
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }),
    });
    // 400: lote inválido, não adianta reenviar.
    if (res.ok || res.status === 400) {
      events = events.slice(batch.length);
      write();
    }
  } catch {
    /* sem rede: tenta depois */
  } finally {
    sending = false;
  }
  if (events.length) schedule(60_000);
}

/** Apaga o diário do aparelho (ao sair da conta). */
export function clearPlayerLog() {
  events = [];
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nada a fazer */
  }
}

window.addEventListener('online', () => {
  logEvent('online');
  flush();
});
window.addEventListener('offline', () => logEvent('offline'));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush();
});
window.addEventListener('pagehide', flush);
