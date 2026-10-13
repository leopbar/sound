const express = require('express');
const musicService = require('../services/musicService');
const streamService = require('../services/streamService');
const lyricsService = require('../services/lyrics');
const translateService = require('../services/translate');
const { rateLimit } = require('../middleware/throttle');
const { requireAuth } = require('../middleware/requireAuth');
const { HttpError } = require('../lib/errors');

const router = express.Router();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// Daqui para baixo (busca e streaming), só usuários logados.
router.use(requireAuth);

function readQuery(req) {
  const q = String(req.query.q || '').trim();
  if (!q) throw new HttpError(400, 'MISSING_QUERY', 'Informe o parâmetro "q".');
  if (q.length > 200) throw new HttpError(400, 'QUERY_TOO_LONG', 'Consulta muito longa.');
  return q;
}

/** Busca e já prepara o stream das primeiras faixas, para o primeiro play ser imediato. */
function searchRoute(searchFn) {
  return wrap(async (req, res) => {
    const q = readQuery(req);
    const results = await searchFn(q);
    streamService.prefetch(results.filter((t) => t.source === 'youtube').slice(0, 4).map((t) => t.sourceId));
    res.set('Cache-Control', 'public, max-age=300').json({ query: q, count: results.length, results });
  });
}

// Gravações: MusicBrainz -> YouTube/Jamendo/Internet Archive.
router.get('/search', rateLimit({ windowMs: 60_000, max: 30 }), searchRoute(musicService.search));

// Vídeos na ordem do próprio YouTube (aba "YouTube").
router.get('/search/youtube', rateLimit({ windowMs: 60_000, max: 30 }), searchRoute(musicService.searchYouTube));

// Letra da faixa que está tocando (LRCLIB).
router.get('/lyrics', rateLimit({ windowMs: 60_000, max: 60 }), wrap(async (req, res) => {
  const str = (v, max) => String(v || '').trim().slice(0, max);
  const title = str(req.query.title, 300);
  const artist = str(req.query.artist, 200);
  if (!title || !artist) throw new HttpError(400, 'MISSING_TRACK', 'Informe "title" e "artist".');
  const duration = Number(req.query.duration);
  const lyrics = await lyricsService.getLyrics({
    title,
    artist,
    album: str(req.query.album, 300) || null,
    duration: Number.isFinite(duration) && duration > 0 && duration < 7200 ? duration : null,
    kind: req.query.kind === 'video' ? 'video' : null,
  });
  res.set('Cache-Control', 'private, max-age=3600').json(lyrics);
}));

// Tradução da letra (pt-BR). Recebe as linhas que o cliente já tem: { lines: string[] }.
router.post(
  '/lyrics/translation',
  rateLimit({ windowMs: 60_000, max: 20 }),
  express.json({ limit: '64kb' }),
  wrap(async (req, res) => {
    const lines = req.body?.lines;
    if (!Array.isArray(lines) || !lines.length || lines.length > 500 || !lines.every((l) => typeof l === 'string')) {
      throw new HttpError(400, 'INVALID_LINES', 'Envie "lines" (lista de até 500 linhas).');
    }
    const clean = lines.map((l) => l.slice(0, 500));
    if (clean.reduce((n, l) => n + l.length, 0) > 30_000) {
      throw new HttpError(400, 'LYRICS_TOO_LONG', 'Letra muito longa para traduzir.');
    }
    res.set('Cache-Control', 'no-store').json(await translateService.translateLines(clean));
  })
);

const streamLimit = rateLimit({ windowMs: 60_000, max: 240 }); // seeks geram várias requisições

// Rotas específicas antes da rota genérica do YouTube.
router.get('/stream/jamendo/:trackId', streamLimit, wrap((req, res) =>
  streamService.streamJamendo(req.params.trackId, req, res)
));

router.get('/stream/archive/:identifier/*', streamLimit, wrap((req, res) =>
  streamService.streamArchive(req.params.identifier, req.params[0], req, res)
));

router.get('/stream/:videoId', streamLimit, wrap((req, res) =>
  streamService.streamYouTube(req.params.videoId, req, res)
));

module.exports = router;
