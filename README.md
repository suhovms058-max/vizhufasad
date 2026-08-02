# ВИЖУФАСАД

Специализированный сервис автоматической визуализации фасада дома по фотографии.

> Визуализация — концепция внешнего вида, а не рабочий строительный проект.

## Текущее состояние

Публичный production пока использует статический Next.js-фронтенд с legacy-формой заявки и
Express API на VPS. В продуктовой ветке уже реализованы PostgreSQL/Redis/S3, passwordless-вход,
проекты, безопасная обработка фото, автоматический assessment, кредитный кошелёк и рабочая
Standard image-to-image генерация. Production-переключение ещё не выполнено; очередь, Pro, 4K,
платежи и редактор отсутствуют.

Подробности:

- [Текущее состояние](docs/CURRENT_STATE.md)
- [Целевая архитектура](docs/TARGET_ARCHITECTURE.md)
- [Дорожная карта](docs/MIGRATION_ROADMAP.md)

## Требования

- Node.js 22
- npm 11 (версия из lock-файла является источником зависимостей)

## Фронтенд

```bash
cp .env.example .env.local
npm ci
npm run typecheck
npm run build
npm run dev
```

`NEXT_PUBLIC_LEADS_API_URL` встраивается в статическую сборку и не должен содержать секретов.

Проверка GitHub Pages export:

```bash
GITHUB_ACTIONS=true \
NEXT_PUBLIC_BASE_PATH=/vizhufasad \
NEXT_PUBLIC_LEADS_API_URL=https://89-23-97-248.sslip.io/api/leads \
npm run build
test -f out/index.html
```

## Сервер

```bash
cd server
cp .env.example .env
npm ci
npm run check
npm test
npm start
```

Проверка после запуска:

```bash
curl -fsS http://127.0.0.1:8080/health
```

Секреты задаются только в `server/.env` на VPS. Этот файл, фотографии и данные заказов запрещено коммитить.

## Локальная инфраструктура данных

Требуются Docker с Compose plugin и Node.js 22+. Скопируйте `.env.example` в `.env`, а `server/.env.example` в `server/.env`. Значения по умолчанию предназначены только для локальной разработки.

```bash
docker compose up -d
cd server
npm ci
npm run db:setup
npm run smoke:infra
npm start
```

`docker compose up -d` одной командой запускает PostgreSQL, Redis и MinIO и создаёт приватный бакет. API сообщает состояние всех зависимостей на `GET /health` и `GET /health/ready`; простой liveness endpoint — `GET /health/live`. Ответы health check не содержат connection strings, логины или ключи.

Drizzle ORM выбран как лёгкий TypeScript/JavaScript ORM поверх PostgreSQL с версионированными SQL-миграциями. Схема находится в `server/src/db/schema.mjs`, а применяемый SQL — в `server/drizzle`. Изменения схемы создаются через `npm run db:generate`, применяются через `npm run db:migrate`.

Стартовые тарифы создаются командой `npm run db:seed` и всегда остаются неактивными. Авторизация, очередь генераций и платежная интеграция на этом этапе не реализованы.

Старые файловые заявки не удаляются и не перезаписываются. Предварительная проверка:

```bash
cd server
npm run migrate:local-orders
```

После проверки резервной копии, `DATABASE_URL` и S3-настроек импорт запускается явно:

```bash
npm run migrate:local-orders -- --apply
```

## Авторизация и кабинет

Passwordless-вход и серверно-защищённый каркас кабинета работают на origin Express API: `/auth/login`, `/auth/verify`, `/app`, `/app/projects`, `/app/settings`. JSON API и полная модель безопасности описаны в [`docs/STAGE_3_AUTH.md`](docs/STAGE_3_AUTH.md).

После изменения схемы:

```bash
cd server
npm run db:migrate
npm test
```

Для локальной разработки задайте уникальный `AUTH_HASH_SECRET` и используйте `AUTH_MAIL_MODE=console`. В production обязательны SMTP, `AUTH_COOKIE_SECURE=true` и HTTPS; небезопасная конфигурация отклоняется при старте.

## Production

- Фронтенд: push в `main` запускает `.github/workflows/deploy-pages.yml`, создаёт static export `out/` и публикует его в GitHub Pages.
- API: отдельный Node.js/Express-процесс на VPS Timeweb; GitHub Actions его не разворачивает.
- Публичный адрес фронтенда: `https://suhovms058-max.github.io/vizhufasad/`.
- Используемый фронтендом API: `https://89-23-97-248.sslip.io/api/leads`.

Изменения этого этапа находятся в отдельной ветке и не должны сливаться в `main` без проверки и явного решения владельца.

## Проекты и безопасная загрузка фотографий

Защищённый продуктовый путь работает на Express-origin:

- `/app` — проекты текущего пользователя;
- `/app/new` — создание проекта и прямая загрузка фото в приватный S3/MinIO;
- `/app/projects/:id` — открытие, переименование, замена фото и удаление проекта;
- `/api/projects` — JSON API с обязательной серверной сессией и проверкой владельца.

Локальный запуск:

```bash
docker compose up -d
cd server
npm ci
npm run db:migrate
npm test
npm start
```

Откройте `http://localhost:8080/auth/login`, войдите по одноразовому коду и перейдите в `/app/new`.
Файл отправляется браузером по короткоживущему presigned URL прямо в приватный бакет. API затем проверяет
магические байты и декодирование, ограничение 25 МБ и 80 млн пикселей, исправляет ориентацию, удаляет EXIF,
переводит изображение в sRGB и создаёт безопасную исходную копию, рабочую копию и миниатюру.

