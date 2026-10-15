/**
 * Tradução de letras para português do Brasil pelo endpoint público do Google Tradutor
 * (`translate_a/single?client=gtx`): sem chave, não oficial. O cache segura o volume.
 */
const crypto = require('crypto');
const axios = require('axios');
const { remember } = require('../lib/cache');
const { HttpError } = require('../lib/errors');

const TARGET = 'pt-BR';
const TTL = 60 * 60 * 24 * 7; // a tradução de um texto não muda
const CHUNK_CHARS = 4000; // a requisição vai no corpo, mas o Google recusa textos muito longos

const http = axios.create({
  baseURL: 'https://translate.googleapis.com',
  timeout: 10000,
  // O UA do app (MB_USER_AGENT, com contato) leva 429 aqui, e não convém mandar o contato ao Google.
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  },
});

// O Google responde 429 de vez em quando (sobretudo na 1ª chamada): tenta de novo com espera.
const RETRY_DELAYS_MS = [400, 1200];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const retryable = (err) => !err.response || err.response.status === 429 || err.response.status >= 500;

// O texto vai no corpo (POST): letras inteiras não cabem na URL.
const post = (text) =>
  http.post('/translate_a/single', new URLSearchParams({ q: text }).toString(), {
    params: { client: 'gtx', sl: 'auto', tl: TARGET, dt: 't' },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
  });

/** Traduz um bloco de texto. -> { text, lang } (lang = idioma detectado). */
async function translateText(text) {
  let data;
  for (let attempt = 0; ; attempt++) {
    try {
      ({ data } = await post(text));
      break;
    } catch (err) {
      if (attempt < RETRY_DELAYS_MS.length && retryable(err)) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      console.warn('[translate] Google Tradutor falhou:', err.response?.status || err.message);
      throw new HttpError(502, 'TRANSLATION_UNAVAILABLE', 'Tradução indisponível no momento.');
    }
  }
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new HttpError(502, 'TRANSLATION_UNAVAILABLE', 'Tradução indisponível no momento.');
  }
  return {
    text: data[0].map((seg) => (Array.isArray(seg) ? seg[0] || '' : '')).join(''),
    lang: typeof data[2] === 'string' ? data[2] : null,
  };
}

/** Agrupa linhas em blocos de até CHUNK_CHARS (uma linha nunca é quebrada). */
function chunk(lines) {
  const chunks = [];
  let cur = [];
  let size = 0;
  for (const line of lines) {
    if (cur.length && size + line.length + 1 > CHUNK_CHARS) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(line);
    size += line.length + 1;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/**
 * Traduz um bloco de linhas numa chamada só (o Google preserva as quebras de linha).
 * Se a contagem não bater, traduz linha a linha para não desalinhar a letra.
 */
async function translateChunk(lines) {
  const { text, lang } = await translateText(lines.join('\n'));
  const out = text.split('\n').map((s) => s.trim());
  if (out.length === lines.length) return { out, lang };
  const each = [];
  for (const line of lines) each.push((await translateText(line)).text.trim());
  return { out: each, lang };
}

const isPortuguese = (lang) => /^pt\b/i.test(lang || '');

/**
 * lines: string[] -> { lang, same, translations: string[] } (mesma ordem/tamanho; '' em linhas vazias).
 * `same` = a letra já está em português (nada a traduzir).
 */
async function translateLines(lines) {
  const unique = [...new Set(lines.map((l) => l.trim()).filter(Boolean))];
  if (!unique.length) return { lang: null, same: false, translations: lines.map(() => '') };

  const key = `translate:${TARGET}:${crypto.createHash('sha256').update(unique.join('\n')).digest('hex')}`;
  const result = await remember(key, TTL, async () => {
    const map = {};
    let lang = null;
    for (const part of chunk(unique)) {
      const { out, lang: detected } = await translateChunk(part);
      lang ||= detected;
      if (isPortuguese(lang)) return { lang, map: null };
      part.forEach((line, i) => (map[line] = out[i] || ''));
    }
    return { lang, map };
  });

  if (!result.map) return { lang: result.lang, same: true, translations: [] };
  return {
    lang: result.lang,
    same: false,
    translations: lines.map((l) => {
      const t = result.map[l.trim()] || '';
      // Linha igual à original (refrão "oh oh", nomes): não repete embaixo.
      return t.toLowerCase() === l.trim().toLowerCase() ? '' : t;
    }),
  };
}

module.exports = { translateLines };
