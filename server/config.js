const isProd = process.env.NODE_ENV === 'production';

// URL pública do app (o que o usuário digita no navegador). Base dos links de e-mail,
// dos callbacks OAuth e do domínio dos passkeys (WebAuthn rpID).
const appUrl = (process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, '');

const authSecret = process.env.BETTER_AUTH_SECRET || '';
if (isProd && authSecret.length < 32) {
  throw new Error('BETTER_AUTH_SECRET ausente ou curto demais (mín. 32 caracteres). Gere com: openssl rand -base64 32');
}

module.exports = {
  isProd,
  port: Number(process.env.PORT) || 4000,
  appUrl,
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:8080')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  databaseUrl: process.env.DATABASE_URL || 'postgres://sound:sound@localhost:5432/sound',
  auth: {
    secret: authSecret || 'dev-only-secret-change-me-dev-only-secret',
    google: { clientId: process.env.GOOGLE_CLIENT_ID || '', clientSecret: process.env.GOOGLE_CLIENT_SECRET || '' },
    github: { clientId: process.env.GITHUB_CLIENT_ID || '', clientSecret: process.env.GITHUB_CLIENT_SECRET || '' },
    // Desligue (false) para fechar o cadastro público depois de criar as contas desejadas.
    signUpEnabled: process.env.SIGNUP_ENABLED !== 'false',
  },
  smtp: {
    url: process.env.SMTP_URL || '', // ex.: smtps://usuario:senha@smtp.exemplo.com:465
    from: process.env.MAIL_FROM || 'Sound <no-reply@localhost>',
  },
  userAgent:
    process.env.MB_USER_AGENT || 'SoundPlayer/1.0.0 ( https://github.com/your-org/sound )',
  youtubeApiKey: process.env.YOUTUBE_API_KEY || '',
  jamendoClientId: process.env.JAMENDO_CLIENT_ID || '',
  searchLimit: Number(process.env.SEARCH_LIMIT) || 12,
};
