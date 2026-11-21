import {
  Body,
  Controller,
  Headers,
  Module,
  Post,
  UseGuards,
  BadRequestException,
  Get,
  Param,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import {
  pool,
  InternalGuard,
  hashPassword,
  checkPassword,
  requireAdmin,
} from "./common";
const db = pool("identity");
const digest = (token: string) =>
  createHash("sha256")
    .update(token.replace(/^Bearer /, ""))
    .digest("hex");
const publicUser = (u: any) => ({
  id: u.id,
  name: u.name,
  login: u.login,
  role: u.role,
});
async function session(token: string) {
  const r = await db.query(
    "SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now()",
    [digest(token || "")],
  );
  if (!r.rows[0]) throw new Error("Сессия истекла. Войдите снова");
  return publicUser(r.rows[0]);
}
@Controller()
class IdentityController {
  @Get("health") health() {
    return db.query("SELECT 1").then(() => ({ ok: true }));
  }
  @Post(":operation")
  @UseGuards(InternalGuard)
  async handle(
    @Body() body: any,
    @Headers("authorization") token: string,
    @Param("operation") operation: string,
  ) {
    try {
      if (operation === "login") {
        const input = z
          .object({
            login: z.string().min(1).max(80),
            password: z.string().max(128),
          })
          .parse(body);
        const r = await db.query("SELECT * FROM users WHERE login=$1", [
          input.login,
        ]);
        if (
          !r.rows[0] ||
          !checkPassword(input.password, r.rows[0].password_hash)
        )
          throw new Error("Неверный логин или пароль");
        const secret = randomBytes(32).toString("hex");
        await db.query(
          "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')",
          [digest(secret), r.rows[0].id],
        );
        return { token: secret, user: publicUser(r.rows[0]) };
      }
      const user = await session(token);
      if (operation === "session") return user;
      if (operation === "logout") {
        await db.query("DELETE FROM sessions WHERE token_hash=$1", [
          digest(token),
        ]);
        return true;
      }
      requireAdmin(user);
      if (operation === "users")
        return (
          await db.query("SELECT id,name,login,role FROM users ORDER BY name")
        ).rows;
      if (operation === "user") {
        const r = await db.query(
          "SELECT id,name,login,role FROM users WHERE id=$1",
          [z.string().uuid().parse(body.id)],
        );
        if (!r.rows[0]) throw new Error("Пользователь не найден");
        return r.rows[0];
      }
      if (operation === "create-user") {
        const i = z
          .object({
            name: z.string().trim().min(2).max(100),
            login: z.string().regex(/^[a-zA-Z0-9._-]{3,40}$/),
            password: z.string().min(8).max(128),
            role: z.enum(["ADMIN", "TEACHER"]),
          })
          .parse(body);
        return publicUser(
          (
            await db.query(
              "INSERT INTO users(name,login,password_hash,role) VALUES($1,$2,$3,$4) RETURNING *",
              [i.name, i.login, hashPassword(i.password), i.role],
            )
          ).rows[0],
        );
      }
      throw new Error("Неизвестная операция");
    } catch (e: any) {
      throw new BadRequestException(
        e.code === "23505"
          ? "Логин уже занят"
          : e instanceof z.ZodError
            ? "Проверьте поля пользователя (пароль — от 8 символов)"
            : e.message,
      );
    }
  }
}
@Module({ controllers: [IdentityController] })
class IdentityModule {}
async function main() {
  await db.query(`CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, login text UNIQUE NOT NULL, password_hash text NOT NULL, role text NOT NULL CHECK(role IN ('ADMIN','TEACHER')));
    CREATE TABLE IF NOT EXISTS sessions(token_hash text PRIMARY KEY, user_id uuid REFERENCES users(id), expires_at timestamptz NOT NULL);`);
  if (process.env.SEED_DEMO === "true")
    for (const [login, name, role] of [
      ["admin", "Администратор", "ADMIN"],
      ["teacher", "Анна Смирнова", "TEACHER"],
      ["petrov", "Иван Петров", "TEACHER"],
    ]) {
      await db.query(
        "INSERT INTO users(login,name,role,password_hash) VALUES($1,$2,$3,$4) ON CONFLICT(login) DO NOTHING",
        [
          login,
          name,
          role,
          hashPassword(process.env.DEMO_PASSWORD || "Campus2026!"),
        ],
      );
    }
  const app = await NestFactory.create(IdentityModule);
  await app.listen(Number(process.env.PORT || 3001), "0.0.0.0");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
