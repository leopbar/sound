/**
 * Fontes alternativas de áudio:
 *  - Jamendo (música Creative Commons) — requer JAMENDO_CLIENT_ID.
 *  - Internet Archive (gravações ao vivo / históricas, ex.: Live Music Archive).
 */
const axios = require('axios');
const config = require('../config');
const { remember, TTL } = require('../lib/cache');
const { normalize, tokenCoverage } = require('../lib/text');

const AUDIO_EXT = /\.(mp3|ogg|m4a|flac)$/i;

/* ----------------------------- Jamendo ----------------------------- */

function jamendoToTrack(t) {
  return {
    id: `jamendo:${t.id}`,
    sourceId: String(t.id),
    title: t.name,
    artist: t.artist_name,
    album: t.album_name || null,
    thumbnail: t.album_image || t.image || null,
    duration: t.duration || null,
    source: 'jamendo',
    streamUrl: `/api/stream/jamendo/${t.id}`,
  };
}

async function jamendoSearch(text, limit = 10) {
  if (!config.jamendoClientId) return [];
  return remember(`jamendo:search:${normalize(text)}:${limit}`, TTL.METADATA, async () => {
    const { data } = await axios.get('https://api.jamendo.com/v3.0/tracks/', {
      timeout: 8000,
      params: { client_id: config.jamendoClientId, format: 'json', limit, search: text, audioformat: 'mp32' },
    });
    return (data.results || []).map(jamendoToTrack);
  });
}

async function jamendoAudioUrl(trackId) {
  if (!config.jamendoClientId) return null;
  return remember(`jamendo:audio:${trackId}`, TTL.STREAM_INFO, async () => {
    const { data } = await axios.get('https://api.jamendo.com/v3.0/tracks/', {
      timeout: 8000,
      params: { client_id: config.jamendoClientId, format: 'json', id: trackId, audioformat: 'mp32' },
    });
    return data.results?.[0]?.audio || null;
  });
}

/* ------------------------- Internet Archive ------------------------- */

function archiveStreamUrl(identifier, file) {
  return `/api/stream/archive/${encodeURIComponent(identifier)}/${file.split('/').map(encodeURIComponent).join('/')}`;
}

function luceneTerm(s) {
  return `"${String(s).replace(/["\\]/g, '')}"`;
}

async function archiveSearch(text, { title, artist } = {}, limit = 5) {
  const q = title && artist
    ? `title:(${luceneTerm(title)}) AND creator:(${luceneTerm(artist)}) AND mediatype:(audio OR etree)`
    : `(${text.replace(/[():"\\]/g, ' ')}) AND mediatype:(audio OR etree)`;
  return remember(`ia:search:${normalize(q)}:${limit}`, TTL.METADATA, async () => {
    const { data } = await axios.get('https://archive.org/advancedsearch.php', {
      timeout: 10_000,
      params: { q, 'fl[]': ['identifier', 'title', 'creator'], rows: limit, output: 'json', 'sort[]': 'downloads desc' },
    });
    return data.response?.docs || [];
  });
}

async function archiveFiles(identifier) {
  return remember(`ia:meta:${identifier}`, TTL.METADATA, async () => {
    const { data } = await axios.get(`https://archive.org/metadata/${encodeURIComponent(identifier)}`, { timeout: 10_000 });
    return (data.files || []).filter((f) => AUDIO_EXT.test(f.name));
  });
}

/** Escolhe o arquivo de áudio do item cujo título mais se aproxima do desejado (MP3 preferido). */
function pickArchiveFile(files, title) {
  const mp3 = files.filter((f) => /\.mp3$/i.test(f.name));
  const pool = mp3.length ? mp3 : files;
  if (!title) return pool[0];
  return [...pool].sort(
    (a, b) => tokenCoverage(title, b.title || b.name) - tokenCoverage(title, a.title || a.name)
  )[0];
}

/** Converte "3:45" | "225.3" em segundos. */
function archiveLength(len) {
  if (!len) return null;
  if (String(len).includes(':')) return String(len).split(':').reduce((a, p) => a * 60 + Number(p), 0) || null;
  return Math.round(Number(len)) || null;
}

async function archiveToTracks(docs, wantedTitle) {
  const out = [];
  for (const doc of docs) {
    try {
      const files = await archiveFiles(doc.identifier);
      const f = pickArchiveFile(files, wantedTitle);
      if (!f) continue;
      out.push({
        id: `archive:${doc.identifier}/${f.name}`,
        sourceId: `${doc.identifier}/${f.name}`,
        title: f.title || wantedTitle || doc.title,
        artist: [].concat(f.creator || doc.creator || 'Unknown').join(', '),
        album: [].concat(doc.title || [])[0] || null,
        thumbnail: `https://archive.org/services/img/${encodeURIComponent(doc.identifier)}`,
        duration: archiveLength(f.length),
        source: 'archive',
        streamUrl: archiveStreamUrl(doc.identifier, f.name),
      });
    } catch {
      /* item inacessível: ignora */
    }
  }
  return out;
}

/* ---------------------------- API pública ---------------------------- */

/** Procura a mesma gravação no Jamendo e, depois, no Internet Archive. */
async function findFallbackForTrack(track) {
  const label = `${track.artist} ${track.title}`;

  const jam = await jamendoSearch(label, 5).catch(() => []);
  const jamHit = jam.find(
    (t) => tokenCoverage(track.artist, t.artist) >= 0.8 && tokenCoverage(track.title, t.title) >= 0.8
  );
  if (jamHit) return jamHit;

  const docs = await archiveSearch(label, track, 3).catch(() => []);
  const [ia] = await archiveToTracks(docs.slice(0, 2), track.title);
  if (ia && tokenCoverage(track.title, ia.title) >= 0.6) return ia;
  return null;
}

/** Busca livre quando a MusicBrainz não retorna nada. */
async function freeSearch(text, limit = 10) {
  const [jam, docs] = await Promise.all([
    jamendoSearch(text, limit).catch(() => []),
    archiveSearch(text, {}, 4).catch(() => []),
  ]);
  const ia = await archiveToTracks(docs, null);
  return [...jam, ...ia].slice(0, limit);
}

module.exports = { findFallbackForTrack, freeSearch, jamendoAudioUrl };
