# Sound — Music Discovery & Streaming Player

Busque qualquer música e ouça na hora. A busca e o áudio vêm do **YouTube** (via proxy); faixas antigas do **Jamendo** e do **Internet Archive** salvas em playlists continuam tocando.

```
React (Vite + Tailwind + Zustand)  ──/api──▶  nginx  ──▶  Express
                                                          ├─ /api/auth      (Better Auth: sessões, passkeys, OAuth)
                                                          ├─ /api/playlists (por usuário, PostgreSQL)
                                                          ├─ YouTube      (busca: Data API v3 ou busca interna)
                                                          ├─ Jamendo / Internet Archive (só stream de faixas já salvas)
                                                          └─ /api/stream  (yt-dlp, HTTP Range)
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

### Num subcaminho, atrás de um nginx já existente (ex.: https://seudominio.com/sound)

Quando o servidor já tem um nginx com Certbot nas portas 80/443, não use o perfil `https` (o Caddy
disputaria as portas). O nginx do host repassa `/sound/` **sem cortar o
prefixo**:

```ini
APP_URL=https://seudominio.com/sound
BASE_PATH=/sound          # tem que bater com o caminho do APP_URL (vai para o build do front)
CLIENT_BIND=127.0.0.1
CLIENT_PORT=3100        # qualquer porta livre no servidor
```

```nginx
location = /sound { return 301 /sound/; }
location /sound/ {
    proxy_pass http://127.0.0.1:3100;        # sem barra no fim: repassa /sound/... inteiro
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off; proxy_request_buffering off;
    proxy_read_timeout 1h; proxy_send_timeout 1h;
}
```

Atualizar: copie o código para o servidor e rode `docker compose up -d --build` na pasta dele.

### Deploy automático (GitHub Actions)

`.github/workflows/deploy.yml` valida o build a cada push/PR e, na `main`, entra no servidor por
SSH e roda `scripts/deploy.sh` (atualiza o clone para o commit do push, reconstrói com
`docker compose up -d --build --wait` e confere o `/api/health`). Para configurar:

1. No servidor, a pasta do app precisa ser um clone do repositório (`.env` e `secrets/` ficam fora do git).
2. Gere uma chave só para o deploy (`ssh-keygen -t ed25519 -N "" -f deploy_key`) e adicione a
   pública ao `authorized_keys` **presa ao script** — ela não abre shell:
   ```
   restrict,command="/caminho/do/app/scripts/deploy.sh" ssh-ed25519 AAAA… github-actions-deploy
   ```
3. Secrets do repositório: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PORT` (opcional),
   `DEPLOY_SSH_KEY` (privada) e `DEPLOY_KNOWN_HOSTS` (`ssh-keyscan -H <host>`).

Deploy manual no servidor: `./scripts/deploy.sh` (última `main`) ou `./scripts/deploy.sh <sha>`.

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
| `BASE_PATH` | Subcaminho do app (ex.: `/sound`); vazio = raiz. Precisa bater com o caminho do `APP_URL`. |
| `SMTP_URL` / `MAIL_FROM` | Recomendado em produção: verificação de e-mail e recuperação de senha. |
| `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET` | Opcional: login social. |
| `SIGNUP_ENABLED` | `false` fecha o cadastro público. |
| `MB_USER_AGENT` | Recomendado. User-Agent (`App/versão ( contato )`) enviado ao LRCLIB (letras). |
| `YOUTUBE_API_KEY` | Opcional. Busca via Data API v3 (mais precisa). Sem chave — ou com a cota esgotada — usa a busca interna (parse do `ytInitialData`). |
| `JAMENDO_CLIENT_ID` | Opcional. Necessário só para tocar faixas do Jamendo já salvas em playlists. |
| `YTDLP_COOKIES_FILE` | Opcional. Arquivo de cookies (formato Netscape) caso o YouTube exija verificação anti-bot. |
| `YTDLP_WORKERS` | Opcional. Processos permanentes do yt-dlp (padrão 2; `0` = só a linha de comando). |

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
| `GET /api/search?q=` | Vídeos na ordem do próprio YouTube (30 s a 20 min; `/api/search/youtube` é alias antigo): `{ id, kind: 'video', title, artist (canal), thumbnail, duration, views, source, streamUrl }[]`. |
| `GET /api/stream/:videoId` | Áudio do YouTube (`audioonly`/`highestaudio`), com suporte a `Range` (seek). |
| `GET /api/stream/jamendo/:id` | Proxy do MP3 do Jamendo. |
| `GET /api/stream/archive/:identifier/*` | Proxy de arquivo do Internet Archive. |

Falhas de stream (vídeo privado, removido, bloqueado por região, restrição de idade, anti-bot) retornam **502** com JSON:

```json
{ "error": "VIDEO_PRIVATE", "message": "O vídeo é privado.", "videoId": "...", "tryNext": true }
```

O frontend lê essa mensagem, mostra um aviso e pula para a próxima faixa da fila.

## Decisões de arquitetura

- **yt-dlp sempre aberto.** O áudio do YouTube é resolvido pelo **yt-dlp** (instalado na imagem, usando o Node como runtime JS). Ele fica aberto em processos permanentes (`ytdlp_worker.py`, ~1,2 s por música em vez de ~3 s abrindo um processo a cada vez), com a linha de comando como reserva se nenhum estiver livre ou se um cair. O `ytdl-core` (`@distube/ytdl-core`) foi removido: o repositório foi arquivado em ago/2025 e ele falhava sempre. Quando o YouTube mudar de novo, atualize com `docker compose build --no-cache server`.
- **Seek de verdade.** O proxy repassa `Range`/`Content-Range`, então a seekbar funciona sem baixar a faixa inteira.
- **Mesma origem.** O nginx serve o app e faz proxy de `/api` (com `proxy_buffering off`), o que evita CORS no `<audio>` e permite que o `AnalyserNode` leia as amostras para o visualizador.
- **Busca só no YouTube.** Havia também uma busca no catálogo MusicBrainz (gravação → vídeo casado por pontuação), removida porque trazia versões erradas com frequência; a ordem do próprio YouTube acerta mais.
- **Cache** (`node-cache`, em memória): resultados de busca 1h, info de stream 4h. Prefetch das 4 primeiras faixas a cada busca, para o primeiro play ser imediato.

## Resultados

Os vídeos aparecem como o YouTube mostra (clipes, uploads, versões), sem Shorts nem compilações longas. Next/Previous seguem a lista em que o play foi dado.

## Atalhos

`Espaço` play/pause · `←/→` ±5s · `Shift+←/→` anterior/próxima · teclas de mídia (Media Session API).

## Aviso legal

Extrair áudio do YouTube viola os Termos de Serviço do YouTube. Use apenas para fins pessoais/educacionais e respeite os direitos autorais.
