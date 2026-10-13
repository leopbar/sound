# Sound — guia obrigatório antes de qualquer alteração

> **Leia este arquivo inteiro antes de mudar qualquer coisa no sistema.** Ele resume o que existe,
> por que foi feito assim e quais invariantes não podem ser quebrados. Detalhes de uso/deploy
> estão no [README.md](README.md). Ao concluir uma mudança relevante, **atualize este arquivo**.

Idioma: o usuário conversa em **português**; textos de UI, mensagens de erro da API,
comentários e README são em português. Mensagens de commit em inglês.

## O que é

Player de música: busca gravações (MusicBrainz) e toca o áudio via proxy (YouTube → fallback
Jamendo / Internet Archive). Desde o commit `143441b` tem **login obrigatório**, **playlists
por usuário no PostgreSQL** e **painel de administração**. Está publicado num
VPS (Docker Compose num subcaminho, atrás do nginx do servidor; ver "Ambiente").

## Arquitetura

```
Navegador ──▶ nginx já existente no servidor (subcaminho)  — ou Caddy (perfil "https")
          ──▶ nginx (client/, serve o build do React e faz proxy de {base}/api)
          ──▶ Express (server/, porta 4000) ──▶ PostgreSQL 17 (volume pgdata)
```

### Subcaminho (`BASE_PATH`)
O app roda na raiz (local, `:8088`) **ou** num subcaminho (ex.: `https://seudominio.com/sound`).
- O caminho vem do `APP_URL` (servidor: `config.basePath`, rotas em `${basePath}/api`) e do build
  arg `BASE_PATH` (cliente: `base` do Vite; arquivos em `html/<BASE_PATH>/`). **Os dois têm que bater.**
- Front: nunca escreva `/api/...`, `/icons/...` ou `'/'` direto; use `client/src/lib/base.js`
  (`API_BASE`, `APP_BASE`, `appPath()`). `manifest.webmanifest` usa URLs relativas; `sw.js` deriva
  a base do próprio escopo.
- `streamUrl` das faixas fica salva **relativa** (`/api/stream/...`); o cliente prefixa `API_BASE`.
- `client/nginx.conf.template`: o nginx oficial aplica `envsubst` só em `BASE_PATH`
  (`NGINX_ENVSUBST_FILTER`). Não escreva `${BASE_PATH}` em comentários do template.
- Better Auth: `baseURL = ${APP_URL}/api/auth` (o roteador dele usa o pathname dessa URL).
  Cookies com `cookiePrefix: 'sound'` (o domínio pode hospedar outros apps).
- Healthcheck do Docker: `/api/health` sempre existe na raiz, além de `${basePath}/api/health`.

