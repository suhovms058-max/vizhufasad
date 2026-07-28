# ВИЖУФАСАД

Специализированный сервис автоматической визуализации фасада дома по фотографии.

> Визуализация — концепция внешнего вида, а не рабочий строительный проект.

## Текущее состояние

Сейчас публично работает статический Next.js-фронтенд с формой заявки. Express API на VPS принимает фотографию, выполняет техническую и AI-проверку, сохраняет заказ в файлах и отправляет уведомления в MAX и Mail.ru. Генерация фасада, очередь заданий, база данных, авторизация, личный кабинет, кредиты и платежи ещё не реализованы.

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

## Production

- Фронтенд: push в `main` запускает `.github/workflows/deploy-pages.yml`, создаёт static export `out/` и публикует его в GitHub Pages.
- API: отдельный Node.js/Express-процесс на VPS Timeweb; GitHub Actions его не разворачивает.
- Публичный адрес фронтенда: `https://suhovms058-max.github.io/vizhufasad/`.
- Используемый фронтендом API: `https://89-23-97-248.sslip.io/api/leads`.

Изменения этого этапа находятся в отдельной ветке и не должны сливаться в `main` без проверки и явного решения владельца.
