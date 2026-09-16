import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../../packages/database";
import { createApp } from "../../apps/api/app";
import { enforceRate } from "../../packages/auth/rate-limit";
import { migrate, readMigrations } from "../../packages/database/migrations";
import mysql from "mysql2/promise";
const url = process.env.TEST_DATABASE_URL;
test(
  "HTTP auth rejects missing sessions, cross-origin writes, malformed input and enforces shared rate limits",
  { skip: !url },
  async () => {
    assert.match(new URL(url!).pathname, /^\/ludo_test_/);
    const parsed = new URL(url!);
    const migrationDb = await mysql.createConnection({
      host: parsed.hostname,
      port: Number(parsed.port || 3306),
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.slice(1),
      multipleStatements: true,
      socketPath: process.env.MYSQL_SOCKET_PATH,
    });
    await migrate(
      migrationDb,
      await readMigrations("packages/database/migrations"),
    );
    await migrationDb.end();
    const db = createDatabase(url!),
      app = createApp(db, "http://localhost:3000");
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as any).port}/api/v2`;
    try {
      assert.equal((await fetch(`${base}/auth/me`)).status, 401);
      assert.equal(
        (
          await fetch(`${base}/auth/register`, {
            method: "POST",
            headers: {
              Origin: "https://other.example",
              "Content-Type": "application/json",
            },
            body: "{}",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await fetch(`${base}/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{",
          })
        ).status,
        400,
      );
      const key = randomUUID();
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () => enforceRate(db, key, 3, 60)),
      );
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 3);
      assert.equal(results.filter((r) => r.status === "rejected").length, 3);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await db.end();
    }
  },
);
