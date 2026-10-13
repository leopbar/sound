const express = require('express');
const { HttpError } = require('../lib/errors');
const { pool } = require('../db');
const { setTemporaryPassword, createUserWithTempPassword, readTemporaryPassword } = require('../lib/tempPassword');

/**
 * Ações de admin que o plugin do Better Auth não cobre. Listar, banir, trocar papel e
 * encerrar sessões ficam em /api/auth/admin/* (plugin admin).
 */
const router = express.Router();
router.use(express.json({ limit: '10kb' }));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.use((req, res, next) => {
  if (req.user?.role !== 'admin') return next(new HttpError(403, 'FORBIDDEN', 'Acesso restrito a administradores.'));
  res.set('Cache-Control', 'no-store'); // respostas podem conter senhas temporárias
  next();
});

async function assertUserExists(id) {
  const { rowCount } = await pool.query('SELECT 1 FROM "user" WHERE id = $1', [id]);
  if (!rowCount) throw new HttpError(404, 'USER_NOT_FOUND', 'Usuário não encontrado.');
}

/** Cadastra um usuário com senha temporária: { name, email, role? } -> { user, password }. */
router.post('/users', wrap(async (req, res) => {
  const name = String(req.body?.name ?? '').trim().slice(0, 60);
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const role = req.body?.role === 'admin' ? 'admin' : 'user';
  if (!name) throw new HttpError(400, 'INVALID_NAME', 'Informe o nome.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) throw new HttpError(400, 'INVALID_EMAIL', 'E-mail inválido.');
  res.status(201).json(await createUserWithTempPassword({ name, email, role }));
}));

/** Senha temporária ainda não trocada pelo usuário. */
router.get('/users/:id/temp-password', wrap(async (req, res) => {
  await assertUserExists(req.params.id);
  const temp = await readTemporaryPassword(req.params.id);
  if (!temp) throw new HttpError(404, 'NO_TEMP_PASSWORD', 'Não há senha temporária disponível para este usuário. Gere uma nova.');
  res.json(temp);
}));

/** Gera uma senha temporária para o usuário; ele terá de trocá-la no próximo login. */
router.post('/users/:id/temp-password', wrap(async (req, res) => {
  await assertUserExists(req.params.id);
  res.json({ password: await setTemporaryPassword(req.params.id) });
}));

module.exports = router;
