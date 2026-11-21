import { test } from "node:test";
import assert from "node:assert/strict";
import {
  today,
  addDays,
  slotTime,
  validateBookingDate,
  confirmationWindow,
} from "../shared/domain";
test("Moscow date is independent of host timezone", () => {
  assert.equal(today(new Date("2026-10-05T22:00:00Z")), "2026-10-06");
});
test("booking an ongoing pair keeps its scheduled ending", () => {
  assert.doesNotThrow(() =>
    validateBookingDate("2026-10-05", 1, new Date("2026-10-05T10:25:00+03:00")),
  );
  assert.throws(() =>
    validateBookingDate("2026-10-05", 1, new Date("2026-10-05T10:30:00+03:00")),
  );
});
test("seven calendar dates and no Sundays", () => {
  const now = new Date("2026-10-06T08:00:00+03:00");
  assert.doesNotThrow(() => validateBookingDate("2026-10-12", 1, now));
  assert.throws(() => validateBookingDate("2026-10-13", 1, now));
  assert.throws(() => validateBookingDate("2026-10-11", 1, now));
  assert.throws(() => validateBookingDate("2026-10-05", 1, now));
});
test("confirmation window ends with previous pair, not next pair", () => {
  assert.deepEqual(confirmationWindow("2026-10-05", 2), {
    confirmAt: "2026-10-05T09:00:00.000Z",
    deadline: "2026-10-05T09:10:00.000Z",
  });
  assert.equal(
    slotTime("2026-10-05", 3, "start").toISOString(),
    "2026-10-05T09:40:00.000Z",
  );
});
test("invalid calendar dates and slots are rejected", () => {
  assert.throws(() =>
    validateBookingDate("2026-02-30", 1, new Date("2026-02-28")),
  );
  assert.throws(() => slotTime("2026-10-05", 7, "end"));
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});
