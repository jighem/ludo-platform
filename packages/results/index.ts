import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { type Database, transaction } from "../database";
import { DomainError } from "../auth/passwords";
import { leaguePermission, audit } from "../league-engine";
export interface Placement {
  userId: string;
  place: number;
  kills: number;
  home: number;
  completed: boolean;
}
function validate(p: Placement[], reason: unknown) {
  if (
    !Array.isArray(p) ||
    p.length < 2 ||
    p.length > 4 ||
    typeof reason !== "string" ||
    !reason.trim() ||
    reason.length > 1000 ||
    new Set(p.map((v) => v?.userId)).size !== p.length ||
    new Set(p.map((v) => v?.place)).size !== p.length ||
    p.some(
      (v) =>
        !v ||
        typeof v.userId !== "string" ||
        v.userId.length !== 36 ||
        !Number.isInteger(v.place) ||
        v.place < 1 ||
        v.place > p.length ||
        !Number.isInteger(v.kills) ||
        v.kills < 0 ||
        v.kills > 10000 ||
        !Number.isInteger(v.home) ||
        v.home < 0 ||
        v.home > 4 ||
        typeof v.completed !== "boolean",
    )
  )
    throw new DomainError("INVALID_RESULT");
}
export class ResultService {
  constructor(private db: Database) {}
  private async append(
    tx: PoolConnection,
    actor: string,
    league: string,
    match: string,
    placements: Placement[],
    approval: string,
    reason: string,
    previous: any = null,
  ) {
    const id = randomUUID(),
      revision = (previous?.revision ?? 0) + 1;
    await tx.execute(
      "INSERT INTO match_results(id,match_id,revision,approval,metrics,created_by,change_reason) VALUES(?,?,?,?,?,?,?)",
      [
        id,
        match,
        revision,
        approval,
        JSON.stringify(placements),
        actor,
        reason,
      ],
    );
    for (const p of placements)
      await tx.execute(
        "INSERT INTO result_placements(result_id,user_id,place) VALUES(?,?,?)",
        [id, p.userId, p.place],
      );
    await audit(
      tx,
      actor,
      league,
      "RESULT_REVISION",
      "match_results",
      id,
      previous,
      { matchId: match, revision, approval, placements },
      reason,
    );
    return { id, matchId: match, revision, approval };
  }
  async manual(
    actor: string,
    league: string,
    ruleset: string,
    placements: Placement[],
    reason: string,
  ) {
    validate(placements, reason);
    return transaction(this.db, async (tx) => {
      await leaguePermission(tx, actor, league, true);
      for (const p of placements) await leaguePermission(tx, p.userId, league);
      const [rules] = await tx.query<any[]>(
        "SELECT id FROM ruleset_versions WHERE id=?",
        [ruleset],
      );
      if (!rules[0]) throw new DomainError("RULESET_NOT_FOUND", 404);
      const [settings] = await tx.query<any[]>(
        "SELECT id FROM league_settings_versions WHERE league_id=? ORDER BY version DESC LIMIT 1",
        [league],
      );
      const id = randomUUID();
      await tx.execute(
        "INSERT INTO matches(id,source,phase,ruleset_version_id,state,created_by,finished_at) VALUES(?,'MANUAL','COMPLETED',?,?,?,CURRENT_TIMESTAMP(6))",
        [id, ruleset, JSON.stringify({ source: "MANUAL" }), actor],
      );
      for (let seat = 0; seat < placements.length; seat++)
        await tx.execute(
          "INSERT INTO match_players(match_id,user_id,seat) VALUES(?,?,?)",
          [id, placements[seat].userId, seat],
        );
      await tx.execute(
        "INSERT INTO league_matches(league_id,match_id,settings_version_id) VALUES(?,?,?)",
        [league, id, settings[0].id],
      );
      return this.append(tx, actor, league, id, placements, "PENDING", reason);
    });
  }
  async revise(
    actor: string,
    league: string,
    match: string,
    expectedRevision: number,
    approval: string,
    reason: string,
    correction?: Placement[],
  ) {
    if (
      !["APPROVED", "REJECTED", "PENDING", "CANCELLED", "DISPUTED"].includes(
        approval,
      ) ||
      typeof reason !== "string" ||
      !reason.trim() ||
      reason.length > 1000 ||
      !Number.isSafeInteger(expectedRevision)
    )
      throw new DomainError("INVALID_RESULT");
    return transaction(this.db, async (tx) => {
      await leaguePermission(tx, actor, league, true);
      const [matches] = await tx.query<any[]>(
        "SELECT m.source FROM matches m JOIN league_matches l ON l.match_id=m.id WHERE m.id=? AND l.league_id=? FOR UPDATE",
        [match, league],
      );
      if (!matches[0]) throw new DomainError("MATCH_NOT_FOUND", 404);
      const [results] = await tx.query<any[]>(
        "SELECT * FROM match_results WHERE match_id=? ORDER BY revision DESC LIMIT 1",
        [match],
      );
      const previous = results[0];
      if (!previous || previous.revision !== expectedRevision)
        throw new DomainError("STALE_RESULT_REVISION", 409);
      const placements = correction ?? previous.metrics;
      validate(placements, reason);
      if (correction) {
        if (matches[0].source !== "MANUAL")
          throw new DomainError("AUTHORITATIVE_RESULT_IMMUTABLE", 409);
        const [players] = await tx.query<any[]>(
          "SELECT user_id FROM match_players WHERE match_id=?",
          [match],
        );
        if (
          players.length !== placements.length ||
          players.some((p) => !placements.some((v) => v.userId === p.user_id))
        )
          throw new DomainError("PARTICIPANTS_IMMUTABLE");
      }
      return this.append(
        tx,
        actor,
        league,
        match,
        placements,
        approval,
        reason,
        previous,
      );
    });
  }
  async standings(actor: string, league: string) {
    return transaction(this.db, async (tx) => {
      await leaguePermission(tx, actor, league);
      const [results] = await tx.query<any[]>(
        `SELECT r.metrics,s.configuration FROM league_matches l JOIN league_settings_versions s ON s.id=l.settings_version_id JOIN match_results r ON r.match_id=l.match_id WHERE l.league_id=? AND r.approval='APPROVED' AND NOT EXISTS(SELECT 1 FROM match_results newer WHERE newer.match_id=r.match_id AND newer.revision>r.revision)`,
        [league],
      );
      const totals = new Map<
        string,
        {
          userId: string;
          points: number;
          played: number;
          wins: number;
          kills: number;
        }
      >();
      for (const result of results) {
        const scoring = result.configuration;
        for (const p of result.metrics as Placement[]) {
          const row = totals.get(p.userId) ?? {
            userId: p.userId,
            points: 0,
            played: 0,
            wins: 0,
            kills: 0,
          };
          row.points +=
            scoring.placements[p.place - 1] +
            p.kills * scoring.kill +
            p.home * scoring.home +
            (p.completed ? scoring.completion : 0);
          row.played++;
          row.wins += p.place === 1 ? 1 : 0;
          row.kills += p.kills;
          totals.set(p.userId, row);
        }
      }
      const sorted = [...totals.values()].sort(
        (a, b) => b.points - a.points || a.userId.localeCompare(b.userId),
      );
      let rank = 0;
      return sorted.map((row, index) => {
        if (index === 0 || row.points !== sorted[index - 1].points)
          rank = index + 1;
        return { ...row, rank };
      });
    });
  }
  async history(actor: string, league: string, match: string) {
    return transaction(this.db, async (tx) => {
      await leaguePermission(tx, actor, league);
      const [rows] = await tx.query<any[]>(
        "SELECT r.* FROM match_results r JOIN league_matches l ON l.match_id=r.match_id WHERE l.league_id=? AND l.match_id=? ORDER BY r.revision",
        [league, match],
      );
      return rows;
    });
  }
}
