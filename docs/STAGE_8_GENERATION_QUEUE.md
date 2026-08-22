# Этап 8: асинхронная очередь генераций

## Выбор очереди

Используется BullMQ 5.81.2 поверх Redis. Это поддерживаемая Node.js-очередь с уникальными job ID,
приоритетами, ограниченной конкуренцией, retries/backoff, stalled-job recovery и graceful shutdown.
Redis запускается с AOF (`appendfsync everysec`) и `maxmemory-policy noeviction`.

Официальные рекомендации:

- [production и Redis persistence/noeviction](https://docs.bullmq.io/guide/going-to-production);
- [retries и exponential backoff](https://docs.bullmq.io/guide/retrying-failing-jobs);
- [уникальные job ID](https://docs.bullmq.io/guide/jobs/job-ids);
- [stalled recovery](https://docs.bullmq.io/guide/jobs/stalled);
- [graceful shutdown](https://docs.bullmq.io/guide/workers/graceful-shutdown).

## Процессы

- `npm run start:api` — web/API. Проверяет владельца и входные данные, резервирует один кредит,
  создаёт durable-запись в PostgreSQL и ставит job в Redis. Ответ `202` не ждёт GenAPI.
- `npm run start:worker` — отдельный generation worker. Загружает исходник из S3, вызывает provider,
  проверяет и сохраняет результат, затем фиксирует либо возвращает кредит.

Worker можно масштабировать отдельными процессами. BullMQ lock и условный переход в PostgreSQL не
позволяют двум worker одновременно исполнить одну generation.

## Состояния

| Состояние | Назначение | Допустимое продолжение |
|---|---|---|
| `created` | durable-запись создана | `queued`, `cancelled`, `failed_refunded` |
| `queued` | job находится в Redis | `preprocessing`, `cancelled`, `failed_refunded` |
| `preprocessing` | worker читает и готовит исходник | `generating`, `retrying`, `failed_refunded` |
| `generating` | выполняется provider request | `quality_check_pending`, `retrying`, `failed_refunded` |
| `quality_check_pending` | техническая проверка/запись результата | `completed`, `retrying`, `failed_refunded` |
| `retrying` | ожидается автоматический повтор | `preprocessing`, `cancelled`, `failed_refunded` |
| `completed` | результат готов | терминальное |
| `failed_refunded` | техническая ошибка, резерв возвращён | терминальное |
| `cancelled` | пользователь отменил ожидающую задачу, резерв возвращён | терминальное |

Плохой пользовательский ввод отклоняется до enqueue и не повторяется. Временные provider/network
ошибки повторяются до трёх раз с exponential backoff. Attempts сохраняются в PostgreSQL.

## Восстановление

- job ID равен UUID generation; повторный enqueue не создаёт дубль;
- запись в PostgreSQL создаётся до Redis job, поэтому сбой Redis не теряет задачу;
- watchdog повторно добавляет `queued`/`retrying` записи после восстановления Redis;
- BullMQ возвращает stalled job в очередь; событие синхронизирует статус PostgreSQL;
- heartbeat/watchdog обнаруживает зависшие активные состояния;
- reserve, commit и refund имеют независимые idempotency keys.

## API и UI

- `POST /api/projects/:projectId/generations/standard` — `202`, enqueue;
- `GET /api/projects/:projectId/generations/:generationId` — polling статуса и attempts;
- `POST /api/projects/:projectId/generations/:generationId/cancel` — отмена ожидающей задачи;
- `GET /api/projects/:projectId/generations/:generationId/result-url` — owner-only временная ссылка;
- `/app/projects/:projectId` — polling каждые две секунды без WebSocket.

Этапы UI: анализ, подготовка, генерация, проверка, скачивание.

## Запуск

```powershell
docker compose up -d
cd server
Copy-Item .env.example .env
npm ci
npm run db:migrate
npm run db:seed
```

В первом терминале:

```powershell
npm run start:api
```

Во втором:

```powershell
npm run start:worker
```

Остановка `SIGTERM`/`Ctrl+C` прекращает получение новых jobs и ждёт текущую работу. Production
process manager должен запускать API и worker как разные services с одинаковыми `DATABASE_URL`,
`REDIS_URL` и S3-параметрами.

## Метрики

При непустом `GENERATION_METRICS_TOKEN` доступен
`GET /internal/generation/metrics` с `Authorization: Bearer ...`. Ответ содержит queue depth,
completed/failed/retrying, среднее полное время и среднюю provider latency. Токен и connection
strings не выводятся.

## Проверки

```powershell
npm run check
npm test
npm run db:check
npm run smoke:api
npm run smoke:queue
```

`smoke:queue` использует PostgreSQL и Redis, но не вызывает платный GenAPI.
