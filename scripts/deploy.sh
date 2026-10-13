#!/usr/bin/env bash
# Deploy no servidor: atualiza este checkout para um commit da main e reconstrói o stack.
#
# Chamado pelo GitHub Actions (.github/workflows/deploy.yml) via SSH. No servidor, a chave do
# Actions fica presa a este script em authorized_keys (command="…/scripts/deploy.sh",restrict),
# então ela não abre shell: só consegue pedir o deploy de um commit que já está na main.
# O SHA chega em SSH_ORIGINAL_COMMAND; manualmente: ./scripts/deploy.sh [sha]
#
# Variáveis opcionais: DEPLOY_BRANCH (padrão main), COMPOSE_PROJECT_NAME (padrão sound).
# Este repositório é público: nada de caminhos, hosts ou portas do servidor aqui nem no log.
set -euo pipefail

main() {
  cd "$(dirname "$(readlink -f "$0")")/.."
  local branch="${DEPLOY_BRANCH:-main}"
  export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-sound}"

  if [[ "${1:-}" != "--build" ]]; then
    # Só um deploy por vez (pushes seguidos esperam o anterior). O fd 9 passa pelo exec abaixo.
    exec 9>.git/deploy.lock
    flock -w 900 9 || { echo "Outro deploy em andamento há mais de 15 min." >&2; exit 1; }

    local sha="${1:-${SSH_ORIGINAL_COMMAND:-}}"
    sha="${sha##* }"   # aceita "deploy <sha>" ou só "<sha>"

    git fetch --quiet origin "$branch"
    if [[ -z "$sha" ]]; then
      sha="$(git rev-parse "origin/$branch")"
    elif [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
      echo "SHA inválido." >&2; exit 2
    fi
    if ! git merge-base --is-ancestor "$sha" "origin/$branch"; then
      echo "Commit $sha não está em origin/$branch." >&2; exit 2
    fi
    # Um deploy mais novo já passou: não volta a versão.
    if git rev-parse --verify --quiet HEAD >/dev/null \
       && git merge-base --is-ancestor "$sha" HEAD && [[ "$sha" != "$(git rev-parse HEAD)" ]]; then
      echo "HEAD já está à frente de $sha; nada a fazer."; exit 0
    fi

    # .env e secrets/ estão no .gitignore: o reset não toca neles.
    git reset --quiet --hard "$sha"
    echo "Código em $(git log -1 --format='%h %s')"
    # Roda a etapa de build com a versão nova deste script (já com o lock herdado).
    exec "./scripts/deploy.sh" --build
  fi

  echo "Construindo e subindo o stack…"
  docker compose up -d --build --remove-orphans --wait --wait-timeout 180

  # Confere o caminho completo nginx → Express (inclui o BASE_PATH).
  local ok=""
  for _ in $(seq 1 15); do
    if docker compose exec -T client sh -c 'wget -qO- "http://127.0.0.1${BASE_PATH}/api/health"' >/dev/null 2>&1; then
      ok=1; break
    fi
    sleep 2
  done
  if [[ -z "$ok" ]]; then
    echo "Healthcheck falhou." >&2
    # Sem "docker compose logs" aqui: o log do Actions é público e o servidor pode registrar
    # e-mails/links. Consulte os logs direto no servidor.
    docker compose ps --format 'table {{.Service}}\t{{.Status}}' >&2
    exit 1
  fi

  # Remove só as imagens antigas deste projeto (o servidor hospeda outros sistemas).
  docker image prune -f --filter "label=com.docker.compose.project=${COMPOSE_PROJECT_NAME}" >/dev/null || true
  docker compose ps --format 'table {{.Service}}\t{{.Status}}'
  echo "Deploy concluído: $(git log -1 --format='%h %s')"
}

main "$@"
