const axios = require('axios');
const config = require('../config');
const { remember, TTL } = require('../lib/cache');
const { createThrottle } = require('../middleware/throttle');
const { normalize, luceneEscape, tokenCoverage } = require('../lib/text');

const http = axios.create({
  baseURL: 'https://musicbrainz.org/ws/2',
  timeout: 10_000,
  headers: { 'User-Agent': config.userAgent, Accept: 'application/json' },
});

// MusicBrainz: no máximo 1 requisição por segundo (por IP). Margem de segurança de 100ms.
const mbThrottle = createThrottle(1100);

/**
 * "Bohemian Rhapsody - Queen" é ambíguo (título-artista ou artista-título),
 * então pesquisamos as duas ordens. Sem separador, usamos busca livre.
 */
function splitQuery(raw) {
  const parts = raw.trim().split(/\s+[-–—]\s+/);
  return parts.length === 2 && parts[0] && parts[1] ? parts : null;
}

function buildQuery(raw) {
  const q = raw.trim();
  const parts = splitQuery(q);
  if (parts) {
    const [a, b] = parts.map((p) => `"${luceneEscape(p)}"`);
    return `(recording:${a} AND artist:${b}) OR (recording:${b} AND artist:${a})`;
  }
  const by = /^(.+?)\s+by\s+(.+)$/i.exec(q);
  if (by) return `recording:"${luceneEscape(by[1])}" AND artist:"${luceneEscape(by[2])}"`;
  return luceneEscape(q);
}

function artistName(credit = []) {
  return credit.map((c) => (c.name || c.artist?.name || '') + (c.joinphrase || '')).join('').trim();
}

/** Prefere o lançamento oficial de álbum de estúdio para a capa. */
function pickRelease(releases = []) {
  const score = (r) => {
    const rg = r['release-group'] || {};
    let s = 0;
    if (r.status === 'Official') s += 4;
    if (rg['primary-type'] === 'Album') s += 3;
    if (!(rg['secondary-types'] || []).length) s += 2; // não é compilação/ao vivo
    if (r.date) s += 1;
    return s;
  };
  return [...releases].sort((a, b) => score(b) - score(a) || (a.date || '9999').localeCompare(b.date || '9999'))[0];
}

function toTrack(rec) {
  const release = pickRelease(rec.releases);
  const rgId = release?.['release-group']?.id;
  return {
    mbid: rec.id,
    title: rec.title,
    version: rec.disambiguation || null,
    artist: artistName(rec['artist-credit']),
    album: release?.title || null,
    releaseId: release?.id || null,
    releaseGroupId: rgId || null,
    coverArt: rgId ? `https://coverartarchive.org/release-group/${rgId}/front-250` : null,
    duration: rec.length ? Math.round(rec.length / 1000) : null,
    isrc: rec.isrcs?.[0] || null,
    score: rec.score ?? 0,
    releaseCount: rec.releases?.length || 0,
  };
}

// Versões alternativas: só sobem no ranking se o usuário pedir explicitamente.
const ALT_VERSION = /\b(live|ao vivo|karaoke|instrumental|demo|remix|mix|cast|acoustic|acustico|edit|version|session|rehearsal|broadcast|excerpt)\b/;

const STUDIO_FILTER =
  'AND status:official AND primarytype:album AND NOT secondarytype:live AND NOT secondarytype:compilation';

function isStudioAlbum(release) {
  const rg = release?.['release-group'] || {};
  return release?.status === 'Official' && rg['primary-type'] === 'Album' && !(rg['secondary-types'] || []).length;
}

const PAREN = /[([][^)\]]*[)\]]/g;
const baseTitle = (title) => normalize(title.replace(PAREN, ''));
const songKey = (t) => `${baseTitle(t.title)}|${normalize(t.artist)}`;
const stripThe = (s) => normalize(s).replace(/^the /, '');
const sameArtist = (a, b) => stripThe(a) === stripThe(b);

/** Score local: relevância MusicBrainz + sinais de "gravação canônica". */
function rank(track, rec, wanted) {
  const version = normalize(`${track.version || ''} ${track.title}`);
  let s = track.score;
  if (ALT_VERSION.test(version) && !ALT_VERSION.test(wanted)) s -= 30;
  if ((rec.releases || []).some(isStudioAlbum)) s += 15;
  if (track.isrc) s += 5;
  if (!track.duration) s -= 10;
  s += Math.min(10, Math.log2(1 + track.releaseCount) * 2);
  return s;
}

/**
 * Erros transitórios, que valem nova tentativa com backoff:
 *  - 503: resposta de rate-limit da MusicBrainz;
 *  - falhas de rede sem resposta HTTP (ETIMEDOUT, ECONNRESET, EAI_AGAIN...).
 */
function isTransient(err) {
  return err.response ? err.response.status === 503 : Boolean(err.isAxiosError);
}

async function mbSearch(query, attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      const { data } = await mbThrottle(() => http.get('/recording', { params: { query, fmt: 'json', limit: 50 } }));
      return data.recordings || [];
    } catch (err) {
      if (!isTransient(err) || i >= attempts) throw err;
      console.warn(`[musicbrainz] tentativa ${i}/${attempts} falhou (${err.code || err.response?.status}); repetindo.`);
      await new Promise((r) => setTimeout(r, 1200 * i)); // o throttle já espaça as chamadas
    }
  }
}

