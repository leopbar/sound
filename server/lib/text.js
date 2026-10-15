/** Normalização de texto para comparação aproximada (acentos, caixa, pontuação). */
function normalize(s = '') {
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function tokens(s) {
  return normalize(s).split(' ').filter(Boolean);
}

/** Fração dos tokens de `needle` presentes em `haystack` (0..1). */
function tokenCoverage(needle, haystack) {
  const n = tokens(needle);
  if (!n.length) return 0;
  const h = new Set(tokens(haystack));
  return n.filter((t) => h.has(t)).length / n.length;
}

/** "PT1H2M3S" -> 3723 */
function parseIsoDuration(iso = '') {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  const [, d = 0, h = 0, min = 0, s = 0] = m.map((v) => Number(v) || 0);
  return d * 86400 + h * 3600 + min * 60 + s;
}

/** "1:02:03" | "5:55" -> segundos */
function parseClock(text = '') {
  const parts = String(text).split(':').map(Number);
  if (!parts.length || parts.some(Number.isNaN)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

module.exports = { normalize, tokens, tokenCoverage, parseIsoDuration, parseClock };
