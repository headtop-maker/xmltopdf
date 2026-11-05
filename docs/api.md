# HTTP API

Контракт сервиса «XML → PDF». Машинная версия: `GET /openapi.json`, интерактивная — `GET /docs`.
Swagger UI: нажмите **Authorize**, введите `X-API-Key` (локально `local-test-key`), затем выполняйте
запросы — ключ подставляется автоматически.

Все защищённые методы требуют заголовок `X-API-Key`. Без него — `401 UNAUTHORIZED`.

## POST /api/v1/conversions

Конвертирует XML в PDF. Тело запроса — **сырые байты XML**, не multipart и не JSON.

| Заголовок | Обязателен | Значение |
| --- | --- | --- |
| `X-API-Key` | да | ключ владельца |
| `Content-Type` | да | `application/octet-stream`, `application/xml` или `text/xml` |

Тип документа **определяется автоматически** по содержимому XML:

1. `Файл/@ВерсФорм` — версия формата;
2. `Документ/@КНД` — титул (например, 1175014 — ТОРГ-2 покупателя, 1175015 — ТОРГ-2 доп. сведения,
   1115131 — УПД);
3. для УПД — `Документ/@Функция` (`СЧФ`, `ДОП`, `СЧФДОП`, `СвРК`, `СвЗК`).

Параметра выбора типа нет: подсказки `documentType` больше не существует, старые запросы с ним
игнорируют этот параметр. Определённый титул проверяется по закреплённой XSD; несовпадение или
неподдерживаемая функция — `422`.

Ответ `201`:

```json
{
  "artifactId": "03366aff-0296-4941-8dc7-c8883cf99680",
  "status": "ready",
  "document": {
    "family": "Torg2",
    "formatVersion": "5.01",
    "operatorVersion": "torg2_05_01_01",
    "titleIndex": 0,
    "function": null,
    "workflowFunction": null,
    "knd": "1175014"
  },
  "validation": {
    "xsd": "valid",
    "schemaRevision": "DP_PRIRASXPRIN_1_994_01_05_01_04",
    "schemaSha256": "6139596b…",
    "businessRulesVersion": "torg2-business-v1",
    "business": "passed-with-warnings",
    "unmappedCount": 0
  },
  "sourceSha256": "…",
  "pdfSha256": "856cad0b…",
  "pdfSizeBytes": 125631,
  "pageCount": 4,
  "templateVersion": "torg2-title0-v1",
  "signingTarget": "pdf",
  "signatureProfile": "external-detached",
  "signatureStatus": "not-provided",
  "downloadUrl": "http://localhost:3000/api/v1/downloads/…",
  "createdAt": "2026-11-03T…",
  "expiresAt": "2026-11-04T…",
  "warnings": []
}
```

`pdfSha256` — хеш ровно тех байтов, которые дальше подписываются внешней системой. Это контроль
целостности, а не электронная подпись.

### Повторная отправка

Отдельного ключа идемпотентности нет: дедупликация выполняется по содержимому.

| Ситуация | Результат |
| --- | --- |
| Те же байты XML и те же параметры печати | `201`, тот же `artifactId` и тот же PDF |
| Другой XML или другая версия шаблона | `201`, новый артефакт |
| Запрос с теми же байтами ещё выполняется | оба запроса получают один `artifactId` |

Повторное использование действует, пока жив артефакт (по умолчанию 24 часа). После истечения TTL
повторная отправка создаёт новый артефакт. Неизвестные заголовки, включая прежний `Idempotency-Key`,
игнорируются.

## GET /api/v1/conversions/:artifactId

Метаданные артефакта и новая короткоживущая ссылка. Доступно только владельцу ключа.
Чужой артефакт и несуществующий дают одинаковый `404`.

## GET /api/v1/downloads/:token

Отдаёт сохранённые байты PDF по capability-token.

- `Content-Type: application/pdf`;
- `ETag` = SHA-256 файла;
- `Cache-Control: private, no-store`;
- токен живёт 15 минут, в базе хранится только его хеш;
- истёкший и неизвестный токен неразличимы (`404`).

## GET /api/v1/formats

Справочник возможностей: реализованные титулы, ревизии и SHA-256 XSD, версии шаблонов и бизнес-правил,
подписной профиль, лимиты. Используется для проверки развёртывания и построения списка поддерживаемых
документов. Подробнее — раздел «Зачем» в `README.md`.

## GET /health/live, GET /health/ready

`live` — процесс жив. `ready` — проверяет SQLite, `xmllint`, закреплённые XSD, шрифты и Chromium.
`ready` возвращает `503`, если конвертация сейчас невозможна.

## Ошибки

| Код | HTTP | Когда |
| --- | --- | --- |
| `UNAUTHORIZED` | 401 | нет или неизвестен `X-API-Key` |
| `EMPTY_BODY` | 400 | пустое тело |
| `MALFORMED_XML` | 400 | XML не well-formed |
| `INVALID_ENCODING` | 400 | конфликт BOM и declaration, неизвестная кодировка |
| `UNSAFE_XML` | 400 | DTD, PI, XInclude, внешние сущности |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | тело не XML |
| `XML_LIMIT_EXCEEDED` | 413 | превышен размер тела, глубина, число элементов или строк |
| `XSD_VALIDATION_FAILED` | 422 | документ не прошёл XSD |
| `UNSUPPORTED_TITLE` | 422 | КНД/версия не поддержаны |
| `UNSUPPORTED_FUNCTION` | 422 | функция УПД отсутствует или не печатается |
| `BUSINESS_VALIDATION_FAILED` | 422 | нарушены бизнес-правила |
| `UNMAPPED_DATA` | 422 | содержательное значение XML некуда вывести |
| `AMBIGUOUS_DOCUMENT_TYPE` | 409 | XML подходит под несколько титулов |
| `TOO_MANY_REQUESTS` | 429 | превышена квота (`Retry-After`) |
| `STORAGE_UNAVAILABLE` | 503 | недоступно хранилище |
| `VALIDATION_UNAVAILABLE` | 503 | нет `xmllint` или схем |
| `RENDERER_BUSY` | 503 | очередь Chromium переполнена (`Retry-After`) |
| `CONVERSION_TIMEOUT` | 504 | превышен дедлайн конвертации |

Формат ошибки: `{ "statusCode": 422, "code": "XSD_VALIDATION_FAILED", "message": "…", "details": [...] }`,
в ответе есть `requestId` для поиска в логах.

## Лимиты

Значения по умолчанию (меняются переменными окружения, актуальные — в `GET /api/v1/formats`):

| Лимит | Значение |
| --- | --- |
| тело запроса | 10 MiB |
| XML после декодирования | 30 MiB |
| элементов / глубина | 100 000 / 64 |
| товарных строк | 1000 |
| страниц PDF | 100 |
| размер PDF | 50 MiB |
| артефакт | 24 часа |
| ссылка скачивания | 15 минут |
| запросов в минуту | 300 |

## Пример

```bash
curl --fail-with-body \
  -H 'X-API-Key: local-test-key' \
  -H 'Content-Type: application/octet-stream' \
  --data-binary @test/fixtures/torg2.xml \
  http://localhost:3000/api/v1/conversions > conversion.json

curl -OJ "$(python3 -c "import json;print(json.load(open('conversion.json'))['downloadUrl'])")"
```
