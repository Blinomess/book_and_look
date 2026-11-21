// Runs against the local seeded demo; bookings created by this check are cancelled.
import assert from "node:assert/strict";
const url = process.env.APP_URL || "http://127.0.0.1:3000/graphql";
async function request(query, variables = {}, token = "") {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: token ? "Bearer " + token : "",
    },
    body: JSON.stringify({ query, variables }),
  });
  const result = await r.json();
  if (result.errors?.length) throw new Error(result.errors[0].message);
  return result.data;
}
const login = async (name) =>
  (
    await request(
      "mutation($login:String!,$password:String!){login(login:$login,password:$password){token user{id name role}}}",
      { login: name, password: process.env.DEMO_PASSWORD || "Campus2026!" },
    )
  ).login;
await assert.rejects(() => request("{rooms{id}}"));
await assert.rejects(() =>
  request('mutation{login(login:"teacher",password:"wrong"){token}}'),
);
const admin = await login("admin"),
  teacher = await login("teacher"),
  other = await login("petrov");
let created = [];
try {
  const data = await request(
    "{rooms{id number building floor kind capacity equipment active} users{id role} serverTime}",
    {},
    admin.token,
  );
  assert.equal(data.rooms.length >= 4, true);
  await assert.rejects(() => request("{users{id}}", {}, teacher.token));
  await assert.rejects(() =>
    request(
      "mutation($input:RoomInput!){saveRoom(input:$input){id}}",
      { input: data.rooms[0] },
      teacher.token,
    ),
  );
  const day = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Moscow",
  }).format(new Date(data.serverTime));
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  const date = d.toISOString().slice(0, 10);
  const mutation =
    "mutation($date:String!,$slots:[SlotInput!]!,$teacherId:ID){createBooking(date:$date,slots:$slots,teacherId:$teacherId){id status teacherId createdBy}}";
  const args = {
    date,
    slots: [
      { roomId: data.rooms[0].id, slot: 5 },
      { roomId: data.rooms[1].id, slot: 6 },
    ],
    teacherId: teacher.user.id,
  };
  await assert.rejects(() => request(mutation, args, other.token));
  const result = await request(mutation, args, admin.token);
  created = result.createBooking;
  assert.deepEqual(
    created.map((b) => b.status),
    ["CONFIRMED", "PENDING"],
  );
  assert.equal(created[0].createdBy, admin.user.id);
  assert.equal(created[0].teacherId, teacher.user.id);
  await assert.rejects(() =>
    request(
      "mutation($id:ID!){cancelBooking(id:$id)}",
      { id: created[0].id },
      other.token,
    ),
  );
  await request(
    "mutation($id:ID!){cancelBooking(id:$id)}",
    { id: created[0].id },
    teacher.token,
  );
  const bookings = (
    await request(
      "query($date:String){bookings(date:$date){id status}}",
      { date },
      admin.token,
    )
  ).bookings;
  for (const b of created)
    assert.equal(bookings.find((x) => x.id === b.id)?.status, "CANCELLED");
  await request("mutation{logout}", {}, other.token);
  await assert.rejects(() => request("{me{id}}", {}, other.token));
  console.log(
    "PASS: authentication, roles, administrator booking on behalf, chain states, ownership, cancellation cascade, logout.",
  );
} finally {
  for (const b of created)
    await request(
      "mutation($id:ID!){cancelBooking(id:$id)}",
      { id: b.id },
      admin.token,
    ).catch(() => {});
  for (const auth of [admin, teacher, other])
    await request("mutation{logout}", {}, auth.token).catch(() => {});
}
