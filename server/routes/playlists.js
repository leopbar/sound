const express = require('express');
const { pool, transaction } = require('../db');
const { HttpError } = require('../lib/errors');

/**
 * Playlists do usuário logado. Toda query filtra por user_id = req.user.id: uma
 * playlist de outro usuário é indistinguível de uma inexistente (404).
 */
const router = express.Router();
router.use(express.json({ limit: '1mb' }));

const MAX_PLAYLISTS = 200;
const MAX_TRACKS = 1000;

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const notFound = () => new HttpError(404, 'PLAYLIST_NOT_FOUND', 'Playlist não encontrada.');

function cleanName(value) {
  const name = String(value ?? '').trim().slice(0, 60);
  if (!name) throw new HttpError(400, 'INVALID_NAME', 'Informe um nome para a playlist.');
  return name;
}

const str = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : null);
const num = (v) => (Number.isFinite(v) && v >= 0 ? v : null);
const httpUrl = (v) => (typeof v === 'string' && /^https?:\/\//i.test(v) ? v.slice(0, 1000) : null);

/**
 * A faixa vem do cliente: guardamos só os campos conhecidos, e a URL de stream
 * precisa apontar para o nosso próprio proxy.
 */
function cleanTrack(t) {
  if (!t || typeof t !== 'object' || typeof t.id !== 'string' || !t.id || t.id.length > 300) {
    throw new HttpError(400, 'INVALID_TRACK', 'Faixa inválida.');
  }
  if (typeof t.streamUrl !== 'string' || !t.streamUrl.startsWith('/api/stream/') || t.streamUrl.length > 1000) {
    throw new HttpError(400, 'INVALID_TRACK', 'Faixa inválida.');
  }
  return {
    id: t.id,
    kind: str(t.kind, 20),
    title: str(t.title) || 'Sem título',
    version: str(t.version),
    artist: str(t.artist),
    album: str(t.album),
    isrc: str(t.isrc, 20),
    mbid: str(t.mbid, 40),
    thumbnail: httpUrl(t.thumbnail),
    fallbackThumbnail: httpUrl(t.fallbackThumbnail),
    duration: num(t.duration),
    views: num(t.views),
    source: str(t.source, 20),
    sourceId: str(t.sourceId),
    streamUrl: t.streamUrl,
  };
}

const toJson = (row) => ({ id: row.id, name: row.name, tracks: row.tracks, createdAt: row.created_at, updatedAt: row.updated_at });

/** Lê a playlist com lock, aplica fn(tracks) e grava o resultado. */
function mutateTracks(userId, id, fn) {
  return transaction(async (db) => {
    const { rows } = await db.query('SELECT tracks FROM playlist WHERE id = $1 AND user_id = $2 FOR UPDATE', [id, userId]);
    if (!rows.length) throw notFound();
    const tracks = fn(rows[0].tracks);
    const res = await db.query(
      'UPDATE playlist SET tracks = $3, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, userId, JSON.stringify(tracks)],
    );
    return toJson(res.rows[0]);
  });
}

async function insertPlaylist(db, userId, name, tracks) {
  const { rows } = await db.query(
    `INSERT INTO playlist (user_id, name, tracks)
     SELECT $1, $2, $3 WHERE (SELECT count(*) FROM playlist WHERE user_id = $1) < $4
     RETURNING *`,
    [userId, name, JSON.stringify(tracks), MAX_PLAYLISTS],
  );
  if (!rows.length) throw new HttpError(409, 'PLAYLIST_LIMIT', `Limite de ${MAX_PLAYLISTS} playlists atingido.`);
  return toJson(rows[0]);
}

router.get('/', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM playlist WHERE user_id = $1 ORDER BY created_at, id', [req.user.id]);
  res.set('Cache-Control', 'private, no-store').json({ playlists: rows.map(toJson) });
}));

router.post('/', wrap(async (req, res) => {
  const name = cleanName(req.body?.name);
  const tracks = req.body?.track ? [cleanTrack(req.body.track)] : [];
  res.status(201).json(await insertPlaylist(pool, req.user.id, name, tracks));
}));

/** Importa as playlists que estavam só no navegador (versão sem login). */
router.post('/import', wrap(async (req, res) => {
  const input = Array.isArray(req.body?.playlists) ? req.body.playlists.slice(0, MAX_PLAYLISTS) : [];
  const created = await transaction(async (db) => {
    const out = [];
    for (const p of input) {
      const seen = new Set();
      const tracks = (Array.isArray(p?.tracks) ? p.tracks : [])
        .flatMap((t) => {
          try {
            return [cleanTrack(t)];
          } catch {
            return [];
          }
        })
        .filter((t) => !seen.has(t.id) && seen.add(t.id))
        .slice(0, MAX_TRACKS);
      out.push(await insertPlaylist(db, req.user.id, String(p?.name ?? '').trim().slice(0, 60) || 'Playlist importada', tracks));
    }
    return out;
  });
  res.status(201).json({ playlists: created });
}));

router.patch('/:id', wrap(async (req, res) => {
  const { rows } = await pool.query(
    'UPDATE playlist SET name = $3, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING *',
    [req.params.id, req.user.id, cleanName(req.body?.name)],
  );
  if (!rows.length) throw notFound();
  res.json(toJson(rows[0]));
}));

router.delete('/:id', wrap(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM playlist WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  if (!rowCount) throw notFound();
  res.status(204).end();
}));

router.post('/:id/tracks', wrap(async (req, res) => {
  const track = cleanTrack(req.body?.track);
  res.json(await mutateTracks(req.user.id, req.params.id, (tracks) => {
    if (tracks.some((t) => t.id === track.id)) return tracks;
    if (tracks.length >= MAX_TRACKS) throw new HttpError(409, 'TRACK_LIMIT', `Limite de ${MAX_TRACKS} faixas por playlist.`);
    return [...tracks, track];
  }));
}));

router.delete('/:id/tracks/:trackId', wrap(async (req, res) => {
  res.json(await mutateTracks(req.user.id, req.params.id, (tracks) => tracks.filter((t) => t.id !== req.params.trackId)));
}));

/** Nova ordem das faixas: body { ids } com exatamente os mesmos ids da playlist. */
router.put('/:id/order', wrap(async (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids)) throw new HttpError(400, 'INVALID_ORDER', 'Ordem inválida.');
  res.json(await mutateTracks(req.user.id, req.params.id, (tracks) => {
    const byId = new Map(tracks.map((t) => [t.id, t]));
    if (ids.length !== tracks.length || new Set(ids).size !== ids.length || !ids.every((id) => byId.has(id))) {
      throw new HttpError(409, 'ORDER_CONFLICT', 'A playlist mudou. Recarregue e tente novamente.');
    }
    return ids.map((id) => byId.get(id));
  }));
}));

module.exports = router;
