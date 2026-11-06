# Тестовые данные

В репозитории остались только файлы, на которых реально работают автотесты и визуальная сверка.
Ручные артефакты приёмки (PDF, XLSX, выгрузки СБИС, скриншоты) удалены; как их получить заново —
ниже.

## Что лежит в `test/fixtures`

Всего 10 файлов, ~156 КБ, все в Git.

| Файл | Что проверяет |
| --- | --- |
| `torg2.xml` | ТОРГ-2 титул покупателя: конвертация, кэш, квоты, визуальная регрессия |
| `torg2-title1.xml` | ТОРГ-2 титул продавца (доп. сведения) |
| `upd-schf.xml` | УПД `СЧФ` — только счёт-фактура |
| `upd-dop.xml` | УПД `ДОП` — только документ об отгрузке |
| `upd-schfdop.xml` | УПД `СЧФДОП` — оба раздела, бланк Saby |
| `upd-svrk.xml` | УПД `СвРК` — отчёт комиссионера о реализации |
| `upd-svzk.xml` | УПД `СвЗК` — отчёт о закупке |
| `upd-title1.xml` | УПД титул покупателя (КНД 1115132) |
| `torg2-reference.pdf` | Эталон вёрстки ТОРГ-2 от заказчика (Saby), не побайтовая цель |
| `provenance.json` | Происхождение, SHA-256 и кодировка каждого файла |

Почему не один файл: каждый XML проходит отдельную ветку адаптера (титул, функция УПД, второй
титул). Один образец не покрывает ни `СвРК`/`СвЗК`, ни портретные вторые титулы.

Файлы `torg2.xml` и `upd-schfdop.xml` — канонические: их используют быстрый старт, нагрузочный
скрипт и ручные кейсы.

## Что удалено из корня

Это были результаты ручных прогонов, а не источник данных:

- PDF: `all_ours*.pdf`, `torg2-current.pdf`, `torg2-downloads*.pdf`, `torg2-examples-ours.pdf`,
  `torg2-vislib-result.pdf`;
- XLSX: `torg2-current.xlsx`, `torg2-form.xlsx`, `torg2-pdf-visual.xlsx`;
- XML-выгрузки `2eeacbcf-…xml`, `7e4d103e-…xml` (те же образцы, что в `test/fixtures`);
- каталоги `sved-app/` (XSD/XLSX из СБИС), `test-output/`, `demo/`, `vislib13012026/`, `data/`;
- `scripts/make-torg2-form-xlsx.py`.

## Как получить артефакты заново

```bash
# один документ
npm run build && npm start
curl -H 'X-API-Key: local-test-key' -H 'Content-Type: application/octet-stream' \
  --data-binary @test/fixtures/torg2.xml -o conversion.json \
  http://localhost:3000/api/v1/conversions
curl -o torg2.pdf "$(jq -r .downloadUrl conversion.json)"

# все страницы для визуальной сверки (нужен Docker-образ с poppler)
./scripts/visual-regression.sh

# нагрузочный прогон
node scripts/load-test.mjs test/fixtures/upd-schfdop.xml 2 20
```

Результаты этих команд складывайте в `test-output/` (он в `.gitignore`) и не коммитьте.

## Правила

- `test/fixtures` — единственный источник тестовых XML. Не заменяйте файлы «по месту»:
  меняйте `provenance.json` вместе с файлом.
- Реальные документы заказчика не коммитить; синтетика должна быть обезличена.
- Большие бинарные результаты (PDF, XLSX, скриншоты) в репозиторий не добавлять.
