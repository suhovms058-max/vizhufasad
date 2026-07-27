# Текущее состояние ВИЖУФАСАД

Дата аудита: 27 июля 2026 года. База: `main`, commit `3cfb1fa`.

## Фактический production-путь

| Компонент | Фактическая схема | Подтверждение |
|---|---|---|
| Фронтенд | Next.js static export → GitHub Pages | `next.config.ts`, `.github/workflows/deploy-pages.yml` |
| Публичный сайт | `suhovms058-max.github.io/vizhufasad/` | README, `basePath=/vizhufasad` |
| API | Express на отдельном VPS Timeweb | адрес в `app/page.tsx`, server README и эксплуатационная история |
| VPS deployment | Ручной `git pull`, `npm`, restart systemd | автоматизации в репозитории нет |
| Cloudflare/OpenNext | Не используется в production | остались package scripts и `open-next.config.ts` |
| Next standalone | Собирается локально при отсутствии `GITHUB_ACTIONS`, но production-путь не подтверждён | `next.config.ts` |

## Что работает

- Одностраничный Next.js/React интерфейс и загрузочная форма.
- Static export и публикация фронтенда через GitHub Pages.
- Приём одного изображения до 15 МБ в JPG, PNG или WEBP.
- Техническая проверка Sharp: размеры, пропорции и энтропия.
- AI-оценка исходной фотографии через Yandex AI Studio; OpenAI-код остаётся резервным. В ветке аудита Yandex-запрос переведён на официальный structured output (`json_schema`), потому что последние production-тесты завершались `AI_INVALID_JSON`.
- Создание номера заказа и статус-токена.
- Файловое сохранение JSON заказа и исходной фотографии.
- Получение статуса заказа по токену.
- Уведомления MAX и Mail.ru.
- Rate limiting, CORS, Helmet и права `0600` для сохраняемых файлов.

## Что работает частично

- AI-проверка: при ошибке заказ остаётся `queued_for_ai`, но фонового повтора и очереди нет.
- Статусная модель: содержит `manual_review`/`photo_review_required`, что противоречит полностью автоматической модели.
- Доставка: выполняется синхронно внутри HTTP-запроса; сбои могут увеличить время ответа.
- Хранение: локальные JSON и фотографии подходят только для одной инстанции и не дают транзакций, индексов, retention-политики или надёжной очереди.
- Deployment API: выполняется вручную; конфигурации systemd и reverse proxy нет в репозитории.
- Проверки: сборка и синтаксис проходят, но unit/integration-тестов нет.

## Чего нет

- Фактической генерации вариантов фасада.
- Автоматической проверки сохранения геометрии результата.
- Пользовательской настройки фасада и явных разрешений на изменение конструкции.
- Фоновой очереди, повторов, idempotency и dead-letter обработки.
- PostgreSQL, объектного хранилища и политики удаления данных.
- Авторизации, личного кабинета и истории результатов.
- Кредитов, тарифной логики и платежей.
- Скачивания результата и автоматической доработки.
- Наблюдаемости: структурированных метрик, tracing, alerting и корреляции задач.

## Что удалить

Удаление выполняется отдельной задачей после продуктового решения, не в аудите:

- тарифы и тексты про специалиста, ручную проверку, расчёт материалов, PDF для строителей и сопровождение в `app/page.tsx`;
- `manual_review`, `operatorSummary`, `photo_review_required` и операторские формулировки в `server/index.mjs`;
- дублирующие старые `page.tsx` и `globals.css` в корне после подтверждения, что они не используются;
- `DEPLOY_AUTOMATION_V2.txt`, `UPDATE_README.txt`, `server/placeholder.txt`;
- Cloudflare/OpenNext/Vercel-зависимости и конфигурацию, если этот deployment-путь окончательно не выбран.

## Что переиспользовать

- визуальный каркас Next.js и секцию сравнения «до/после»;
- загрузку файла, клиентский preview и форму;
- Sharp-проверку изображения и ограничения размера;
- Yandex AI adapter после стабилизации контракта структурированного ответа;
- безопасные order ID/status token;
- Helmet, CORS и rate limiting;
- notification adapters как технические оповещения, но не как операторский этап;
- `/health` как основу readiness/liveness с последующим разделением.

## Жёстко заданные значения и расхождения

- production API ранее был жёстко задан в `app/page.tsx`; теперь поддерживается `NEXT_PUBLIC_LEADS_API_URL`, а workflow явно задаёт production URL;
- `SITE_ORIGIN` допускает только одно origin и должен совпадать с origin GitHub Pages без path;
- README ранее описывал только GitHub Pages и не фиксировал VPS/API;
- `next.config.ts` одновременно содержит GitHub Pages export и standalone-режим;
- package scripts содержат Cloudflare preview/build, хотя production использует GitHub Pages;
- metadata и контент обещают услуги, запрещённые текущими продуктовыми ограничениями;
- `.env.example` отсутствовал, хотя server README на него ссылался;
- `.gitignore` отсутствовал полностью.

## Безопасность и зависимости

До исправления audit выявил high-уязвимости в Next.js 15.5.20, Sharp 0.34.x и Nodemailer 7.x. В ветке аудита Next.js, Sharp и Nodemailer обновлены до исправленных версий и добавлена защита от случайного коммита секретов и пользовательских файлов.

После обновления `npm audit --omit=dev` для сервера показывает 0 уязвимостей. Во frontend dependency tree остаётся high-предупреждение для PostCSS, транзитивно зафиксированного Next.js; npm не предлагает исправления. Текущий production является static export: PostCSS используется во время доверенной сборки и не обрабатывает пользовательский CSS во время исполнения, что снижает применимость, но предупреждение остаётся открытым до исправления upstream.

Отдельные риски следующего этапа:

- персональные данные и фотографии хранятся без формальной retention/delete-политики;
- API возвращает статус-токен клиенту, но не имеет аккаунта и централизованной авторизации;
- синхронные внешние вызовы увеличивают риск тайм-аутов;
- MIME проверяется до декодирования; Sharp отклоняет повреждённый файл, но нужны негативные integration-тесты;
- публичный API привязан к адресу `sslip.io`, а не к управляемому домену.
- исправление structured output проверено синтаксически, но требует одной контрольной заявки с реальным Yandex API на VPS после развёртывания ветки;

## Результаты проверок исходной точки

- frontend `npm ci`: успешно после назначения writable npm cache;
- frontend `npm run typecheck`: успешно;
- GitHub Pages build/export: успешно, `out/index.html` создан;
- standalone build: успешно;
- server `npm ci`: успешно;
- server `npm run check`: успешно;
- server `npm test`: тестов нет;
- server smoke `/health`: HTTP/JSON успешно с `AI_PROVIDER=none`;
- lint: отдельной lint-конфигурации и команды нет.

Предупреждение Next.js о нескольких lock-файлах возникло из-за внешнего lock-файла рабочей среды, а не структуры репозитория.

## Официальные источники

- [Next.js Static Exports](https://nextjs.org/docs/app/guides/static-exports)
- [GitHub Pages: custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Yandex AI Studio: multimodal requests](https://aistudio.yandex.ru/docs/en/ai-studio/operations/generation/multimodels-request)
- [Yandex AI Studio: structured output](https://aistudio.yandex.ru/docs/en/ai-studio/operations/generation/completions-structured)
- [Node.js test runner](https://nodejs.org/api/test.html)
