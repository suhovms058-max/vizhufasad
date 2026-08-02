# API заявок ВИЖУФАСАД

Express API принимает одно изображение JPG/PNG/WEBP до 15 МБ, проверяет его через Sharp и, при настройке провайдера, через мультимодальную AI-модель. Заказ и исходное фото сохраняются локально; уведомления отправляются в MAX и Mail.ru.

## Запуск и проверки

```bash
cp .env.example .env
npm ci
npm run check
npm test
npm run db:setup
npm run smoke:infra
npm start
```

```bash
curl -fsS http://127.0.0.1:8080/health/live
curl -fsS http://127.0.0.1:8080/health
```

Требуется Node.js 22+. Интеграционные тесты автоматически пропускаются без настроенных инфраструктурных переменных; `npm run smoke:infra` с заполненным `server/.env` проверяет PostgreSQL, Redis, приватность бакета и скачивание по временной ссылке.

## Конфигурация

Обязательные переменные:

- `SITE_ORIGIN`
- `MAX_BOT_TOKEN`
- `MAX_CHAT_ID`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `LEADS_EMAIL`

Для Yandex AI Studio используются `YANDEX_API_KEY`, `YANDEX_FOLDER_ID` и `YANDEX_MODEL`.
Выбор основного и резервного provider задаётся через `PHOTO_ASSESSMENT_PRIMARY_PROVIDER` и
`PHOTO_ASSESSMENT_FALLBACK_PROVIDER`. Все параметры перечислены в `.env.example`.

`server/.env` хранится только на VPS с правами доступа владельца и не добавляется в Git. `DATA_DIR` должен указывать на каталог с резервным копированием и ограниченным доступом.

Для PostgreSQL, Redis и S3-compatible storage обязательны `DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` и `S3_BUCKET`. Локальные значения приведены в `.env.example`; production-секреты должны поступать из окружения/secret manager.

## Данные и миграции

- ORM: Drizzle, потому что он работает с текущим ESM Node.js без отдельного generated client и хранит обозримые SQL-миграции в Git.
- `npm run db:generate` — создать новую миграцию после изменения схемы.
- `npm run db:check` — проверить согласованность журнала и снимков миграций.
- `npm run db:migrate` — применить неприменённые миграции.
- `npm run db:seed` — идемпотентно синхронизировать effective-dated тарифы и стоимость действий.
- `npm run db:setup` — миграции и seed.
- `npm run migrate:local-orders` — dry run импорта старых JSON-заявок.
- `npm run migrate:local-orders -- --apply` — импортировать метаданные и фотографии, сохранив исходные файлы.

## Реализованные endpoints

- `GET /health/live` — liveness API без внешних проверок
- `GET /health` и `GET /health/ready` — readiness API, PostgreSQL, Redis и storage
- `POST /api/leads`
- `GET /api/orders/:id/status?token=...`

Новый продуктовый путь Standard использует BullMQ и отдельный `npm run start:worker`. API не ждёт
provider, а возвращает `202`; состояние и attempts сохраняются в PostgreSQL. Старый `/api/leads`
остаётся контролируемо deprecated и не участвует в очереди продукта.

## Production

API фактически запускается как отдельный сервис на VPS Timeweb. Репозиторий не содержит systemd unit, reverse-proxy-конфигурацию или автоматический VPS deployment; их состояние требуется сверять непосредственно на сервере перед изменением production.

## Автоматическая проверка фото проекта

Новый путь проектов использует `PHOTO_ASSESSMENT_PRIMARY_PROVIDER` и
`PHOTO_ASSESSMENT_FALLBACK_PROVIDER`. `auto` выбирает настроенный Yandex и затем OpenAI.
`npm run smoke:photo-assessment` проверяет сохранение результатов, retry/fallback и неизменность
кошелька при полном сбое provider. Ручной ветки решения нет.

## Кошелёк и тарифы

`npm run db:seed` создаёт версионированный каталог тарифов и стоимости действий.
`npm run smoke:wallet` проверяет bonus/reserve/commit/refund и защиту от двойного списания.
Экран `/app/balance` и API `/api/wallet`/`/api/catalog` требуют сессию. Платёжных маршрутов нет.

Feature flags перечислены в `.env.example`. `FEATURE_PAYMENTS_ENABLED` обязан оставаться `false` до
отдельного этапа подключения payment provider.

## Очередь и worker

```powershell
npm run start:api
# отдельный терминал или production service
npm run start:worker
```

Проверка без платного GenAPI: `npm run smoke:queue`. Параметры concurrency, attempts, backoff,
stalled lock, watchdog и приоритетов перечислены в `.env.example`. Операционная инструкция:
[`../docs/STAGE_8_GENERATION_QUEUE.md`](../docs/STAGE_8_GENERATION_QUEUE.md).
