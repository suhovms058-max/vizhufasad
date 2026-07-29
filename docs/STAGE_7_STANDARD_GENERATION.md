# Этап 7: Standard-генерация фасада

## Поток

1. Сервер проверяет владельца проекта, готовность исходного фото и решение assessment.
2. Нормализует версионированные настройки и собирает prompt `standard-facade-v3`.
3. Создаёт идемпотентную generation и резервирует стоимость `standard_generation` в кошельке.
4. Передаёт рабочую копию исходника image-edit provider.
5. Записывает attempt: provider job ID, модель, prompt version, seed, время и стоимость.
6. Декодирует ответ Sharp, приводит к sRGB JPEG и удаляет метаданные.
7. Сохраняет результат только в приватный S3, выполняет commit и помечает проект `ready`.
8. При технической ошибке удаляет частичный объект, фиксирует failure и идемпотентно возвращает
   резерв. Повторный idempotency key не списывает кредит второй раз.

Режимы: `gentle` (по умолчанию), `balanced`, `conceptual`. Все флаги сохранения структуры по
умолчанию равны `true`. Снять конкретное ограничение может только явный пользовательский ввод.
Модель автоматически добавляет концептуальные ограждения там, где они нужны на уже существующих
крыльцах, площадках, наружных ступенях и опасных перепадах. Это не разрешает создавать новую
террасу, балкон, лестницу, площадку, проём или несущую опору.
Правило подтверждено реальным тестом Nano Banana 2: существующая верхняя площадка получила
ограждение между существующими опорами без изменения архитектуры.

## API

- `POST /api/projects/:projectId/generations/standard`
- `GET /api/projects/:projectId/generations/:generationId`
- `GET /api/projects/:projectId/generations/:generationId/result-url`

Все продуктовые маршруты требуют серверную сессию и проверяют владельца через запрос к БД.
Результат выдаётся только короткоживущей подписанной ссылкой.

Development/staging endpoint: `POST /api/staging/generation/standard`. Он выключен по умолчанию,
требует отдельный случайный `x-staging-secret` и конфигурационно запрещён при `NODE_ENV=production`.

## Настройка

В `server/.env`:

```dotenv
FEATURE_STANDARD_GENERATION_ENABLED=true
GENERATION_PRIMARY_PROVIDER=genapi
GENAPI_API_KEY=секрет_только_на_сервере
GENAPI_STANDARD_MODEL=nano-banana-2
GENAPI_STANDARD_ESTIMATED_COST_MINOR=2500
GENERATION_FALLBACK_PROVIDER=none
```

Ключ нельзя помещать в `.env.example`, логи, GitHub Secrets без необходимости или клиентский
Next.js bundle. Значение estimate консервативное; фактическая стоимость сохраняется отдельно из
ответа provider.

## Проверки

Без платного внешнего запроса:

```bash
docker compose up -d
cd server
npm run db:migrate
npm run db:seed
npm run check
npm test
npm run db:check
```

Платный закрытый benchmark требует явного opt-in и бюджета в копейках:

```powershell
$env:GENERATION_LIVE_SMOKE_ENABLED="true"
$env:GENERATION_SMOKE_BUDGET_MINOR="30000"
npm run smoke:generation
```

Полный реальный staging HTTP-путь с временной фикстурой, wallet и MinIO:

```powershell
$env:GENERATION_LIVE_SMOKE_ENABLED="true"
npm run smoke:generation:endpoint
```

Оба скрипта читают ключ из `server/.env`, не печатают его и сохраняют изображения только в
`GENERATION_SMOKE_OUTPUT_DIR`, который должен находиться вне репозитория. Endpoint smoke удаляет
созданные записи и S3-объекты после сохранения локальной контрольной копии.

## Что намеренно не входит

Полноценная очередь, Pro, 4K, текстовый редактор, автоматическая проверка результата и production
self-hosted fallback не реализуются на этом этапе.
