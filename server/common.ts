import "reflect-metadata";
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Pool } from "pg";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { User } from "../shared/domain";
export const internalKey = process.env.INTERNAL_KEY || "local-development-only";
export const identityUrl = process.env.IDENTITY_URL || "http://127.0.0.1:3001";
export const bookingUrl = process.env.BOOKING_URL || "http://127.0.0.1:3002";
export const pool = (name: string) =>
  new Pool({
    connectionString:
      process.env.DATABASE_URL ||
      `postgresql://campus:campus@localhost:5432/${name}`,
  });
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function checkPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  const actual = scryptSync(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(hash, "hex"));
}
export async function remote(
  url: string,
  path: string,
  body: unknown,
  token?: string,
) {
  const result = await fetch(url + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-key": internalKey,
      authorization: token || "",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const data = (await result.json()) as any;
  if (!result.ok)
    throw new Error(
      typeof data.message === "string" ? data.message : "Сервис недоступен",
    );
  return data;
}
@Injectable()
export class InternalGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    if (
      ctx.switchToHttp().getRequest().headers["x-internal-key"] !== internalKey
    )
      throw new UnauthorizedException();
    return true;
  }
}
export async function authenticate(token?: string): Promise<User> {
  if (!token) throw new Error("Войдите в систему");
  return remote(identityUrl, "/session", {}, token);
}
export function requireAdmin(user: User) {
  if (user.role !== "ADMIN") throw new Error("Доступно только администратору");
}
