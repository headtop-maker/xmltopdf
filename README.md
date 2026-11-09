# XML → PDF: печатное представление формализованных документов

Сервис принимает исходный XML бинарным телом HTTP-запроса, определяет поддерживаемый формат, проверяет его
по закреплённой полной XSD, формирует человекочитаемый PDF и отдаёт его байты в ответе.
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

Реализованы все четыре строки матрицы: ТОРГ-2 титулы 0 и 1, УПД титулы 0 и 1
(для УПД — функции `СЧФ`, `ДОП`, `СЧФДОП`, `СвРК`, `СвЗК`). Отдельного справочника форматов в API нет:
поддерживаемые титулы перечислены здесь и в `docs/compliance-matrix.md`.

Для УПД печатный смысл определяется `Документ/@Функция`: `СЧФ` печатается как счёт-фактура, `ДОП` — как
документ об отгрузке (без титула счёта-фактуры), `СЧФДОП` — как УПД с обоими разделами. Если у `СЧФ`
встречается `СвПродПер`, данные отгрузки не попадают в счёт-фактуру, а выводятся в приложении с
предупреждением. Статус печатной формы — производная от функции: `1` для `СЧФДОП`, `2` для `ДОП`;
отдельного атрибута статуса в XML нет.

### Бланк УПД Saby

Для `СЧФДОП` и `ДОП` используется отдельный бланк по образцу Saby: сетка 16 граф
(ширины 65,2 / 16,5 / 135,0 / 47,2 / 17,3 / 44,2 / 42,9 / 40,6 / 56,9 / 40,7 / 32,0 / 55,5 / 57,2 / 40,3 / 40,7 / 81,0 pt,
итого 813,2 pt), шапка с линиями, итоги и блоки подписей по координатам эталона.
Бланк один и тот же; в поле «Статус» печатается `1` для `СЧФДОП` и `2` для `ДОП`.
Включается переменной `UPD_SABY_LAYOUT=true`; по умолчанию работает универсальный шаблон.

Многостраничная вёрстка:

- таблица продолжается на следующих страницах, шапка повторяется только там, где есть товарные строки;
- строка выше printable-области делится на части: числа печатаются в первой, продолжения помечены
  «Продолжение позиции N», количество, стоимость и НДС считаются один раз;
- завершающая часть разбита на секции (подписи; основание и транспортировка; парные блоки передачи
  и приёмки), каждая переносится отдельно; секция, начинающая новую страницу, получает отступ 14 pt;
- на многостраничных документах печатается колонтитул «УПД № … от …» и «Страница N из M»,
  поле «Документ составлен на N листах» заполняется по фактическому числу страниц (два прохода рендера).

Сверка с эталоном СБИС для `УП-13093`: контрольные позиции и линии — в пределах 1 pt,
подробности в [`docs/reports/upd-13093-alignment.md`](docs/reports/upd-13093-alignment.md).
Проверка вариантов (ООО-продавец, длинные наименования, 40 строк, разные ставки НДС) —
в [`docs/reports/upd-variants-check.md`](docs/reports/upd-variants-check.md).

`DEMO_FILL_BLANKS=true` — только для тестов: заполняет бумажные поля, которых нет в XML
(«Товар получил», «Иные сведения» и т. п.). В production не включается, по умолчанию `false`.

## Быстрый старт (Docker)

```bash
cp .env.example .env          # при необходимости замените API_KEYS
docker compose up --build -d
curl -fsS http://localhost:3000/health/ready
```

Образ проверен: контейнер работает non-root, Chromium запускается с включённым sandbox, readiness
проверяет `xmllint`, схемы, шрифты и renderer; в контейнере сконвертированы все четыре титула (ТОРГ-2 0/1,
УПД 0/1). Контейнер работает без тома данных: PDF не сохраняется на диск.

Проверка production-сборки из ветки (сборка образа, запуск с `--read-only`, health, конвертации)
описана в [`docs/reports/docker-container-check.md`](docs/reports/docker-container-check.md).
Без `.env` с `API_KEYS` сервис не стартует — файл в образ не попадает и передаётся compose-файлом.

## Продакшен

