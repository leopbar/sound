const express = require('express');
const musicService = require('../services/musicService');
const streamService = require('../services/streamService');
const { rateLimit } = require('../middleware/throttle');
const { HttpError } = require('../lib/errors');

const router = express.Router();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

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
