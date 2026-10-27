const { getMigrations } = require('better-auth/db/migration');
const { auth } = require('./auth');
const { pool } = require('./db');

/** Cria/atualiza as tabelas do Better Auth (user, session, account, verification, passkey) e as do app. */
async function migrate() {
  const { runMigrations, toBeCreated, toBeAdded } = await getMigrations(auth.options);
  if (toBeCreated.length || toBeAdded.length) {
    console.log(`[db] migrando auth: ${[...toBeCreated, ...toBeAdded].map((t) => t.table).join(', ')}`);
    await runMigrations();
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS playlist (
      id         text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id    text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
      tracks     jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS playlist_user_idx ON playlist (user_id, created_at);
    -- Ordem (ids) antes do primeiro "embaralhar"; NULL quando a playlist não está embaralhada.
    ALTER TABLE playlist ADD COLUMN IF NOT EXISTS original_order jsonb;

    -- Senha temporária criptografada, visível ao admin até o usuário definir a dele.
    CREATE TABLE IF NOT EXISTS temp_password (
      user_id    text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
      ciphertext text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    -- Letras já encontradas no LRCLIB (resposta pronta da API), por chave da busca.
    CREATE TABLE IF NOT EXISTS lyrics_cache (
      key        text PRIMARY KEY,
      data       jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    -- Traduções completas, reutilizadas entre usuários e reinícios.
    CREATE TABLE IF NOT EXISTS translation_cache (
      key        text PRIMARY KEY,
      data       jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    -- Convites para compartilhar uma playlist (o destinatário recebe uma cópia ao aceitar).
    -- sender_seen: o remetente já viu a resposta (aceito/recusado).
    CREATE TABLE IF NOT EXISTS playlist_share (
      id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      sender_id     text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      recipient_id  text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      playlist_id   text REFERENCES playlist(id) ON DELETE SET NULL,
      playlist_name text NOT NULL,
      status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
      sender_seen   boolean NOT NULL DEFAULT false,
      created_at    timestamptz NOT NULL DEFAULT now(),
      responded_at  timestamptz
    );
    CREATE UNIQUE INDEX IF NOT EXISTS playlist_share_pending_idx
      ON playlist_share (playlist_id, recipient_id) WHERE status = 'pending';
    CREATE INDEX IF NOT EXISTS playlist_share_recipient_idx ON playlist_share (recipient_id) WHERE status = 'pending';
    CREATE INDEX IF NOT EXISTS playlist_share_sender_idx ON playlist_share (sender_id) WHERE NOT sender_seen;
  `);
}

/** O Postgres pode demorar alguns segundos para aceitar conexões no primeiro boot do compose. */
async function migrateWithRetry({ attempts = 15, delayMs = 2000 } = {}) {
  for (let i = 1; ; i++) {
    try {
      return await migrate();
    } catch (err) {
      if (i >= attempts || !['ECONNREFUSED', 'ENOTFOUND', '57P03'].includes(err.code)) throw err;
      console.log(`[db] aguardando o banco (${i}/${attempts})…`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

module.exports = { migrate: migrateWithRetry };

if (require.main === module) {
  migrateWithRetry()
    .then(() => console.log('[db] ok'))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
