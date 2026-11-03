# XML → PDF: печатное представление формализованных документов

Сервис принимает исходный XML бинарным телом HTTP-запроса, определяет поддерживаемый формат, проверяет его
по закреплённой полной XSD, формирует человекочитаемый PDF и отдаёт ссылку на неизменяемый артефакт.
PDF — самостоятельный файл, подготовленный к **внешней отсоединённой электронной подписи**.

Сервис **не подписывает** документы, не хранит ключи и не проверяет подписи. Он не печатает утверждения
«подписано», номера сертификатов или штампы оператора: таких данных в XML нет, а без проверки подписи
их нельзя утверждать.

## Состояние реализации

| Семейство | Титул | Версия | XSD | Статус |
| --- | --- | --- | --- | --- |
| ТОРГ-2 | 0, покупатель | 5.01 / torg2_05_01_01 | `DP_PRIRASXPRIN_1_994_01_05_01_04.xsd` | **реализован**, проверен на образце заказчика |
| ТОРГ-2 | 1, дополнительные сведения продавца | 5.01 | `DP_PRIRASXDOP_1_994_02_05_01_01.xsd` | **реализован**, синтетический fixture по XSD; ссылка на файл покупателя, итоги приёмки, подписанты |
| УПД | 0, продавец | 5.03 / utd970_05_03_01 | `ON_NSCHFDOPPR_1_997_01_05_03_05.xsd` | **реализован** для функций `СЧФ`, `ДОП`, `СЧФДОП`, `СвРК`, `СвЗК` (для `СвРК`/`СвЗК` — структурная печать, нормативно не утверждена) |
| УПД | 1, покупатель | 5.03 | `ON_NSCHFDOPPOK_1_997_02_05_03_01.xsd` | **реализован**, обезличенный fixture; ссылка на файл продавца, приёмка, код итога, подписанты |

`GET /api/v1/formats` возвращает только реально поддерживаемые титулы и функции
(`supportedFunctions`). Сейчас реализованы все четыре строки матрицы: ТОРГ-2 титулы 0 и 1, УПД титулы 0 и 1
(для УПД — функции `СЧФ`, `ДОП`, `СЧФДОП`, `СвРК`, `СвЗК`). Подробно — `docs/compliance-matrix.md`.

Для УПД печатный смысл определяется `Документ/@Функция`: `СЧФ` печатается как счёт-фактура, `ДОП` — как
документ об отгрузке (без титула счёта-фактуры), `СЧФДОП` — как УПД с обоими разделами. Если у `СЧФ`
встречается `СвПродПер`, данные отгрузки не попадают в счёт-фактуру, а выводятся в приложении с
предупреждением.

## Быстрый старт (Docker)

```bash
cp .env.example .env          # при необходимости замените API_KEYS и PUBLIC_BASE_URL
docker compose up --build -d
curl -fsS http://localhost:3000/health/ready
```

Образ проверен: контейнер работает non-root, Chromium запускается с включённым sandbox, readiness
проверяет `xmllint`, схемы, шрифты и renderer; в контейнере сконвертированы все четыре титула (ТОРГ-2 0/1,
УПД 0/1), а повторное скачивание после `docker restart` возвращает те же байты.

Конвертация образца:

```bash
curl --fail-with-body \
  -H 'X-API-Key: local-test-key' \
  -H 'Content-Type: application/octet-stream' \
  -H 'Accept: application/json' \
  --data-binary @test/fixtures/torg2.xml \
  http://localhost:3000/api/v1/conversions > conversion.json

node -e "console.log(require('./conversion.json').downloadUrl)"
curl -OJ "$(node -e "process.stdout.write(require('./conversion.json').downloadUrl)")"
```

Для УПД:

```bash
curl --fail-with-body \
  -H 'X-API-Key: local-test-key' \
  -H 'Content-Type: application/octet-stream' \
  --data-binary @test/fixtures/upd-schfdop.xml \
  http://localhost:3000/api/v1/conversions > upd.json
```