Сервис живёт на общем хосте `ats.sine.su` (`46.23.98.143`) рядом с ATS CRM, BugRadar и UPD OCR.
Каталог на сервере — `/opt/xmltopdf`, наружу открыт только `https://ats.sine.su/xmltopdf/*`:
маршрут объявлен в Caddyfile проекта `ats-crm-api` (`handle_path` срезает префикс), своего порта
на хосте контейнер не публикует и ходит в сеть `ats-crm-api_default`.

Хост — 1 vCPU и ~2 GiB RAM на все сервисы, поэтому образ собирается локально под `linux/amd64`
и передаётся на сервер архивом: `npm ci`, `apt` и установка Chromium на самом хосте не запускаются.
Развёртывание:

```bash
PROD_SSH_HOST=ats.sine.su ./scripts/deploy-prod.sh
```

Скрипт собирает образ, заливает его, обновляет `compose.yaml` и проверяет
`https://ats.sine.su/xmltopdf/health/ready`. Серверный `.env` (с `API_KEYS` и
`PUBLIC_BASE_URL=https://ats.sine.su/xmltopdf`) скрипт не трогает — он создаётся один раз по образцу
`.env.example`. Ресурсы ограничены в `deploy/compose.prod.yaml`: `mem_limit: 1g`, `cpus: 0.8`,
`MAX_CONCURRENT_RENDERS=1`, ротация логов 10m × 3.

Ключ берётся из окружения (значение — из `API_KEYS` в `.env`, файл не коммитится):

```bash
export API_KEY="$(sed -n 's/^API_KEYS=\([^:]*\):.*/\1/p' .env)"
```

Конвертация образца:

```bash
curl --fail-with-body \
  -H "X-API-Key: $API_KEY" \
  -H 'Content-Type: application/octet-stream' \
  --data-binary @test/fixtures/torg2.xml \
  -o conversion.json \
  http://localhost:3000/api/v1/conversions

URL=$(jq -r .downloadUrl conversion.json)
curl --fail-with-body -o torg2.pdf "$URL"
pdfinfo torg2.pdf | grep Pages
jq '{artifactId, pageCount, pdfSha256, expiresAt}' conversion.json
```

Для УПД:

```bash
curl --fail-with-body \
  -H "X-API-Key: $API_KEY" \
  -H 'Content-Type: application/octet-stream' \
  --data-binary @test/fixtures/upd-schfdop.xml \
  -o upd.json \
  http://localhost:3000/api/v1/conversions
curl -o upd.pdf "$(jq -r .downloadUrl upd.json)"
```

Swagger UI: <http://localhost:3000/docs>, машинный контракт: <http://localhost:3000/openapi.json>.
Нажмите **Authorize** и введите ключ из `API_KEYS` — дальше ключ подставляется автоматически.
Swagger умеет отправлять бинарное тело: выберите файл XML в `POST /api/v1/conversions`.

Контейнер работает под non-root, Chromium запускается с включённым sandbox (без флага `--no-sandbox`), сеть для renderer запрещена.

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
| POST | `/api/v1/conversions` | Конвертация; тело — XML-байты; ответ JSON с метаданными и `downloadUrl` |
| GET | `/api/v1/downloads/:token` | PDF по короткоживущей ссылке из in-memory кэша |
| GET | `/health/live`, `/health/ready` | Liveness и readiness |

Тип документа определяется автоматически: `Файл/@ВерсФорм` → `Документ/@КНД` → для УПД
`Документ/@Функция`. Параметра выбора типа нет; устаревший `?documentType=…` игнорируется.
Определённый титул проверяется по закреплённой XSD.

Заголовки конвертации: `X-API-Key` и `Content-Type: application/octet-stream | application/xml | text/xml`.
Других заголовков нет.

Повторная отправка тех же байтов возвращает тот же PDF и то же имя файла: результат дедуплицируется
по содержимому в памяти процесса (`cached: true`). Подробный контракт, коды ошибок и лимиты —
[`docs/api.md`](docs/api.md).

Ответ `201` — JSON: `artifactId`, `sourceSha256`, `pdfSha256`, `pdfSizeBytes`, `pageCount`,
`document`, `validation`, `warnings`, `templateVersion`, `signingTarget: "pdf"`,
`signatureProfile: "external-detached"`, `createdAt`, `expiresAt`, `cached` и `downloadUrl`.

