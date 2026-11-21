# Архитектура

## Выбор

Обычный монолит проще развернуть, но слабее показывает распределённое взаимодействие. Модульный монолит был бы разумен для реального малого продукта. Для задания выбрана компактная микросервисная архитектура: Identity и Booking с отдельными PostgreSQL базами и GraphQL API Gateway. Помещения и брони остаются в одном сервисе ради атомарной проверки доступности. Шлюз не содержит предметных правил. Брокер сообщений, Saga и CQRS для текущих сценариев не требуются.

## Паттерны

- API Gateway: GraphQL с явным SDL, единая внешняя точка входа, адаптация к внутренним REST-командам.
- MVC: React — представление; NestJS HTTP-контроллеры — приём и маршрутизация; BookingStore и PostgreSQL — модель. Это адаптация ответственности MVC для SPA, а не классический серверный рендеринг MVC.
- Service Layer: BookingStore реализует атомарные предметные операции. В MVP сервис и repository объединены в одном классе; отдельный Repository как реализованный паттерн не заявляется.
- Database per Service: отдельные БД, отсутствие межсервисных SQL JOIN. Identity отдаёт данные преподавателя через API; в брони хранится снимок имени.
- Dependency Injection применена явно через конструктор BookingStore: подключение БД и часы подменяются в тестах. Контроллеры регистрируются контейнером NestJS.

## Целостность и отказоустойчивость

Все изменения бронирований и закрытий выполняются в транзакциях PostgreSQL с общей advisory-блокировкой для MVP. Два частичных уникальных индекса запрещают действующие дубликаты `(room_id,date,slot)` и `(teacher_id,date,slot)`. Благодаря фиксированным непересекающимся парам здесь достаточно уникальности, диапазонные EXCLUDE-ограничения не нужны.

Серверный обработчик отменяет просроченные цепочки. Та же обработка выполняется перед предметными операциями и на старте. Состояние хранится в БД, а не в памяти таймера. Рекурсивная связь только с предыдущим номером пары исключает циклы при штатных операциях.

Identity выдаёт непрозрачные токены; остальные сервисы проверяют сессию через Identity и сами проверяют права. Межсервисный ключ отделяет внутренние HTTP-методы от внешнего API. В Compose наружу опубликован только Gateway на localhost. Зависимость от Identity означает, что при его отказе защищённые операции недоступны. Таймаут внутренних запросов — 8 секунд.

## Структура компонентов (UML-представление)

```mermaid
flowchart LR
  U[Преподаватель / администратор] --> V[React View]
  V -->|GraphQL / HTTP| G[API Gateway · NestJS]
  G -->|REST / HTTP| I[Identity service]
  G -->|REST / HTTP| B[Booking service]
  B -->|Проверка сессии и преподавателя| I
  I --> ID[(Identity PostgreSQL)]
  B --> BD[(Booking PostgreSQL)]
  W[Обработчик просрочек] --> B
```

## Последовательность создания брони

```mermaid
sequenceDiagram
  actor Teacher as Преподаватель
  participant UI as React
  participant G as Gateway
  participant B as Booking
  participant I as Identity
  participant DB as PostgreSQL
  Teacher->>UI: Выбор даты и пар
  UI->>G: createBooking + токен
  G->>B: POST /create
  B->>I: Проверить сессию
  I-->>B: Пользователь и роль
  B->>DB: BEGIN + advisory lock
  B->>DB: Отмена просроченных цепочек
  B->>B: Проверка даты, времени и владельца
  B->>DB: Проверка помещения и закрытий
  B->>DB: INSERT броней с уникальными индексами
  alt Конфликт
    B->>DB: ROLLBACK
    B-->>G: Ошибка конфликта
    G-->>UI: GraphQL errors
  else Успех
    B->>DB: COMMIT
    B-->>G: Созданные записи
    G-->>UI: Подтверждение и новые состояния
  end
```

## Состояния брони