Swagger UI: <http://localhost:3000/docs>, машинный контракт: <http://localhost:3000/openapi.json>.
Нажмите **Authorize** и введите ключ из `API_KEYS` — дальше ключ подставляется автоматически.
Swagger умеет отправлять бинарное тело: выберите файл XML в `POST /api/v1/conversions`.

Контейнер работает под non-root, Chromium запускается без `--no-sandbox`, сеть для renderer запрещена.

## Локальный запуск без Docker

Требования: Node.js ≥ 22.12, `xmllint` (libxml2-utils), Chromium для Playwright, `poppler-utils` —
только для проверки извлечённого текста в тестах.

```bash
npm ci
PLAYWRIGHT_BROWSERS_PATH=./.playwright-browsers npx playwright install chromium
cp .env.example .env
npm run build
npm start
```

`xmllint` должен быть в `PATH`: без него `/health/ready` возвращает 503, а конвертация — 503
`VALIDATION_UNAVAILABLE`. На macOS: `brew install libxml2`.

## API

| Метод | Путь | Назначение |
| --- | --- | --- |
| POST | `/api/v1/conversions` | Конвертация; тело — XML-байты; тип документа определяется по XML/КНД; ответ JSON с `downloadUrl` |
| GET | `/api/v1/conversions/:artifactId` | Метаданные и новая короткоживущая ссылка (владелец) |
| GET | `/api/v1/downloads/:token` | Точные сохранённые байты PDF по capability-token |
| GET | `/api/v1/formats` | Реализованные форматы, ревизии XSD, лимиты, подписной профиль |
| GET | `/health/live`, `/health/ready` | Liveness и readiness |

Тип документа определяется автоматически: `Файл/@ВерсФорм` → `Документ/@КНД` → для УПД
`Документ/@Функция`. Параметра выбора типа нет; устаревший `?documentType=…` игнорируется.
Определённый титул проверяется по закреплённой XSD.

Заголовки конвертации: `X-API-Key`, `Content-Type: application/octet-stream | application/xml | text/xml`,
необязательный `Idempotency-Key` (≤ 128 символов).

Идемпотентность: тот же ключ и те же байты → тот же `artifactId` и тот же PDF; тот же ключ с другим
XML → `409 IDEMPOTENCY_CONFLICT`; без заголовка каждый запрос создаёт новый артефакт.
Подробный контракт, коды ошибок и лимиты — [`docs/api.md`](docs/api.md).

Ответ `201` содержит `artifactId`, `sourceSha256`, `pdfSha256`, `pageCount`, `downloadUrl`,
`signingTarget: "pdf"`, `signatureProfile: "external-detached"`, `signatureStatus: "not-provided"`,
`warnings` и версии ресурсов. `pdfSha256` — контроль целостности, а не ГОСТ-подпись.

Скачивание отдаёт `application/pdf`, `Content-Disposition` с безопасным именем, `ETag` = SHA-256,
`Cache-Control: private, no-store`. Токен живёт 15 минут (не дольше артефакта), в базе хранится только
его hash; истёкший и неизвестный токен дают одинаковый 404.

## Конфигурация

Все значения — переменные окружения (см. `.env.example`). Ключевые:

| Переменная | По умолчанию | Смысл |
| --- | --- | --- |
| `API_KEYS` | — (обязательна) | `key:ownerId,key2:ownerId2`; без ключей сервис не стартует |
| `PUBLIC_BASE_URL` | `http://localhost:3000` | База для ссылок; никогда не берётся из `Host` |
| `DATA_DIR` | `./data` | SQLite, приватные XML/PDF, temp |
| `ARTIFACT_TTL_SECONDS` | `86400` | Срок жизни артефакта |
| `DOWNLOAD_TOKEN_TTL_SECONDS` | `900` | Срок жизни ссылки скачивания |
| `RATE_LIMIT_PER_MINUTE` | `300` | Квота POST-запросов на владельца (0 — отключить) |
| `MAX_BODY_BYTES` | 10 MiB | Лимит исходного тела |
| `MAX_XML_DEPTH` / `MAX_XML_ELEMENTS` / `MAX_GOODS_ROWS` | 64 / 100 000 / 1000 | Лимиты дерева и строк |
| `MAX_PDF_PAGES` | 100 | Лимит страниц результата |
| `MAX_CONCURRENT_RENDERS` / `RENDER_QUEUE_LIMIT` | 2 / 10 | Пул Chromium |
| `DOCS_ENABLED` | `true` вне production | Swagger UI |

