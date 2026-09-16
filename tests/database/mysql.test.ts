import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { migrate, readMigrations } from "../../packages/database/migrations";
const url = process.env.TEST_DATABASE_URL;
test(
  "MySQL: fresh migration, replay, foreign keys, rollback and dirty migration refusal",
  { skip: !url },
  async () => {
    const parsed = new URL(url!);
    assert.match(
      parsed.pathname,
      /^\/ludo_test_/,
      "Integration tests require a disposable ludo_test_ database",
    );
    const connection = await mysql.createConnection({
      socketPath: process.env.MYSQL_SOCKET_PATH,
      host: parsed.hostname,
      port: Number(parsed.port || 3306),
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.slice(1),
      multipleStatements: true,
    });
    try {
      const files = await readMigrations("packages/database/migrations");
      await migrate(connection, files);
      assert.deepEqual(await migrate(connection, files), []);
      const id = randomUUID();
      await connection.execute(
        "INSERT INTO users(id,email,username,password_hash) VALUES(?,?,?,'test-only')",
        [id, `${id}@example.invalid`, id.slice(0, 30)],
      );
      await assert.rejects(
        connection.execute(
          "INSERT INTO league_members(league_id,user_id) VALUES (?,?)",
          [randomUUID(), id],
        ),
      );
      await connection.beginTransaction();
      await connection.execute(
        "INSERT INTO leagues(id,name,visibility,created_by) VALUES (?,'rollback','PRIVATE',?)",
        [randomUUID(), id],
      );
      await connection.rollback();
      const [result] = await connection.query<any[]>(
        "SELECT COUNT(*) AS total FROM leagues WHERE created_by=?",
        [id],
      );
      assert.equal(result[0].total, 0);
      await assert.rejects(
        migrate(
          connection,
          files.map((f, i) => (i ? f : { ...f, checksum: "changed" })),
        ),
      );
    } finally {
      await connection.end();
    }
  },
);
