export const SLOTS = [
  { number: 1, start: "09:00", end: "10:30" },
  { number: 2, start: "10:40", end: "12:10" },
  { number: 3, start: "12:40", end: "14:10" },
  { number: 4, start: "14:20", end: "15:50" },
  { number: 5, start: "16:20", end: "17:50" },
  { number: 6, start: "18:00", end: "19:30" },
];
export type User = {
  id: string;
  name: string;
  login: string;
  role: "ADMIN" | "TEACHER";
};
export type Room = {
  id: string;
  number: string;
  building: string;
  floor: number;
  kind: "CLASSROOM" | "LAB";
  capacity: number;
  equipment: string[];
  active: boolean;
};
export type Booking = {
  id: string;
  roomId: string;
  teacherId: string;
  teacherName: string;
  createdBy: string;
  date: string;
  slot: number;
  status: "CONFIRMED" | "PENDING" | "CANCELLED";
  previousId: string | null;
  confirmAt: string | null;
  deadline: string | null;
  cancellationReason: string | null;
};
export function today(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function addDays(date: string, count: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
}
export function slotTime(
  date: string,
  slot: number,
  edge: "start" | "end",
): Date {
  const s = SLOTS[slot - 1];
  if (!s) throw new Error("Неизвестная пара");
  return new Date(`${date}T${s[edge]}:00+03:00`);
}
export function validateBookingDate(
  date: string,
  slot: number,
  now = new Date(),
): void {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(new Date(date + "T12:00:00Z").getTime()) ||
    new Date(date + "T12:00:00Z").toISOString().slice(0, 10) !== date
  )
    throw new Error("Некорректная дата");
  if (date < today(now) || date > addDays(today(now), 6))
    throw new Error("Бронирование доступно на сегодня и следующие 6 дней");
  if (new Date(date + "T12:00:00Z").getUTCDay() === 0)
    throw new Error("В воскресенье бронирование недоступно");
  if (slotTime(date, slot, "end") <= now)
    throw new Error("Эта пара уже закончилась");
}
export function confirmationWindow(date: string, previousSlot: number) {
  const deadline = slotTime(date, previousSlot, "end");
  return {
    confirmAt: new Date(deadline.getTime() - 10 * 60_000).toISOString(),
    deadline: deadline.toISOString(),
  };
}