Ссылка ведёт на `GET /api/v1/downloads/{token}` и отдаёт точные байты:
`Content-Type: application/pdf`, `Content-Disposition` с безопасным именем, `ETag` = `pdfSha256`,
`Cache-Control: private, no-store`. Токен живёт `DOWNLOAD_TOKEN_TTL_SECONDS` (15 минут) и не дольше
записи в кэше.

Файлы не сохраняются: PDF и XML существуют только в памяти процесса и в кэше на `CACHE_TTL_SECONDS`.
После рестарта или истечения TTL ссылка даёт `404`, документ нужно запросить заново. Повторная отправка
тех же байтов возвращает тот же `artifactId` и те же байты (`cached: true`).

## Конфигурация

Все значения — переменные окружения (см. `.env.example`). Ключевые:

| Переменная | По умолчанию | Смысл |
| --- | --- | --- |
| `API_KEYS` | — (обязательна) | `key:ownerId,key2:ownerId2`; без ключей сервис не стартует |
| `PUBLIC_BASE_URL` | `http://localhost:3000` | База для `downloadUrl`; не берётся из `Host` |
| `CACHE_TTL_SECONDS` | `900` | Сколько секунд повторный запрос отдаёт PDF из памяти |
| `DOWNLOAD_TOKEN_TTL_SECONDS` | `900` | Срок жизни ссылки скачивания |
| `CACHE_MAX_BYTES` | 64 MiB | Верхняя граница in-memory кэша PDF |
| `RATE_LIMIT_PER_MINUTE` | `300` | Квота POST-запросов на владельца (0 — отключить) |
| `MAX_BODY_BYTES` | 10 MiB | Лимит исходного тела |
| `MAX_XML_DEPTH` / `MAX_XML_ELEMENTS` / `MAX_GOODS_ROWS` | 64 / 100 000 / 1000 | Лимиты дерева и строк |
| `MAX_PDF_PAGES` | 100 | Лимит страниц результата |
| `MAX_CONCURRENT_RENDERS` / `RENDER_QUEUE_LIMIT` | 2 / 10 | Пул Chromium |
| `DOCS_ENABLED` | `true` вне production | Swagger UI |
| `UPD_SABY_LAYOUT` | `false` | Бланк Saby для `СЧФДОП` (статус 1) и `ДОП` (статус 2): сетка 16 граф, многостраничная таблица, секции подписей, колонтитул |
| `DEMO_FILL_BLANKS` | `false` | **Только для проверки вёрстки**: заполняет бумажные строки бланка, которых нет в XML (температура, маркировка, весы, отбор, производитель, станция, дата получения в УПД) |

## Архитектура

```
src/
  conversions/          HTTP-контракт, оркестрация, in-memory кэш PDF
  xml-security/         декодирование кодировок, безопасный SAX-разбор, лимиты
  document-registry/    манифест схем, определение формата по КНД/версии
  validation/           XSD через xmllint, версионированные бизнес-правила
  documents/torg2/      модель, карта полей, покрытие, шаблон
  documents/upd/        УПД 5.03: модель, карта, шаблон; upd-saby — бланк Saby (СЧФДОП/ДОП)
  rendering/            Chromium pool, проверка готового PDF
  access/               API key → principal
  health/               readiness по кэшу, схемам, xmllint, шрифтам, renderer
resources/
  schemas/              закреплённые XSD + SHA-256 в manifests/schemas.json
  dictionaries/         русские подписи полей, извлечённые из XSD
  fonts/                PT Sans (OFL), встраивается в PDF
```

Поток: бинарное тело → декодирование по XML-правилам → SAX-разбор с запретом DTD/PI/XInclude →
определение формата по корню, `ВерсФорм` и `КНД` → XSD в subprocess `xmllint --nonet` → бизнес-проверки →
типизированная модель печати с контролем покрытия → HTML/CSS → Chromium → проверка PDF → ответ байтами
(кэш в памяти, без записи на диск).

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
- XML/PDF/ФИО/ключи/токены не пишутся в логи; логи содержат requestId, семейство, версии, размеры и длительности,
  но не содержимое документа.

## Тесты

