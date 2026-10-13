FROM node:22-alpine

# yt-dlp: extrator de reserva quando o ytdl-core não acompanha mudanças do YouTube.
# Sem versão fixa de propósito — o YouTube muda com frequência; rebuild para atualizar:
#   docker compose build --no-cache server
RUN apk add --no-cache python3 py3-pip \
 && pip install --no-cache-dir --break-system-packages "yt-dlp[default]" \
 && yt-dlp --version

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
