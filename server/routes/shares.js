const express = require('express');
const { pool, transaction } = require('../db');
const { HttpError } = require('../lib/errors');
const { insertPlaylist } = require('./playlists');

/**
 * Compartilhamento de playlists entre usuários. O remetente convida; o destinatário aceita
 * (recebe uma CÓPIA da playlist, como playlist nova dele) ou recusa; o remetente vê a resposta.
 * Cada rota só enxerga convites em que o usuário logado é remetente ou destinatário.
 */
const router = express.Router();
router.use(express.json({ limit: '10kb' }));
router.use((req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});

const MAX_PENDING_PER_SENDER = 100;

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const shareNotFound = () => new HttpError(404, 'SHARE_NOT_FOUND', 'Convite não encontrado.');

/** "Rock (De João)", cortando o nome da lista para caber nos 60 caracteres. */
function copyName(name, senderName) {
  const suffix = ` (De ${String(senderName || 'outro usuário').trim().slice(0, 30)})`;
  return `${name.slice(0, 60 - suffix.length).trim()}${suffix}`;
}

/** Usuários para quem dá para compartilhar: todos menos você e os suspensos. Só o nome. */
router.get('/users', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name FROM "user" WHERE id <> $1 AND banned IS NOT TRUE ORDER BY lower(name), id`,
    [req.user.id],
  );
  res.json({ users: rows });
}));

/** Envia o convite: body { playlistId, userId }. */
router.post('/', wrap(async (req, res) => {
  const playlistId = String(req.body?.playlistId ?? '');
  const userId = String(req.body?.userId ?? '');
  if (userId === req.user.id) throw new HttpError(400, 'INVALID_RECIPIENT', 'Escolha outro usuário.');

  const { rows: [playlist] } = await pool.query('SELECT id, name FROM playlist WHERE id = $1 AND user_id = $2', [playlistId, req.user.id]);
  if (!playlist) throw new HttpError(404, 'PLAYLIST_NOT_FOUND', 'Playlist não encontrada.');
  const { rows: [recipient] } = await pool.query('SELECT id, name FROM "user" WHERE id = $1 AND banned IS NOT TRUE', [userId]);
  if (!recipient) throw new HttpError(404, 'USER_NOT_FOUND', 'Usuário não encontrado.');

  const { rows: [{ count }] } = await pool.query(
    `SELECT count(*)::int AS count FROM playlist_share WHERE sender_id = $1 AND status = 'pending'`,
    [req.user.id],
  );
  if (count >= MAX_PENDING_PER_SENDER) {
    throw new HttpError(429, 'TOO_MANY_SHARES', 'Muitos convites aguardando resposta. Espere alguns serem respondidos.');
  }

  const { rows } = await pool.query(
    `INSERT INTO playlist_share (sender_id, recipient_id, playlist_id, playlist_name)
     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING id`,
    [req.user.id, recipient.id, playlist.id, playlist.name],
  );
  if (!rows.length) {
    throw new HttpError(409, 'SHARE_PENDING', `${recipient.name} ainda não respondeu ao convite desta lista.`);
  }
  res.status(201).json({ id: rows[0].id, recipient: { id: recipient.id, name: recipient.name } });
}));

/**
 * O que o usuário precisa ver: convites recebidos aguardando resposta e respostas
 * (aceito/recusado) aos convites que ele enviou e ainda não viu.
 */
router.get('/inbox', wrap(async (req, res) => {
  const [incoming, outcomes] = await Promise.all([
    pool.query(
      `SELECT s.id, s.playlist_name, s.created_at, u.name AS sender_name, jsonb_array_length(p.tracks) AS track_count
         FROM playlist_share s
         JOIN "user" u ON u.id = s.sender_id
         JOIN playlist p ON p.id = s.playlist_id
        WHERE s.recipient_id = $1 AND s.status = 'pending'
        ORDER BY s.created_at, s.id`,
      [req.user.id],
    ),
    pool.query(
      `SELECT s.id, s.playlist_name, s.status, s.responded_at, u.name AS recipient_name
         FROM playlist_share s
         JOIN "user" u ON u.id = s.recipient_id
        WHERE s.sender_id = $1 AND s.status <> 'pending' AND NOT s.sender_seen
        ORDER BY s.responded_at, s.id`,
      [req.user.id],
    ),
  ]);
  res.json({
    incoming: incoming.rows.map((r) => ({
      id: r.id,
      playlistName: r.playlist_name,
      senderName: r.sender_name,
      trackCount: r.track_count,
      createdAt: r.created_at,
    })),
    outcomes: outcomes.rows.map((r) => ({
      id: r.id,
      playlistName: r.playlist_name,
      recipientName: r.recipient_name,
      status: r.status,
      respondedAt: r.responded_at,
    })),
  });
}));

/** Aceita: copia as faixas atuais da playlist do remetente para uma playlist nova do destinatário. */
router.post('/:id/accept', wrap(async (req, res) => {
  const playlist = await transaction(async (db) => {
    const { rows: [share] } = await db.query(
      `SELECT s.id, s.playlist_id, p.name, p.tracks, u.name AS sender_name
         FROM playlist_share s
         JOIN "user" u ON u.id = s.sender_id
         LEFT JOIN playlist p ON p.id = s.playlist_id
        WHERE s.id = $1 AND s.recipient_id = $2 AND s.status = 'pending'
        FOR UPDATE OF s`,
      [req.params.id, req.user.id],
    );
    if (!share) throw shareNotFound();
    if (!share.playlist_id) {
      await db.query('DELETE FROM playlist_share WHERE id = $1', [share.id]);
      throw new HttpError(410, 'PLAYLIST_GONE', 'Essa lista não existe mais.');
    }
    const created = await insertPlaylist(db, req.user.id, copyName(share.name, share.sender_name), share.tracks);
    await db.query(`UPDATE playlist_share SET status = 'accepted', responded_at = now() WHERE id = $1`, [share.id]);
    return created;
  });
  res.json({ playlist });
}));

router.post('/:id/decline', wrap(async (req, res) => {
  const { rowCount } = await pool.query(
    `UPDATE playlist_share SET status = 'declined', responded_at = now()
      WHERE id = $1 AND recipient_id = $2 AND status = 'pending'`,
    [req.params.id, req.user.id],
  );
  if (!rowCount) throw shareNotFound();
  res.status(204).end();
}));

/** O remetente viu a resposta: some da caixa dele. */
router.post('/:id/seen', wrap(async (req, res) => {
  const { rowCount } = await pool.query(
    `UPDATE playlist_share SET sender_seen = true WHERE id = $1 AND sender_id = $2 AND status <> 'pending'`,
    [req.params.id, req.user.id],
  );
  if (!rowCount) throw shareNotFound();
  res.status(204).end();
}));

module.exports = router;
