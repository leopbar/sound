# Sound — Music Discovery & Streaming Player

Busque qualquer gravação do mundo e ouça na hora. Metadados vêm da **MusicBrainz**, o áudio do **YouTube** (via proxy) e, como reserva, do **Jamendo** e do **Internet Archive**.

```
React (Vite + Tailwind + Zustand)  ──/api──▶  nginx  ──▶  Express
                                                          ├─ /api/auth      (Better Auth: sessões, passkeys, OAuth)
                                                          ├─ /api/playlists (por usuário, PostgreSQL)
                                                          ├─ MusicBrainz  (metadados, fila 1 req/s, cache 1h)
                                                          ├─ YouTube      (busca: Data API v3 ou busca interna)
                                                          ├─ Jamendo / Internet Archive (fallback)
                                                          └─ /api/stream  (ytdl-core → yt-dlp, HTTP Range)
```

## Rodando (Docker)

```bash
cp .env.example .env        # preencha BETTER_AUTH_SECRET e POSTGRES_PASSWORD
docker compose up -d --build
```

Abra http://localhost:8080 e crie sua conta. Se mudar a porta (`CLIENT_PORT`), ajuste `APP_URL` junto.
As tabelas são criadas/atualizadas automaticamente na subida do servidor.

## Subindo no VPS (HTTPS)

1. Aponte um registro DNS `A`/`AAAA` (ex.: `sound.seudominio.com`) para o IP do VPS e libere as portas 80 e 443.
2. No `.env`:
   ```ini
   APP_URL=https://sound.seudominio.com
   DOMAIN=sound.seudominio.com
   CLIENT_BIND=127.0.0.1
   BETTER_AUTH_SECRET=...   # openssl rand -base64 32
   POSTGRES_PASSWORD=...    # openssl rand -base64 32
   SMTP_URL=smtps://usuario:senha@smtp.seuprovedor.com:465
   MAIL_FROM=Sound <no-reply@seudominio.com>
   ```
