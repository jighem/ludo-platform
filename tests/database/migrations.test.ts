import { test } from "node:test";
import assert from "node:assert/strict";
import { planMigrations } from "../../packages/database/migrations";
const migration = {
  name: "001_initial.sql",
  sql: "CREATE TABLE example (id INT);",
  checksum: "abc",
};
test("applies new migrations and skips recorded identical files", () => {
  assert.deepEqual(planMigrations([migration], []), [migration]);
  assert.deepEqual(
    planMigrations(
      [migration],
      [{ name: migration.name, checksum: "abc", status: "APPLIED" }],
    ),
    [],
  );
});
test("refuses changed, failed, missing and out-of-order migration histories", () => {
  assert.throws(() =>
    planMigrations(
      [migration],
      [{ name: migration.name, checksum: "changed", status: "APPLIED" }],
    ),
  );
  assert.throws(() =>
    planMigrations(
      [migration],
      [{ name: migration.name, checksum: "abc", status: "RUNNING" }],
    ),
  );
  assert.throws(() =>
    planMigrations(
      [],
      [{ name: migration.name, checksum: "abc", status: "APPLIED" }],
    ),
  );
  assert.throws(() =>
    planMigrations(
      [migration, { ...migration, name: "002_later.sql" }],
      [{ name: "002_later.sql", checksum: "abc", status: "APPLIED" }],
    ),
  );
});