```bash
npm test                              # 79 тестов: unit + integration (реальный Chromium, реальные XSD)
npm run test:e2e                      # интеграционный набор
./scripts/convert-sample.sh           # прогон образца ТОРГ-2
node scripts/verify-sample.mjs test-output/generated.txt
./scripts/visual-regression.sh        # 11 страниц против Linux-эталонов (нужен Docker-образ)
node scripts/load-test.mjs test/fixtures/upd-schfdop.xml 2 20
```

`npm test` проверяет: кодировки и их конфликты, DTD/PI/XInclude/XXE, лимиты, XSD-валидацию образца,
полный цикл HTTP → PDF → скачивание, одинаковые байты при повторном скачивании, изоляцию владельцев,
дедупликацию по содержимому, отсутствие подписных утверждений и наличие дисклеймера.

Ручные сценарии (Swagger, четыре образца заказчика, повторная отправка, ошибки, лимиты, перезапуск) —
[`docs/manual-testing.md`](docs/manual-testing.md).

Дополнительно: `test/golden/` — 15 страниц эталонов (ТОРГ-2 0/1, УПД 0/1, все три функции),
`docs/reports/load-test.md` — измерения p50/p95 и поведения очереди на 2 CPU / 2 GiB.

## Граф кода (Graphify)

Дев-инструмент, на работу сервиса не влияет. Строит граф символов и связей по `src/`, `test/` и
`scripts/` — удобно перед изменением ядра: кто вызывает метод, что затронет правка, какие тесты связаны.

```bash
npm run graph:build     # полная пересборка: AST, без LLM
npm run graph:update    # инкрементально после правок кода
npm run graph:report    # отчёт и HTML без LLM-меток
```

Результат — `graphify-out/graph.json`, `GRAPH_REPORT.md`, `graph.html`; каталоги в `.gitignore`.
MCP-сервер `graphify` подключён к DSH, его инструменты (`query_graph`, `get_node`, `shortest_path`,
`god_nodes` и др.) отвечают по графу без чтения файлов подряд. Установка и ограничения —
[`docs/graphify.md`](docs/graphify.md).

## Ограничения

- Печать ТОРГ-2 сверена с эталоном `all_1-4.pdf`: совпадают шрифты, сетки таблиц, формат чисел,
  пагинация 4/4/5/4 и координаты ключевых элементов. Ширины товарной таблицы (20 граф) и таблицы
  расхождений (18 граф) закреплены по границам эталона СБИС, таблицы используют `table-layout: fixed`
  с отдельным `colgroup` на каждую; отклонение границ ≤0,6 pt. Интервалы страниц 3–4 сверены по
  контрольным позициям (допуск 1 pt). Остаточные отличия: в банковских реквизитах эталон печатает
  «р/с … в БАНК», у нас — «р/с …, БАНК»; нормативная приёмка бланка — вне репозитория.
- УПД титул 0: функции `СЧФ`, `ДОП`, `СЧФДОП`, `СвРК`, `СвЗК` печатаются. Бланк Saby для `СЧФДОП`
  (статус 1) и `ДОП` (статус 2) сверен с эталоном СБИС `УП-13093`: контрольные позиции и линии — в
  пределах 1 pt (Tahoma 7 pt, сетка 16 граф по 65,2 … 81,0 pt). Документ многостраничный: шапка
  повторяется только при наличии товарных строк, строка выше страницы делится с пометкой
  «Продолжение позиции N», завершающая часть разбита на секции, на продолжениях печатается
  «Страница N из M», поле «на N листах» считается по факту. Нормативная приёмка формы не выполнялась.
  Бланк включается `UPD_SABY_LAYOUT=true`.
- Реальные обезличенные образцы вторых титулов (особенно ТОРГ-2 титул 1) не предоставлены; для них
  проверены структура и отсутствие потери полей, но не бизнес-содержание.
- Печать `СвРК`/`СвЗК` реализована как отдельный вариант с функциональным заголовком и дисклеймером
  «не счёт-фактура»; её нормативная форма не утверждена, сведения о комитенте (принципале) печатаются
  только из переданных полей.
- Внешняя подпись не проверялась: см. `docs/signing-compatibility.md`.
- PDF/A не поддерживается; Chromium не гарантирует PDF/A.
- Кэш и токены живут в памяти процесса: при нескольких репликах ссылка, выданная одним инстансом,
  не сработает на другом. Горизонтальное масштабирование потребует общего кэша или внешнего хранилища.
