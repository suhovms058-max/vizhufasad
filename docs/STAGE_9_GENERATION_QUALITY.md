# Этап 9: автоматический контроль качества генерации

## Гарантия выдачи

Публичная ссылка создаётся только для generation со статусом `completed`, а этот статус устанавливается только после сохранённой оценки `passed`. Кандидаты с решениями `retry_required` и `rejected_refund` лежат под приватными diagnostic keys и не попадают в owner result API.

Ручного решения, оператора и маршрута override нет. Admin endpoint предназначен только для диагностики версий, баллов и причин.

## Комбинация сигналов

`GenerationQualityAssessment` версии `generation-quality-assessment-v1` содержит независимые сигналы:

1. VLM: тот же дом, этажность, крыша, окна, двери, балконы/террасы, положение, перспектива, артефакты и соответствие стилю.
2. Контуры: двустороннее совпадение сильных границ с допуском в несколько пикселей.
3. Spatial layout: распределение плотности границ по сетке 4×4.
4. Protected zones: отдельные чувствительные сектора крыши, окон, дверей, объёма и положения дома.

Цвет и материал фасада не участвуют в одной общей pixel similarity. Локальная часть работает по яркостным границам, поэтому смена отделки не должна автоматически отклонять результат. Итог вычисляется серверной политикой `facade-quality-policy-v1`; VLM не принимает финальное решение самостоятельно.

Официальные контракты, на которых основана реализация:

- [Yandex AI Studio Responses API и JSON Schema](https://yandex.cloud/en/docs/ai-studio/responses/cancelResponse);
- [Yandex Qwen 3.6 как мультимодальная модель с Responses API](https://yandex.cloud/en/blog/digest-april-2026);
- [Sharp raw pixel output](https://sharp.pixelplumbing.com/api-output/);
- [Sharp grayscale и colour operations](https://sharp.pixelplumbing.com/api-colour/).

## Разрешённые изменения

Снимок `config_snapshot.preserve` преобразуется в `allowed_changes`. Если пользователь явно разрешил менять крышу, окна, двери, этажность, перспективу или положение, соответствующий критерий исключается из блокирующего набора. Проверки «тот же дом», артефактов и соответствия выбранному стилю остаются обязательными. Автоматически добавленное ограждение на уже существующей опасной площадке не считается новой террасой.

## Жизненный цикл и деньги

1. Worker сохраняет candidate №1 в приватный S3 и создаёт assessment №1.
2. `passed` — копирует проверенный candidate в `standard.jpg`, фиксирует один reserve и ставит `completed`.
3. `retry_required` — сохраняет причины, усиливает prompt и создаёт candidate №2. Второго списания или reserve нет.
4. `rejected_refund` — не публикует candidate, ставит `failed_refunded` и вызывает прежний idempotent refund key `generation:<id>:refund`.
5. Сбой VLM является техническим: candidate остаётся в S3, очередь повторяет QC с bounded retry/fallback. Он не расходует quality retry как плохой результат.

База и уникальные ограничения запрещают assessment №3. Два candidate generation attempts различаются `candidate_number` 1/2 и остаются связаны с оценками.

## Провайдеры и РФ

`GENERATION_QUALITY_PRIMARY_PROVIDER=auto` выбирает настроенный Yandex AI Studio первым, затем OpenAI только при наличии его ключа. При включённой Standard-генерации конфигурация без QC или без VLM отклоняется при старте. Ответ стороннего сервиса всегда проверяется strict JSON Schema через Ajv.

Production требует:

```dotenv
GENERATION_QUALITY_ENABLED=true
GENERATION_QUALITY_PRIMARY_PROVIDER=yandex
YANDEX_API_KEY=...
YANDEX_FOLDER_ID=...
GENERATION_QUALITY_YANDEX_MODEL=qwen3.6-35b-a3b
```

Секреты находятся только в `server/.env` или secret manager и не коммитятся.

## Пороги

Все пороги задаются в basis points 0–10000:

- `GENERATION_QUALITY_MIN_OVERALL`;
- `GENERATION_QUALITY_MIN_SAME_HOUSE`;
- `GENERATION_QUALITY_MIN_PROTECTED_ELEMENT`;
- `GENERATION_QUALITY_MIN_CONTOURS`;
- `GENERATION_QUALITY_MIN_SPATIAL_LAYOUT`;
- `GENERATION_QUALITY_MIN_PROTECTED_ZONES`;
- `GENERATION_QUALITY_MIN_ARTIFACTS`;
- `GENERATION_QUALITY_MIN_STYLE`.

Менять их следует версионированно после regression и закрытого набора реальных фасадов, а не под один проблемный заказ.

## Диагностика и retention

По умолчанию diagnostic candidate и подробные VLM/structural результаты хранятся 72 часа. Команда удаления объекта и редактирования подробностей БД:

```powershell
cd server
npm run cleanup:generation-quality
```

Её следует запускать не реже одного раза в час. `GENERATION_QUALITY_ADMIN_TOKEN` длиной не менее 24 символов включает read-only `GET /internal/generation/quality/:generationId`. Ссылка на candidate подписывается на `GENERATION_QUALITY_DIAGNOSTIC_URL_TTL_SECONDS`; токен и S3 key пользователю не выдаются.

Метрики `GET /internal/generation/metrics` дополнены durable counters: `first_pass`, `retry_required`, `retry_passed`, `rejected_refunded`, `refunds`, `average_score`.

## Golden regression

```powershell
cd server
npm run regression:generation-quality
```

Команда без внешних API измеряет детерминированные случаи: только новая отделка, сдвиг дома, изменение крыши, перенос проёма и явно разрешённая смена крыши. Результат записывается в [`GENERATION_QUALITY_REGRESSION.md`](GENERATION_QUALITY_REGRESSION.md). VLM contract/fallback и полный lifecycle покрыты mock/integration tests; реальный credentialed smoke не запускается автоматически и не расходует средства GenAPI.
