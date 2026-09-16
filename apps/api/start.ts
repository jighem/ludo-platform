import "dotenv/config";
import { createDatabase } from "../../packages/database";
import { createApp } from "./app";
const url = process.env.PLATFORM_DATABASE_URL;
if (!url) throw new Error("PLATFORM_DATABASE_URL is required");
const db = createDatabase(url);
await db.query("SELECT 1");
const server = createApp(
  db,
  process.env.APP_URL || "http://localhost:3000",
).listen(Number(process.env.PLATFORM_PORT || 3001), "127.0.0.1", () =>
  console.log("Platform API listening on localhost"),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () =>
    server.close(() => {
      void db.end().then(() => process.exit(0));
    }),
  );
