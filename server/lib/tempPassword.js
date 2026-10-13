const crypto = require('crypto');
const { hashPassword } = require('better-auth/crypto');
const config = require('../config');
const { pool, transaction } = require('../db');
const { HttpError } = require('./errors');

// Sem caracteres ambíguos (0/O, 1/l/I).
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateTempPassword() {
  const group = () => Array.from({ length: 4 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
  return `${group()}-${group()}-${group()}-${group()}`;
}

/*
 * A senha temporária fica guardada criptografada (AES-256-GCM) para o admin poder
 * consultá-la até o usuário definir a própria senha; nesse momento ela é apagada.
 * O login nunca usa este valor — ele confere o hash scrypt em account.password.
 */
const KEY = Buffer.from(crypto.hkdfSync('sha256', config.auth.secret, Buffer.alloc(0), 'sound:temp-password:v1', 32));

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

function decrypt(payload) {
  const [iv, tag, data] = payload.split('.').map((s) => Buffer.from(s, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** Grava o hash da senha, a cópia criptografada e o bloqueio "troca obrigatória"; encerra as sessões. */
async function applyTemporaryPassword(db, userId) {
  const password = generateTempPassword();
  const hash = await hashPassword(password);

  const updated = await db.query(
    `UPDATE account SET password = $2, "updatedAt" = now() WHERE "userId" = $1 AND "providerId" = 'credential'`,
    [userId, hash],
  );
  if (!updated.rowCount) {
    await db.query(
      `INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
       VALUES ($2, $1, 'credential', $1, $3, now(), now())`,
      [userId, crypto.randomBytes(16).toString('hex'), hash],
    );
  }
  await db.query(
    `INSERT INTO temp_password (user_id, ciphertext) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, created_at = now()`,
    [userId, encrypt(password)],
  );
  await db.query('UPDATE "user" SET "mustChangePassword" = true, "updatedAt" = now() WHERE id = $1', [userId]);
  await db.query('DELETE FROM session WHERE "userId" = $1', [userId]);
  return password;
}

/**
 * Define uma senha temporária para um usuário existente (criando a credencial de senha se
 * ele só usava Google/GitHub/passkey); a troca passa a ser obrigatória no próximo login.
 */
function setTemporaryPassword(userId) {
  return transaction((db) => applyTemporaryPassword(db, userId));
}

/** Cria um usuário já com e-mail verificado e senha temporária. */
async function createUserWithTempPassword({ name, email, role = 'user' }) {
  try {
    return await transaction(async (db) => {
      const { rows } = await db.query(
        `INSERT INTO "user" (id, name, email, "emailVerified", role, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, true, $4, now(), now()) RETURNING id, name, email, role`,
        [crypto.randomBytes(16).toString('hex'), name, email, role],
      );
      const password = await applyTemporaryPassword(db, rows[0].id);
      return { user: rows[0], password };
    });
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'USER_ALREADY_EXISTS', 'Já existe uma conta com esse e-mail.');
    throw err;
  }
}

/** Senha temporária ainda pendente do usuário, ou null se ele já definiu a dele. */
async function readTemporaryPassword(userId) {
  const { rows } = await pool.query('SELECT ciphertext, created_at FROM temp_password WHERE user_id = $1', [userId]);
  if (!rows.length) return null;
  try {
    return { password: decrypt(rows[0].ciphertext), createdAt: rows[0].created_at };
  } catch {
    return null; // BETTER_AUTH_SECRET mudou: não há como recuperar; gere outra.
  }
}

/** Usuário definiu a própria senha: libera o app e descarta a temporária. */
async function clearTemporaryPassword(userId) {
  await transaction(async (db) => {
    await db.query('UPDATE "user" SET "mustChangePassword" = false, "updatedAt" = now() WHERE id = $1', [userId]);
    await db.query('DELETE FROM temp_password WHERE user_id = $1', [userId]);
  });
}

module.exports = { setTemporaryPassword, createUserWithTempPassword, readTemporaryPassword, clearTemporaryPassword };
