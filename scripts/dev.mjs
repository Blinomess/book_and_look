import { spawn } from "node:child_process";
const processes = [];
function run(args, extra = {}) {
  const child = spawn(process.execPath, args, {
    stdio: "inherit",
    env: { ...process.env, ...extra },
  });
  processes.push(child);
  child.on("exit", (code) => {
    if (code) shutdown(code);
  });
}
function shutdown(code = 0) {
  for (const p of processes) p.kill();
  process.exit(code);
}
process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());
run(["dist/server/identity.js"], {
  PORT: "3001",
  DATABASE_URL:
    process.env.IDENTITY_DATABASE_URL ||
    "postgresql://campus:campus@localhost:5432/identity",
  SEED_DEMO: "true",
});
run(["dist/server/booking.js"], {
  PORT: "3002",
  DATABASE_URL:
    process.env.BOOKING_DATABASE_URL ||
    "postgresql://campus:campus@localhost:5432/booking",
  SEED_DEMO: "true",
});
run(["dist/server/gateway.js"], { PORT: "3000" });
run(["node_modules/vite/bin/vite.js"]);