3. Suba com o Caddy (certificado Let's Encrypt automático):
   ```bash
   docker compose --profile https up -d --build
   ```

Com `CLIENT_BIND=127.0.0.1` só o Caddy é exposto à internet — isso é o que garante que o IP usado no rate limit e na lista de sessões não possa ser forjado via `X-Forwarded-For`. **Não troque o `BETTER_AUTH_SECRET` depois** (invalida todas as sessões) e faça backup do volume do banco:

```bash
docker compose exec db pg_dump -U sound sound > backup.sql
```

Depois de criar as contas que quiser, `SIGNUP_ENABLED=false` fecha o cadastro público.

## Autenticação

[Better Auth](https://www.better-auth.com), self-hosted no próprio backend (nenhum serviço externo, nenhum custo por usuário):

- **E-mail e senha** — hash scrypt, mínimo de 10 caracteres, senhas que aparecem em vazamentos são recusadas (Have I Been Pwned por *k-anonymity*: só 5 caracteres do hash SHA-1 saem do servidor).
- **Passkeys (WebAuthn)** — cadastradas na tela *Conta*; entrada com digital/rosto/PIN, inclusive pelo autopreenchimento do campo de e-mail. Exigem HTTPS (ou `localhost`).
- **Google / GitHub** (opcional) — preencha `GOOGLE_*`/`GITHUB_*`; callback `{APP_URL}/api/auth/callback/{google|github}`. Contas com o mesmo e-mail são vinculadas.
- **Verificação de e-mail e recuperação de senha** — com `SMTP_URL`, o e-mail precisa ser confirmado antes do primeiro login. Sem SMTP, os links aparecem em `docker compose logs server` e a verificação não é exigida.
- **Sessões** — cookie `httpOnly` + `SameSite=Lax` (+ `Secure` em HTTPS), nada no `localStorage`; validade de 30 dias renovada com o uso; a tela *Conta* lista os dispositivos conectados e permite encerrá-los. Trocar/redefinir a senha encerra as outras sessões.
- **Proteções** — CSRF por verificação de `Origin`/Fetch Metadata, rate limit nas rotas de login/cadastro/recuperação (5 tentativas/min por IP), mensagens que não revelam se um e-mail existe, CSP e headers de segurança no nginx, HSTS no Caddy.

Todo o app exige login: busca e streaming respondem `401` sem sessão.

## Administração

Crie (ou recupere) um administrador com senha temporária — a troca é obrigatória no primeiro login:

```bash
docker compose exec server node scripts/create-admin.js voce@exemplo.com "Seu Nome"
```

Rodar de novo para o mesmo e-mail gera outra senha temporária e derruba as sessões abertas (serve para recuperar o acesso). A aba **Admin** (só para quem tem papel `admin`) permite **cadastrar usuários** (o sistema gera a senha temporária) e, para cada usuário, tornar/remover admin, suspender/reativar, ver ou gerar senha temporária, desconectar de todos os dispositivos e excluir a conta.

A senha temporária fica disponível em "Ver senha" até o usuário entrar e definir a própria — então ela é apagada; o admin nunca vê a senha definitiva. Ela é guardada **criptografada** (AES-256-GCM, chave derivada do `BETTER_AUTH_SECRET`) na tabela `temp_password`; o login usa apenas o hash scrypt. Enquanto a senha for temporária, a API responde `403 PASSWORD_CHANGE_REQUIRED` para tudo fora de `/api/auth/*`. Sessões são validadas no banco a cada requisição, então suspensão, logout e senha temporária valem na hora.

## Playlists

Ficam no PostgreSQL, ligadas ao usuário que as criou. **Toda** consulta filtra por `user_id` da sessão, então a playlist de outra pessoa é indistinguível de uma inexistente (`404`). Excluir a conta apaga as playlists (FK em cascata). Playlists criadas antes do login (guardadas no navegador) são importadas para a conta no primeiro acesso.

Desenvolvimento com hot reload (Vite em http://localhost:5173, `node --watch` no backend):

```bash
docker compose -f docker-compose.dev.yml up
```

> No modo dev o servidor usa a imagem `node:22-alpine` pura, **sem yt-dlp**. Para streaming do YouTube use o compose principal ou instale o yt-dlp localmente.

## Variáveis de ambiente

| Variável | Uso |
|---|---|
| `APP_URL` | URL pública do app (links de e-mail, OAuth, domínio dos passkeys). |
| `BETTER_AUTH_SECRET` | **Obrigatório.** Assina cookies e tokens. `openssl rand -base64 32`. |
| `POSTGRES_PASSWORD` | **Obrigatório.** Senha do banco. |
| `DOMAIN` / `CLIENT_BIND` | HTTPS com Caddy no VPS (veja acima). |
| `SMTP_URL` / `MAIL_FROM` | Recomendado em produção: verificação de e-mail e recuperação de senha. |
| `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET` | Opcional: login social. |
| `SIGNUP_ENABLED` | `false` fecha o cadastro público. |
| `MB_USER_AGENT` | **Recomendado.** A MusicBrainz exige identificação (`App/versão ( contato )`); UAs genéricos recebem 503 com mais frequência. |
| `YOUTUBE_API_KEY` | Opcional. Busca via Data API v3 (mais precisa). Sem chave — ou com a cota esgotada — usa a busca interna (parse do `ytInitialData`). |
| `JAMENDO_CLIENT_ID` | Opcional. Habilita o fallback Jamendo. |
| `YT_COOKIES` / `YTDLP_COOKIES_FILE` | Opcional. Cookies caso o YouTube exija verificação anti-bot. |
| `SEARCH_LIMIT` | Máximo de resultados (padrão 12). |

## API

Todas as rotas abaixo (exceto `/api/health`, `/api/auth/*` e `/api/auth-config`) exigem sessão.

| Rota | Descrição |
|---|---|
| `/api/auth/*` | Better Auth (sign-up/sign-in, sessões, passkeys, OAuth, reset de senha). |
| `GET /api/auth-config` | Provedores de login habilitados, se a verificação de e-mail está ativa, se o cadastro está aberto. |
| `GET /api/playlists` | Playlists do usuário logado. |
| `POST /api/playlists` | `{ name, track? }` cria uma playlist. |
| `PATCH /api/playlists/:id` · `DELETE /api/playlists/:id` | Renomeia `{ name }` / exclui. |
| `POST /api/playlists/:id/tracks` · `DELETE /api/playlists/:id/tracks/:trackId` | Adiciona `{ track }` / remove uma faixa. |
| `PUT /api/playlists/:id/order` | `{ ids }`: nova ordem das faixas. |
| `POST /api/playlists/import` | `{ playlists }`: importa playlists do navegador. |
| `POST /api/admin/users` | Admin: `{ name, email, role? }` cadastra usuário → `{ user, password }` (senha temporária). |
| `GET /api/admin/users/:id/temp-password` | Admin: senha temporária pendente (404 depois que o usuário a troca). |
| `POST /api/admin/users/:id/temp-password` | Admin: gera nova senha temporária `{ password }`. Demais ações de admin: `/api/auth/admin/*`. |
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
