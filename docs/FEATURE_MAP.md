# FEATURE_MAP — «что видит пользователь» → «где это в коде»

Для агента: владелец проекта НЕ программист и говорит словами интерфейса («кнопка Моя подписка», «текст после покупки», «квитанция не приходит»). Найди строку ниже по его словам и сразу открывай указанные файлы. Не исследуй репозиторий.

Обозначения: **TG** = Telegram (`apps/bot/src/handlers/*`, `keyboards/index.ts`), **MAX** = `apps/bot/src/max/*`. Любая пользовательская правка почти всегда нужна в ОБОИХ каналах. Бизнес-логика общая: `apps/bot/src/services/*`.
Кнопки: TG — `keyboards/index.ts`, MAX — `max/keyboards.ts`. Нажатие кнопки = строка-«callback» (`menu:...`), обрабатывается: TG — `handlers/callbacks.ts`, MAX — `max/handlers.ts` (функция `callback`).
Ввод текста пользователем: TG — `handlers/messages.ts`, MAX — `max/handlers.ts`; что бот сейчас ждёт — `session.awaitingInput` (`utils/state.ts`).

## Таблица

| Что говорит владелец | Callback / команда | TG | MAX | Логика |
|---|---|---|---|---|
| Главное меню, набор кнопок | `menu:main` | `keyboards/index.ts` mainMenuKeyboard | `max/keyboards.ts` mainMenuKeyboard | — |
| /start, регистрация, первое знакомство, /help | `/start`, `/help` | `handlers/commands.ts` (goToMainFlow) | `max/handlers.ts` | `services/userService.ts` |
| Новая квитанция, добавить услугу в квитанцию, цена, количество, форма оплаты, «Приход/Возврат», предпросмотр | `menu:receipt:new`, `receipt:*` | `handlers/callbacks.ts` (блок receipt:), `handlers/messages.ts` | `max/handlers.ts` | `services/operationService.ts` (buildReceiptPreviewText, createOperationWithSnapshots) |
| Квитанция формируется / не пришла / ошибка рендера | `receipt:confirm` | — | — | `operationService.renderAndSendOperation` → `services/rendererClient.ts` → `apps/renderer-worker/src/renderReceipt.ts` |
| Внешний вид квитанции (шаблон, шрифты, поля) | — | — | — | `apps/renderer-worker/src/templates/receipt.hbs`, `receiptPayload.ts` |
| Номер квитанции KV-000001 (план: KVT для TG, KVM для MAX; единый сквозной счётчик; старые номера сохраняются) | — | — | — | `operationService.ts` (createOperationWithSnapshots); схема `Operation.receiptNumber`; проектные правила — `docs/account-linking.md`, раздел 2.1 |
| Список квитанций, история, повторно отправить, удалить квитанцию | `menu:operations`, `history:*` | `handlers/callbacks.ts` | `max/handlers.ts` | `operationService.ts` (listRecentOperations, sendExistingReceipt, deleteOperationForUser) |
| Услуги: список, добавить, удалить | `menu:services`, `service:*` | `handlers/callbacks.ts` | `max/handlers.ts` | `services/userService.ts` (listActiveServices, createService, softDeleteService) |
| Данные ИП: ИНН, ФИО, адрес, ОГРН | `menu:profile`, `profile:edit:*` | `handlers/callbacks.ts` | `max/handlers.ts` | `userService.ts` (upsertProfile, updateProfileField), `utils/validation.ts` |
| Часовой пояс | `profile:tz`, `tz:*` | `handlers/callbacks.ts` | `max/handlers.ts` | `services/timeZoneService.ts`, `packages/shared/src/timezones.ts` |
| Выгрузка в Excel | `menu:export` | `handlers/callbacks.ts` (menu:export) | `max/handlers.ts` (menu:export) | `services/exportService.ts` |
| Моя подписка: экран, купить, продлить, осталось дней | `menu:subscription`, `sub:buy` | `handlers/subscription.ts` | `max/subscription.ts` | `services/subscriptionService.ts` (цена/срок — константы вверху файла); тексты: buildSubscriptionText |
| Напоминания об окончании подписки (за 3/2/1 день) | — | — | — | `subscriptionService.ts` (runSubscriptionReminders, startSubscriptionReminderScheduler) |
| Оплата подписки (ещё НЕ подключена, сейчас подарок 365 дней) | `sub:buy` | `handlers/subscription.ts` | `max/subscription.ts` | `subscriptionService.purchaseSubscription` |
| Свой логотип / подпись на квитанции (брендинг) | `branding:*` | `handlers/branding.ts` | `max/subscription.ts` (branding: и handleMaxBrandingInput) | `services/brandingService.ts`, `brandingStorage.ts`, `packages/shared/src/branding.ts`; вид — `receipt.hbs`; детали — `docs/receipt-branding-pilot.md` |
| Поддержка (написать автору бота) | `support:open` | `handlers/subscription.ts` | `max/subscription.ts` (handleMaxSupportInput) | `services/supportService.ts` |
| «Синхронизировать Max и TG», подключить второй мессенджер, объединить истории одного ИП (пока заглушка) | `sub:sync` | `handlers/subscription.ts` | `max/subscription.ts` | Связывание ещё не реализовано; `docs/account-linking.md`: префиксы KVT/KVM с единым счётчиком, более поздняя подписка; раздел 13 — совместимость с действующими пользователями |
| Статистика для админа, /stats, ежедневный отчёт, картинка с графиками за месяц (пользователи, активные за день, активные за 7 дней, квитанции) | `/stats` | `handlers/statistics.ts` | — | `statisticsService.ts`, `statisticsChart.ts`, `statisticsWidget.ts`, `dailyStatsService.ts`, `telegramWidgetApi.ts`; `docs/interactive-statistics.md` |
| Что-то со вебхуками, запуском, health | — | `apps/bot/src/index.ts` | `max/webhook.ts`, `max/client.ts` | `config.ts` (env-переменные) |
| Деплой, сервер, GitHub Actions | — | — | — | `.github/workflows/deploy.yml`, `scripts/deploy*.sh`, `docs/deployment.md` |
| Таблицы БД, новое поле | — | — | — | `packages/db/prisma/schema.prisma` + новая миграция в `packages/db/prisma/migrations/` |

## Как искать то, чего нет в таблице
1. Владелец называет текст на экране → `grep` по этой точной русской строке в `apps/bot/src` (тексты кнопок: `keyboards/index.ts`, `max/keyboards.ts`; тексты сообщений: `services/*`, `handlers/*`, `max/*`).
2. Название кнопки → её callback в keyboards → `grep` этого callback в `handlers/callbacks.ts` и `max/handlers.ts`.
3. Если нашёл новое место, которого нет в таблице, — добавь строку сюда (одна строка, без лишних слов).
