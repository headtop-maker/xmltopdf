# HTTP API

Контракт сервиса «XML → PDF». Машинная версия: `GET /openapi.json`, интерактивная — `GET /docs`.
Swagger UI: нажмите **Authorize**, введите `X-API-Key` со значением из `API_KEYS` (в окружении — `$API_KEY`).

Все защищённые методы требуют `X-API-Key`. Без него — `401 UNAUTHORIZED`. Скачивание по токену
ключ не требует: токен сам является правом доступа.

Сервис не хранит файлы: PDF рендерится в памяти, живёт в LRU-кэше и отдаётся по короткоживущей
ссылке. Ни XML, ни PDF не пишутся на диск и не переживают рестарт процесса.

## POST /api/v1/conversions

Тело — **сырые байты XML**, не multipart и не JSON.

| Заголовок | Обязателен | Значение |
| --- | --- | --- |
| `X-API-Key` | да | ключ владельца |
| `Content-Type` | да | `application/octet-stream`, `application/xml` или `text/xml` |

Тип документа определяется автоматически: `Файл/@ВерсФорм` → `Документ/@КНД` → для УПД
`Документ/@Функция` (`СЧФ`, `ДОП`, `СЧФДОП`, `СвРК`, `СвЗК`). Титул проверяется по закреплённой XSD.
Статус печатного бланка УПД не является отдельным атрибутом XML и выводится из функции: `1` для
`СЧФДОП`, `2` для `ДОП`.

### Ответ `201`

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
    "schemaSha256": "6139596b…6084",
    "businessRulesVersion": "torg2-business-v1",
    "business": "passed",
    "unmappedCount": 0
  },
  "sourceSha256": "3e3edc1f…37e9",
  "pdfSha256": "2c7c5c56…55cc",
  "pdfSizeBytes": 121864,
  "pageCount": 4,
  "templateVersion": "torg2-title0-v1",
  "signingTarget": "pdf",
  "signatureProfile": "external-detached",
  "signatureStatus": "not-provided",
  "downloadUrl": "http://localhost:3000/api/v1/downloads/Gb5-PuuApHMG4iTOdKud8fxnQa_RkX2iGsXdSzv8pn8",
  "createdAt": "2026-11-06T07:36:04.000Z",
  "expiresAt": "2026-11-06T07:51:04.000Z",
  "warnings": [],
  "cached": false
}
```

`pdfSha256` — контроль целостности и байты для подписи, не ГОСТ-подпись.

## GET /api/v1/downloads/:token

Отдаёт точные байты PDF по capability-token из памяти.

- `Content-Type: application/pdf`, `Content-Length`;
- `Content-Disposition: attachment; filename="torg2-<pdfSha8>.pdf"`;
- `ETag` = `X-Pdf-Sha256` = SHA-256 тела;
- `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`;
- неизвестный, истёкший, вытесненный из кэша или потерянный при рестарте токен — одинаковый `404`.

## Повторная отправка и кэш

- Те же байты XML и параметры печати → тот же `artifactId`, `pdfSha256` и байты, `cached: true`.
- Другой XML → новый артефакт и другой `pdfSha256`.
- Отдельного `Idempotency-Key` нет.
- Кэш живёт в памяти процесса (`CACHE_TTL_SECONDS`), ссылка — `DOWNLOAD_TOKEN_TTL_SECONDS`;
  после рестарта обе величины теряются.
- PDF детерминирован: повторный рендер тех же байтов даёт тот же `pdfSha256`.

## GET /health/live, GET /health/ready

`ready` проверяет кэш, `xmllint`, закреплённые XSD, шрифты и Chromium; при недоступности — `503`.

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
| `VALIDATION_UNAVAILABLE` | 503 | нет `xmllint` или схем |
| `RENDERER_BUSY` | 503 | очередь Chromium переполнена (`Retry-After`) |
| `CONVERSION_TIMEOUT` | 504 | превышен дедлайн конвертации |

Формат ошибки: `{ "statusCode": 422, "code": "XSD_VALIDATION_FAILED", "message": "…", "details": [...] }`,
в ответе есть `requestId`.

## Лимиты

| Лимит | Значение |
| --- | --- |
| тело запроса | 10 MiB |
| XML после декодирования | 30 MiB |
| элементов / глубина | 100 000 / 64 |
| товарных строк | 1000 |
| страниц PDF | 100 |
| размер PDF | 50 MiB |
| кэш PDF | 900 с / 64 MiB |
| ссылка скачивания | 900 с |
| запросов в минуту | 300 |
