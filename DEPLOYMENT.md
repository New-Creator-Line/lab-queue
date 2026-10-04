# Бесплатное развёртывание: Vercel + Supabase

Инструкция рассчитана на новый проект. Для группы из 30 человек бесплатных тарифов обычно достаточно.

## 1. Что потребуется

- аккаунт GitHub;
- аккаунт Vercel на тарифе Hobby;
- аккаунт Supabase на тарифе Free;
- Telegram-бот, созданный через `@BotFather`;
- Node.js 22 или новее — только если хотите запускать проект локально.

Актуальные условия всегда проверяйте на официальных страницах:

- https://vercel.com/pricing
- https://supabase.com/pricing

На момент подготовки инструкции Vercel Hobby стоит $0 и предназначен для личных некоммерческих проектов. Supabase Free также стоит $0, включает базу PostgreSQL до 500 МБ, но может приостанавливать неактивный проект после недели без обращений. Для этой очереди объём базы будет значительно меньше лимита.

## 2. Создать базу Supabase

1. Откройте https://supabase.com/dashboard и создайте новый проект на Free.
2. Сохраните пароль базы данных в менеджере паролей.
3. Откройте `SQL Editor` → `New query`.
4. Скопируйте туда весь файл `supabase/setup.sql` и нажмите `Run`.
5. Откройте `Connect` и скопируйте строку подключения `Transaction pooler`.
6. Замените в строке `[YOUR-PASSWORD]` на пароль базы. Итог должен начинаться с `postgresql://` и обычно использовать порт `6543`.

Эта строка станет секретной переменной `DATABASE_URL`. Не публикуйте её и не добавляйте в GitHub.

## 3. Подготовить Telegram-бота

1. Откройте `@BotFather` в Telegram.
2. Создайте нового бота командой `/newbot` или используйте существующего.
3. Сохраните токен бота. Он понадобится как `TELEGRAM_BOT_TOKEN`.
4. Имя бота без символа `@` понадобится как `TELEGRAM_BOT_USERNAME`.
5. Придумайте отдельный случайный секрет для webhook. Разрешены латинские буквы, цифры, `_` и `-`. Например, можно сгенерировать его командой:

   ```bash
   openssl rand -hex 32
   ```

   Значение понадобится как `TELEGRAM_WEBHOOK_SECRET`.

Если токен бота когда-либо отправлялся в чат, публиковался или попадал в файл, сначала перевыпустите его через `@BotFather` и используйте только новый токен.

## 4. Загрузить код в GitHub

1. Распакуйте архив.
2. Создайте новый приватный репозиторий на https://github.com/new.
3. Загрузите в него содержимое папки `lab-queue`.

Через терминал это можно сделать так:

```bash
git init
git add .
git commit -m "Initial deployment"
git branch -M main
git remote add origin https://github.com/YOUR_NAME/YOUR_REPOSITORY.git
git push -u origin main
```

Файлы `.env.local`, `work/`, `.vercel/`, `.next/` и `node_modules/` в архив намеренно не включены. Секреты должны храниться только в настройках Vercel.

## 5. Создать проект Vercel

1. Откройте https://vercel.com/new.
2. Импортируйте репозиторий GitHub.
3. Framework Preset должен определиться как `Next.js`.
4. Добавьте Environment Variables для окружений Production, Preview и Development:

   | Переменная | Значение |
   |---|---|
   | `DATABASE_URL` | строка Transaction pooler из Supabase |
   | `TELEGRAM_BOT_USERNAME` | имя бота без `@` |
   | `TELEGRAM_BOT_TOKEN` | новый токен BotFather |
   | `TELEGRAM_WEBHOOK_SECRET` | случайный секрет из шага 3 |
   | `ADMIN_TELEGRAM_IDS` | Telegram ID администраторов через запятую |

5. Нажмите `Deploy`.
6. После завершения скопируйте адрес вида `https://your-project.vercel.app`.

Если вы меняете переменные позднее, откройте `Project Settings` → `Environment Variables`, сохраните значения и выполните Redeploy последнего деплоя.

## 6. Подключить Telegram webhook

После первого деплоя выполните запрос, подставив свои значения:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://YOUR-PROJECT.vercel.app/api/telegram/webhook",
    "secret_token": "YOUR_TELEGRAM_WEBHOOK_SECRET",
    "allowed_updates": ["message"],
    "drop_pending_updates": true
  }'
```

Telegram должен вернуть `{"ok":true,...}`. Проверить состояние можно так:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

В поле `url` должен быть адрес `/api/telegram/webhook`, а `last_error_message` должен отсутствовать. Документация Telegram: https://core.telegram.org/bots/api#setwebhook

## 7. Проверить работу

1. Откройте публичный адрес Vercel в обычном браузере.
2. Нажмите вход через Telegram.
3. Перейдите в бот по одноразовой ссылке и нажмите `Start`.
4. Нажмите кнопку возврата на сайт в сообщении бота.
5. Проверьте запись в очередь, выход и обновление списка.
6. Войдите администратором и проверьте изменение порядка на ещё не завершившемся занятии.

Доступ получат только аккаунты из `lib/roster.ts`. Первая подгруппа — позиции 1–15, вторая — 16–30. Основной суперадминистратор отмечен в этом файле; дополнительные суперадминистраторы могут быть перечислены в `ADMIN_TELEGRAM_IDS`. Суперадминистратор назначает обычных администраторов через раздел «Администраторы» после того, как участник хотя бы один раз вошёл на сайт.

## 8. Обновления и обслуживание

- Изменяйте список группы в `lib/roster.ts`, затем отправляйте изменения в GitHub. Vercel развернёт новую версию автоматически.
- Ошибки приложения смотрите в Vercel: `Project` → `Logs`.
- Ошибки базы смотрите в Supabase: `Logs` → `Postgres Logs`.
- Делайте резервные копии важных данных вручную: бесплатный Supabase не включает автоматические резервные копии.
- Если Supabase приостановил проект после бездействия, восстановите его в Dashboard; сайт снова заработает после пробуждения базы.
- При смене домена повторно вызовите `setWebhook` с новым адресом.
- Никогда не помещайте реальные значения токенов и `DATABASE_URL` в репозиторий.

## 9. Локальная проверка перед публикацией

```bash
cp .env.example .env.local
# заполните .env.local своими значениями
npm ci
npm run lint
npm run build
npm run dev
```

Файл `.env.local` игнорируется Git и должен оставаться только на вашем компьютере.
