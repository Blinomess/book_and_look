import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Booking,
  Room,
  User,
  SLOTS,
  today,
  addDays,
  slotTime,
} from "../../shared/domain";
import "./style.css";
type Closure = { id: string; roomId: string; starts: string; ends: string };
const roomFields = "id number building floor kind capacity equipment active";
const bookingFields =
  "id roomId teacherId teacherName createdBy date slot status previousId confirmAt deadline cancellationReason";
async function api(query: string, variables: Record<string, unknown> = {}) {
  const r = await fetch("/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: sessionStorage.getItem("token")
        ? "Bearer " + sessionStorage.getItem("token")
        : "",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!r.ok) throw new Error("Сервер недоступен");
  const result = await r.json();
  if (result.errors?.length) throw new Error(result.errors[0].message);
  return result.data;
}
function App() {
  const [user, setUser] = useState<User | null>(null),
    [rooms, setRooms] = useState<Room[]>([]),
    [bookings, setBookings] = useState<Booking[]>([]),
    [closures, setClosures] = useState<Closure[]>([]),
    [users, setUsers] = useState<User[]>([]);
  const [date, setDate] = useState(today()),
    [page, setPage] = useState("schedule"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [boot, setBoot] = useState(true);
  const [now, setNow] = useState(new Date()),
    [offset, setOffset] = useState(0),
    [search, setSearch] = useState(""),
    [kind, setKind] = useState(""),
    [capacity, setCapacity] = useState(""),
    [equipment, setEquipment] = useState("");
  const [selected, setSelected] = useState<{ roomId: string; slot: number }[]>(
      [],
    ),
    [teacherId, setTeacherId] = useState("");
  const [edit, setEdit] = useState<Room | Partial<Room> | null>(null),
    [userForm, setUserForm] = useState(false),
    [close, setClose] = useState<Room | null>(null),
    [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);
  async function refresh() {
    const d = await api(
      `{me{id name login role} rooms{${roomFields}} bookings{${bookingFields}} closures{id roomId starts ends} serverTime}`,
    );
    setUser(d.me);
    setRooms(d.rooms);
    setBookings(d.bookings);
    setClosures(d.closures);
    const t = new Date(d.serverTime);
    setOffset(t.getTime() - Date.now());
    setNow(t);
    if (d.me.role === "ADMIN")
      setUsers((await api("{users{id name login role}}")).users);
  }
  useEffect(() => {
    if (sessionStorage.getItem("token"))
      refresh()
        .catch((e) => setError(e.message))
        .finally(() => setBoot(false));
    else setBoot(false);
  }, []);
  useEffect(() => {
    if (!user) return;
    const t = setInterval(
      () => refresh().catch((e) => setError(e.message)),
      15000,
    );
    return () => clearInterval(t);
  }, [user?.id]);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date(Date.now() + offset)), 1000);
    return () => clearInterval(t);
  }, [offset]);
  async function action(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await refresh();
      setNotice(message);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const admin = user?.role === "ADMIN";
  const active = bookings.filter((b) => b.status !== "CANCELLED");
  const filtered = rooms.filter(
    (r) =>
      r.active &&
      (!kind || r.kind === kind) &&
      r.capacity >= Number(capacity || 0) &&
      (!equipment || r.equipment.includes(equipment)) &&
      `${r.number} ${r.building}`.toLowerCase().includes(search.toLowerCase()),
  );
  const myBookings = bookings
    .filter((b) => admin || b.teacherId === user?.id)
    .filter((b) => b.date >= today(now))
    .sort((a, b) => a.date.localeCompare(b.date) || a.slot - b.slot);
  const awaiting = myBookings.filter(
    (b) =>
      b.status === "PENDING" &&
      b.confirmAt &&
      b.deadline &&
      new Date(b.confirmAt) <= now &&
      now < new Date(b.deadline),
  );
  function choose(roomId: string, slot: number) {
    setSelected((s) =>
      s.some((x) => x.roomId === roomId && x.slot === slot)
        ? s.filter((x) => !(x.roomId === roomId && x.slot === slot))
        : [...s.filter((x) => x.slot !== slot), { roomId, slot }],
    );
  }
  const displayDate = (d: string) =>
    new Date(d + "T12:00:00+03:00").toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      weekday: "short",
    });
  if (boot) return <div className="loading">Загружаем кампус…</div>;
  if (!user)
    return (
      <main className="login-layout">
        <section className="login-story">
          <div className="brand">
            <i aria-hidden="true" />
            Кампус
          </div>
          <h1>
            Бронирование
            <br />
            аудиторий
          </h1>
          <div className="campus-print" aria-hidden="true">
            <i className="sun" />
            <i className="building tower" />
            <i className="building wing" />
            <i className="building hall" />
          </div>
        </section>
        <section className="login-panel">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              setError("");
              try {
                const d = await api(
                  "mutation($login:String!,$password:String!){login(login:$login,password:$password){token}}",
                  Object.fromEntries(f),
                );
                sessionStorage.setItem("token", d.login.token);
                await refresh();
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <h2>Вход в систему</h2>
            <p className="muted">
              Используйте учётную запись преподавателя или администратора.
            </p>
            {error && (
              <div role="alert" className="error">
                {error}
              </div>
            )}
            <label>
              Логин
              <input name="login" autoComplete="username" required />
            </label>
            <label>
              Пароль
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? "Входим…" : "Войти →"}
            </button>
            <p className="muted small">
              Нет учётной записи? Обратитесь к администратору.
            </p>
          </form>
        </section>
      </main>
    );
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <i aria-hidden="true" />
          Кампус
        </div>
        <nav aria-label="Основная навигация">
          {[
            ["schedule", "▦", "Расписание"],
            ["bookings", "◷", admin ? "Все бронирования" : "Мои бронирования"],
            ...(admin
              ? [
                  ["rooms", "▤", "Помещения"],
                  ["users", "♙", "Пользователи"],
                ]
              : []),
          ].map(([id, icon, title]) => (
            <button
              key={id}
              className={page === id ? "nav-active" : ""}
              aria-current={page === id ? "page" : undefined}
              onClick={() => setPage(id)}
            >
              <span>{icon}</span>
              {title}
            </button>
          ))}
        </nav>
        <div className="aside-bottom">
          <div className="avatar">{user.name[0]}</div>
          <strong>{user.name}</strong>
          <small>{admin ? "Администратор" : "Преподаватель"}</small>
          <button
            onClick={async () => {
              try {
                await api("mutation{logout}");
              } finally {
                sessionStorage.removeItem("token");
                setUser(null);
                setPage("schedule");
                setTeacherId("");
                setError("");
                setNotice("");
                setSelected([]);
                setUsers([]);
              }
            }}
          >
            Выйти ↗
          </button>
        </div>
      </aside>
      <main className="content">
        <header>
          <span>
            Учебные пространства /{" "}
            {page === "schedule"
              ? "Расписание"
              : page === "bookings"
                ? "Бронирования"
                : page === "rooms"
                  ? "Помещения"
                  : "Пользователи"}
          </span>
          <span className="live">
            <i />{" "}
            {now.toLocaleTimeString("ru-RU", {
              timeZone: "Europe/Moscow",
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            МСК
          </span>
        </header>
        {error && (
          <div role="alert" className="error">
            {error}
            <button onClick={() => setError("")}>×</button>
          </div>
        )}
        {notice && (
          <div role="status" className="success">
            {notice}
            <button onClick={() => setNotice("")}>×</button>
          </div>
        )}
        {awaiting.length > 0 && (
          <div className="warning">
            Нужно подтвердить продолжение: {awaiting.length}. Без подтверждения
            оставшиеся пары последовательности будут отменены.{" "}
            <button onClick={() => setPage("bookings")}>Перейти →</button>
          </div>
        )}
        {page === "schedule" && (
          <>
            <div className="page-heading">
              <div>
                <h1>Расписание аудиторий</h1>
                <p className="muted">
                  Выберите свободные пары. Одна бронь — одна пара.
                </p>
              </div>
              <div className="counter">
                <strong>{rooms.filter((r) => r.active).length}</strong>
                <span>
                  Помещения
                  <br />в каталоге
                </span>
              </div>
            </div>
            <div className="days">
              {Array.from({ length: 7 }, (_, i) => addDays(today(now), i)).map(
                (d) => (
                  <button
                    key={d}
                    className={date === d ? "day selected" : "day"}
                    aria-pressed={date === d}
                    onClick={() => {
                      setDate(d);
                      setSelected([]);
                    }}
                  >
                    <span>
                      {d === today(now)
                        ? "Сегодня"
                        : new Date(d + "T12:00:00Z").toLocaleDateString(
                            "ru-RU",
                            { weekday: "short" },
                          )}
                    </span>
                    <strong>
                      {new Date(d + "T12:00:00Z").toLocaleDateString("ru-RU", {
                        day: "numeric",
                        month: "short",
                      })}
                    </strong>
                  </button>
                ),
              )}
            </div>
            <div className="filters">
              <input
                aria-label="Поиск помещения"
                placeholder="Поиск по номеру или корпусу"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                aria-label="Тип помещения"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                <option value="">Все типы</option>
                <option value="CLASSROOM">Аудитории</option>
                <option value="LAB">Лаборатории</option>
              </select>
              <input
                aria-label="Минимальная вместимость"
                type="number"
                min="1"
                placeholder="Вместимость от"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
              />
              <select
                aria-label="Оборудование"
                value={equipment}
                onChange={(e) => setEquipment(e.target.value)}
              >
                <option value="">Любое оборудование</option>
                {[...new Set(rooms.flatMap((r) => r.equipment))]
                  .sort()
                  .map((e) => (
                    <option key={e}>{e}</option>
                  ))}
              </select>
            </div>
            <div className="table-top">
              <strong>{displayDate(date)}</strong>
              <span>
                <i className="dot free" /> Свободно{" "}
                <i className="dot occupied" /> Занято{" "}
                <i className="dot pending" /> Ждёт подтверждения
              </span>
            </div>
            <div className="table-scroll">
              <table className="schedule">
                <thead>
                  <tr>
                    <th>Помещение</th>
                    {SLOTS.map((s) => (
                      <th key={s.number}>
                        {s.number} пара
                        <small>
                          {s.start} — {s.end}
                        </small>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id}>
                      <th>
                        <strong>
                          {r.kind === "LAB" ? "Лаб." : "Ауд."} {r.number}
                        </strong>
                        <small>
                          {r.building} · этаж {r.floor}
                        </small>
                        <small>До {r.capacity} человек</small>
                        <div className="tags">
                          {r.equipment.map((e) => (
                            <span key={e}>{e}</span>
                          ))}
                        </div>
                      </th>
                      {SLOTS.map((s) => {
                        const b = active.find(
                          (b) =>
                            b.roomId === r.id &&
                            b.date === date &&
                            b.slot === s.number,
                        );
                        const blocked =
                          new Date(date + "T12:00:00Z").getUTCDay() === 0 ||
                          slotTime(date, s.number, "end") <= now ||
                          closures.some(
                            (c) =>
                              c.roomId === r.id &&
                              c.starts <= date &&
                              c.ends >= date,
                          );
                        const checked = selected.some(
                          (x) => x.roomId === r.id && x.slot === s.number,
                        );
                        return (
                          <td key={s.number}>
                            <button
                              disabled={!!b || blocked || busy}
                              aria-pressed={checked}
                              className={
                                "cell " +
                                (b
                                  ? b.status === "PENDING"
                                    ? "pending-cell"
                                    : "booked"
                                  : blocked
                                    ? "unavailable"
                                    : checked
                                      ? "chosen"
                                      : "available")
                              }
                              onClick={() => choose(r.id, s.number)}
                            >
                              <span className="mobile-slot">
                                {s.number} пара · {s.start}–{s.end}
                              </span>
                              {b ? (
                                <>
                                  <strong>{b.teacherName}</strong>
                                  <small>
                                    {b.status === "PENDING"
                                      ? "Ждёт подтверждения"
                                      : "Забронировано"}
                                  </small>
                                </>
                              ) : blocked ? (
                                "Недоступно"
                              ) : checked ? (
                                "✓ Выбрано"
                              ) : (
                                <>
                                  {slotTime(date, s.number, "start") <= now
                                    ? "Занять до " + s.end
                                    : "+ Забронировать"}
                                </>
                              )}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filtered.length && (
                <div className="empty">
                  Нет помещений по выбранным фильтрам.
                </div>
              )}
            </div>
            <p className="muted small">
              Последовательные пары требуют подтверждения за 10 минут до
              окончания предыдущей — даже при смене помещения.
            </p>
            {selected.length > 0 && (
              <div className="booking-bar">
                <div>
                  <strong>Выбрано пар: {selected.length}</strong>
                  <small>
                    {[...selected]
                      .sort((a, b) => a.slot - b.slot)
                      .map(
                        (s) =>
                          `${s.slot} пара · ${rooms.find((r) => r.id === s.roomId)?.number}`,
                      )
                      .join(" / ")}
                  </small>
                </div>
                {admin && (
                  <select
                    aria-label="Преподаватель"
                    value={teacherId}
                    onChange={(e) => setTeacherId(e.target.value)}
                  >
                    <option value="">Выберите преподавателя</option>
                    {users
                      .filter((u) => u.role === "TEACHER")
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                  </select>
                )}
                <button className="secondary" onClick={() => setSelected([])}>
                  Сбросить
                </button>
                <button
                  className="primary"
                  disabled={busy || (admin && !teacherId)}
                  onClick={() =>
                    action(async () => {
                      await api(
                        `mutation($date:String!,$slots:[SlotInput!]!,$teacherId:ID){createBooking(date:$date,slots:$slots,teacherId:$teacherId){id}}`,
                        {
                          date,
                          slots: selected,
                          teacherId: admin ? teacherId : user.id,
                        },
                      );
                      setSelected([]);
                    }, "Бронирование создано")
                  }
                >
                  Забронировать →
                </button>
              </div>
            )}
          </>
        )}
        {page === "bookings" && (
          <>
            <div className="page-heading">
              <div>
                <h1>{admin ? "Все бронирования" : "Мои бронирования"}</h1>
                <p className="muted">
                  Текущие и будущие записи, включая отменённые.
                </p>
              </div>
            </div>
            <div className="booking-list">
              {myBookings.map((b) => {
                const r = rooms.find((r) => r.id === b.roomId);
                const canConfirm =
                  b.status === "PENDING" &&
                  !!b.confirmAt &&
                  !!b.deadline &&
                  new Date(b.confirmAt) <= now &&
                  now < new Date(b.deadline);
                return (
                  <article
                    key={b.id}
                    className={
                      "booking-card " +
                      (b.status === "CANCELLED" ? "cancelled" : "")
                    }
                  >
                    <div className="booking-slot">
                      {b.slot}
                      <small>пара</small>
                    </div>
                    <div className="booking-info">
                      <strong>
                        {r?.kind === "LAB" ? "Лаборатория" : "Аудитория"}{" "}
                        {r?.number}{" "}
                        <span className={"badge " + b.status.toLowerCase()}>
                          {b.status === "PENDING"
                            ? "Ожидает подтверждения"
                            : b.status === "CANCELLED"
                              ? "Отменено"
                              : "Подтверждено"}
                        </span>
                      </strong>
                      <p>
                        {displayDate(b.date)} · {SLOTS[b.slot - 1].start}–
                        {SLOTS[b.slot - 1].end} · {b.teacherName}
                      </p>
                      {b.status === "PENDING" && (
                        <small>
                          Подтвердите {displayDate(b.date)} с{" "}
                          {new Date(b.confirmAt!).toLocaleTimeString("ru-RU", {
                            timeZone: "Europe/Moscow",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}{" "}
                          до{" "}
                          {new Date(b.deadline!).toLocaleTimeString("ru-RU", {
                            timeZone: "Europe/Moscow",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          . Иначе эта и последующие связанные пары отменятся.
                        </small>
                      )}
                      {b.cancellationReason && (
                        <small>{b.cancellationReason}</small>
                      )}
                    </div>
                    <div className="card-actions">
                      {canConfirm && (
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() =>
                            action(
                              () =>
                                api(
                                  "mutation($id:ID!){confirmBooking(id:$id)}",
                                  { id: b.id },
                                ),
                              "Следующая пара подтверждена",
                            )
                          }
                        >
                          Подтвердить
                        </button>
                      )}
                      {b.status !== "CANCELLED" &&
                        (admin || slotTime(b.date, b.slot, "start") > now) && (
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() => {
                              setError("");
                              setCancelTarget(b);
                            }}
                          >
                            Отменить
                          </button>
                        )}
                    </div>
                  </article>
                );
              })}
              {!myBookings.length && (
                <div className="empty">
                  Бронирований пока нет. Выберите помещение в расписании.
                </div>
              )}
            </div>
          </>
        )}
        {page === "rooms" && admin && (
          <>
            <div className="page-heading">
              <div>
                <h1>Помещения</h1>
              </div>
              <button
                className="primary"
                onClick={() =>
                  setEdit({
                    number: "",
                    building: "Главный корпус",
                    floor: 1,
                    kind: "CLASSROOM",
                    capacity: 30,
                    equipment: [],
                    active: true,
                  })
                }
              >
                + Добавить помещение
              </button>
            </div>
            <div className="room-grid">
              {rooms.map((r) => (
                <article className="room-card" key={r.id}>
                  <span className="eyebrow">
                    {r.kind === "LAB" ? "ЛАБОРАТОРИЯ" : "АУДИТОРИЯ"}
                    {!r.active ? " · НЕАКТИВНА" : ""}
                  </span>
                  <h2>{r.number}</h2>
                  <p>
                    {r.building} · {r.floor} этаж · до {r.capacity} человек
                  </p>
                  <div className="tags">
                    {r.equipment.map((e) => (
                      <span key={e}>{e}</span>
                    ))}
                  </div>
                  <div className="card-actions">
                    <button className="secondary" onClick={() => setEdit(r)}>
                      Изменить
                    </button>
                    <button className="secondary" onClick={() => setClose(r)}>
                      Закрыть на даты
                    </button>
                  </div>
                  {closures
                    .filter((c) => c.roomId === r.id)
                    .map((c) => (
                      <div key={c.id} className="closure">
                        Закрыто: {c.starts} — {c.ends}
                        <button
                          disabled={busy}
                          onClick={() =>
                            action(
                              () =>
                                api("mutation($id:ID!){reopenRoom(id:$id)}", {
                                  id: c.id,
                                }),
                              "Закрытие снято",
                            )
                          }
                        >
                          Снять
                        </button>
                      </div>
                    ))}
                </article>
              ))}
            </div>
          </>
        )}
        {page === "users" && admin && (
          <>
            <div className="page-heading">
              <div>
                <h1>Пользователи</h1>
              </div>
              <button className="primary" onClick={() => setUserForm(true)}>
                + Добавить пользователя
              </button>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Имя</th>
                    <th>Логин</th>
                    <th>Роль</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.name}</td>
                      <td>{u.login}</td>
                      <td>
                        {u.role === "ADMIN" ? "Администратор" : "Преподаватель"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <footer>
          Кампус · Система бронирования учебных помещений
          <span>Время вуза: Москва, UTC+3</span>
        </footer>
      </main>
      {cancelTarget && (
        <Modal
          title="Отменить бронирование?"
          onClose={() => setCancelTarget(null)}
        >
          <p>
            Будет отменена {cancelTarget.slot}-я пара{" "}
            {displayDate(cancelTarget.date)} и все оставшиеся связанные пары.
            Помещения снова станут доступны другим преподавателям.
          </p>
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          <div className="card-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setCancelTarget(null)}
            >
              Оставить бронь
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                action(async () => {
                  await api("mutation($id:ID!){cancelBooking(id:$id)}", {
                    id: cancelTarget.id,
                  });
                  setCancelTarget(null);
                }, "Бронь и связанные пары отменены")
              }
            >
              Да, отменить
            </button>
          </div>
        </Modal>
      )}
      {edit && (
        <Modal
          title={edit.id ? "Редактирование помещения" : "Новое помещение"}
          onClose={() => setEdit(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = Object.fromEntries(new FormData(e.currentTarget));
              action(async () => {
                await api(
                  `mutation($input:RoomInput!){saveRoom(input:$input){id}}`,
                  {
                    input: {
                      ...(edit.id ? { id: edit.id } : {}),
                      number: f.number,
                      building: f.building,
                      floor: Number(f.floor),
                      kind: f.kind,
                      capacity: Number(f.capacity),
                      equipment: String(f.equipment)
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                      active: f.active === "on",
                    },
                  },
                );
                setEdit(null);
              }, "Помещение сохранено");
            }}
          >
            <label>
              Номер
              <input
                name="number"
                defaultValue={edit.number}
                required
                maxLength={20}
              />
            </label>
            <label>
              Корпус
              <input
                name="building"
                defaultValue={edit.building}
                required
                maxLength={60}
              />
            </label>
            <div className="form-row">
              <label>
                Этаж
                <input
                  name="floor"
                  type="number"
                  min={-2}
                  max={100}
                  defaultValue={edit.floor}
                  required
                />
              </label>
              <label>
                Вместимость
                <input
                  name="capacity"
                  type="number"
                  min={1}
                  max={1000}
                  defaultValue={edit.capacity}
                  required
                />
              </label>
            </div>
            <label>
              Тип
              <select name="kind" defaultValue={edit.kind}>
                <option value="CLASSROOM">Аудитория</option>
                <option value="LAB">Лаборатория</option>
              </select>
            </label>
            <label>
              Оборудование через запятую
              <input
                name="equipment"
                defaultValue={edit.equipment?.join(", ")}
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                name="active"
                defaultChecked={edit.active}
              />{" "}
              Доступно для бронирования
            </label>
            {error && (
              <div role="alert" className="error">
                {error}
              </div>
            )}
            <button className="primary" disabled={busy}>
              Сохранить
            </button>
          </form>
        </Modal>
      )}
      {userForm && (
        <Modal title="Новый пользователь" onClose={() => setUserForm(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = Object.fromEntries(new FormData(e.currentTarget));
              action(async () => {
                await api(
                  "mutation($name:String!,$login:String!,$password:String!,$role:String!){createUser(name:$name,login:$login,password:$password,role:$role){id}}",
                  f,
                );
                setUserForm(false);
              }, "Пользователь создан");
            }}
          >
            <label>
              ФИО
              <input name="name" minLength={2} maxLength={100} required />
            </label>
            <label>
              Логин
              <input name="login" pattern="[a-zA-Z0-9._\-]{3,40}" required />
            </label>
            <label>
              Пароль
              <input
                name="password"
                type="password"
                minLength={8}
                maxLength={128}
                required
                autoComplete="new-password"
              />
            </label>
            <label>
              Роль
              <select name="role">
                <option value="TEACHER">Преподаватель</option>
                <option value="ADMIN">Администратор</option>
              </select>
            </label>
            {error && (
              <div role="alert" className="error">
                {error}
              </div>
            )}
            <button className="primary" disabled={busy}>
              Создать
            </button>
          </form>
        </Modal>
      )}
      {close && (
        <Modal
          title={"Закрыть помещение " + close.number}
          onClose={() => setClose(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = Object.fromEntries(new FormData(e.currentTarget));
              action(async () => {
                await api(
                  "mutation($roomId:ID!,$starts:String!,$ends:String!){closeRoom(roomId:$roomId,starts:$starts,ends:$ends)}",
                  { ...f, roomId: close.id },
                );
                setClose(null);
              }, "Помещение закрыто на выбранные даты");
            }}
          >
            <p className="muted">
              Сначала отмените существующие брони в выбранном диапазоне.
            </p>
            <label>
              С<input name="starts" type="date" defaultValue={date} required />
            </label>
            <label>
              По (включительно)
              <input name="ends" type="date" defaultValue={date} required />
            </label>
            {error && (
              <div role="alert" className="error">
                {error}
              </div>
            )}
            <button className="primary" disabled={busy}>
              Закрыть помещение
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-title">
          <h2>{title}</h2>
          <button aria-label="Закрыть" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
