import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../../packages/database";
import { LeagueService, DEFAULT_SCORING } from "../../packages/league-engine";
import { ResultService } from "../../packages/results";
import { publishRules } from "../../packages/rulesets/repository";
import { STANDARD_RULES } from "../../packages/rulesets";
const url = process.env.TEST_DATABASE_URL;
test(
  "manual result approval, correction, cancellation and historical scoring stay league-scoped",
  { skip: !url },
  async () => {
    assert.match(new URL(url!).pathname, /^\/ludo_test_/);
    const db = createDatabase(url!),
      leagues = new LeagueService(db),
      results = new ResultService(db);
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
        b = await user();
      const league = await leagues.create(a, "Scoring test", "PRIVATE"),
        other = await leagues.create(b, "Other", "PRIVATE");
      await leagues.accept(b, (await leagues.invite(a, league.id, b)).code);
      const rules = await publishRules(db, a, {
        ...STANDARD_RULES,
        id: `test-${randomUUID()}`,
      });
      const placements = [
        { userId: a, place: 1, kills: 2, home: 4, completed: true },
        { userId: b, place: 2, kills: 0, home: 1, completed: false },
      ];
      const result = await results.manual(
        a,
        league.id,
        rules.id,
        placements,
        "Recorded match",
      );
      assert.deepEqual(await results.standings(a, league.id), []);
      await assert.rejects(
        results.revise(b, league.id, result.matchId, 1, "APPROVED", "Approve"),
        /LEAGUE_ACCESS_DENIED/,
      );
      await assert.rejects(
        results.revise(b, other.id, result.matchId, 1, "APPROVED", "Approve"),
        /MATCH_NOT_FOUND/,
      );
      const attempts = await Promise.allSettled([
        results.revise(a, league.id, result.matchId, 1, "APPROVED", "Verified"),
        results.revise(
          a,
          league.id,
          result.matchId,
          1,
          "APPROVED",
          "Duplicate",
        ),
      ]);
      assert.equal(attempts.filter((a) => a.status === "fulfilled").length, 1);
      assert.equal((await results.standings(a, league.id))[0].points, 60);
      await leagues.configureScoring(a, league.id, {
        ...DEFAULT_SCORING,
        kill: 100,
      });
      assert.equal((await results.standings(a, league.id))[0].points, 60);
      await results.revise(
        a,
        league.id,
        result.matchId,
        2,
        "APPROVED",
        "Correct placement",
        placements.map((p) => ({ ...p, place: 3 - p.place })),
      );
      const corrected = await results.standings(a, league.id);
      assert.equal(corrected[0].userId, b);
      assert.equal(corrected[0].points, 50);
      await results.revise(
        a,
        league.id,
        result.matchId,
        3,
        "CANCELLED",
        "Match invalidated",
      );
      assert.deepEqual(await results.standings(a, league.id), []);
      const history = await results.history(a, league.id, result.matchId);
      assert.equal(history.length, 4);
      assert.equal(history[0].approval, "PENDING");
      assert.equal(history[1].metrics[0].place, 1);
      assert.deepEqual(await results.standings(b, other.id), []);
    } finally {
      await db.end();
    }
  },
);
