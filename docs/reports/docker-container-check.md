# Проверка production-образа в Docker

Дата: 2026-11-09. Образ собран из ветки `master` командой `docker build -t xmltopdf:check .`.

## Что проверено

| Проверка | Результат |
|---|---|
| Сборка образа (node:24-bookworm-slim, npm ci, tsc, prune, Chromium) | успешно, образ 1.98 GB |
| Запуск как в `compose.yaml`: `--read-only`, `tmpfs /tmp`, non-root | uid 10001, контейнер стартует |
| `GET /health/ready` | 200 |
| Конвертация ТОРГ-2 (пример из задачи) | 201, 4 страницы, `business: passed`, `warnings: []`, 281 мс |
| Конвертация УПД (`test/fixtures/upd-schfdop.xml`) | 201, 2 страницы, `passed`, 242 мс |
| Chromium в контейнере | `/ms-playwright/chromium-1248`, работает без `--no-sandbox` |
| Node | v24.22.2 |

## Что нужно коллеге

1. `.env` в корне проекта (в образ не попадает — исключён `.dockerignore`) с `API_KEYS=<key>:<owner>`;
   без него сервис не стартует: `API_KEYS is required`.
2. `docker compose up --build` — соберёт образ и поднимет сервис на `127.0.0.1:3000`.
3. Swagger в production выключен (`DOCS_ENABLED` по умолчанию `false` при `NODE_ENV=production`);
   включается переменной `DOCS_ENABLED=true`.

## Команды проверки без compose

```bash
docker build -t xmltopdf:local .
docker run --rm -p 127.0.0.1:3000:3000 \
  --read-only --tmpfs /tmp:size=256m --shm-size 256m \
  -e NODE_ENV=production -e API_KEYS=test:owner \
  -e RESOURCE_DIR=/app/resources -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  xmltopdf:local
curl -fsS http://127.0.0.1:3000/health/ready
```