Очистку незавершённых загрузок следует запускать по расписанию не реже одного раза в час:

```bash
cd server
npm run cleanup:images
```

Старый `POST /api/leads` по умолчанию продолжает работать с deprecation-заголовками. После отдельного
production-переключения его можно закрыть через `LEGACY_LEADS_MODE=disabled`; исходные локальные заказы
и фотографии этот переключатель не удаляет. Полный контракт и retention-политика описаны в
[`docs/STAGE_4_PROJECT_IMAGES.md`](docs/STAGE_4_PROJECT_IMAGES.md).

## Автоматическая проверка исходного фото

После технической обработки фотография автоматически проходит assessment без оператора и ручного решения.
Допустимы только `accepted`, `accepted_with_warning` и `retake_required`. Warning не блокирует переход к
настройке фасада. При отказе пользователь получает конкретные рекомендации по пересъёмке.

Новый модуль находится в `server/src/photo-assessment`. Он:

- вычисляет Sharp-метрики разрешения, детализации и освещения;
- запрашивает у vision provider только признаки кадра по strict JSON Schema;
- применяет версионированные пороги в коде, а не доверяет модели итоговое решение;
- выполняет не более двух попыток основного provider и одну попытку fallback;
- хранит технический результат отдельно от пользовательского;
- при полном сбое provider оставляет фотографию `ready`, не меняет кошелёк и разрешает повторить проверку.

Проверка:

```bash
cd server
npm test
npm run smoke:photo-assessment
```

Конфигурация: `PHOTO_ASSESSMENT_PRIMARY_PROVIDER`, `PHOTO_ASSESSMENT_FALLBACK_PROVIDER`,
`PHOTO_ASSESSMENT_TIMEOUT_MS`, `PHOTO_ASSESSMENT_PRIMARY_ATTEMPTS`,
`PHOTO_ASSESSMENT_RETRY_DELAY_MS`, а также provider-specific model и API key. Подробный контракт:
[`docs/STAGE_5_PHOTO_ASSESSMENT.md`](docs/STAGE_5_PHOTO_ASSESSMENT.md).

## Баланс и тарифы

Этап 6 добавляет атомарный кредитный кошелёк и единый каталог PostgreSQL. Новый пользователь получает
два бонусных кредита один раз. Платные действия используют `reserve → commit` и `refund` при
технической неудаче; assessment и скачивание бесплатны.

```bash
cd server
npm run db:migrate
npm run db:seed
npm test
npm run smoke:wallet
```

Owner-only API: `/api/wallet`, `/api/wallet/transactions`, `/api/catalog/tariffs` и
`/api/catalog/action-costs`. Экран: `/app/balance`. Payment provider, checkout и кнопки покупки
намеренно отсутствуют. Подробности: [`docs/STAGE_6_WALLET_TARIFFS.md`](docs/STAGE_6_WALLET_TARIFFS.md).

## Standard-генерация фасада

Этап 7 добавляет provider-independent Standard image-to-image путь. Основной provider — GenAPI
с моделью `nano-banana-2`; она лучше выполнила требование законченного фасада в расширенном
сравнении edit-моделей и успешно прошла три фасада закрытого набора.
Исходник и результат остаются приватными, ссылки короткоживущие, а техническая ошибка после
резерва кредита приводит к идемпотентному возврату.
Prompt автоматически учитывает стиль, материалы, палитру и пожелания клиента, завершает фасадные
узлы и может добавить ограждение только на уже существующей опасной площадке или перепаде.

```bash
docker compose up -d
cd server
npm run db:migrate
npm run db:seed
npm run check
npm test
npm run db:check
```

Для включения задайте только в `server/.env`:

```dotenv
FEATURE_STANDARD_GENERATION_ENABLED=true
GENAPI_API_KEY=ваш_серверный_ключ
GENAPI_STANDARD_MODEL=nano-banana-2
```

Платные smoke-команды требуют отдельного `GENERATION_LIVE_SMOKE_ENABLED=true` и описаны в
[`docs/STAGE_7_STANDARD_GENERATION.md`](docs/STAGE_7_STANDARD_GENERATION.md). Измерения и
ограничения provider: [`docs/GENERATION_PROVIDER_DECISION.md`](docs/GENERATION_PROVIDER_DECISION.md).

## Асинхронная очередь генераций

Этап 8 переносит Standard-генерацию из HTTP-процесса в BullMQ worker. API отвечает `202` сразу
после durable-записи, резерва кредита и idempotent enqueue. Отдельный worker выполняет
preprocessing, provider request, техническую проверку и сохранение в приватный S3.

```powershell
docker compose up -d
cd server
npm ci
npm run db:migrate
npm run db:seed
```

Запускаются два отдельных процесса:

```powershell
npm run start:api
```

```powershell
npm run start:worker
```

UI `/app/projects/:projectId` использует polling. Redis настроен с AOF и `noeviction`; retries
ограничены, зависшие jobs восстанавливаются BullMQ и watchdog, а окончательная техническая ошибка
идемпотентно возвращает кредит. Полное описание:
[`docs/STAGE_8_GENERATION_QUEUE.md`](docs/STAGE_8_GENERATION_QUEUE.md).
