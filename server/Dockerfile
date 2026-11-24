FROM node:22-alpine

# yt-dlp: resolve o áudio do YouTube (processos permanentes em services/ytdlp_worker.py).
# Sem versão fixa de propósito. Esta é só a versão de partida: o servidor confere o PyPI e instala
# as novas sozinho no volume /data/ytdlp (services/ytdlpUpdate.js). YTDLP_VERSION fixa uma versão
# (build arg; útil para testar a atualização a partir de uma versão antiga).
ARG YTDLP_VERSION=""
RUN apk add --no-cache python3 py3-pip \
 && pip install --no-cache-dir --break-system-packages "yt-dlp[default]${YTDLP_VERSION:+==$YTDLP_VERSION}" \
 && yt-dlp --version

# Versões do yt-dlp instaladas pela atualização automática (volume; do usuário node).
RUN mkdir -p /data/ytdlp && chown node:node /data/ytdlp

WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
CMD ["node", "index.js"]
