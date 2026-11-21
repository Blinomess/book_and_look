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
import { z } from "zod";
import {
  authenticate,
  identityUrl,
  InternalGuard,
  pool,
  remote,
  requireAdmin,
} from "./common";
import { BookingStore } from "./booking-store";
const store = new BookingStore(pool("booking"));
@Controller()
class BookingController {
  @Get("health") health() {
    return store.db.query("SELECT 1").then(() => ({ ok: true }));
  }
  @Post(":operation")
  @UseGuards(InternalGuard)
  async handle(
    @Param("operation") op: string,
    @Body() body: any,
    @Headers("authorization") token: string,
  ) {
    try {
      const user = await authenticate(token);
      switch (op) {
        case "rooms":
          return await store.rooms();
        case "bookings":
          return await store.bookings(body.date);
        case "closures":
          return await store.closures();
        case "create": {
          const teacher =
            body.teacherId && body.teacherId !== user.id
              ? (requireAdmin(user),
                await remote(
                  identityUrl,
                  "/user",
                  { id: body.teacherId },
                  token,
                ))
              : user;
          return await store.create(body, user, teacher);
        }
        case "confirm":
          return await store.confirm(z.string().uuid().parse(body.id), user);
        case "cancel":
          return await store.cancel(z.string().uuid().parse(body.id), user);
      }
      requireAdmin(user);
      if (op === "save-room") return await store.saveRoom(body);
      if (op === "close-room")
        return await store.closeRoom(
          z.string().uuid().parse(body.roomId),
          body.starts,
          body.ends,
        );
      if (op === "reopen")
        return await store.reopen(z.string().uuid().parse(body.id));
      throw new Error("Неизвестная операция");
    } catch (e: any) {
      throw new BadRequestException(
        e.code === "23505"
          ? "Помещение или преподаватель уже заняты на эту пару (либо номер помещения уже существует)"
          : e instanceof z.ZodError
            ? "Проверьте введённые данные"
            : e.message,
      );
    }
  }
}
@Module({ controllers: [BookingController] })
class BookingModule {}
async function main() {
  await store.init();
  if (process.env.SEED_DEMO === "true") await store.seed();
  await store.sweep();
  setInterval(
    () =>
      store.sweep().catch((e) => console.error("Expiry worker:", e.message)),
    5000,
  ).unref();
  const app = await NestFactory.create(BookingModule);
  await app.listen(Number(process.env.PORT || 3002), "0.0.0.0");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
