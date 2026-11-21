import { Body, Controller, Get, Headers, Module, Post } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { buildSchema, graphql } from "graphql";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bookingUrl, identityUrl, remote } from "./common";
import { SLOTS } from "../shared/domain";
const schema = buildSchema(
  readFileSync(resolve("server/schema.graphql"), "utf8"),
);
const root: any = {
  slots: () => SLOTS,
  serverTime: () => new Date().toISOString(),
};
for (const [name, path, service] of [
  ["login", "login", identityUrl],
  ["logout", "logout", identityUrl],
  ["me", "session", identityUrl],
  ["users", "users", identityUrl],
  ["createUser", "create-user", identityUrl],
  ["rooms", "rooms", bookingUrl],
  ["bookings", "bookings", bookingUrl],
  ["closures", "closures", bookingUrl],
  ["createBooking", "create", bookingUrl],
  ["confirmBooking", "confirm", bookingUrl],
  ["cancelBooking", "cancel", bookingUrl],
  ["saveRoom", "save-room", bookingUrl],
  ["closeRoom", "close-room", bookingUrl],
  ["reopenRoom", "reopen", bookingUrl],
])
  root[name] = (args: any, ctx: any) =>
    remote(service, "/" + path, args.input || args, ctx.token);
@Controller()
class GatewayController {
  @Get("health") health() {
    return { ok: true };
  }
  @Post("graphql") async query(
    @Body() body: any,
    @Headers("authorization") token: string,
  ) {
    if (typeof body?.query !== "string" || body.query.length > 20000)
      return { errors: [{ message: "Некорректный запрос" }] };
    return graphql({
      schema,
      source: body.query,
      variableValues: body.variables,
      operationName: body.operationName,
      rootValue: root,
      contextValue: { token },
    });
  }
}
@Module({ controllers: [GatewayController] })
class GatewayModule {}
async function main() {
  const app = await NestFactory.create<NestExpressApplication>(GatewayModule);
  app.useStaticAssets(resolve("web-dist"));
  await app.listen(Number(process.env.PORT || 3000), "0.0.0.0");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
