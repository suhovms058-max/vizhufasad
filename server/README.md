# API заявок ВИЖУФАСАД

Express API принимает одно изображение JPG/PNG/WEBP до 15 МБ, проверяет его через Sharp и, при настройке провайдера, через мультимодальную AI-модель. Заказ и исходное фото сохраняются локально; уведомления отправляются в MAX и Mail.ru.

## Запуск и проверки

```bash
cp .env.example .env
npm ci
npm run check
npm test
npm start
```

```bash
curl -fsS http://127.0.0.1:8080/health
```

Требуется Node.js 22+. Автоматических unit-тестов пока нет; `npm test` завершается успешно с нулём найденных тестов.

## Конфигурация

Обязательные переменные:

- `SITE_ORIGIN`
- `MAX_BOT_TOKEN`
- `MAX_CHAT_ID`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `LEADS_EMAIL`

Для Yandex AI Studio используются `AI_PROVIDER=yandex`, `YANDEX_API_KEY`, `YANDEX_FOLDER_ID` и `YANDEX_MODEL`. Все параметры перечислены в `.env.example`.

`server/.env` хранится только на VPS с правами доступа владельца и не добавляется в Git. `DATA_DIR` должен указывать на каталог с резервным копированием и ограниченным доступом.

## Реализованные endpoints

- `GET /health`
- `POST /api/leads`
- `GET /api/orders/:id/status?token=...`

Текущий файловый механизм является временным. Он не предоставляет очередь, повторные фоновые задания, транзакции или масштабирование на несколько процессов.

## Production

API фактически запускается как отдельный сервис на VPS Timeweb. Репозиторий не содержит systemd unit, reverse-proxy-конфигурацию или автоматический VPS deployment; их состояние требуется сверять непосредственно на сервере перед изменением production.