## Архитектура

```
src/
  conversions/          HTTP-контракт, оркестрация, ответы
  xml-security/         декодирование кодировок, безопасный SAX-разбор, лимиты
  document-registry/    манифест схем, определение формата по КНД/версии
  validation/           XSD через xmllint, версионированные бизнес-правила
  documents/torg2/      модель, карта полей, покрытие, шаблон
  documents/upd/        УПД 5.03: функции СЧФ/ДОП/СЧФДОП, модель, карта, шаблон
  rendering/            Chromium pool, проверка готового PDF
  artifacts/            SQLite (WAL), атомарные файлы, токены, TTL, идемпотентность
  access/               API key → principal
  health/               readiness по хранилищу, схемам, xmllint, шрифтам, renderer
resources/
  schemas/              закреплённые XSD + SHA-256 в manifests/schemas.json
  dictionaries/         русские подписи полей, извлечённые из XSD
  fonts/                PT Sans (OFL), встраивается в PDF
```

Поток: бинарное тело → декодирование по XML-правилам → SAX-разбор с запретом DTD/PI/XInclude →
определение формата по корню, `ВерсФорм` и `КНД` → XSD в subprocess `xmllint --nonet` → бизнес-проверки →
типизированная модель печати с контролем покрытия → HTML/CSS → Chromium → проверка PDF → атомарное
сохранение → ссылка.

Покрытие: каждый непустой атрибут и текст XML получает статус `rendered`, `appendix` или `technical`
(allowlist с объяснением). Непредставленное содержательное значение — ошибка `422 UNMAPPED_DATA`.
Для образца: `appendix = 0`, `unmapped = 0`; к `technical` отнесены только служебные значения
(версия программы, идентификаторы участников ЭДО, код страны адреса) — каждое с пояснением.

## Безопасность

- Кодировки: UTF-8 с/без BOM, windows-1251, UTF-16LE/BE; конфликт BOM и declaration — 400. HTTP charset
  не меняет declaration.
- DTD, объявления сущностей, processing instructions и XInclude запрещены до XSD; внешние сущности
  невозможны, сеть и файловые резолверы не используются.
- `xmllint` запускается массивом аргументов без shell, с `--nonet`, таймаутом и ограничением stderr;
  временный файл создаётся в приватном каталоге и удаляется.
- Chromium: JavaScript выключен, service workers заблокированы, контекст offline, все не-`data:` запросы
  прерываются, `--host-resolver-rules=MAP * ~NOTFOUND`.
- XML/PDF/ФИО/ключи/токены не пишутся в логи; логи содержат requestId, artifactId, версии, размеры,
  длительности.

## Тесты

```bash
npm test                              # 60 тестов: unit + integration (реальный Chromium, реальные XSD)
npm run test:e2e                      # интеграционный набор
./scripts/convert-sample.sh           # прогон образца ТОРГ-2
node scripts/verify-sample.mjs test-output/generated.txt
./scripts/visual-regression.sh        # 11 страниц против Linux-эталонов (нужен Docker-образ)
node scripts/load-test.mjs test/fixtures/upd-schfdop.xml 2 20
```

`npm test` проверяет: кодировки и их конфликты, DTD/PI/XInclude/XXE, лимиты, XSD-валидацию образца,
полный цикл HTTP → PDF → скачивание, одинаковые байты при повторном скачивании, изоляцию владельцев,
идемпотентность, отсутствие подписных утверждений и наличие дисклеймера.