- Аудита выданных файлов нет: после рестарта или TTL восстановить PDF по ссылке нельзя, клиент
  должен сохранить байты сам.

## Документация

- [`docs/api.md`](docs/api.md) — HTTP-контракт: автоопределение типа, дедупликация по содержимому, коды ошибок, лимиты.
- [`docs/manual-testing.md`](docs/manual-testing.md) — ручные тест-кейсы сервиса и чек-лист приёмки.
- [`docs/manual-testing-upd.md`](docs/manual-testing-upd.md) — ручной тест-кейс УПД: шапка, таблица, суммы, подписи, запрещённые элементы.
- [`docs/reports/torg2-examples-diff.md`](docs/reports/torg2-examples-diff.md) — сверка четырёх образцов
  с `all_1-4.pdf`, координаты и остаточные отличия.
- [`docs/reports/torg2-sample-comparison.md`](docs/reports/torg2-sample-comparison.md) — прогон образца
  и сверка с эталонным PDF.
- [`docs/field-maps/torg2-title0.md`](docs/field-maps/torg2-title0.md) — карта XML → печатная форма ТОРГ-2.
- [`docs/field-maps/upd-title0.md`](docs/field-maps/upd-title0.md) — карта XML → печатная форма УПД.
- [`docs/field-maps/torg2-title1.md`](docs/field-maps/torg2-title1.md) — карта второго титула ТОРГ-2.
- [`docs/field-maps/upd-title1.md`](docs/field-maps/upd-title1.md) — карта титула покупателя УПД.
- [`docs/reports/upd-fixtures.md`](docs/reports/upd-fixtures.md) — прогон синтетических УПД по функциям.
- [`docs/reports/upd-13093-alignment.md`](docs/reports/upd-13093-alignment.md) — сверка бланка Saby с эталоном
  СБИС `УП-13093`: координаты, допуски, остаточные отличия.
- [`docs/reports/upd-variants-check.md`](docs/reports/upd-variants-check.md) — варианты: ООО-продавец,
  длинные наименования, 40 строк, разные ставки НДС, разбиение строк и секций.
- [`docs/reports/torg2-layout-fixes.md`](docs/reports/torg2-layout-fixes.md) — правки ТОРГ-2: СодСоб,
  ОКПО, две строки комиссии, сетки таблиц по XLSX СБИС, интервалы страниц 3–4.
- [`docs/reports/docker-container-check.md`](docs/reports/docker-container-check.md) — проверка
  production-образа: сборка, запуск non-root, health, конвертации.
- [`docs/reports/upd-saby-layout-draft.md`](docs/reports/upd-saby-layout-draft.md) — исторический черновик
  первого прохода бланка (устарел).
- [`docs/reports/title1-fixtures.md`](docs/reports/title1-fixtures.md) — прогон вторых титулов.
- [`docs/reports/visual-regression.md`](docs/reports/visual-regression.md) — Linux-эталоны страниц.
- [`docs/reports/load-test.md`](docs/reports/load-test.md) — нагрузочный прогон и очередь.
- [`docs/test-data.md`](docs/test-data.md) — какие тестовые XML/PDF лежат в `test/fixtures`, их происхождение и как получить артефакты заново.
- [`docs/graphify.md`](docs/graphify.md) — граф кода репозитория (Graphify CLI и MCP) для анализа зависимостей.
- [`docs/adr/0001-stack-and-pipeline.md`](docs/adr/0001-stack-and-pipeline.md) — выбор стека.
- [`docs/adr/0002-pdf-profile-and-signing.md`](docs/adr/0002-pdf-profile-and-signing.md) — профиль PDF и
  контракт подписи.
- [`docs/adr/0003-stateless-rendering.md`](docs/adr/0003-stateless-rendering.md) — отказ от хранения
  файлов: PDF в in-memory кэше, ссылка с TTL.
- [`docs/compliance-matrix.md`](docs/compliance-matrix.md) — матрица соответствия и статусы.
- [`docs/signing-compatibility.md`](docs/signing-compatibility.md) — что проверено и что нет.
