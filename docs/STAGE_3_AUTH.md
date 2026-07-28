# Этап 3: passwordless-авторизация

## Граница реализации

Публичный Next.js-сайт пока остаётся статическим GitHub Pages. Статический export не может проверить серверную сессию до выдачи HTML, поэтому вход и кабинет временно обслуживаются Express API на VPS:

- `/auth/login` — запрос кода;
- `/auth/verify` — подтверждение кода;
- `/app` и `/app/projects` — пустой список проектов;
- `/app/settings` — настройки, выход и запрос удаления аккаунта;
- `/api/auth/*` — JSON API.

Так `/app/*` и сессионная cookie находятся на одном origin и проверяются сервером. Перенос этих страниц в Next.js допустим только после перехода с GitHub Pages на server runtime или после настройки единого reverse proxy.

## Модель безопасности

- Код состоит из шести цифр, генерируется криптографическим генератором, хранится только как HMAC-SHA-256 и действует 10 минут по умолчанию.
- Новый запрос погашает предыдущий активный код для того же нормализованного email.
- У кода ограничено число попыток; успешное подтверждение атомарно помечает его использованным.
- Запрос и подтверждение защищены отдельными rate limits. Значения email и IP в ключах/БД хешируются.
- Сессионный токен содержит 256 бит случайности. В PostgreSQL хранится только HMAC; cookie имеет `HttpOnly`, `SameSite=Lax`, `Path=/` и `Secure` в production.
- Logout и управление сессиями записывают отзыв в PostgreSQL. Аудит не содержит кодов или cookie.
- Новый пользователь и его кошелёк создаются в одной транзакции.
- Запрос удаления аккаунта фиксирует время и немедленно отзывает все сессии. Физическое удаление намеренно отложено до отдельной retention-задачи.
- Телефон, пароль, социальные входы, платежи и генерация не используются.

`AUTH_HASH_SECRET` — обязательный отдельный секрет длиной не менее 32 символов. Его нельзя коммитить. `AUTH_MAIL_MODE=console` разрешён только вне production; запуск production с ним завершается ошибкой. Production также не запускается с `AUTH_COOKIE_SECURE=false`.

## Локальный запуск

```bash
docker compose up -d
cd server
cp .env.example .env
# заполнить AUTH_HASH_SECRET; console mail напечатает код только в локальном журнале
npm ci
npm run db:migrate
npm test
npm start
```

Открыть `http://127.0.0.1:8080/auth/login`. Для production установить `NODE_ENV=production`, `AUTH_MAIL_MODE=smtp`, `AUTH_COOKIE_SECURE=true`, SMTP-параметры и уникальный `AUTH_HASH_SECRET`.

## JSON API

- `POST /api/auth/code/request` — `{ "email": "user@example.com" }`;
- `POST /api/auth/code/confirm` — `{ "challengeId": "...", "code": "123456" }`;
- `GET /api/auth/me`;
- `POST /api/auth/logout`;
- `GET /api/auth/sessions`;
- `DELETE /api/auth/sessions/:id`;
- `POST /api/auth/sessions/revoke-all`;
- `POST /api/auth/account/deletion-request`.

Все маршруты после подтверждения кода используют HttpOnly-cookie. Секретный токен не возвращается в JSON.

## Оставшиеся ограничения

- Rate limit хранится в памяти одного Express-процесса. До горизонтального масштабирования его store нужно перенести в Redis.
- Фоновое физическое удаление аккаунта и данных не входит в этап 3; сейчас безопасно фиксируется запрос и отзываются все сессии.
- SMTP production требует ручной проверки с реальными секретами на staging/VPS; development-проверки используют только console mail.
- `npm audit --omit=dev` для frontend и server не сообщает уязвимостей. Полный frontend audit всё ещё видит проблемы только в неиспользуемых production-кодом CLI-цепочках `vercel`/`@opennextjs/cloudflare`; их обновление или удаление относится к отдельной миграции deployment toolchain.
