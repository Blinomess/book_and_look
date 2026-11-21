# Кампус — бронирование учебных помещений

Учебный MVP по архитектуре клиент-серверных приложений. React/TypeScript, NestJS, GraphQL SDL, PostgreSQL, Docker Compose. Все данные сохраняются в PostgreSQL; статических подмен API нет.

Подробное описание назначения файлов, функций, обработчиков интерфейса и конфигураций: [справочник по коду](docs/code-reference.md).

![Экран входа в Кампус](docs/screenshots/login.png)

## Запуск на Windows

1. Запустить Docker Desktop и дождаться готовности Linux engine.
2. В корне проекта выполнить:

```powershell
docker compose up --build -d
docker compose ps
```

Открыть http://localhost:3000. Первый запуск скачивает образы и зависимости.

Демонстрационные пользователи (создаются один раз при первом запуске):

| Логин | Пароль по умолчанию | Роль |
|---|---|---|
| admin | Campus2026! | Администратор |
| teacher | Campus2026! | Анна Смирнова, преподаватель |
| petrov | Campus2026! | Иван Петров, преподаватель |

Для собственных настроек скопировать `.env.example` в `.env` **до первого запуска**. Изменение DEMO_PASSWORD не меняет пароли уже созданных пользователей. Стенд привязан к localhost; демонстрационные секреты предназначены только для локального запуска.

```powershell
docker compose logs --tail=100 gateway identity booking
docker compose down
```

Обычная остановка сохраняет данные. Не используйте `down -v`, если хотите сохранить пользователей и брони.

## Разработка и проверки

```powershell
npm ci
npm run build
npm test
```

Полная проверка правил с PostgreSQL, без установки СУБД на Windows:

```powershell
docker compose -p campus-ci -f compose.test.yaml up --build --abort-on-container-exit --exit-code-from tests
docker compose -p campus-ci -f compose.test.yaml down
```

Проверка HTTP/GraphQL и прав доступа на запущенном демонстрационном стенде:

```powershell
node scripts/smoke.mjs
```

Она создаёт и затем отменяет две записи на завтра (либо на понедельник). Запускать на демонстрационных данных со свободными 5-й и 6-й парами; отменённые записи сохраняются в истории.

Для `npm run dev` нужны две PostgreSQL базы `identity` и `booking`. Их адреса задаются `IDENTITY_DATABASE_URL` и `BOOKING_DATABASE_URL`. Сначала выполнить `npm run build`: сервер работает из `dist`, клиент Vite — на http://localhost:5173. После изменения серверного кода пересобрать и перезапустить процесс.

Интеграционный тест выполняется на настоящем PostgreSQL, создаёт отдельную случайную схему и удаляет только её:

```powershell
$env:TEST_DATABASE_URL='postgresql://user:password@localhost:5432/test_database'
npm test
```

Без переменной интеграционный тест явно пропускается. Модульные проверки времени выполняются всегда.

## Структура

- `web/src/` — интерфейс React: расписание, личные брони, помещения, пользователи.
- `server/gateway.ts`, `server/schema.graphql` — публичный GraphQL API и раздача веб-клиента.
- `server/identity.ts` — учётные записи и сессии, собственная БД.
- `server/booking.ts` — REST-контроллер сервиса помещений и бронирований.
- `server/booking-store.ts` — правила, транзакции, доступ к данным.
- `shared/domain.ts` — расписание и функции времени.
- `tests/` — проверки предметных правил и интеграционные проверки.
- `docs/` — требования, архитектура и диаграммы в Mermaid.
- `infra/` — локальный Kubernetes.