- **client/**: React 18 + Vite 6 + Tailwind 3 + Zustand 5. Sem router: `App.jsx` alterna views
  (`search | playlists | admin | account`) por estado.
- **server/**: Express 4, **CommonJS**. Better Auth é ESM-only, mas carrega via `require()`
  (Node ≥ 22.12 tem require(esm)); a imagem usa `node:22-alpine`. Não converta para ESM sem motivo.
- Tudo é **mesma origem** (`/api` via nginx em prod, proxy do Vite em dev): cookies first-party,
  sem CORS para o `<audio>`, Web Audio API funciona.

### Arquivos-chave do backend
| Arquivo | Papel |
|---|---|
| `server/auth.js` | Configuração **única** do Better Auth (plugins, sessão, rate limit, hooks). |
| `server/config.js` | Variáveis de ambiente. Em produção exige `BETTER_AUTH_SECRET` ≥ 32 chars. |
| `server/db.js` | `pg.Pool` + helper `transaction(fn)`. |
| `server/migrate.js` | Roda na subida: `getMigrations` do Better Auth + `CREATE TABLE IF NOT EXISTS` das tabelas do app. Também roda isolado (`node migrate.js`). |
| `server/middleware/requireAuth.js` | Sessão obrigatória; 403 `PASSWORD_CHANGE_REQUIRED` se senha temporária. Popula `req.user`/`req.session`. |
| `server/routes/api.js` | `/api/health` público; **tudo abaixo de `router.use(requireAuth)`** (busca e stream). |
| `server/services/lyrics.js` | Letras via LRCLIB (sem chave): `/api/get` exato (com duração) → `/api/search` com pontuação. O `/get` responde **503** quando não acha: tratado como "sem correspondência". Limpa título/canal de faixas da aba YouTube (`kind=video`). Cache 24h (inclusive "não encontrada"). Rota `GET /api/lyrics` (atrás do `requireAuth`). |
| `server/services/translate.js` | Tradução das letras para pt-BR pelo endpoint público do Google Tradutor (`translate_a/single?client=gtx`, sem chave, POST). Traduz a letra inteira numa chamada (o Google preserva as quebras de linha; se a contagem não bater, traduz linha a linha). Blocos de até 4000 caracteres, cache 7 dias por hash do texto, retentativas em 429/5xx. **Não use `config.userAgent`** (o UA do MusicBrainz leva 429 e mandaria o contato ao Google). Letra já em português ⇒ `same: true`. Rota `POST /api/lyrics/translation` `{ lines }` (atrás do `requireAuth`). |
| `server/services/streamService.js` | Proxy de áudio (YouTube via ytdl-core → yt-dlp; Jamendo/Archive). Toda resposta do axios em stream passa por `keepOpen()`: o follow-redirects deixa um timeout de inatividade no socket que **cortava a música** quando o `<audio>` parava de ler (buffer cheio, tela bloqueada). Queda no meio do download **não** invalida a URL em cache (só falha antes dos cabeçalhos). Não use a URL remota como id em erro/log (a do Jamendo pode levar a chave). |
| `server/routes/api.js` → `POST /api/client-log` | Diário do player enviado pelo aparelho (pausas com motivo, erros, quedas de rede, retomadas, tela bloqueada). Só imprime `[client] u=<8 chars do id> <data> <evento> chave=valor` no log (lista fechada de eventos, valores saneados, repetidos descartados). Para diagnosticar o celular: `docker compose logs server \| grep '\[client\]'`. |
| `server/routes/playlists.js` | CRUD de playlists do usuário logado. |
| `server/routes/admin.js` | Rotas de admin próprias (cadastro, senha temporária). Checa `req.user.role === 'admin'`. |
| `server/lib/tempPassword.js` | Gera/aplica/criptografa/lê/limpa senhas temporárias. |
| `server/lib/mailer.js` | Nodemailer via `SMTP_URL`; sem SMTP, imprime links no log. |
| `server/scripts/create-admin.js` | Cria ou recupera admin com senha temporária. |
| `server/index.js` | Ordem de montagem importa: `app.all('/api/auth/*', toNodeHandler(auth))` vem **antes** de qualquer `express.json()`. |

### Arquivos-chave do frontend
| Arquivo | Papel |
|---|---|
| `client/src/lib/authClient.js` | `createAuthClient` (plugins passkey, admin, inferAdditionalFields) + tradução de códigos de erro para PT. |
| `client/src/lib/api.js` | `request()` com `credentials: 'include'`; 401/403 disparam `authClient.$store.notify('$sessionSignal')` (refaz o `useSession`). `playlistsApi`, `adminApi`. |
| `client/src/App.jsx` | Gate: sem sessão → `AuthScreen`; `mustChangePassword` → `ForcePasswordChange`; senão `Player` (montado com `key={user.id}`). |
| `client/src/components/AuthScreen.jsx` | Login, cadastro, passkey (inclui autofill condicional), social, esqueci/redefinir senha. |
| `client/src/components/AccountView.jsx` | Perfil, passkeys, troca de senha, sessões ativas, excluir conta. |
| `client/src/components/AdminView.jsx` | Painel admin (só aparece para `role === 'admin'`). |
| `client/src/components/AddToPlaylist.jsx` | Botão "+" (menu: playlists existentes + criar nova). Variantes `card` (canto do card, aparece no hover) e `bar` (PlayerBar, menu abre para cima). Se a faixa já está em alguma playlist vira **✓** em destaque (no card fica sempre visível); o menu continua abrindo para adicionar a outras. |
| `client/src/lib/useSortable.js` | Reordenação por arrasto **sem HTML5 drag-and-drop** (não funciona no toque): mouse arrasta a linha; toque = segurar ~350 ms ou arrastar pela alça (`touch-action: none`). `touchmove` não passivo bloqueia a rolagem durante o arrasto; rola sozinho perto das bordas/PlayerBar (`[data-player-bar]`). |
| `client/src/lib/pwa.js` | Instalação como app: captura `beforeinstallprompt` cedo (store Zustand), detecta iOS/standalone, registra `/sw.js` (só em produção). Botão em `components/InstallButton.jsx` (nav; no iOS mostra instruções). |
| `client/src/store/lyricsStore.js` + `components/LyricsPanel.jsx` | Letra carregada quando a faixa **começa a tocar** (efeito no `PlayerBar`). Painel em tela cheia atrás da PlayerBar: linha atual destacada (LRC), clique numa linha faz seek; rolagem automática pausa 4 s após rolagem manual. O painel **abre sozinho** a cada faixa nova que começa a tocar; pausar/retomar não o reabre. **Tradução**: botão no cabeçalho do painel (só com letra em texto), desligado por padrão e lembrado em `localStorage['sound:lyricsTranslate']`; a tradução só é buscada com ele ligado (uma vez por faixa, `translation[trackId]`) e aparece em letra menor sob cada linha (sincronizada ou simples). Letra em português desabilita o botão. |
| `client/src/lib/beatGrid.js` + `lib/beatWorker.js` + `components/Dancer.jsx` + `components/dancers.jsx` + `store/dancerStore.js` | Dançarino: personagem SVG (gato, sapo, pinguim, robô, boneco) que dança no ritmo. **Sincronia por grade pré-calculada**: com o dançarino ligado, a faixa é baixada de novo (`fetch` do `/api/stream`), decodificada a 22.050 Hz mono e analisada num Web Worker com `@audio/beat-track` (Ellis, programação dinâmica; BPM limitado a 70–160; +46 ms = meio quadro de análise). Validado contra o "Beat This!" (CPJKU): ~98% das batidas a ±70 ms. Grade em cache (memória + `localStorage['sound:beats']`, 40 faixas, deltas em ms). O download da grade só começa com a faixa tocando e o `<audio>` já com o arquivo baixado (ou após 10 s), não é cancelado quando o `Dancer` remonta (troca de layout do painel), só por outra faixa ou ao desligar (`cancelBeatGrid`). O `Dancer` lê `audio.currentTime − (outputLatency + baseLatency) + 35 ms` (compensa a suavização e o quadro) e acha a batida por busca binária; a pose tem ataque seco na batida. Enquanto a grade não fica pronta (ou se falhar), usa `lib/beatTracker.js` (detecção ao vivo pelo `beatAnalyser` do `audioEngine`), que também fornece a intensidade. O `Dancer` só escreve variáveis CSS (`--bob`, `--armL`…) a cada quadro, **sem re-render do React**. Personagem sorteado por faixa (nunca repete o anterior). Botão próprio na PlayerBar, independente da letra: os dois ligados ⇒ a letra ocupa a área toda e o personagem fica **por cima**, na metade de cima (`pointer-events-none`); a linha atual para 12 px abaixo dele e as já cantadas sobem por trás, quase invisíveis (6%). A rolagem é calculada no `SyncedLyrics` (`[data-lyrics-scroll]`, unidades `cqh`); só um ⇒ tela cheia. Ligado/desligado fica em `localStorage['sound:dancer']`; só a letra abre sozinha. O X/Esc do painel desliga os dois. |
| `client/src/store/playerStore.js` + `hooks/useAudioPlayer.js` | Player. **Rede instável (4G) não é faixa quebrada**: em erro, `probeStream` sonda a rota; sem rede/gateway/429 ou servidor OK ⇒ `recover()` tenta de novo do ponto onde parou (`#t=` no src; 1, 2, 4, 8, 15, 30 s; sem rede espera o `online` sem limite) e mostra aviso; só pula quando o servidor responde JSON de erro (vídeo privado etc.) ou o navegador recusa o formato 2×. Vigia de 30 s em "carregando" (`watchStall`). Ao tocar, pré-resolve a próxima faixa no servidor (`warmStream`). Fila + posição salvas por usuário em `localStorage['sound:player:<userId>']` (e `:pos`) e restauradas pausadas ao abrir; apagadas ao sair/excluir conta (`forgetPlayerState`). Pausa registra quem pediu (`user`, `lockscreen`, senão `system`). Media Session: pular/voltar/arrastar só com a opção da tela Conta → Reprodução (`sound:lockSkip`, desligada por padrão; o Android usa as mesmas ações para tela de bloqueio e fone). Ações do store recebem `via` string: nunca passe o handler direto no `onClick` (o evento viraria `via`). |
| `client/src/lib/playerLog.js` | Fila do diário (`localStorage['sound:playerLog']`, 200 eventos), enviada a cada 10 s/ao esconder/ao fechar/ao voltar a rede, para `POST /api/client-log`. |
| `client/src/store/playlistStore.js` | Playlists vindas do servidor, atualização otimista; em erro, **recarrega do servidor** (não restaura snapshot, por causa de corridas). Importa `localStorage['sound:playlists']` legado no 1º login. |

## PWA (instalável no celular)

- `client/public/manifest.webmanifest` + ícones em `client/public/icons/` (gerados por
  `client/scripts/gen-icons.mjs` a partir de um SVG único: `npm i --no-save sharp && node scripts/gen-icons.mjs`).
- `client/public/sw.js`: cacheia só o casco (navegação rede-primeiro → `/` offline; `/assets/` e
  `/icons/` cache-primeiro). **Nunca intercepte `/api/`** (sessão, playlists e áudio precisam ir
  sempre ao servidor). Ao mudar a estratégia, troque o nome do cache (`sound-shell-vN`).
- nginx: `location = /manifest.webmanifest` define o MIME (o nginx não conhece `.webmanifest`);
  `sw.js` sai com `no-cache` pelo `location /`.
- Instalação só funciona em HTTPS (ou `localhost`); por IP da rede local o Chrome não oferece.
- O painel de navegador interno do app Claude (Electron) não registra service worker; para testar
  use Chrome de verdade (headless via `puppeteer-core` + `Page.getInstallabilityErrors`).
- Tela de bloqueio: `useAudioPlayer` alimenta a Media Session (metadados, play/pause, posição).

## Autenticação (Better Auth 1.7.x, self-hosted)

- **Métodos**: e-mail/senha (mín. 10, máx. 128; scrypt), **passkeys** (`@better-auth/passkey`,
  rpID = hostname do `APP_URL`), Google/GitHub opcionais (só ativam se as chaves existirem no env).
- **Have I Been Pwned**: senhas vazadas são recusadas (falha *fechada* se a API estiver fora).
- **Verificação de e-mail** só é exigida quando `SMTP_URL` está configurado (`mailEnabled`).
- **Sessão**: cookie httpOnly, `SameSite=Lax`, `Secure` quando `APP_URL` é https; 30 dias,
  renovada 1×/dia; `freshAge` 10 min. **`cookieCache` está DESLIGADO de propósito**: a sessão é
  conferida no banco a cada requisição para que logout, banimento, "desconectar dispositivos" e
  senha temporária valham na hora. Não religue sem resolver isso.
- **Rate limit** (Better Auth, memória): sign-in 5/min, sign-up 5/h, reset 5/h etc. IP vem do
  header `x-real-ip`, que o **nginx sobrescreve** (`proxy_set_header X-Real-IP $remote_addr`).
- **CSRF**: checagem de Origin do Better Auth; `trustedOrigins` = `APP_URL` + `CORS_ORIGINS`.
- `GET /api/auth-config` (público) informa ao front os provedores, se há verificação de e-mail e se
  o cadastro está aberto (`SIGNUP_ENABLED`).
- Mensagens de erro do Better Auth chegam em inglês com `code`; traduza em `authClient.js` (`MESSAGES`).

## Admin e senhas temporárias

- Plugin `admin` do Better Auth: colunas `role`, `banned`, `banReason`, `banExpires` em `user` e
  `impersonatedBy` em `session`. Endpoints em `/api/auth/admin/*` (listar, banir, setRole,
  revokeUserSessions, removeUser).
- Campo extra `user.mustChangePassword` (`input: false` → usuário não altera por conta própria).
- Fluxo: admin cria usuário (`POST /api/admin/users`) ou gera nova senha
  (`POST /api/admin/users/:id/temp-password`) → hash scrypt em `account.password` +
  **cópia criptografada (AES-256-GCM, chave HKDF do `BETTER_AUTH_SECRET`)** em `temp_password`
  + `mustChangePassword = true` + sessões apagadas. O admin consulta com
  `GET /api/admin/users/:id/temp-password` até o usuário trocar.
- A troca (`/change-password`, hook `after` em `auth.js`) ou o reset por e-mail (`onPasswordReset`)
  chamam `clearTemporaryPassword` → flag `false` e linha de `temp_password` apagada. O admin
  **nunca** vê a senha definitiva.
- Funções `ctx.internalAdapter.*` do Better Auth exigem contexto de requisição e **falham em
  scripts** ("No auth context found"). Em scripts/rotas próprias use SQL direto + `hashPassword`
  de `better-auth/crypto` (como em `lib/tempPassword.js`).
- Recuperar acesso de admin: `docker compose exec server node scripts/create-admin.js <email> "<nome>"`
  (o e-mail do admin real não fica neste arquivo; está na memória local da sessão).

## Banco de dados

- Tabelas do Better Auth (camelCase, aspas obrigatórias: `"user"`, `"userId"`, `"createdAt"`…):
  `user`, `session`, `account`, `verification`, `passkey`.
- Tabelas do app (snake_case): `playlist (id, user_id → user ON DELETE CASCADE, name 1..60, tracks jsonb, original_order jsonb NULL, …)`
  e `temp_password (user_id PK → user CASCADE, ciphertext, created_at)`.
- Migrações rodam automaticamente na subida do servidor; o log "Database schema mismatch" no
  primeiro boot é esperado (aparece antes da migração).
- Ao adicionar plugin/campo no Better Auth, a migração automática cria as colunas — mas ela
  **recusa** coluna obrigatória sem default em tabela com dados: use `required: false`/`defaultValue`.

## Invariantes de segurança (não quebrar)

1. **Toda** query de playlist filtra por `user_id = req.user.id`; playlist alheia ⇒ **404**
   (indistinguível de inexistente). Usuário não vê playlist de outro — nem admin, por enquanto.
2. Faixas vindas do cliente passam por `cleanTrack` (whitelist de campos; `streamUrl` precisa
   começar com `/api/stream/`; thumbnails só `http(s)`). Limites: 200 playlists/usuário, 1000 faixas/playlist.
3. Mutação de faixas é feita em transação com `SELECT … FOR UPDATE` (`mutateTracks`).
   Reordenação recebe a lista completa de ids (`PUT /:id/order`) e valida que é uma permutação.
   Embaralhar (`POST /:id/shuffle`, no servidor) guarda em `playlist.original_order` a ordem de antes
   do 1º embaralhamento; `POST /:id/restore-order` volta a ela (faixas novas no fim) e zera a coluna.
   O JSON da playlist expõe `shuffled` (botão "Ordem original").
4. Busca e stream exigem sessão. Rotas novas: monte atrás de `requireAuth`.
5. Rotas de admin novas: dentro de `routes/admin.js` (já checa o papel) ou endpoints do plugin.
6. Nunca guarde token/sessão em `localStorage`. Respostas com senha usam `Cache-Control: no-store`.
7. Não exponha a porta do app direto no VPS: `CLIENT_BIND=127.0.0.1` com Caddy na frente
   (senão `X-Forwarded-For` pode ser forjado, pois o nginx confia em redes privadas do Docker).
8. Não troque `BETTER_AUTH_SECRET` em produção: derruba todas as sessões e torna ilegíveis as
   senhas temporárias pendentes.

## Ambiente

- `.env` (não versionado) precisa de `BETTER_AUTH_SECRET` e `POSTGRES_PASSWORD`; o compose
  falha sem eles. Ver `.env.example` para o resto (`APP_URL`, `DOMAIN`, `CLIENT_BIND`, `SMTP_URL`,
  OAuth, `SIGNUP_ENABLED`, chaves de música).
- **Local do usuário**: stack de produção rodando em **http://localhost:8088** (`CLIENT_PORT=8088`,
  `APP_URL=http://localhost:8088` no `.env`). Depois de mudar código: `docker compose up -d --build`.
- **Portas ocupadas na máquina** por outros projetos: 5173 (outro Vite), 55432 e 5432 (outros
  Postgres), 8080, 80 etc. Para testes isolados use outro nome de projeto
  (`docker compose -p soundtest …` com outra `CLIENT_PORT`) e **não derrube o stack `sound`**.
- Dev com hot reload: `docker compose -f docker-compose.dev.yml up` (inclui Postgres; `APP_URL`
  `http://localhost:5173`).
- **Produção**: num subcaminho, atrás de um nginx já existente no servidor (ver README), com
  `SIGNUP_ENABLED=false` (contas novas só pelo painel Admin). Os detalhes operacionais (servidor,
  caminhos, portas) ficam **fora do repositório**, na memória local da sessão.
- **CI/CD** (`.github/workflows/deploy.yml`): push na `main` → job `build` (vite build com
  `BASE_PATH`, `node --check` do servidor) → job `deploy` (SSH com chave exclusiva, presa por
  `restrict,command=` ao `scripts/deploy.sh` do clone no servidor). O script só aceita SHA que
  esteja em `origin/main`, nunca volta versão, usa lock, roda `docker compose up -d --build --wait`
  e confere `{base}/api/health` pelo nginx. **O log do Actions é público**: o script não imprime
  caminhos nem `docker compose logs`. Host/usuário/chave/known_hosts ficam em secrets `DEPLOY_*`.
- **Este repositório é PÚBLICO.** Nunca versione IP/host de servidor, caminhos ou portas internas
  de produção, e-mails ou outros dados pessoais, nem segredos. Confira o diff antes de commitar.
- O servidor de produção hospeda outros sistemas: não mexa em nada que não seja do Sound.
- **YouTube bloqueia IPs de datacenter** ("Sign in to confirm you're not a bot"), tanto ytdl-core
  quanto yt-dlp: em servidor, o stream só funciona com cookies de uma conta Google secundária,
  arquivo Netscape em `./secrets/youtube-cookies.txt` (montado gravável em `/secrets`, porque o
  yt-dlp regrava os cookies renovados; legível só pelo uid 1000) + `YTDLP_COOKIES_FILE` no `.env`.

## Como testar uma mudança

1. `cd client && npx vite build` (pega erro de sintaxe/import).
2. `docker compose up -d --build` e `docker compose logs server`.
3. Fluxos via `curl` precisam do header `Origin: http://localhost:8088` (CSRF) e de cookie jar.
4. Para testar admin sem mexer na conta real, crie um admin descartável com o script
   (`teste-admin@test.dev`), teste e apague-o depois (`DELETE FROM "user" WHERE email = …`).
   Nunca altere a senha/conta do admin real em testes.
5. O rate limit de login (5/min por IP) afeta testes repetidos: espere 1 min ou use outra conta.

## Regras de trabalho com o usuário

- **Nunca** faça `git commit`/`git push` sem autorização explícita a cada vez; **sem** trailer
  `Co-Authored-By` (regra global dele).
- Histórico de commits é direto na `main`.
- Ao terminar testes no navegador interno, pare a reprodução de áudio e feche a aba.
