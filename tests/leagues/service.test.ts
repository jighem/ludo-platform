import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../../packages/database";
import { LeagueService, DEFAULT_SCORING } from "../../packages/league-engine";
const url = process.env.TEST_DATABASE_URL;
test(
  "leagues isolate administration, consume invitations once and preserve the last administrator",
  { skip: !url },
  async () => {
    assert.match(new URL(url!).pathname, /^\/ludo_test_/);
    const db = createDatabase(url!),
      service = new LeagueService(db);
    const user = async (verified = true) => {
      const id = randomUUID();
      await db.execute(
        "INSERT INTO users(id,email,username,password_hash,email_verified_at) VALUES(?,?,?,?,?)",
        [
          id,
          `${id}@example.invalid`,
          id.replaceAll("-", "").slice(0, 24),
          "test-only",
          verified ? "2026-01-01 00:00:00" : null,
        ],
      );
      return id;
    };
    try {
      const a = await user(),
        b = await user(),
        c = await user(),
        unverified = await user(false);
      await assert.rejects(
        service.create(unverified, "Denied", "PUBLIC"),
        /VERIFIED_ACCOUNT_REQUIRED/,
      );
      const first = await service.create(a, "Private league", "PRIVATE"),
        second = await service.create(b, "Public league", "PUBLIC");
      assert.equal(
        (await service.list(c)).some((l) => l.id === first.id),
        false,
      );
      await assert.rejects(service.invite(b, first.id), /LEAGUE_ACCESS_DENIED/);
      await assert.rejects(
        service.configureScoring(b, first.id, DEFAULT_SCORING),
        /LEAGUE_ACCESS_DENIED/,
      );
      await assert.rejects(
        service.setMember(a, first.id, a, "MEMBER", "ACTIVE"),
        /LAST_ADMIN_REQUIRED/,
      );
      const invite = await service.invite(a, first.id);
      const accepts = await Promise.allSettled([
        service.accept(b, invite.code),
        service.accept(c, invite.code),
      ]);
      assert.equal(accepts.filter((r) => r.status === "fulfilled").length, 1);
      const winner = accepts[0].status === "fulfilled" ? b : c;
      await service.accept(winner, invite.code);
      await service.setMember(a, first.id, winner, "LEAGUE_ADMIN", "ACTIVE");
      const removals = await Promise.allSettled([
        service.setMember(a, first.id, a, "MEMBER", "ACTIVE"),
        service.setMember(winner, first.id, winner, "MEMBER", "ACTIVE"),
      ]);
      assert.equal(removals.filter((r) => r.status === "fulfilled").length, 1);
      const [admins] = await db.query<any[]>(
        "SELECT user_id FROM league_members WHERE league_id=? AND role='LEAGUE_ADMIN' AND status='ACTIVE'",
        [first.id],
      );
      assert.equal(admins.length, 1);
      await service.requestJoin(c, second.id);
      await assert.rejects(
        service.decideJoin(a, second.id, c, true),
        /LEAGUE_ACCESS_DENIED/,
      );
      await service.decideJoin(b, second.id, c, true);
      await service.configureScoring(b, second.id, {
        ...DEFAULT_SCORING,
        kill: 8,
      });
      const [versions] = await db.query<any[]>(
        "SELECT version,configuration FROM league_settings_versions WHERE league_id=? ORDER BY version",
        [second.id],
      );
      assert.deepEqual(
        versions.map((v) => v.version),
        [1, 2],
      );
      assert.equal(versions[0].configuration.kill, 5);
      await service.setMember(b, second.id, c, "MEMBER", "REMOVED");
      await assert.rejects(
        service.members(c, second.id),
        /LEAGUE_ACCESS_DENIED/,
      );
    } finally {
      await db.end();
    }
  },
);
