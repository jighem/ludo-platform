import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../../packages/database";
import { MatchService } from "../../packages/match-engine";
import { publishRules } from "../../packages/rulesets/repository";
import { STANDARD_RULES } from "../../packages/rulesets";
const url = process.env.TEST_DATABASE_URL;
test(
  "online matches require check-in, reject forged dice, commit one roll and replay duplicate requests",
  { skip: !url },
  async () => {
    assert.match(new URL(url!).pathname, /^\/ludo_test_/);
    const db = createDatabase(url!),
      service = new MatchService(db);
    const user = async () => {
      const id = randomUUID();
      await db.execute(
        "INSERT INTO users(id,email,username,password_hash,email_verified_at,platform_role) VALUES(?,?,?,?,CURRENT_TIMESTAMP(6),'SUPER_ADMIN')",
        [
          id,
          `${id}@example.invalid`,
          id.replaceAll("-", "").slice(0, 24),
          "test-only",
        ],
      );
      return id;
    };
    try {
      const a = await user(),
        b = await user(),
        outsider = await user();
      const rules = await publishRules(db, a, {
        ...STANDARD_RULES,
        id: `test-${randomUUID()}`,
      });
      const match = await service.create(a, [a, b], rules.id);
      await assert.rejects(
        service.snapshot(outsider, match.id),
        /MATCH_ACCESS_DENIED/,
      );
      const cmd = {
        type: "ROLL",
        commandId: randomUUID(),
        expectedRevision: 1,
      };
      await assert.rejects(
        service.command(a, match.id, cmd),
        /MATCH_NOT_PLAYING/,
      );
      assert.equal((await service.checkIn(a, match.id)).phase, "LOBBY");
      assert.equal((await service.checkIn(b, match.id)).phase, "PLAYING");
      await assert.rejects(
        service.command(a, match.id, { ...cmd, die: 6 }),
        /INVALID_COMMAND/,
      );
      const [one, two] = await Promise.all([
        service.command(a, match.id, cmd),
        service.command(a, match.id, cmd),
      ]);
      assert.deepEqual(one, two);
      assert.equal(one.state.revision, 2);
      await assert.rejects(
        service.command(a, match.id, { ...cmd, type: "SURRENDER" }),
        /COMMAND_ID_REUSED/,
      );
      await assert.rejects(
        service.command(a, match.id, { ...cmd, commandId: randomUUID() }),
        /STALE_REVISION/,
      );
      const snapshot = await service.snapshot(a, match.id);
      assert.equal(snapshot.revision, 2);
      assert.equal(
        snapshot.events.filter((e) => e.event.type === "DICE_AUDIT").length,
        1,
      );
      assert.equal(
        await service.expire(match.id, snapshot.state.turnId),
        false,
      );
      const end = await service.command(b, match.id, {
        type: "SURRENDER",
        commandId: randomUUID(),
        expectedRevision: 2,
      });
      assert.equal(end.state.phase, "COMPLETED");
      assert.deepEqual(end.state.finishOrder, [a, b]);
      const [receipts] = await db.query<any[]>(
        "SELECT command_id FROM match_commands WHERE match_id=?",
        [match.id],
      );
      assert.equal(receipts.length, 2);
      const [completed] = await db.query<any[]>(
        "SELECT approval,metrics FROM match_results WHERE match_id=?",
        [match.id],
      );
      assert.equal(completed.length, 1);
      assert.equal(completed[0].approval, "APPROVED");
      const timed = await service.create(a, [a, b], rules.id);
      await service.checkIn(a, timed.id);
      await service.checkIn(b, timed.id);
      await db.execute(
        "UPDATE matches SET state=JSON_SET(state,'$.deadline',?),deadline=? WHERE id=?",
        [Date.now() - 1000, new Date(Date.now() - 1000), timed.id],
      );
      const expirations = await Promise.all([
        service.expire(timed.id, 1),
        service.expire(timed.id, 1),
      ]);
      assert.equal(expirations.filter(Boolean).length, 1);
      assert.equal((await service.snapshot(a, timed.id)).state.activeSeat, 1);
    } finally {
      await db.end();
    }
  },
);
