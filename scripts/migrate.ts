import "dotenv/config";
import mysql from "mysql2/promise";
import { migrate, readMigrations } from "../packages/database/migrations";
const url = process.env.PLATFORM_DATABASE_URL;
if (!url)
  throw new Error(
    "Set PLATFORM_DATABASE_URL to the new platform MySQL database",
  );
const parsed = new URL(url);
if (!["mysql:"].includes(parsed.protocol)) throw new Error("MySQL is required");
const connection = await mysql.createConnection({
  socketPath: process.env.MYSQL_SOCKET_PATH,
  host: parsed.hostname,
  port: Number(parsed.port || 3306),
  user: decodeURIComponent(parsed.username),
  password: decodeURIComponent(parsed.password),
  database: parsed.pathname.slice(1),
  multipleStatements: true,
  timezone: "+00:00",
});
try {
  console.log({
    applied: await migrate(
      connection,
      await readMigrations("packages/database/migrations"),
    ),
  });
} finally {
  await connection.end();
}