```mermaid
stateDiagram-v2
  [*] --> CONFIRMED: Первая пара / быстрая бронь в окне
  [*] --> PENDING: Продолжение заранее
  PENDING --> CONFIRMED: Подтверждение в окне
  CONFIRMED --> PENDING: Добавлена ещё не завершённая предыдущая пара
  PENDING --> CANCELLED: Истёк срок / отменена предыдущая / ручная отмена
  CONFIRMED --> CANCELLED: Ручная отмена / отменена предыдущая
  CANCELLED --> [*]
```

Завершение пары определяется по времени, отдельный статус COMPLETED не нужен. Историческая подтверждённая запись остаётся CONFIRMED.

## ER: сервис бронирований

```mermaid
erDiagram
  ROOM ||--o{ BOOKING : contains
  ROOM ||--o{ CLOSURE : unavailable
  BOOKING o|--o| BOOKING : previous
  ROOM {
    uuid id PK
    text number
    text building
    int floor
    text kind
    int capacity
    jsonb equipment
    boolean active
  }
  BOOKING {
    uuid id PK
    uuid room_id FK
    uuid teacher_id "external identity reference"
    text teacher_name "snapshot"
    uuid created_by "external identity reference"
    date date
    int slot
    text status
    uuid previous_id FK
    timestamptz confirm_at
    timestamptz deadline
    text cancellation_reason
  }
  CLOSURE {
    uuid id PK
    uuid room_id FK
    date starts
    date ends
  }
```

## ER: сервис пользователей

```mermaid
erDiagram
  USER ||--o{ SESSION : owns
  USER {
    uuid id PK
    text name
    text login UK
    text password_hash
    text role
  }
  SESSION {
    text token_hash PK
    uuid user_id FK
    timestamptz expires_at
  }
```

## DFD: контекст

```mermaid
flowchart LR
  T[Преподаватель] -->|Поиск, бронь, подтверждение, отмена| S((Система бронирования))
  S -->|Занятость и результаты операций| T
  A[Администратор] -->|Пользователи, помещения, закрытия, брони| S
  S -->|Каталоги и результаты операций| A
```

## DFD: первый уровень

```mermaid
flowchart LR
  U[Пользователь] -->|Логин и пароль| P1((1. Аутентификация))
  P1 <--> D1[(Учётные записи и сессии)]
  P1 -->|Токен| U
  U -->|Фильтры| P2((2. Поиск помещений))
  D2[(Помещения и закрытия)] --> P2
  D3[(Брони)] --> P2
  P2 -->|Доступность| U
  U -->|Создание / отмена / подтверждение| P3((3. Бронирование))
  P3 <--> D3
  D2 --> P3
  P3 -->|Результат| U
  A[Администратор] --> P4((4. Управление каталогами))
  P4 <--> D2
  P4 <--> D1
```

## Развёртывание

```mermaid
flowchart TB
  Browser[Браузер Windows] -->|localhost:3000| Gateway
  subgraph Docker Desktop Linux
    Gateway[Gateway + собранный React]
    Identity[Identity container]
    Booking[Booking container + worker]
    IDB[(PostgreSQL identity)]
    BDB[(PostgreSQL booking)]
    Gateway --> Identity
    Gateway --> Booking
    Booking --> Identity
    Identity --> IDB
    Booking --> BDB
    IDB --> IV[identity-data volume]
    BDB --> BV[booking-data volume]
  end
```

Диаграммы — исходные модели для дальнейшего оформления. Mermaid flowchart выше не заменяет строго оформленные UML Use Case/Component/Deployment, если преподаватель требует нотацию UML в draw.io. Финальное графическое оформление и полный текст пояснительной записки — отдельный следующий этап.

## Основания выбора технологий

TypeScript используется на клиенте и сервере; общие типы ограничивают расхождения. NestJS предоставляет HTTP-контроллеры и структуру модулей. GraphQL.js исполняет явную SDL-схему внутри контроллера Gateway; Apollo не требуется. PostgreSQL обеспечивает транзакции и уникальные частичные индексы. Docker Compose даёт воспроизводимый локальный стенд. React обслуживает интерактивное расписание.

Документация: https://docs.nestjs.com/controllers · https://graphql.org/learn/schema/ · https://www.postgresql.org/docs/17/indexes-partial.html
