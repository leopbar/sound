const { betterAuth } = require('better-auth');
const { haveIBeenPwned, admin } = require('better-auth/plugins');
const { createAuthMiddleware, isAPIError } = require('better-auth/api');
const { passkey } = require('@better-auth/passkey');
const config = require('./config');
const { pool } = require('./db');
const { sendActionEmail, mailEnabled } = require('./lib/mailer');
const { clearTemporaryPassword } = require('./lib/tempPassword');

const appOrigin = new URL(config.appUrl);

const socialProviders = {};
for (const name of ['google', 'github']) {
  const { clientId, clientSecret } = config.auth[name];
  if (clientId && clientSecret) socialProviders[name] = { clientId, clientSecret };
}

/**
 * Better Auth: sessões em cookie httpOnly (nada de token no localStorage), senhas com
 * scrypt, proteção CSRF por Origin/Fetch-Metadata, rate limit nas rotas sensíveis,
 * passkeys (WebAuthn) e verificação de senhas vazadas (Have I Been Pwned, k-anonymity).
 */
const auth = betterAuth({
  appName: 'Sound',
  baseURL: config.appUrl,
  basePath: '/api/auth',
  secret: config.auth.secret,
  database: pool,
  trustedOrigins: [appOrigin.origin, ...config.corsOrigins],

  emailAndPassword: {
    enabled: true,
    disableSignUp: !config.auth.signUpEnabled,
    minPasswordLength: 10,
    // Sem SMTP não há como entregar o link; nesse caso a verificação não é exigida.
    requireEmailVerification: mailEnabled,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 30 * 60,
    onPasswordReset: ({ user }) => clearTemporaryPassword(user.id),
    sendResetPassword: ({ user, url }) =>
      sendActionEmail({
        to: user.email,
        subject: 'Redefinir sua senha do Sound',
        intro: 'Recebemos um pedido para redefinir a senha da sua conta. O link expira em 30 minutos.',
        action: 'Redefinir senha',
        url,
      }),
  },

  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: mailEnabled,
    autoSignInAfterVerification: true,
    expiresIn: 24 * 60 * 60,
    sendVerificationEmail: ({ user, url }) =>
      sendActionEmail({
        to: user.email,
        subject: 'Confirme seu e-mail no Sound',
        intro: `Olá, ${user.name}! Confirme seu e-mail para ativar sua conta.`,
        action: 'Confirmar e-mail',
        url,
      }),
  },

  socialProviders,
  account: {
    accountLinking: { enabled: true, trustedProviders: Object.keys(socialProviders) },
  },

  user: {
    deleteUser: { enabled: true }, // playlists são removidas em cascata (FK)
    additionalFields: {
      // Senha temporária (criada pelo admin): o app fica bloqueado até a troca.
      // input: false -> o próprio usuário não consegue alterar via sign-up/update-user.
      mustChangePassword: { type: 'boolean', required: false, defaultValue: false, input: false },
    },
  },

  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/change-password' || isAPIError(ctx.context.returned)) return;
      const userId = ctx.context.session?.user?.id;
      if (userId) await clearTemporaryPassword(userId);
    }),
  },

  session: {
    expiresIn: 30 * 24 * 60 * 60, // 30 dias
    updateAge: 24 * 60 * 60, // renova a validade no máximo 1x/dia
    freshAge: 10 * 60, // ações sensíveis exigem login nos últimos 10 min
    // Sem cache da sessão no cookie: logout, banimento, "desconectar dispositivos" e senha
    // temporária valem na hora (custo: uma consulta indexada por requisição).
    cookieCache: { enabled: false },
  },

  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
      '/sign-up/email': { window: 60 * 60, max: 5 },
      '/request-password-reset': { window: 60 * 60, max: 5 },
      '/send-verification-email': { window: 60 * 60, max: 5 },
      '/change-password': { window: 60, max: 5 },
      '/delete-user': { window: 60, max: 3 },
    },
  },

  advanced: {
    // O nginx sobrescreve X-Real-IP com o IP real; o cliente não consegue forjá-lo.
    ipAddress: { ipAddressHeaders: ['x-real-ip'] },
    useSecureCookies: appOrigin.protocol === 'https:',
  },

  plugins: [
    // Papel "admin": gerencia usuários (listar, banir, trocar papel, senha temporária, encerrar sessões).
    admin({ defaultRole: 'user', adminRoles: ['admin'], bannedUserMessage: 'Sua conta foi suspensa. Fale com o administrador.' }),
    passkey({ rpID: appOrigin.hostname, rpName: 'Sound', origin: appOrigin.origin }),
    haveIBeenPwned({
      customPasswordCompromisedMessage: 'Essa senha apareceu em vazamentos de dados conhecidos. Escolha outra.',
    }),
  ],
});

/** O que o frontend precisa saber para montar a tela de login. */
const publicAuthConfig = {
  providers: Object.keys(socialProviders),
  emailVerification: mailEnabled,
  signUp: config.auth.signUpEnabled,
};

module.exports = { auth, publicAuthConfig };