Ручные сценарии (Swagger, четыре образца заказчика, идемпотентность, ошибки, лимиты, перезапуск) —
[`docs/manual-testing.md`](docs/manual-testing.md).

Дополнительно: `test/golden/` — 15 страниц эталонов (ТОРГ-2 0/1, УПД 0/1, все три функции),
`docs/reports/load-test.md` — измерения p50/p95 и поведения очереди на 2 CPU / 2 GiB.

## Ограничения

- Печать ТОРГ-2 сверена с эталоном `all_1-4.pdf`: совпадают шрифты, сетки таблиц, формат чисел,
  пагинация 4/4/5/4 и координаты ключевых элементов. Остаточные отличия — блок условий заканчивается
  на 15–20 pt ниже, у РС-74035 на странице условий две строки вместо одной, в банковских реквизитах
  эталон печатает «р/с … в БАНК», у нас — «р/с …, БАНК». Нормативная приёмка бланка — вне репозитория.
- УПД титул 0 реализован, но нормативная сверка формы счёта-фактуры (в т.ч. изменений с 01.04.2026)
  не завершена; реальные обезличенные образцы УПД не предоставлены.
- Реальные обезличенные образцы вторых титулов (особенно ТОРГ-2 титул 1) не предоставлены; для них
  проверены структура и отсутствие потери полей, но не бизнес-содержание.
- Печать `СвРК`/`СвЗК` реализована как отдельный вариант с функциональным заголовком и дисклеймером
  «не счёт-фактура»; её нормативная форма не утверждена, сведения о комитенте (принципале) печатаются
  только из переданных полей.
- Внешняя подпись не проверялась: см. `docs/signing-compatibility.md`.
- PDF/A не поддерживается; Chromium не гарантирует PDF/A.
- Одна реплика и один SQLite-том; горизонтальное масштабирование потребует PostgreSQL и объектного
  хранилища.

## Документация

- [`docs/api.md`](docs/api.md) — HTTP-контракт: автоопределение типа, идемпотентность, коды ошибок, лимиты.
- [`docs/manual-testing.md`](docs/manual-testing.md) — ручные тест-кейсы и чек-лист приёмки.
- [`docs/reports/torg2-examples-diff.md`](docs/reports/torg2-examples-diff.md) — сверка четырёх образцов
  с `all_1-4.pdf`, координаты и остаточные отличия.
- [`docs/reports/torg2-sample-comparison.md`](docs/reports/torg2-sample-comparison.md) — прогон образца
  и сверка с эталонным PDF.
- [`docs/field-maps/torg2-title0.md`](docs/field-maps/torg2-title0.md) — карта XML → печатная форма ТОРГ-2.
- [`docs/field-maps/upd-title0.md`](docs/field-maps/upd-title0.md) — карта XML → печатная форма УПД.
- [`docs/field-maps/torg2-title1.md`](docs/field-maps/torg2-title1.md) — карта второго титула ТОРГ-2.
- [`docs/field-maps/upd-title1.md`](docs/field-maps/upd-title1.md) — карта титула покупателя УПД.
- [`docs/reports/upd-fixtures.md`](docs/reports/upd-fixtures.md) — прогон синтетических УПД по функциям.
- [`docs/reports/title1-fixtures.md`](docs/reports/title1-fixtures.md) — прогон вторых титулов.
- [`docs/reports/visual-regression.md`](docs/reports/visual-regression.md) — Linux-эталоны страниц.
- [`docs/reports/load-test.md`](docs/reports/load-test.md) — нагрузочный прогон и очередь.
- [`docs/adr/0001-stack-and-pipeline.md`](docs/adr/0001-stack-and-pipeline.md) — выбор стека.
- [`docs/adr/0002-pdf-profile-and-signing.md`](docs/adr/0002-pdf-profile-and-signing.md) — профиль PDF и
  контракт подписи.
- [`docs/compliance-matrix.md`](docs/compliance-matrix.md) — матрица соответствия и статусы.
- [`docs/signing-compatibility.md`](docs/signing-compatibility.md) — что проверено и что нет.
