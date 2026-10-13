module.exports = {
  port: Number(process.env.PORT) || 4000,
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:8080')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  userAgent:
    process.env.MB_USER_AGENT || 'SoundPlayer/1.0.0 ( https://github.com/your-org/sound )',
  youtubeApiKey: process.env.YOUTUBE_API_KEY || '',
  jamendoClientId: process.env.JAMENDO_CLIENT_ID || '',
  searchLimit: Number(process.env.SEARCH_LIMIT) || 12,
};
