# Graphify: граф кода репозитория

[Graphify](https://docs.graphify.com/) строит граф символов и связей (вызовы, импорты, наследование)
и отдаёт его агенту через CLI или MCP. Граф детерминированный: узлы и рёбра извлекаются парсером,
без модели; каждое ребро помечено `EXTRACTED` или `INFERRED`.

Зачем это здесь: перед изменением `ConversionsService.convert` или `ArtifactsService` можно
за один запрос получить вызывающих, зависимости и затронутые тесты, не читая файлы подряд.

## Что уже собрано

```
graphify-out/graph.json     883 узла, 2268 рёбер, 50 сообществ
graphify-out/GRAPH_REPORT.md
graphify-out/graph.html     интерактивная визуализация
```

Снимок соответствует коммиту `HEAD`. Незакоммиченные правки в граф не попадают — после
изменений кода выполняйте обновление.

## Установка

Пакет PyPI называется `graphifyy` (две `y`), команда — `graphify`.
Локальная установка в репозиторий, чтобы DSH мог запускать MCP-сервер по абсолютному пути:

```bash
export UV_TOOL_DIR="$PWD/.graphify/tools"
export UV_TOOL_BIN_DIR="$PWD/.graphify/bin"
uv tool install "graphifyy[mcp]"
```

`.graphify/` и `graphify-out/` исключены из Git.

## Сборка и обновление

```bash
npm run graph:build     # полная пересборка (AST, без LLM)
npm run graph:update    # инкрементально после правок кода
npm run graph:report    # пересобрать GRAPH_REPORT.md и graph.html без LLM-меток
```

Полная пересборка на этом репозитории занимает секунды: 108 файлов кода, `--code-only`
пропускает документы и изображения.

## MCP-сервер

`graphify-mcp` читает `graphify-out/graph.json` и отдаёт 10 инструментов:

| Инструмент | Назначение |
| --- | --- |
| `query_graph` | подграф по вопросу, `depth` 1–6, `token_budget` |
| `get_node`, `get_neighbors` | символ и его связи |
| `get_community` | все узлы сообщества |
| `god_nodes` | самые связанные узлы |
| `graph_stats` | счётчики и разбивка по уверенности |
| `shortest_path` | путь между символами |
| `list_prs`, `get_pr_impact`, `triage_prs` | PR и их влияние на граф |

Проверка без DSH:

```bash
./.graphify/bin/graphify-mcp graphify-out/graph.json
# JSON-RPC initialize → tools/list
```

### Подключение к DSH

В `~/.dsh/profiles/desktop/cordis.patch.yml` добавлен второй экземпляр штатного MCP-клиента:

```yaml
- insert:
    - name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: graphify
        transport: stdio
        command: /Users/admin/Documents/native/xmltopdf/.graphify/bin/graphify-mcp
        args:
          - /Users/admin/Documents/native/xmltopdf/graphify-out/graph.json
        failOnStartupError: false
```

После правки конфига инструменты `mcp__graphify__*` появляются в сессии; на этой машине
изменение применилось без перезапуска приложения. Резервная копия конфига:
`cordis.patch.yml.bak-graphify-*`.

## Примеры

```bash
export PATH="$PWD/.graphify/bin:$PATH"

graphify god-nodes --top 10
graphify explain "ConversionsService.convert" --all
graphify affected "ArtifactsService.findIdempotent" --depth 2
graphify path "ConversionsController.create" "ArtifactsService.findIdempotent"
graphify query "artifact cache rendering" --budget 1500
```

Через MCP те же вопросы задаются инструментами `mcp__graphify__*`; например
`query_graph(question="artifact cache rendering", depth=2, token_budget=1500)`.

## Ограничения

- Граф отражает только код: XML, XSD, PDF и документация в него не входят.
- DI-связи NestJS (`@Injectable`, провайдеры модуля) и динамические вызовы могут не резолвиться:
  ребро `create → convert` помечено `INFERRED`, а не `EXTRACTED`.
- Пустой список вызывающих не доказывает, что символ не используется.
- Граф — снимок коммита; перед выводами о текущей ветке сверяйтесь с рабочим деревом.
- `graphify install` ставит skill для Claude Code; для DSH он не нужен.
