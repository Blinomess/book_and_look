import { Pool, PoolClient } from "pg";
import {
  Booking,
  User,
  validateBookingDate,
  confirmationWindow,
  slotTime,
  today,
  addDays,
} from "../shared/domain";
import { z } from "zod";
export const roomInput = z.object({
  id: z.string().uuid().optional(),
  number: z.string().trim().min(1).max(20),
  building: z.string().trim().min(1).max(60),
  floor: z.number().int().min(-2).max(100),
  kind: z.enum(["CLASSROOM", "LAB"]),
  capacity: z.number().int().min(1).max(1000),
  equipment: z.array(z.string().trim().min(1).max(60)).max(30),
  active: z.boolean(),
});
export class BookingStore {
  constructor(
    public db: Pool,
    private clock = () => new Date(),
  ) {}
  async init() {
    await this.db
      .query(`CREATE TABLE IF NOT EXISTS rooms(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), number text NOT NULL, building text NOT NULL, floor int NOT NULL, kind text NOT NULL, capacity int NOT NULL CHECK(capacity>0), equipment jsonb NOT NULL DEFAULT '[]', active boolean NOT NULL DEFAULT true, UNIQUE(building,number));
      CREATE TABLE IF NOT EXISTS bookings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), room_id uuid NOT NULL REFERENCES rooms(id), teacher_id uuid NOT NULL, teacher_name text NOT NULL, created_by uuid NOT NULL, date date NOT NULL, slot int NOT NULL CHECK(slot BETWEEN 1 AND 6), status text NOT NULL CHECK(status IN ('CONFIRMED','PENDING','CANCELLED')), previous_id uuid REFERENCES bookings(id), confirm_at timestamptz, deadline timestamptz, cancellation_reason text, created_at timestamptz NOT NULL DEFAULT now());
      CREATE UNIQUE INDEX IF NOT EXISTS room_slot ON bookings(room_id,date,slot) WHERE status <> 'CANCELLED';
      CREATE UNIQUE INDEX IF NOT EXISTS teacher_slot ON bookings(teacher_id,date,slot) WHERE status <> 'CANCELLED';
      CREATE INDEX IF NOT EXISTS booking_deadline ON bookings(deadline) WHERE status='PENDING';
      CREATE TABLE IF NOT EXISTS closures(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), room_id uuid NOT NULL REFERENCES rooms(id), starts date NOT NULL, ends date NOT NULL CHECK(ends>=starts));`);
  }
  // One transaction lock serializes booking/closure mutations for this small MVP.
  // Partial unique indexes remain the final database-level protection against races.
  async transaction<T>(
    fn: (c: PoolClient, now: Date) => Promise<T>,
  ): Promise<T> {
    const c = await this.db.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock(20261004)");
      const now = this.clock();
      await this.expire(c, now);
      const result = await fn(c, now);
      await c.query("COMMIT");
      return result;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  private async cancelTree(c: PoolClient, id: string, reason: string) {
    await c.query(
      `WITH RECURSIVE chain AS (SELECT id FROM bookings WHERE id=$1 UNION ALL SELECT b.id FROM bookings b JOIN chain ON b.previous_id=chain.id)
      UPDATE bookings SET status='CANCELLED', cancellation_reason=$2 WHERE id IN (SELECT id FROM chain) AND status<>'CANCELLED'`,
      [id, reason],
    );
  }
  private async expire(c: PoolClient, now: Date) {
    const due = await c.query(
      "SELECT id FROM bookings WHERE status='PENDING' AND deadline<=$1",
      [now],
    );
    for (const row of due.rows)
      await this.cancelTree(c, row.id, "Не подтверждено вовремя");
  }
  async sweep() {
    return this.transaction(async () => true);
  }
  map(b: any): Booking {
    return {
      id: b.id,
      roomId: b.room_id,
      teacherId: b.teacher_id,
      teacherName: b.teacher_name,
      createdBy: b.created_by,
      date: typeof b.date === "string" ? b.date : today(b.date),
      slot: b.slot,
      status: b.status,
      previousId: b.previous_id,
      confirmAt: b.confirm_at?.toISOString() || null,
      deadline: b.deadline?.toISOString() || null,
      cancellationReason: b.cancellation_reason,
    };
  }
  async bookings(date?: string) {
    return this.transaction(async (c) =>
      (
        await c.query(
          "SELECT *, date::text AS date FROM bookings WHERE ($1::date IS NULL OR date=$1::date) ORDER BY bookings.date,slot,created_at",
          [date || null],
        )
      ).rows.map((b) => this.map(b)),
    );
  }
  async rooms() {
    return (await this.db.query("SELECT * FROM rooms ORDER BY building,number"))
      .rows;
  }
  async closures() {
    return (
      await this.db.query(
        'SELECT id,room_id AS "roomId",starts::text AS starts,ends::text AS ends FROM closures ORDER BY starts',
      )
    ).rows;
  }
  async create(
    input: { date: string; slots: { roomId: string; slot: number }[] },
    user: User,
    teacher: User,
  ) {
    const i = z
      .object({
        date: z.string(),
        slots: z
          .array(
            z.object({
              roomId: z.string().uuid(),
              slot: z.number().int().min(1).max(6),
            }),
          )
          .min(1)
          .max(6),
      })
      .parse(input);
    if (teacher.role !== "TEACHER")
      throw new Error("Бронь оформляется на преподавателя");
    if (user.role !== "ADMIN" && teacher.id !== user.id)
      throw new Error("Нельзя бронировать за другого преподавателя");
    return this.transaction(async (c, now) => {
      const result: Booking[] = [];
      for (const s of [...i.slots].sort((a, b) => a.slot - b.slot)) {
        validateBookingDate(i.date, s.slot, now);
        const room = (
          await c.query("SELECT * FROM rooms WHERE id=$1", [s.roomId])
        ).rows[0];
        if (!room?.active) throw new Error("Помещение недоступно");
        if (
          (
            await c.query(
              "SELECT id FROM closures WHERE room_id=$1 AND $2::date BETWEEN starts AND ends",
              [s.roomId, i.date],
            )
          ).rowCount
        )
          throw new Error("Помещение закрыто на выбранную дату");
        const prev = (
          await c.query(
            "SELECT * FROM bookings WHERE teacher_id=$1 AND date=$2 AND slot=$3 AND status<>'CANCELLED'",
            [teacher.id, i.date, s.slot - 1],
          )
        ).rows[0];
        let pending = false;
        let previousId: string | null = null;
        let confirmAt: string | null = null;
        let deadline: string | null = null;
        if (prev && slotTime(i.date, prev.slot, "end") > now) {
          previousId = prev.id;
          const window = confirmationWindow(i.date, prev.slot);
          confirmAt = window.confirmAt;
          deadline = window.deadline;
          pending = now < new Date(confirmAt) || prev.status === "PENDING";
        }
        const row = (
          await c.query(
            `INSERT INTO bookings(room_id,teacher_id,teacher_name,created_by,date,slot,status,previous_id,confirm_at,deadline) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *,date::text AS date`,
            [
              s.roomId,
              teacher.id,
              teacher.name,
              user.id,
              i.date,
              s.slot,
              pending ? "PENDING" : "CONFIRMED",
              previousId,
              confirmAt,
              deadline,
            ],
          )
        ).rows[0];
        // Also connect a following reservation that was created before its predecessor.
        const next = (
          await c.query(
            "SELECT * FROM bookings WHERE teacher_id=$1 AND date=$2 AND slot=$3 AND status<>'CANCELLED'",
            [teacher.id, i.date, s.slot + 1],
          )
        ).rows[0];
        if (next) {
          const w = confirmationWindow(i.date, s.slot);
          await c.query(
            "UPDATE bookings SET previous_id=$1,confirm_at=$2,deadline=$3,status='PENDING' WHERE id=$4",
            [row.id, w.confirmAt, w.deadline, next.id],
          );
        }
        result.push(this.map(row));
      }
      return result;
    });
  }
  async confirm(id: string, user: User) {
    return this.transaction(async (c, now) => {
      const b = (await c.query("SELECT * FROM bookings WHERE id=$1", [id]))
        .rows[0];
      if (!b || (user.role !== "ADMIN" && b.teacher_id !== user.id))
        throw new Error("Бронь не найдена");
      if (b.status !== "PENDING")
        throw new Error("Бронь не ожидает подтверждения");
      if (now < b.confirm_at || now >= b.deadline)
        throw new Error(
          "Подтвердить можно только в последние 10 минут предыдущей пары",
        );
      const p = (
        await c.query("SELECT status FROM bookings WHERE id=$1", [
          b.previous_id,
        ])
      ).rows[0];
      if (p?.status !== "CONFIRMED")
        throw new Error("Предыдущая пара не подтверждена");
      await c.query("UPDATE bookings SET status='CONFIRMED' WHERE id=$1", [id]);
      return true;
    });
  }
  async cancel(id: string, user: User) {
    return this.transaction(async (c, now) => {
      const b = (
        await c.query("SELECT *,date::text AS date FROM bookings WHERE id=$1", [
          id,
        ])
      ).rows[0];
      if (!b || (user.role !== "ADMIN" && b.teacher_id !== user.id))
        throw new Error("Бронь не найдена");
      if (user.role !== "ADMIN" && slotTime(b.date, b.slot, "start") <= now)
        throw new Error("Отменить можно только до начала пары");
      await this.cancelTree(
        c,
        id,
        user.role === "ADMIN"
          ? "Отменено администратором"
          : "Отменено преподавателем",
      );
      return true;
    });
  }
  async saveRoom(input: unknown) {
    const i = roomInput.parse(input);
    return this.transaction(async (c, now) => {
      if (
        i.id &&
        !i.active &&
        (
          await c.query(
            "SELECT id FROM bookings WHERE room_id=$1 AND status<>'CANCELLED' AND date >= $2::date",
            [i.id, today(now)],
          )
        ).rowCount
      )
        throw new Error("Сначала отмените текущие и будущие брони помещения");
      if (i.id) {
        const r = await c.query(
          "UPDATE rooms SET number=$1,building=$2,floor=$3,kind=$4,capacity=$5,equipment=$6,active=$7 WHERE id=$8 RETURNING *",
          [
            i.number,
            i.building,
            i.floor,
            i.kind,
            i.capacity,
            JSON.stringify(i.equipment),
            i.active,
            i.id,
          ],
        );
        if (!r.rows[0]) throw new Error("Помещение не найдено");
        return r.rows[0];
      }
      return (
        await c.query(
          "INSERT INTO rooms(number,building,floor,kind,capacity,equipment,active) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
          [
            i.number,
            i.building,
            i.floor,
            i.kind,
            i.capacity,
            JSON.stringify(i.equipment),
            i.active,
          ],
        )
      ).rows[0];
    });
  }
  async closeRoom(roomId: string, starts: string, ends: string) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(starts) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(ends) ||
      ends < starts
    )
      throw new Error("Проверьте диапазон дат");
    return this.transaction(async (c) => {
      if (
        (
          await c.query(
            "SELECT id FROM bookings WHERE room_id=$1 AND date BETWEEN $2::date AND $3::date AND status<>'CANCELLED'",
            [roomId, starts, ends],
          )
        ).rowCount
      )
        throw new Error("Сначала отмените брони помещения в этом диапазоне");
      await c.query(
        "INSERT INTO closures(room_id,starts,ends) VALUES($1,$2,$3)",
        [roomId, starts, ends],
      );
      return true;
    });
  }
  async reopen(id: string) {
    return this.transaction(async (c) => {
      await c.query("DELETE FROM closures WHERE id=$1", [id]);
      return true;
    });
  }
  async seed() {
    for (const [number, kind, capacity, equipment] of [
      ["101", "CLASSROOM", 30, ["Проектор", "Доска"]],
      ["203", "CLASSROOM", 60, ["Проектор", "Доска", "Микрофон"]],
      ["205", "LAB", 24, ["Компьютеры", "Проектор"]],
      ["302", "LAB", 16, ["Лабораторные стенды", "Доска"]],
    ] as const) {
      await this.db.query(
        "INSERT INTO rooms(number,building,floor,kind,capacity,equipment) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(building,number) DO NOTHING",
        [
          number,
          "Главный корпус",
          Number(number[0]),
          kind,
          capacity,
          JSON.stringify(equipment),
        ],
      );
    }
  }
}
