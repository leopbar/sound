export function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** 2850226 -> "2,8 mi"; 79000000 -> "79 mi"; 46897 -> "46 mil" (como o YouTube em pt-BR). */
export function formatViews(n) {
  if (!n) return '0';
  const fmt = (v) => v.toLocaleString('pt-BR', { maximumFractionDigits: v < 10 ? 1 : 0 });
  if (n >= 1e9) return `${fmt(Math.floor(n / 1e8) / 10)} bi`;
  if (n >= 1e6) return `${fmt(Math.floor(n / 1e5) / 10)} mi`;
  if (n >= 1e3) return `${fmt(Math.floor(n / 1e2) / 10)} mil`;
  return String(n);
}

export const SOURCE_LABEL = {
  youtube: 'YouTube',
  jamendo: 'Jamendo',
  archive: 'Internet Archive',
};
