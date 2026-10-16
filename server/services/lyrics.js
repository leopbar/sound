/**
 * Letras via LRCLIB (https://lrclib.net): gratuita, sem chave, com letras sincronizadas (LRC).
 */
const axios = require('axios');
const config = require('../config');
const { pool } = require('../db');
const { remember } = require('../lib/cache');
const { normalize, tokenCoverage } = require('../lib/text');
const { HttpError } = require('../lib/errors');

const LYRICS_TTL = 60 * 60 * 24; // memória; letras encontradas também ficam no banco (lyrics_cache)

// O LRCLIB recusa pedidos ao acaso (429, "retry-after: 1"), mesmo com o servidor parado há
// tempos; repetir ~1,5 s depois quase sempre funciona.
const RETRY_DELAYS_MS = [1500, 3000, 5000];
const RETRY_BUDGET_MS = 15000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const http = axios.create({
  baseURL: 'https://lrclib.net/api',
  timeout: 8000,
  headers: { 'User-Agent': config.userAgent, Accept: 'application/json' },
});

/* ---------------- limpeza de título/canal (aba "YouTube") ---------------- */

// "(Official Video)", "[Lyric Video]", "(Remastered 2011)", "(Ao Vivo)", "| Clipe Oficial"...
const NOISE =
  /\s*[([【][^)\]】]*(official|oficial|video|vídeo|clipe|lyric|letra|audio|áudio|visualizer|hd|4k|remaster|ao vivo|live|mv)[^)\]】]*[)\]】]/gi;

