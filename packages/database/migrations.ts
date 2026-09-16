import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Connection, RowDataPacket } from "mysql2/promise";
export interface Migration {
  name: string;
  sql: string;
  checksum: string;
}
export interface Applied {
  name: string;
  checksum: string;
  status: string;
}
export function planMigrations(
  files: Migration[],
  history: Applied[],
): Migration[] {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  if (new Set(files.map((f) => f.name)).size !== files.length)
    throw new Error("Duplicate migration name");
  for (const row of history) {
    const file = files.find((f) => f.name === row.name);
    if (!file || file.checksum !== row.checksum || row.status !== "APPLIED") {
      throw new Error(
        `Migration history requires operator investigation: ${row.name}`,
      );
    }
  }
  const applied = new Set(history.map((r) => r.name));
  let pending = false;
  for (const file of sorted) {
    if (!applied.has(file.name)) pending = true;
    else if (pending) throw new Error("Out-of-order migration history");
  }
  return sorted.filter((f) => !applied.has(f.name));
}
export async function readMigrations(directory: string): Promise<Migration[]> {
  const names = (await readdir(directory))
    .filter((n) => /^\d{3}_[a-z0-9_]+\.sql$/.test(n))
    .sort();
  return Promise.all(
    names.map(async (name) => {
      const sql = (await readFile(path.join(directory, name), "utf8")).replace(
        /\r\n/g,
        "\n",
      );
      return {
        name,
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    }),
  );
}
export async function migrate(
  connection: Connection,
  files: Migration[],
): Promise<string[]> {
  const [locks] = await connection.query<RowDataPacket[]>(
    "SELECT GET_LOCK(CONCAT(DATABASE(), ':migrations'), 10) AS acquired",
  );
  if (locks[0].acquired !== 1) throw new Error("Migration lock unavailable");
  try {
    const [tables] = await connection.query<RowDataPacket[]>(
      "SELECT TABLE_NAME AS name FROM information_schema.tables WHERE table_schema=DATABASE()",
    );
    if (tables.length && !tables.some((t) => t.name === "schema_migrations")) {
      throw new Error(
        "Use an empty platform database. Legacy import requires a separately reviewed migration.",
      );
    }
    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(100) PRIMARY KEY, checksum CHAR(64) NOT NULL,
      status ENUM('RUNNING','APPLIED') NOT NULL,
      started_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), finished_at DATETIME(6) NULL
    ) ENGINE=InnoDB`);
    const [history] = await connection.query<RowDataPacket[]>(
      "SELECT name,checksum,status FROM schema_migrations ORDER BY name",
    );
    const pending = planMigrations(
      files,
      history as (RowDataPacket & Applied)[],
    );
    for (const file of pending) {
      // MySQL DDL commits implicitly. A durable RUNNING marker blocks unsafe automatic retries.
      await connection.execute(
        "INSERT INTO schema_migrations(name,checksum,status) VALUES (?,?,'RUNNING')",
        [file.name, file.checksum],
      );
      await connection.query(file.sql);
      await connection.execute(
        "UPDATE schema_migrations SET status='APPLIED',finished_at=CURRENT_TIMESTAMP(6) WHERE name=?",
        [file.name],
      );
    }
    return pending.map((f) => f.name);
  } finally {
    await connection.query(
      "SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':migrations'))",
    );
  }
}
