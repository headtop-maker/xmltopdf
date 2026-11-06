#!/usr/bin/env bash
# Deploy xmltopdf to the shared production host (ats.sine.su).
#
# Why a prebuilt image: the host is a single-vCPU / 2 GiB box that already runs
# ATS, MongoDB, BugRadar and the OCR stack. Running npm ci + apt + a Chromium
# install there would compete for disk and RAM with live services, so the image
# is built locally for linux/amd64 and shipped as an archive.
#
# The HTTPS route is owned by the ats-crm-api Caddyfile (/xmltopdf/*), not by
# this repository. The server-side .env is never touched by this script.
#
# Required: PROD_SSH_HOST. Optional: PROD_SSH_USER (root), PROD_DIR (/opt/xmltopdf),
# IMAGE (xmltopdf:prod), PLATFORM (linux/amd64), PUBLIC_URL.
set -euo pipefail

PROD_SSH_HOST="${PROD_SSH_HOST:?Set PROD_SSH_HOST (for example ats.sine.su)}"
PROD_SSH_USER="${PROD_SSH_USER:-root}"
PROD_DIR="${PROD_DIR:-/opt/xmltopdf}"
IMAGE="${IMAGE:-xmltopdf:prod}"
PLATFORM="${PLATFORM:-linux/amd64}"
PUBLIC_URL="${PUBLIC_URL:-https://ats.sine.su/xmltopdf}"

REMOTE="${PROD_SSH_USER}@${PROD_SSH_HOST}"
ARCHIVE="$(mktemp -t xmltopdf-image).tar.gz"
trap 'rm -f "$ARCHIVE"' EXIT

echo "① Собираю образ ${IMAGE} для ${PLATFORM}…"
docker buildx build --platform "$PLATFORM" --load -t "$IMAGE" .

echo "② Упаковываю и передаю образ…"
docker save "$IMAGE" | gzip -1 > "$ARCHIVE"
scp -C "$ARCHIVE" "${REMOTE}:/tmp/xmltopdf-image.tar.gz"
ssh "$REMOTE" 'docker load -i /tmp/xmltopdf-image.tar.gz && rm -f /tmp/xmltopdf-image.tar.gz'

echo "③ Обновляю compose-файл…"
ssh "$REMOTE" "mkdir -p '${PROD_DIR}' && test -f '${PROD_DIR}/.env'" || {
  echo "На сервере нет ${PROD_DIR}/.env — создайте его по образцу .env.example" >&2
  exit 1
}
scp deploy/compose.prod.yaml "${REMOTE}:${PROD_DIR}/compose.yaml"

echo "④ Поднимаю контейнер…"
ssh "$REMOTE" "cd '${PROD_DIR}' && docker compose up -d && docker compose ps"

echo "⑤ Проверяю readiness через публичный адрес…"
for attempt in 1 2 3 4 5 6; do
  if curl -fsS --max-time 10 "${PUBLIC_URL}/health/ready" >/dev/null; then
    echo "ok: ${PUBLIC_URL}/health/ready"
    break
  fi
  if [ "$attempt" = 6 ]; then
    echo "readiness не ответил за ~60 c — смотрите docker compose logs" >&2
    exit 1
  fi
  sleep 10
done
