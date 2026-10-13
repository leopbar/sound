# Sound — Music Discovery & Streaming Player

Busque qualquer gravação do mundo e ouça na hora. Metadados vêm da **MusicBrainz**, o áudio do **YouTube** (via proxy) e, como reserva, do **Jamendo** e do **Internet Archive**.

```
React (Vite + Tailwind + Zustand)  ──/api──▶  nginx  ──▶  Express
                                                          ├─ MusicBrainz  (metadados, fila 1 req/s, cache 1h)
                                                          ├─ YouTube      (busca: Data API v3 ou busca interna)
                                                          ├─ Jamendo / Internet Archive (fallback)
                                                          └─ /api/stream  (ytdl-core → yt-dlp, HTTP Range)
```

## Rodando (Docker)

```bash
cp .env.example .env        # opcional: preencha as chaves
docker compose up -d --build
```

Abra http://localhost:8080 (troque a porta com `CLIENT_PORT=8088 docker compose up -d`).

Desenvolvimento com hot reload (Vite em http://localhost:5173, `node --watch` no backend):

```bash
docker compose -f docker-compose.dev.yml up
```

> No modo dev o servidor usa a imagem `node:22-alpine` pura, **sem yt-dlp**. Para streaming do YouTube use o compose principal ou instale o yt-dlp localmente.

## Variáveis de ambiente

| Variável | Uso |
|---|---|
| `MB_USER_AGENT` | **Recomendado.** A MusicBrainz exige identificação (`App/versão ( contato )`); UAs genéricos recebem 503 com mais frequência. |
| `YOUTUBE_API_KEY` | Opcional. Busca via Data API v3 (mais precisa). Sem chave — ou com a cota esgotada — usa a busca interna (parse do `ytInitialData`). |
| `JAMENDO_CLIENT_ID` | Opcional. Habilita o fallback Jamendo. |
| `YT_COOKIES` / `YTDLP_COOKIES_FILE` | Opcional. Cookies caso o YouTube exija verificação anti-bot. |
| `SEARCH_LIMIT` | Máximo de resultados (padrão 12). |

## API

| Rota | Descrição |
|---|---|
| `GET /api/search?q=` | Gravações (MusicBrainz → fonte de áudio): `{ id, kind: 'recording', title, version, artist, album, thumbnail, duration, views, isrc, mbid, source, streamUrl }[]`, ordenadas por relevância + popularidade. |
| `GET /api/search/youtube?q=` | Vídeos na ordem do próprio YouTube: `{ id, kind: 'video', title, artist (canal), thumbnail, duration, views, source, streamUrl }[]`. |
| `GET /api/stream/:videoId` | Áudio do YouTube (`audioonly`/`highestaudio`), com suporte a `Range` (seek). |
| `GET /api/stream/jamendo/:id` | Proxy do MP3 do Jamendo. |
| `GET /api/stream/archive/:identifier/*` | Proxy de arquivo do Internet Archive. |

Falhas de stream (vídeo privado, removido, bloqueado por região, restrição de idade, anti-bot) retornam **502** com JSON:

```json
{ "error": "VIDEO_PRIVATE", "message": "O vídeo é privado.", "videoId": "...", "tryNext": true }
```

O frontend lê essa mensagem, mostra um aviso e pula para a próxima faixa da fila.

## Decisões de arquitetura

- **ytdl-core + yt-dlp.** O `ytdl-core` original foi abandonado em 2023, e o fork mantido (`@distube/ytdl-core`) não recebe atualizações desde jun/2025: hoje ele falha com *"Failed to find any playable formats"*. Ele continua sendo o extrator primário (conforme a stack), mas o proxy cai automaticamente no **yt-dlp** (instalado na imagem, usando o Node como runtime JS). Um *circuit breaker* pula o ytdl-core por 10 min após uma falha não definitiva. Quando o YouTube mudar de novo, atualize com `docker compose build --no-cache server`.
- **Seek de verdade.** O proxy repassa `Range`/`Content-Range`, então a seekbar funciona sem baixar a faixa inteira.
- **Mesma origem.** O nginx serve o app e faz proxy de `/api` (com `proxy_buffering off`), o que evita CORS no `<audio>` e permite que o `AnalyserNode` leia as amostras para o visualizador.
- **Ranking MusicBrainz.** Para músicas populares a busca da MB devolve dezenas de gravações com score 100 (shows, coletâneas, bandas tributo) e às vezes omite a gravação de estúdio. Por isso o backend faz duas consultas (uma restrita a álbuns de estúdio oficiais e uma geral), resolve se "A - B" é título-artista ou artista-título pela popularidade, penaliza versões alternativas (ao vivo, karaokê…), deduplica e herda a capa do álbum de estúdio original.
- **Cache** (`node-cache`, em memória): MusicBrainz 1h, vídeo de cada gravação 24h, info de stream 4h. Prefetch das 2 primeiras faixas a cada busca, para o primeiro play ser imediato.

## Abas de resultado

- **Gravações:** catálogo MusicBrainz, uma entrada por gravação, com álbum, versão e capa oficial.
- **YouTube:** os vídeos como o YouTube mostra (clipes, uploads de fãs, versões fora do catálogo).
- **Tudo:** as duas seções; vídeos que já tocam em algum card de gravação não se repetem.

As duas buscas rodam em paralelo; a aba escolhida fica salva no navegador. Next/Previous seguem a lista em que o play foi dado.

## Atalhos

`Espaço` play/pause · `←/→` ±5s · `Shift+←/→` anterior/próxima · teclas de mídia (Media Session API).

## Aviso legal

Extrair áudio do YouTube viola os Termos de Serviço do YouTube. Use apenas para fins pessoais/educacionais e respeite os direitos autorais.
