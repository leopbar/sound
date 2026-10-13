/**
 * Letras via LRCLIB (https://lrclib.net): gratuita, sem chave, com letras sincronizadas (LRC).
 */
const axios = require('axios');
const config = require('../config');
const { remember } = require('../lib/cache');
const { normalize, tokenCoverage } = require('../lib/text');
const { HttpError } = require('../lib/errors');

const LYRICS_TTL = 60 * 60 * 24; // letras não mudam; "não encontrada" também fica 24h

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

async function exactMatch(want) {
  if (!want.duration) return null;
  try {
    const { data } = await http.get('/get', {
      params: {
        track_name: want.title,
        artist_name: want.artist,
        ...(want.album ? { album_name: want.album } : {}),
        duration: Math.round(want.duration),
      },
    });
    return data;
  } catch {
    // 404 = sem correspondência exata; o /get também responde 503 em vários casos
    // de "não achei". Em qualquer erro, a busca aproximada decide.
    return null;
  }
}

async function fuzzyMatch(want) {
  let data;
  try {
    ({ data } = await http.get('/search', { params: { track_name: want.title, artist_name: want.artist } }));
  } catch (err) {
    console.warn(`[lyrics] LRCLIB falhou para "${want.artist} - ${want.title}":`, err.message);
    throw new HttpError(502, 'LYRICS_UNAVAILABLE', 'Serviço de letras indisponível no momento.');
  }
  let best = null;
  let bestScore = 0;
  for (const item of Array.isArray(data) ? data : []) {
    const s = score(item, want);
    if (s > bestScore) [best, bestScore] = [item, s];
  }
  return best;
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
    const item = (await exactMatch(want)) || (await fuzzyMatch(want));
    return toResult(item);
  });
}

module.exports = { getLyrics, parseLrc, guessFromVideo };