function cleanTitle(title) {
  return String(title || '')
    .replace(NOISE, '')
    .replace(/\s*[|｜].*$/, '') // "Música | Clipe Oficial"
    .replace(/\s+(feat\.?|ft\.?|featuring)\s.*$/i, '')
    .replace(/["“”]/g, '')
    .trim();
}

function cleanChannel(channel) {
  return String(channel || '')
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .replace(/\s*(official|oficial)\s*(channel|canal)?$/i, '')
    .trim();
}

/** Vídeos do YouTube trazem "Artista - Música (Official Video)" no título e o canal como artista. */
function guessFromVideo(title, channel) {
  const clean = cleanTitle(title);
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(clean);
  if (m) return { artist: m[1].trim(), title: cleanTitle(m[2]) };
  return { artist: cleanChannel(channel), title: clean };
}

/* ------------------------------- LRC ------------------------------- */

/** "[01:02.34]texto" (uma linha pode ter vários tempos) -> [{ time, text }] ordenado. */
function parseLrc(lrc) {
  const lines = [];
  for (const raw of String(lrc || '').split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const s of stamps) {
      lines.push({ time: Number(s[1]) * 60 + Number(s[2].replace(':', '.')), text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

/* ----------------------------- busca ----------------------------- */

/** Pontua um resultado do LRCLIB contra o que está tocando (0 = descartar). */
function score(item, want) {
  const titleCov = tokenCoverage(want.title, item.trackName);
  const artistCov = tokenCoverage(want.artist, item.artistName);
  if (titleCov < 0.6 || artistCov < 0.5) return 0;
  let s = titleCov * 2 + artistCov;
  if (want.duration && item.duration) {
    const diff = Math.abs(item.duration - want.duration);
    if (diff > 15) return 0; // outra versão (ao vivo, remix, edit)
    s += 1 - diff / 15;
  }
  if (item.syncedLyrics) s += 0.5;
  return s;
}

function toResult(item) {
  if (!item) return { found: false };
  const synced = item.syncedLyrics ? parseLrc(item.syncedLyrics) : [];
  return {
    found: Boolean(item.instrumental || synced.length || item.plainLyrics),
    instrumental: Boolean(item.instrumental),
    synced: synced.length ? synced : null,
    plain: item.plainLyrics || null,
    track: item.trackName,
    artist: item.artistName,
    source: 'LRCLIB',
  };
}

/**
 * GET no LRCLIB repetindo em falha passageira (429, 5xx, sem resposta). Os status de
 * `definitive` são respostas de verdade ("não achei") e não são repetidos.
 */
async function lrclib(path, params, { definitive = [] } = {}) {
  const started = Date.now();
  for (let attempt = 0; ; attempt++) {
    try {
      const { data } = await http.get(path, { params });
      return data;
    } catch (err) {
      const status = err.response?.status;
      const transient = !definitive.includes(status) && (!status || status === 429 || status >= 500);
      const after = Number(err.response?.headers?.['retry-after']);
      const wait = Math.max(RETRY_DELAYS_MS[attempt] || 0, after > 0 && after <= 10 ? after * 1000 : 0);
      if (!transient || attempt >= RETRY_DELAYS_MS.length || Date.now() - started + wait > RETRY_BUDGET_MS) throw err;
      await sleep(wait);
    }
  }
}

/** { item } achado, { item: null } sem correspondência exata, ou { failed } se o LRCLIB falhou. */
async function exactMatch(want) {
  if (!want.duration) return { item: null };
  try {
    const data = await lrclib(
      '/get',
      {
        track_name: want.title,
        artist_name: want.artist,
        ...(want.album ? { album_name: want.album } : {}),
        duration: Math.round(want.duration),
      },
      // 404 = sem correspondência exata; o /get também responde 503 quando não acha.
      { definitive: [404, 503] }
    );
    return { item: data };
  } catch (err) {
    const status = err.response?.status;
    const answered = status === 503 || (status >= 400 && status < 500 && status !== 429);
    return answered ? { item: null } : { item: null, failed: err };
  }
}

function unavailable(want, err) {
  console.warn(`[lyrics] LRCLIB falhou para "${want.artist} - ${want.title}":`, err.message);
  return new HttpError(502, 'LYRICS_UNAVAILABLE', 'Serviço de letras indisponível no momento.');
}

async function fuzzyMatch(want) {
  let data;
  try {
    data = await lrclib('/search', { track_name: want.title, artist_name: want.artist });
  } catch (err) {
    throw unavailable(want, err);
  }
  let best = null;
  let bestScore = 0;
  for (const item of Array.isArray(data) ? data : []) {
    const s = score(item, want);
    if (s > bestScore) [best, bestScore] = [item, s];
  }
  return best;
}

async function lookup(want) {
  const exact = await exactMatch(want);
  if (exact.item) return toResult(exact.item);
  const best = await fuzzyMatch(want);
  // Sem resultado na busca aproximada, mas o /get falhou: pode existir. Não vira "não encontrada".
  if (!best && exact.failed) throw unavailable(want, exact.failed);
  return toResult(best);
}

/* -------------------- letras já encontradas (banco) -------------------- */

async function readStored(key) {
  try {
    const { rows } = await pool.query('SELECT data FROM lyrics_cache WHERE key = $1', [key]);
    return rows[0]?.data || null;
  } catch (err) {
    console.warn('[lyrics] leitura do banco falhou:', err.message);
    return null;
  }
}

async function store(key, result) {
  try {
    await pool.query(
      `INSERT INTO lyrics_cache (key, data) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, created_at = now()`,
      [key, result]
    );
  } catch (err) {
    console.warn('[lyrics] gravação no banco falhou:', err.message);
  }
}

/**
 * { title, artist, album?, duration?, kind? } -> { found, instrumental, synced, plain, ... }
 * `kind: 'video'` = faixa da aba "YouTube" (título/canal precisam de limpeza).
 */
async function getLyrics({ title, artist, album, duration, kind }) {
  const want =
    kind === 'video'
      ? { ...guessFromVideo(title, artist), album: null, duration }
      : { title: cleanTitle(title) || title, artist, album, duration };
  if (!want.title || !want.artist) return { found: false };

  const key = `lyrics:${normalize(want.artist)}:${normalize(want.title)}:${normalize(want.album || '')}:${Math.round(duration || 0)}`;
  return remember(key, LYRICS_TTL, async () => {
    const stored = await readStored(key);
    if (stored) return stored;
    const result = await lookup(want);
    // Só a letra encontrada fica para sempre; "não encontrada" fica 24h na memória (pode surgir depois).
    if (result.found) await store(key, result);
    return result;
  });
}

module.exports = { getLyrics, parseLrc, guessFromVideo };
