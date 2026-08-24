# Этап 13: безопасный выпуск редизайна

## Назначение

Этот порядок подготавливает короткое production-переключение `vizhufasad.ru` без удаления предыдущей версии. Сборка release-кандидата и read-only проверки допустимы заранее; атомарное переключение выполняется только после отдельного разрешения владельца.

Production использует:

- статический Next.js export из `out/`;
- Express API и generation worker как отдельные systemd-сервисы;
- PostgreSQL, Redis и MinIO из существующего Docker Compose;
- неизменяемые каталоги релизов `/opt/vizhufasad-releases/<release-id>`;
- атомарную ссылку `/opt/vizhufasad-stage` на активный релиз;
- systemd-службы `vizhufasad-stage-api` и `vizhufasad-stage-worker`;
- production env в `server/.env` активного релиза с правами `600`. Файл копируется из предыдущего релиза и не входит в Git.

## Ворота перед выпуском

Выпуск запрещён, пока не выполнены все пункты:

1. Ветка этапа 13 одобрена владельцем, закоммичена и отправлена в GitHub.
2. Целевые тесты, typecheck, static production build и визуальная проверка изменённых экранов прошли.
3. На VPS достаточно места минимум для двух релизов и дампа PostgreSQL.
4. `server/.env` нового релиза скопирован из активного релиза, принадлежит `www-data` и имеет режим `600`; `server/data` перенесён без удаления исходника и имеет режим `700`.
5. Текущий commit, active release и состояние сервисов записаны до переключения.
6. Миграции совместимы с предыдущей версией приложения. Автоматический rollback базы не выполняется.

## Фактическая production-топология

На 24 августа 2026 года production уже использует release-каталоги:

- `/opt/vizhufasad-stage` → `/opt/vizhufasad-releases/prod-7225639`;
- nginx отдаёт `/opt/vizhufasad-stage/out` и проксирует API на `127.0.0.1:8081`;
- PostgreSQL, Redis и MinIO запускаются через `/opt/vizhufasad-stage/docker-compose.yml`;
- подготовленный release-кандидат: `/opt/vizhufasad-releases/prod-d911e65`.

Не заменять действующие systemd/nginx-шаблоны во время UI-релиза. Их фактические пути уже проверены, `nginx -t` проходит.

## Подготовка релиза без остановки сайта

В командах ниже `<commit>` — одобренный commit ветки этапа 13, а `<release-id>` — UTC-время и короткий SHA, например `20260822-1630-a1b2c3d`.

```bash
cd /opt/vizhufasad
git fetch --prune origin
git cat-file -e <commit>^{commit}

sudo install -d -m 0755 /opt/vizhufasad-releases/<release-id>
git archive <commit> | sudo tar -x -C /opt/vizhufasad-releases/<release-id>
sudo cp -a /opt/vizhufasad-stage/server/.env /opt/vizhufasad-releases/<release-id>/server/.env
sudo cp -a /opt/vizhufasad-stage/server/data /opt/vizhufasad-releases/<release-id>/server/data
sudo chown -R www-data:www-data /opt/vizhufasad-releases/<release-id>
sudo chmod 600 /opt/vizhufasad-releases/<release-id>/server/.env
sudo chmod 700 /opt/vizhufasad-releases/<release-id>/server/data

cd /opt/vizhufasad-releases/<release-id>
sudo -u www-data npm ci
sudo -u www-data env NEXT_OUTPUT=export \
  NEXT_PUBLIC_SITE_ORIGIN=https://vizhufasad.ru \
  NEXT_PUBLIC_APP_URL=/app/new \
  NEXT_PUBLIC_CATALOG_URL=/api/public/catalog \
  NEXT_PUBLIC_LEGACY_LEADS_ENABLED=false \
  NEXT_PUBLIC_PAYMENTS_ENABLED=true \
  npm run build

cd server
sudo -u www-data npm ci --omit=dev
```

Перед переключением проверить, что существуют `out/index.html`, `server/index.mjs`, `server/worker.mjs`, `server/.env` и `server/data`. Миграции для UI-релиза `d911e65` не требуются. Если будущий релиз содержит миграцию, её совместимость и отдельный порядок применения проверяются до переключения.

