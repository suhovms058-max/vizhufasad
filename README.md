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

Staging nginx обслуживает каталог `out`, поэтому сборка для Timeweb выполняется явно в режиме static export:

```bash
NEXT_OUTPUT=export npm run build
test -f out/index.html
```

Проверка GitHub Pages export:

```bash
GITHUB_ACTIONS=true \
NEXT_PUBLIC_BASE_PATH=/vizhufasad \
NEXT_PUBLIC_LEADS_API_URL=https://vizhufasad.ru/api/leads \
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
- Публичный адрес фронтенда: `https://vizhufasad.ru/`.
- Используемый фронтендом API: `https://vizhufasad.ru/api`.

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
один бонусный кредит один раз — для пробной Standard-визуализации с водяным знаком. Платные действия используют `reserve → commit` и `refund` при
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

## Stage 12: Pro, редактор, 4K и сравнение

Stage 12 реализован за выключенными по умолчанию feature flags. Pro стоит 2 кредита, текстовая или
масочная доработка — 1 кредит, 4K — 1 кредит. Все три действия используют отдельные идемпотентные
резервы кошелька и автоматический refund при технической неудаче. Сравнение 2–4 результатов
доступно только владельцу проекта после серверной проверки пакета «Оптимум»/«Максимум».

```dotenv
FEATURE_PRO_GENERATION_ENABLED=false
GENAPI_PRO_MODEL=nano-banana-pro
FEATURE_GENERATION_EDITOR_ENABLED=false
GENAPI_EDIT_MODEL=qwen-image-edit-plus
GENAPI_MASK_EDIT_MODEL=bria-genfill
FEATURE_UPSCALE_4K_ENABLED=false
GENAPI_UPSCALE_MODEL=drct-super-resolution
```

Текстовые области и пользовательская маска намеренно разведены по разным provider-capabilities:
`bria-genfill` получает исходник через `image` и настоящую PNG-маску через `mask`; маска не
выдаётся за второе reference image. До платных facade smoke-tests функции остаются выключенными.
Выбор моделей и измерительный план: [`docs/STAGE_12_PROVIDER_DECISION.md`](docs/STAGE_12_PROVIDER_DECISION.md).
Защита от повторной оплаты одной remote-задачи при перезапуске:
[`docs/GENAPI_COST_CONTROL.md`](docs/GENAPI_COST_CONTROL.md).

## Автоматический контроль результата генерации

Этап 9 добавляет обязательный автоматический gate между генерацией и выдачей результата. Проверка объединяет VLM-сравнение исходника и кандидата, контуры, пространственное распределение границ и similarity отдельных защищённых зон. Единая pixel similarity всей картинки не используется, поэтому новая отделка и цвет сами по себе не считаются изменением дома.

- хороший первый кандидат получает `passed` и только после этого становится `completed`;
- первый структурный брак получает `retry_required` и одну бесплатную генерацию с усиленными ограничениями;
- второй брак получает `rejected_refund`, не публикуется и приводит к идемпотентному возврату кредита;
- настройки пользователя `preserve` исключают явно разрешённые изменения из блокирующих проверок;
- диагностические кандидаты остаются в приватном S3 ограниченное время и очищаются по расписанию.

```powershell
cd server
npm run db:migrate
npm run regression:generation-quality
npm test
npm run cleanup:generation-quality
```

При включённой Standard-генерации автоматический QC нельзя отключить и требуется настроенный VLM. Для РФ `auto` сначала выбирает Yandex AI Studio; OpenAI используется только как явно доступный резерв. Пороговые переменные, read-only admin endpoint и retention описаны в [`docs/STAGE_9_GENERATION_QUALITY.md`](docs/STAGE_9_GENERATION_QUALITY.md).

## Пользовательский путь Standard

Текущий продуктовый интерфейс находится на VPS в `/app/*`: `/app/new` объединяет проект, прямую загрузку фото, automatic assessment, настройки фасада, подтверждение стоимости и постановку Standard в очередь. Страница результата восстанавливает настоящий статус после reload, показывает только прошедший quality gate результат, историю, избранное, до/после и баланс. Бесплатный результат выдаётся с водяным знаком.

Публичная Next.js-страница ведёт на `NEXT_PUBLIC_APP_URL`. Старая lead-форма скрыта по умолчанию и включается только явным `NEXT_PUBLIC_LEGACY_LEADS_ENABLED=true`; во время GitHub Pages build флаг зафиксирован как `false`.

