# Этап 5: автоматическая проверка исходной фотографии

## Назначение

Модуль проверяет, подходит ли технически обработанная фотография для автоматической визуализации фасада.
Он не предлагает дизайн, материалы или строительные решения и не создаёт ветку ожидания человека.

Допустимы только три итоговых решения:

- `accepted` — фото подходит;
- `accepted_with_warning` — фото подходит, но пользователь видит необязательные рекомендации;
- `retake_required` — нужно другое фото с конкретными инструкциями.

`accepted` и `accepted_with_warning` переводят проект в `configuration_required`.
`retake_required` переводит его в `photo_retake_required`.

## Архитектура

`server/src/photo-assessment` разделён на независимые части:

- `technical.mjs` — Sharp-метрики;
- `schema.mjs` — строгий provider response contract;
- `prompt.mjs` — immutable prompt и версия;
- `providers.mjs` — одинаковый interface для Yandex AI Studio и OpenAI Responses API;
- `orchestrator.mjs` — timeout, ограниченный retry и fallback;
- `policy.mjs` — детерминированные пороги и пользовательские рекомендации;
- `repository.mjs` — assessment и каждая provider-попытка в PostgreSQL;
- `service.mjs` — owner-only retry и подключение к проекту.

Провайдер не принимает итоговое решение. Он возвращает только структурированные наблюдения: тип сцены,
видимость дома и фасада, полноту кадра, геометрию, препятствия, перспективу, резкость, освещение,
обрезку крыши, confidence и ограниченный список issue codes.

Ответ дополнительно валидируется Ajv с `additionalProperties: false`. Свободный текст provider в базу не
записывается.

## Пороги

Версия policy: `facade-photo-policy-v1`.

- confidence ниже `0.60` блокирует фото;
- confidence от `0.60` до `0.82` даёт warning, если нет блокирующих признаков;
- major crop, плохая геометрия/перспектива/резкость/освещение, крупное препятствие, интерьер, скриншот,
  несколько домов или невидимый фасад требуют пересъёмки;
- minor crop, умеренный угол, небольшие препятствия, допустимые проблемы резкости/света и разрешение ниже
  рекомендуемого дают warning;
- технический минимум остаётся 640×420, рекомендация — от 1200×800.

Рекомендации пользователю формируются детерминированным словарём, поэтому provider не может создать
ручную ветку сопровождения.

## Надёжность

Основной provider вызывается максимум два раза. Повторяется только transient failure: timeout, network,
HTTP 408/409/429/5xx или невалидный structured output. После этого выполняется одна попытка другого
настроенного provider.

Если все вызовы неуспешны:

- assessment получает `provider_unavailable`;
- проект остаётся в `photo_validation_queued`;
- `source_images` остаётся `ready`;
- S3-объекты не удаляются;
- кошелёк и `wallet_transactions` не изменяются;
- пользователь может повторить только автоматическую проверку.

Каждая попытка записывается в `photo_assessment_attempts` без prompt, изображения, ключей и полного
provider response. Финальный `photo_assessments.technical_result` хранится отдельно от `user_result`.

## Версии

- prompt: `facade-photo-assessment-v1`;
- schema: `facade-photo-observation-v1`;
- policy: `facade-photo-policy-v1`;
- model и provider сохраняются в каждой завершённой оценке.

Изменение prompt, schema или policy требует новой версии и прогона категорийного набора.

## API

- `GET /api/projects/:projectId/images/:imageId/assessment`
- `POST /api/projects/:projectId/images/:imageId/assessment/retry`

Оба маршрута требуют действующую серверную сессию и проверяют владельца проекта.

## Тестовый набор

`server/test/fixtures/photo-assessment-cases.json` содержит категории: хороший фасад, угол, низкое
разрешение, деревья, обрезанная крыша, ночь, интерьер, несколько домов, скриншот и размытие.

Unit tests проверяют policy, strict schema, Sharp-метрики и provider request contract. Integration smoke
проверяет PostgreSQL, retry/fallback, раздельные результаты, сохранность фотографии и нулевое изменение
кредитов при сбое.

## Production

Нужно настроить минимум один provider:

```dotenv
PHOTO_ASSESSMENT_PRIMARY_PROVIDER=auto
PHOTO_ASSESSMENT_FALLBACK_PROVIDER=auto
PHOTO_ASSESSMENT_TIMEOUT_MS=45000
PHOTO_ASSESSMENT_PRIMARY_ATTEMPTS=2
PHOTO_ASSESSMENT_RETRY_DELAY_MS=500
```

`auto` выбирает Yandex при наличии `YANDEX_API_KEY` и `YANDEX_FOLDER_ID`, затем OpenAI при наличии
`OPENAI_API_KEY`. В production запуск без основного provider отклоняется. Ключи запрещено коммитить.

Контракт сверялся с официальной документацией:

- [OpenAI Models](https://developers.openai.com/api/docs/models) — image input и Responses API;
- [OpenAI GPT-4o](https://developers.openai.com/api/docs/models/gpt-4o) — image input и Structured Outputs;
- [Yandex AI Studio Responses API](https://yandex.cloud/en/docs/ai-studio/responses/cancelResponse) —
  `TextResponseFormatJsonSchema` и `strict`.