## Резервная точка

```bash
export RELEASE_BACKUP=/var/backups/vizhufasad/<release-id>
sudo install -d -m 0700 "$RELEASE_BACKUP"
readlink -f /opt/vizhufasad-stage | sudo tee "$RELEASE_BACKUP/previous-release.txt"
sudo systemctl status vizhufasad-stage-api vizhufasad-stage-worker --no-pager > "$RELEASE_BACKUP/services-before.txt"

sudo docker compose -f /opt/vizhufasad-stage/docker-compose.yml exec -T postgres \
  sh -lc 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  | sudo tee "$RELEASE_BACKUP/postgres.dump" >/dev/null
sudo test -s "$RELEASE_BACKUP/postgres.dump"
```

Дамп содержит пользовательские данные, поэтому каталог имеет права `0700` и не копируется в GitHub. Объекты MinIO не изменяются обычным выпуском приложения; их резервное копирование выполняется отдельной политикой хранения.

## Атомарное переключение

```bash
sudo ln -sfn /opt/vizhufasad-releases/<release-id> /opt/vizhufasad-stage.next
sudo mv -Tf /opt/vizhufasad-stage.next /opt/vizhufasad-stage
sudo systemctl restart vizhufasad-stage-api vizhufasad-stage-worker
sudo systemctl is-active --quiet vizhufasad-stage-api
sudo systemctl is-active --quiet vizhufasad-stage-worker
sudo nginx -t
sudo systemctl reload nginx
```

Статический frontend переключается одним `mv`; ожидаемая пауза относится только к перезапуску API и worker.

## Обязательный smoke после переключения

Проверить ровно один сквозной сценарий с production backend:

1. `curl -fsS http://127.0.0.1:8081/health/live` возвращает HTTP 200 без секретов. Публичный `/health/*` закрыт nginx и не используется как внешний smoke.
2. Главная, вход, `/app`, `/app/new`, каталог стилей, галерея и юридические страницы открываются без ошибок консоли.
3. Новый пользователь получает код по production SMTP, входит и видит бонусный баланс один раз.
4. Фото загружается только после явного согласия, проходит обработку и assessment.
5. Standard-задача проходит очередь, QC и открывает проверенный результат после reload.
6. Контрольная разовая оплата создаётся сервером; подтверждённый webhook начисляет кредиты ровно один раз. Повторный реальный платёж не нужен, если платёжный код в release не менялся: достаточно сверить доступность checkout и последний подтверждённый smoke этапа 11.
7. Логи API и worker не содержат необработанных exception, секретов, cookie или исходных фото.

Rich results проверяются по опубликованным URL главной, `/gallery` и одной страницы `/styles/<slug>` в Google Rich Results Test. Отсутствие расширенного результата не является ошибкой, если JSON-LD валиден и соответствует видимому содержимому.

## Быстрый откат приложения

Откатить только приложение на путь из `previous-release.txt`:

```bash
export PREVIOUS_RELEASE="$(sudo cat /var/backups/vizhufasad/<release-id>/previous-release.txt)"
sudo test -f "$PREVIOUS_RELEASE/out/index.html"
sudo test -f "$PREVIOUS_RELEASE/server/index.mjs"
sudo ln -sfn "$PREVIOUS_RELEASE" /opt/vizhufasad-stage.next
sudo mv -Tf /opt/vizhufasad-stage.next /opt/vizhufasad-stage
sudo systemctl restart vizhufasad-stage-api vizhufasad-stage-worker
curl -fsS http://127.0.0.1:8081/health/live
```

Базу данных автоматически не восстанавливать: это может удалить новые оплаты, проекты и транзакции. Восстановление дампа допускается только после отдельного решения об инциденте и остановки записи.

## После подтверждения

- сохранить release id, commit, время переключения и результаты smoke в release report;
- оставить предыдущий релиз минимум на семь дней;
- удалить только старые release-каталоги, которые не являются текущим или предыдущим, отдельной подтверждённой операцией;
- не удалять staging и резервные данные в рамках релиза редизайна.
