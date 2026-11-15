# AGENTS.md — карта проекта (читать первым; не исследуй репозиторий заново)

Бот для ИП: принимает платежи, рисует внутреннюю квитанцию (JPEG, НЕ фискальный чек), хранит операции в PostgreSQL, экспортирует в Excel. Каналы: Telegram (основной) и MAX (параллельная реализация). Язык интерфейса и docs/ — русский.

## Как понимать владельца
Владелец НЕ программист: он говорит словами интерфейса («кнопка Моя подписка», «текст после покупки», «квитанция не пришла»), без имён файлов. Никогда не проси его указать файл. Сначала открой `docs/FEATURE_MAP.md` — таблица «слова владельца → файлы TG/MAX/логика», найди строку и иди сразу в файлы. Нет строки — grep по точной русской строке с экрана (см. низ FEATURE_MAP). Новое найденное место допиши в FEATURE_MAP.

## Правила экономии токенов
- НЕ листай репозиторий рекурсивно: в корне огромный `node_modules`. Список файлов — только `git ls-files`.
- НЕ читай целиком: `README.md` (в основном деплой), `scripts/*.test.cjs`, `receipt.hbs` (463 стр.), миграции.
- Сначала grep по символу, затем read с offset/limit нужного куска.
- Не перечитывай этот файл и не пиши «посмотрю как устроен проект» — карта ниже уже есть.

## Стек
Node 20+, TypeScript, pnpm-монорепо (`pnpm@10.11.0`), grammY, MAX Bot API, PostgreSQL 16 + Prisma, Playwright + Handlebars (рендер), ExcelJS, sharp, luxon, zod, pino, Docker Compose, Caddy.

## Карта
- `apps/bot/src/` — бот и HTTP-сервер (express: `/health`, webhook).
  - `index.ts` — старт: webhook/polling, планировщики, MAX-вебхук. `bot.ts` — сборка grammY-бота и порядок регистрации хендлеров. `config.ts` — env (zod).
  - `handlers/` — Telegram: `commands`, `messages`, `callbacks`, `statistics`, `branding`, `subscription`. `keyboards/index.ts`.
  - `max/` — то же для MAX: `client`, `context`, `handlers`, `keyboards`, `subscription`, `types`, `webhook`.
  - `services/` — бизнес-логика, общая для каналов: `operationService`, `userService`, `exportService`, `rendererClient`, `statisticsService`/`statisticsWidget`/`dailyStatsService`, `brandingService`/`brandingStorage`, `subscriptionService`, `supportService`, `timeZoneService`.
  - `utils/` (`formatters`, `state`, `telegram`, `validation`), `types.ts`.
- `apps/renderer-worker/src/` — HTTP-сервис рендера: `renderReceipt.ts`, `receiptPayload.ts`, шаблон `templates/receipt.hbs`.
- `packages/db/` — Prisma: `prisma/schema.prisma` (166 стр.), `prisma/migrations/`, клиент `src/prisma.ts`.
- `packages/shared/src/` — `constants`, `types`, `branding`, `timezones`.
- `scripts/` — деплой (`deploy.sh`, `deploy-entrypoint.sh`), импорт/пересчёт чеков, тесты `*.test.cjs`.
- `docs/` — `deployment.md`, `interactive-statistics.md`, `receipt-branding-pilot.md`, `subscription-pilot.md` (читать только по теме задачи).

## Модель данных (Prisma, кратко)
`User`(telegramId?/maxId?, subscriptionUntil, subscriptionReminderDay) 1—1 `EntrepreneurProfile`(inn, ogrn, ipFullName, address, timeZone, receiptBranding Json) ; `User` 1—N `Service`, `Operation`.
`Operation`: receiptNumber `KV-000001` (unique на пользователя), *Snapshot-поля (профиль/оформление копируются в момент создания), amount, paymentMethod, status (DRAFT→CONFIRMED→RENDERING→RENDERED→SENT|FAILED|DELETED), channel. `OperationItem` — позиции. `RenderJob` — задача рендера. `ConversationSession` — состояние диалога (JSON). `StatisticsReport` — неизменяемые агрегаты.

## Важные инварианты
- **Две реализации канала**: пользовательская фича почти всегда правится и в `handlers/*` (Telegram), и в `max/*` (MAX). Общую логику выноси в `services/`.
- Подписка и брендинг квитанций доступны всем; оплата ещё НЕ подключена (покупка = 365 дней в подарок). Выключатель: `RECEIPT_BRANDING_TEST_ENABLED=false`.
- Снимки (`*Snapshot`) в операции не пересчитываются при смене профиля.
- Схема БД меняется только новой миграцией в `packages/db/prisma/migrations/<YYYYMMDDNNNN>_<name>/`.

## Команды (Windows/PowerShell)
- Сборка всего: `pnpm build`
- Тесты: `pnpm test:stats` (tsc db/shared/bot + статистика, виджет, таймзоны), `pnpm test:branding`
- Prisma: `pnpm prisma:generate`, `pnpm prisma:migrate:dev`, `pnpm prisma:migrate:deploy`
- Локально: `.env` из `.env.example`, `BOT_MODE=polling`, `docker compose up -d --build`

## Деплой
Push в `main` → GitHub Actions (`.github/workflows/deploy.yml`) → VPS по SSH: сборка образов, бэкап БД, миграции, рестарт, проверка health. Не пушить в `main` без явной просьбы пользователя. Секреты — только в `.env` на сервере.

## Обязательно: документация обновляется вместе с кодом
Любое изменение или дополнение кода (фича, правка поведения, текста, кнопки, модели, env, деплоя) НЕ считается завершённым, пока не обновлена документация. Это часть задачи, а не опция; делай в том же заходе, без напоминаний владельца.

Что обновлять:
- Всегда: `docs/FEATURE_MAP.md` — добавь/исправь строку для затронутой функции (слова владельца, callback, файлы TG и MAX, логика). Удалил или переименовал файл — поправь ссылки.
- Структура кода (новый/переименованный модуль, сервис, папка): раздел «Карта» в этом файле.
- Таблицы/поля БД (`schema.prisma`): раздел «Модель данных» здесь + тематический doc.
- Подписка, оплата, напоминания → `docs/subscription-pilot.md`; логотип/брендинг → `docs/receipt-branding-pilot.md`; статистика, `/stats` → `docs/interactive-statistics.md`; деплой, сервер, CI → `docs/deployment.md`. Если подходящего doc нет, а фича крупная — создай `docs/<тема>.md` и добавь его в «Карта» и FEATURE_MAP.
- Новая или изменённая переменная окружения → `.env.example` и `README.md`; новая команда/скрипт → раздел «Команды» здесь.
- Изменился инвариант или правило поведения (например, подключили оплату, «подарок 365 дней» больше не верен) → раздел «Важные инварианты» здесь и тематический doc, иначе следующий чат получит ложные сведения.
- История изменений — только `git log`; файлов-чеклистов этапов в проекте нет (старый файл с чеклистом этапов удалён, не создавай заново).

Перед финальным ответом: `node scripts/check-agent-map.cjs` (проверяет, что файлы из карты существуют), затем в ответе одной строкой перечисли, какие документы обновлены. Не нужно обновлять документы при чисто технических правках без смены поведения и структуры (опечатка, форматирование). Этот файл держи < 100 строк; детали — в `docs/`.
