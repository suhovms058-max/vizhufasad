# Этап 6: кошелёк и единая тарифная модель

## Ledger

Баланс хранится в `wallets.balance` как атомарно обновляемый снимок, но каждое изменение обязательно
сопровождается строкой `wallet_transactions` в той же PostgreSQL-транзакции. Прямого пользовательского
API для изменения баланса нет.

Допустимые типы операций: `free_bonus`, `purchase`, `generation_charge`, `generation_refund`, `promo`,
`subscription`, `admin_adjustment`.

Каждая операция содержит глобально уникальный `idempotency_key` и `balance_after`. Повтор с тем же ключом
и тем же назначением возвращает исходную операцию; несовместимый повтор получает
`IDEMPOTENCY_KEY_CONFLICT`.

## Reserve, commit и refund

1. `reserve` блокирует строку кошелька через `SELECT ... FOR UPDATE`, читает действующую стоимость
   из `action_costs`, проверяет остаток, уменьшает баланс и создаёт `generation_charge` как `reserved`.
2. `commit` переводит резерв в `committed`, не меняя баланс повторно.
3. `refund` при технической неудаче создаёт положительный `generation_refund`, возвращает баланс и
   переводит исходное списание в `refunded`.

Уникальный индекс на `related_transaction_id` запрещает второй возврат. Assessment и скачивание стоят
`0`; создать для них резерв нельзя.

Реализация следует официальной семантике
[PostgreSQL `SELECT ... FOR UPDATE`](https://www.postgresql.org/docs/current/sql-select.html) и
[row-level locks](https://www.postgresql.org/docs/17/explicit-locking.html). Ограничения и индексы
зафиксированы в Drizzle schema согласно
[Drizzle Indexes & Constraints](https://orm.drizzle.team/docs/indexes-constraints).

## Бесплатный бонус

Новый пользователь получает два кредита в той же транзакции, где создаётся кошелёк. Migration 0005
начисляет бонус существующим кошелькам без `free_bonus`. Ключ `free_bonus:<userId>` гарантирует
однократность.

## Тарифы

Единственный источник для API и UI — PostgreSQL:

| Код | Название | Цена | Кредиты | Публичный |
|---|---|---:|---:|---|
| `FREE` | Бесплатный | 0 ₽ | 2 | да |
| `START` | Старт | 790 ₽ | 25 | да |
| `OPTIMUM` | Оптимум | 1 290 ₽ | 60 | да |
| `MAXIMUM` | Максимум | 3 490 ₽ | 240 | да |
| `PLUS` | Plus | не утверждена | не утверждены | нет |

Plus хранится как неактивный непубличный черновик без выдуманной цены.

Новая версия тарифа получает отдельную строку с `valid_from`, а предыдущая закрывается через
`valid_until`. Публикация версии в прошлом запрещена service-валидацией.

## Стоимость действий

| Код | Действие | Кредиты |
|---|---|---:|
| `standard_generation` | Standard | 1 |
| `pro_generation` | Pro | 2 |
| `text_revision` | Текстовая доработка | 1 |
| `upscale_4k` | 4K | 1 |
| `photo_assessment` | Проверка фото | 0 |
| `download` | Скачивание | 0 |

## API, UI и feature flags

Owner-only маршруты: `GET /api/wallet`, `GET /api/wallet/transactions`, `GET /api/catalog`,
`GET /api/catalog/tariffs`, `GET /api/catalog/action-costs` и `GET /app/balance`.
Кнопок покупки, checkout и платёжных endpoint нет.

```dotenv
FEATURE_WALLET_ENABLED=true
FEATURE_TARIFF_CATALOG_ENABLED=true
FEATURE_FREE_BONUS_ENABLED=true
FEATURE_PAYMENTS_ENABLED=false
```

`FEATURE_PAYMENTS_ENABLED=true` блокирует запуск: payment provider не входит в этап 6.

## Проверки

```bash
cd server
npm run db:migrate
npm run db:seed
npm test
npm run smoke:wallet
```

Тесты проверяют параллельные списания, невозможность отрицательного баланса, idempotency,
reserve/commit/refund, однократный бонус, бесплатные действия и effective-dated смену тарифа.