```powershell
cd server
npm run db:migrate
npm test
npm run test:e2e
```

Подробные маршруты, запуск и ограничения: [`docs/STAGE_10_STANDARD_USER_FLOW.md`](docs/STAGE_10_STANDARD_USER_FLOW.md).

## Разовые платежи Robokassa

Публичный сертификат для проверки подписанного `ResultUrl2` скачивается только с официального адреса Robokassa и хранится отдельно от релиза. Перед заменой проверьте срок действия сертификата:

```bash
sudo install -d -m 755 /etc/vizhufasad
curl --fail --silent --show-error --location \
  https://docs.robokassa.ru/media/files/jwtsign.cer \
  | sudo tee /etc/vizhufasad/robokassa-jwtsign.cer >/dev/null
openssl x509 -in /etc/vizhufasad/robokassa-jwtsign.cer -noout -subject -issuer -dates
```

Этап 11 добавляет provider-independent платёжный модуль с адаптером Robokassa для самозанятого НПД. Checkout создаёт только сервер по активной версии тарифа из PostgreSQL. Кредиты начисляются один раз после валидного подписанного `ResultURL`; возврат пользователя через `SuccessUrl2` не меняет баланс.

По умолчанию платежи и подписки выключены. Для локальной проверки без реального списания заполните только `server/.env`, примените миграции и явно включите тестовый магазин:

```dotenv
FEATURE_PAYMENTS_ENABLED=true
FEATURE_SUBSCRIPTIONS_ENABLED=false
PAYMENT_PROVIDER=robokassa
PAYMENT_TEST_MODE=true
ROBOKASSA_MERCHANT_LOGIN=логин_тестового_магазина
ROBOKASSA_PASSWORD1=тестовый_password_1
ROBOKASSA_PASSWORD2=тестовый_password_2
ROBOKASSA_SIGNATURE_ALGORITHM=sha256
ROBOKASSA_OPERATION_STATE_URL=https://auth.robokassa.ru/Merchant/WebService/Service.asmx/OpStateExt
ROBOKASSA_RESULT2_URL=https://ваш_домен/api/payments/webhooks/robokassa/result2
ROBOKASSA_RESULT2_PUBLIC_KEY_FILE=/etc/vizhufasad/robokassa-jwtsign.cer
LEGAL_MERCHANT_NAME=ФИО_самозанятого
LEGAL_MERCHANT_INN=ИНН_самозанятого
LEGAL_MERCHANT_EMAIL=email_для_обращений
LEGAL_MERCHANT_STATUS=Самозанятый, плательщик НПД
```

В production тестовый режим дополнительно требует осознанного `PAYMENT_ALLOW_TEST_MODE_IN_PRODUCTION=true`. Перед боевым включением установите `PAYMENT_TEST_MODE=false`, замените тестовые Password #1/#2 боевыми и снова проведите контрольный платёж. Для автоматических возвратов отдельно задайте боевой `ROBOKASSA_PASSWORD3`; без него возврат через API недоступен. `OpKey` приходит в проверенном `ResultUrl2`, а при недоставленном уведомлении может быть восстановлен штатным read-only запросом `OpStateExt`. После переключения `PAYMENT_ALLOW_TEST_MODE_IN_PRODUCTION` следует вернуть в `false`. Значения паролей, ИНН и персональные реквизиты не коммитятся.

```powershell
docker compose up -d
cd server
npm ci
npm run db:migrate
npm run db:seed
npm run check
npm test
npm run smoke:payments
# Только для оплаченного счёта: получить и сохранить OpKey без запуска возврата.
node scripts/sync-robokassa-operation-state.mjs <InvId>
```

Маршруты: `POST /api/payments/checkout`, `GET /api/payments`, `GET /api/payments/:id`, `POST /api/payments/:id/refund`, подписанный callback `POST /api/payments/webhooks/robokassa/result`. История платежей и чеков доступна владельцу на `/app/balance`. Подписка Plus не показывается и `FEATURE_SUBSCRIPTIONS_ENABLED` остаётся `false`, пока Robokassa отдельно не согласует рекуррентные платежи для магазина.

Выбор и официальные источники: [`docs/PAYMENT_PROVIDER_DECISION.md`](docs/PAYMENT_PROVIDER_DECISION.md).
