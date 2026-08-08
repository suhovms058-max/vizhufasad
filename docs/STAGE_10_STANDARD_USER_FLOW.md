# Этап 10: пользовательский путь Standard

## Что является текущим продуктовым UI

Авторизованный путь работает на Express/VPS под `/app/*`. Статический Next.js-сайт остаётся входной страницей и по умолчанию переводит пользователя на `NEXT_PUBLIC_APP_URL`. Legacy-форма заявок не попадает в доступный интерфейс, пока сборка явно не выполнена с `NEXT_PUBLIC_LEGACY_LEADS_ENABLED=true`; API дополнительно контролируется `LEGACY_LEADS_MODE`.

## Сценарий

1. `/app/new` создаёт или открывает проект.
2. Браузер загружает JPG/PNG/WEBP напрямую по presigned URL; API только завершает обработку.
3. Результат автоматического photo assessment показывает предупреждения или требования к пересъёмке.
4. Принятое фото открывает стили, отделку, палитру, пожелания и все Stage 10 preserve-настройки.
5. Нормализованный черновик сохраняется в `projects.facade_config` и `projects.geometry_policy`; versioned localStorage используется только как браузерный fallback.
6. После подтверждения цены API возвращает `202`, а отдельный worker выполняет генерацию и обязательный quality gate.
7. `/app/projects/:projectId/generations/:generationId` показывает только реальные состояния и восстанавливает polling после reload.
8. Только `completed` получает страницу до/после и временную owner-only ссылку. Free-результат выдаётся как отдельная private S3-копия с водяным знаком.

## API этапа

- `PATCH /api/projects/:projectId/configuration` — сохранить проверенный черновик настроек;
- `GET /api/projects/:projectId/generations` — owner-only история;
- `PATCH /api/projects/:projectId/generations/:generationId/favorite` — избранное только для завершённого результата;
- существующие start/status/cancel/result-url маршруты продолжают использовать очередь и idempotency.

## Запуск и проверка

```powershell
docker compose up -d
cd server
npm ci
npm run db:migrate
npm run start:api
# во втором терминале
npm run start:worker
```

```powershell
cd server
npm test
npm run test:e2e
npm run smoke:infra
npm run smoke:queue
```

Playwright использует Chromium (при необходимости канал задаётся через `PLAYWRIGHT_CHANNEL`) и проверяет ширины 360, 390, 768 и 1440 px, критический путь, reload, watermark, favorite, отсутствие горизонтального overflow и серьёзных/критических axe-нарушений.

## Staging на Timeweb

- Пользовательский путь опубликован на `https://46-149-67-190.sslip.io` и закрыт дополнительной HTTP-аутентификацией от случайного расходования GenAPI.
- API и generation worker работают отдельными systemd-сервисами на клоне; исходный `vizhufasad-api.service` не изменяется.
- PostgreSQL, Redis и MinIO доступны только через loopback. Публичный storage-origin проксируется Nginx, бакет остаётся приватным, ссылки подписываются на короткий срок.
- HTTPS обслуживает Let's Encrypt с автоматическим продлением. Runtime-секреты хранятся только в `/opt/vizhufasad-stage/server/.env` с правами `600`.

## Ограничения этапа

- Оплата, Pro, 4K и редактор областей не подключены и не показываются как работающие функции.
- Результат является концепцией, не строительным проектом, сметой или чертежом.
- Признак free/paid сейчас соответствует наличию у пользователя хотя бы одной committed покупки/подписки; распределение конкретных приобретённых и бонусных кредитов не вводится на этом этапе.
- Внешний provider smoke требует действующих ключей и отдельного контроля расходов; frontend e2e не имитирует успешный внешний provider, а проверяет контракт уже реализованной очереди.
