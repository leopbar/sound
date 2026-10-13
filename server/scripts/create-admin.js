/**
 * Cria (ou redefine) um administrador com senha temporária, que precisa ser trocada no
 * primeiro login. Também serve para recuperar o acesso de um admin.
 *
 *   docker compose exec server node scripts/create-admin.js email@exemplo.com ["Nome"]
 */
const { migrate } = require('../migrate');
const { pool } = require('../db');
const { setTemporaryPassword, createUserWithTempPassword } = require('../lib/tempPassword');

async function main() {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error('Uso: node scripts/create-admin.js email@exemplo.com ["Nome"]');
  }
  const name = process.argv[3] || email.split('@')[0];

  await migrate();

  let user = (await pool.query('SELECT id FROM "user" WHERE lower(email) = $1', [email])).rows[0];
  let password;
  if (user) {
    password = await setTemporaryPassword(user.id);
    console.log(`Usuário existente atualizado: ${email}`);
  } else {
    ({ user, password } = await createUserWithTempPassword({ name, email, role: 'admin' }));
    console.log(`Usuário criado: ${email}`);
  }
  await pool.query(
    `UPDATE "user" SET role = 'admin', banned = false, "banReason" = NULL, "banExpires" = NULL, "emailVerified" = true, "updatedAt" = now()
     WHERE id = $1`,
    [user.id],
  );

  console.log('\nPapel: admin');
  console.log(`Senha temporária: ${password}`);
  console.log('A troca de senha será exigida no primeiro login.\n');
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