/**
 * Busca gravações (recordings) na MusicBrainz. O endpoint /recording já garante
 * que só gravações são retornadas; ainda filtramos vídeos e itens sem artista.
 *
 * Para títulos populares a MusicBrainz devolve dezenas de gravações com score 100
 * (shows ao vivo, coletâneas...), e a versão de estúdio pode nem aparecer. Por isso
 * fazemos duas consultas — uma restrita a álbuns de estúdio oficiais e uma geral —
 * e reordenamos localmente. Gravações equivalentes (mesmo título/artista/versão) são
 * deduplicadas mantendo a melhor ranqueada.
 *
 * `onEarly(tracks)` é chamado assim que a consulta de estúdio chega (só sem cache),
 * com um ranking preliminar — permite adiantar a busca no YouTube enquanto a
 * consulta geral ainda espera sua vez no throttle de 1 req/s.
 */
async function searchRecordings(query, limit = 12, { onEarly } = {}) {
  const key = `mb:recording:${normalize(query)}`;
  const recordings = await remember(key, TTL.METADATA, async () => {
    const base = buildQuery(query);
    const studioP = mbSearch(`(${base}) ${STUDIO_FILTER}`).catch(() => []);
    if (onEarly) {
      studioP.then((studio) => studio.length && onEarly(rankRecordings(studio, query, limit))).catch(() => {});
    }
    const [studio, general] = await Promise.all([studioP, mbSearch(base)]);
    return [...studio, ...general];
  });
  return rankRecordings(recordings, query, limit);
}

/** Filtra, deduplica e ordena as gravações cruas da MusicBrainz. */
function rankRecordings(recordings, query, limit) {
  const wanted = normalize(query);
  const groups = new Map();
  // Melhor lançamento de estúdio por música (título+artista), para herdar a capa.
  const studioArt = new Map();

  for (const rec of recordings) {
    if (rec.video || !rec['artist-credit']?.length) continue;
    // Trechos de DJ-mix ("part of “X” DJ-mix") não existem isolados no YouTube.
    if (/^part of\b/i.test(rec.disambiguation || '')) continue;
    const t = toTrack(rec);
    // A busca Lucene é permissiva ("Queen" casa com "White Queen"): exige que a maior
    // parte dos termos digitados apareça no título/artista/versão.
    if (tokenCoverage(wanted, `${t.title} ${t.artist} ${t.version || ''}`) < 0.6) continue;

    t.rank = rank(t, rec, wanted);
    // "Hotel California (5.1 mix)" e "Hotel California" são a mesma música.
    const variant = normalize(`${t.version || ''} ${(t.title.match(PAREN) || []).join(' ')}`);
    const song = songKey(t);
    const alt = ALT_VERSION.test(variant);
    const k = `${song}|${alt ? variant : ''}`;
    const prev = groups.get(k);
    if (!prev || t.rank > prev.rank) groups.set(k, t);

    const studio = (rec.releases || []).filter(isStudioAlbum).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'))[0];
    if (studio && !/\blive\b/.test(variant)) {
      const prevArt = studioArt.get(song);
      if (!prevArt || (studio.date || '9999') < (prevArt.date || '9999')) studioArt.set(song, studio);
    }
  }

  // "A - B" pode ser título-artista ou artista-título (e existem bandas chamadas
  // "Bohemian Rhapsody"). A interpretação com mais lançamentos somados vence.
  const parts = splitQuery(query);
  if (parts) {
    const [a, b] = parts;
    // Artista precisa casar exatamente: "The Illegal Eagles" não é "Eagles".
    const interp = (t) =>
      tokenCoverage(a, t.title) >= 0.8 && sameArtist(b, t.artist) ? 'ta'
        : tokenCoverage(b, t.title) >= 0.8 && sameArtist(a, t.artist) ? 'at'
          : null;
    const weight = { ta: 0, at: 0 };
    for (const t of groups.values()) {
      t.interp = interp(t);
      if (t.interp) weight[t.interp] += t.releaseCount;
    }
    const winner = weight.ta >= weight.at ? 'ta' : 'at';
    if (weight[winner] > 0) {
      for (const [k, t] of groups) {
        if (t.interp === winner) t.rank += 40;
        else if (t.interp) groups.delete(k); // interpretação perdedora (ex.: banda tributo)
      }
    }
  }

  return [...groups.values()]
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
    .map((t) => {
      // Gravações sem versão especial exibem o álbum de estúdio original da música
      // (ex.: "A Night at the Opera"), mesmo que a gravação escolhida seja de uma coletânea.
      const art = !t.version && studioArt.get(songKey(t));
      if (!art) return t;
      const rgId = art['release-group']?.id;
      return {
        ...t,
        album: art.title,
        releaseId: art.id,
        releaseGroupId: rgId,
        coverArt: rgId ? `https://coverartarchive.org/release-group/${rgId}/front-250` : t.coverArt,
      };
    });
}

module.exports = { searchRecordings };
