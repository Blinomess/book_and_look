import { test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { BookingStore } from "../server/booking-store";
import { User } from "../shared/domain";
test(
  "PostgreSQL: conflicts, chain expiry, permissions, closures and confirmations",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    // TEST_DATABASE_URL must point to a disposable database. The test uses its own schema.
    const schema = "test_" + randomUUID().replaceAll("-", "");
    const control = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
    });
    await control.query(`CREATE SCHEMA ${schema}`);
    const db = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      options: `-c search_path=${schema},public`,
    });
    let now = new Date("2026-10-05T08:00:00+03:00");
    const store = new BookingStore(db, () => now);
    const teacher: User = {
        id: randomUUID(),
        login: "teacher",
        name: "Teacher",
        role: "TEACHER",
      },
      other: User = {
        id: randomUUID(),
        login: "other",
        name: "Other",
        role: "TEACHER",
      },
      admin: User = {
        id: randomUUID(),
        login: "admin",
        name: "Admin",
        role: "ADMIN",
      };
    try {
      await store.init();
      await store.seed();
      const rooms = await store.rooms();
      const create = (u: User, slots: { roomId: string; slot: number }[]) =>
        store.create({ date: "2026-10-05", slots }, u, u);
      const chain = await create(teacher, [
        { roomId: rooms[0].id, slot: 1 },
        { roomId: rooms[1].id, slot: 2 },
        { roomId: rooms[2].id, slot: 3 },
      ]);
      assert.deepEqual(
        chain.map((b) => b.status),
        ["CONFIRMED", "PENDING", "PENDING"],
      );
      await assert.rejects(() => store.confirm(chain[1].id, teacher));
      await assert.rejects(() =>
        create(other, [{ roomId: rooms[0].id, slot: 1 }]),
      );
      await assert.rejects(() =>
        create(teacher, [{ roomId: rooms[3].id, slot: 1 }]),
      );
      await assert.rejects(() => store.cancel(chain[0].id, other));
      await assert.rejects(() =>
        store.closeRoom(rooms[0].id, "2026-10-05", "2026-10-05"),
      );
      now = new Date("2026-10-05T10:20:00+03:00");
      await store.confirm(chain[1].id, teacher);
      now = new Date("2026-10-05T12:10:00+03:00");
      await store.sweep();
      const records = await store.bookings("2026-10-05");
      assert.equal(
        records.find((b) => b.id === chain[1].id)?.status,
        "CONFIRMED",
      );
      assert.equal(
        records.find((b) => b.id === chain[2].id)?.status,
        "CANCELLED",
      );
      await assert.rejects(() => store.cancel(chain[0].id, teacher));
      await store.cancel(chain[0].id, admin);
      now = new Date("2026-10-05T08:00:00+03:00");
      const race = await Promise.allSettled([
        create(teacher, [{ roomId: rooms[0].id, slot: 4 }]),
        create(other, [{ roomId: rooms[0].id, slot: 4 }]),
      ]);
      assert.equal(race.filter((x) => x.status === "fulfilled").length, 1);
      const late = await create(teacher, [
        { roomId: rooms[0].id, slot: 5 },
        { roomId: rooms[1].id, slot: 6 },
      ]);
      now = new Date("2026-10-05T17:50:00+03:00");
      await store.sweep();
      assert.equal(
        (await store.bookings()).find((b) => b.id === late[1].id)?.status,
        "CANCELLED",
      );
      await store.closeRoom(rooms[3].id, "2026-10-06", "2026-10-06");
      await assert.rejects(() =>
        store.create(
          { date: "2026-10-06", slots: [{ roomId: rooms[3].id, slot: 1 }] },
          teacher,
          teacher,
        ),
      );
    } finally {
      await db.end();
      await control.query(`DROP SCHEMA ${schema} CASCADE`);
      await control.end();
    }
  },
);
