# BASE_PATH: subcaminho onde o app é publicado (ex.: /sound para https://seudominio.com/sound).
# Vazio = raiz do domínio.
ARG BASE_PATH=

# ---- build ----
FROM node:22-alpine AS build
ARG BASE_PATH
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN BASE_PATH=$BASE_PATH npm run build

# ---- serve ----
FROM nginx:1.27-alpine
ARG BASE_PATH
ENV BASE_PATH=$BASE_PATH
# Só ${BASE_PATH} é substituído no template; $host, $uri etc. ficam para o nginx.
ENV NGINX_ENVSUBST_FILTER=^BASE_PATH$
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html${BASE_PATH}
EXPOSE 80
