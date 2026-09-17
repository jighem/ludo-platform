import { randomInt, randomUUID, createHash } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { type Database, transaction } from "../database";
import { DomainError } from "../auth/passwords";
import { leaguePermission, requireVerified } from "../league-engine";
import { canonical } from "../rulesets/repository";
import {
  createGame,
  roll,
  move,
  surrender,
  timeout,
  type Transition,
  type GameState,
} from "../game-engine";
import { restoreGame } from "../game-engine/restore";
export type Intent = {
  commandId: string;
  expectedRevision: number;
  type: "ROLL" | "MOVE" | "SURRENDER";
  token?: number;
};
function intent(value: any): asserts value is Intent {
  if (
    !value ||
    typeof value !== "object" ||
    !/^[-a-f0-9]{36}$/i.test(value.commandId) ||
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision < 0 ||
    !["ROLL", "MOVE", "SURRENDER"].includes(value.type) ||
    Object.keys(value).some(
      (k) =>
        ![
          "commandId",
          "expectedRevision",
          "type",
          ...(value.type === "MOVE" ? ["token"] : []),
        ].includes(k),
    ) ||
    (value.type === "MOVE" &&
      (!Number.isInteger(value.token) || value.token < 0 || value.token > 3))
  )
    throw new DomainError("INVALID_COMMAND");
}
const json = (v: any) => (typeof v === "string" ? JSON.parse(v) : v);
export class MatchService {
  constructor(private db: Database) {}
  private async access(tx: PoolConnection, actor: string, id: string) {
    await requireVerified(tx, actor);
    const [scope] = await tx.query<any[]>(
      "SELECT league_id FROM league_matches WHERE match_id=?",
      [id],
    );
    if (scope[0]) await leaguePermission(tx, actor, scope[0].league_id);
    const [players] = await tx.query<any[]>(
      "SELECT user_id FROM match_players WHERE match_id=? AND user_id=?",
      [id, actor],
    );
    if (!players[0]) throw new DomainError("MATCH_ACCESS_DENIED", 403);
    const [matches] = await tx.query<any[]>(
      "SELECT * FROM matches WHERE id=? FOR UPDATE",
      [id],
    );
    if (!matches[0]) throw new DomainError("MATCH_NOT_FOUND", 404);
    return matches[0];
  }
  async create(
    actor: string,
    players: unknown,
    rulesetId: unknown,
    leagueId?: string,
  ) {
    if (
      !Array.isArray(players) ||
      players.length < 2 ||
      players.length > 4 ||
      new Set(players).size !== players.length ||
      !players.includes(actor) ||
      players.some((p) => typeof p !== "string" || p.length !== 36) ||
      typeof rulesetId !== "string"
    )
      throw new DomainError("INVALID_MATCH");
    return transaction(this.db, async (tx) => {
      if (leagueId) await leaguePermission(tx, actor, leagueId, true);
      for (const player of [...players].sort()) {
        if (leagueId) await leaguePermission(tx, player, leagueId);
        else await requireVerified(tx, player);
      }
      const [versions] = await tx.query<any[]>(
        "SELECT configuration,content_hash FROM ruleset_versions WHERE id=?",
        [rulesetId],
      );
      if (!versions[0]) throw new DomainError("RULESET_NOT_FOUND", 404);
      const rules = json(versions[0].configuration);
      if (
        createHash("sha256").update(canonical(rules)).digest("hex") !==
        versions[0].content_hash
      )
        throw new DomainError("RULESET_INTEGRITY_FAILURE", 500);
      const state = createGame(players, rules, Date.now()),
        id = randomUUID();
      await tx.execute(
        "INSERT INTO matches(id,source,phase,ruleset_version_id,state,created_by) VALUES(?,'ONLINE','LOBBY',?,?,?)",
        [id, rulesetId, JSON.stringify(state), actor],
      );
      for (let seat = 0; seat < players.length; seat++)
        await tx.execute(
          "INSERT INTO match_players(match_id,user_id,seat) VALUES(?,?,?)",
          [id, players[seat], seat],
        );
      if (leagueId) {
        const [settings] = await tx.query<any[]>(
          "SELECT id FROM league_settings_versions WHERE league_id=? ORDER BY version DESC LIMIT 1",
          [leagueId],
        );
        await tx.execute(
          "INSERT INTO league_matches(league_id,match_id,settings_version_id) VALUES(?,?,?)",
          [leagueId, id, settings[0].id],
        );
      }
      return { id, phase: "LOBBY", state };
    });
  }
  async snapshot(actor: string, id: string, after = 0) {
    if (!Number.isSafeInteger(after) || after < 0)
      throw new DomainError("INVALID_SEQUENCE");
    return transaction(this.db, async (tx) => {
      const match = await this.access(tx, actor, id);
      const [events] = await tx.query<any[]>(
        "SELECT sequence,event FROM match_events WHERE match_id=? AND sequence>? ORDER BY sequence LIMIT 500",
        [id, after],
      );
      const [last] = await tx.query<any[]>(
        "SELECT COALESCE(MAX(sequence),0) AS sequence FROM match_events WHERE match_id=?",
        [id],
      );
      return {
        id,
        phase: match.phase,
        state: json(match.state),
        revision: match.revision,
        events,
        lastSequence: last[0].sequence,
      };
    });
  }
  async checkIn(actor: string, id: string) {
    return transaction(this.db, async (tx) => {
      const match = await this.access(tx, actor, id);
      if (match.phase !== "LOBBY")
        return { phase: match.phase, state: json(match.state) };
      await tx.execute(
        "UPDATE match_players SET checked_in_at=COALESCE(checked_in_at,CURRENT_TIMESTAMP(6)),last_seen_at=CURRENT_TIMESTAMP(6) WHERE match_id=? AND user_id=?",
        [id, actor],
      );
      const [missing] = await tx.query<any[]>(
        "SELECT user_id FROM match_players WHERE match_id=? AND checked_in_at IS NULL",
        [id],
      );
      if (missing.length) return { phase: "LOBBY", waiting: missing.length };
      const state = restoreGame(json(match.state));
      state.deadline = Date.now() + state.rules.turnSeconds * 1000;
      state.revision++;
      await tx.execute(
        "UPDATE matches SET started_at=CURRENT_TIMESTAMP(6) WHERE id=?",
        [id],
      );
      await this.persist(tx, id, {
        state,
        events: [{ type: "MATCH_STARTED" }],
      });
      return { phase: "PLAYING", state };
    });
  }
  private async persist(tx: PoolConnection, id: string, result: Transition) {
    const { state } = result;
    await tx.execute(
      "UPDATE matches SET state=?,phase=?,revision=?,deadline=?,finished_at=IF(?='COMPLETED',CURRENT_TIMESTAMP(6),finished_at) WHERE id=?",
      [
        JSON.stringify(state),
        state.phase,
        state.revision,
        state.phase === "PLAYING" ? new Date(state.deadline) : null,
        state.phase,
        id,
      ],
    );
    const [last] = await tx.query<any[]>(
      "SELECT COALESCE(MAX(sequence),0) AS sequence FROM match_events WHERE match_id=?",
      [id],
    );
    let sequence = Number(last[0].sequence);
    for (const event of [
      ...result.events,
      ...(result.audit ? [{ type: "DICE_AUDIT", audit: result.audit }] : []),
    ])
      await tx.execute(
        "INSERT INTO match_events(match_id,sequence,event) VALUES(?,?,?)",
        [id, ++sequence, JSON.stringify(event)],
      );
    await tx.execute(
      "INSERT INTO outbox_events(id,kind,payload,deduplication_key) VALUES(?,'MATCH_UPDATED',?,?)",
      [
        randomUUID(),
        JSON.stringify({
          matchId: id,
          revision: state.revision,
          lastSequence: sequence,
        }),
        `match:${id}:${state.revision}`,
      ],
    );
    if (state.phase === "COMPLETED") {
      const [matchRows] = await tx.query<any[]>(
        "SELECT created_by FROM matches WHERE id=?",
        [id],
      );
      const [events] = await tx.query<any[]>(
        "SELECT event FROM match_events WHERE match_id=? ORDER BY sequence",
        [id],
      );
      const metrics = state.finishOrder.map((userId, index) => ({
        userId,
        place: index + 1,
        kills: events.filter(
          (e) => e.event.type === "TOKEN_KILLED" && e.event.playerId === userId,
        ).length,
        home: state.players
          .find((p) => p.id === userId)!
          .tokens.filter((t) => t === 56).length,
        completed:
          state.players
            .find((p) => p.id === userId)!
            .tokens.filter((t) => t === 56).length >=
          state.rules.tokensToFinish,
      }));
      const resultId = randomUUID();
      await tx.execute(
        "INSERT INTO match_results(id,match_id,revision,approval,metrics,created_by,change_reason) VALUES(?,?,1,'APPROVED',?,?,'Server-authoritative completion')",
        [resultId, id, JSON.stringify(metrics), matchRows[0].created_by],
      );
      for (const p of metrics)
        await tx.execute(
          "INSERT INTO result_placements(result_id,user_id,place) VALUES(?,?,?)",
          [resultId, p.userId, p.place],
        );
    }
    return { state, lastSequence: sequence };
  }
  async command(actor: string, id: string, value: unknown) {
    intent(value);
    const hash = createHash("sha256").update(canonical(value)).digest("hex");
    return transaction(this.db, async (tx) => {
      const match = await this.access(tx, actor, id);
      const [receipts] = await tx.query<any[]>(
        "SELECT request_hash,response FROM match_commands WHERE match_id=? AND actor_id=? AND command_id=?",
        [id, actor, value.commandId],
      );
      if (receipts[0]) {
        if (receipts[0].request_hash !== hash)
          throw new DomainError("COMMAND_ID_REUSED", 409);
        return json(receipts[0].response);
      }
      if (match.source !== "ONLINE" || match.phase !== "PLAYING")
        throw new DomainError("MATCH_NOT_PLAYING", 409);
      if (match.revision !== value.expectedRevision)
        throw new DomainError("STALE_REVISION", 409);
      const state = restoreGame(json(match.state));
      let result: Transition;
      try {
        result =
          value.type === "ROLL"
            ? roll(state, actor, (faces) => randomInt(faces.length), Date.now())
            : value.type === "MOVE"
              ? move(state, actor, value.token!, Date.now())
              : surrender(state, actor, Date.now());
      } catch (error) {
        throw new DomainError((error as Error).message, 409);
      }
      const response = await this.persist(tx, id, result);
      await tx.execute(
        "INSERT INTO match_commands(match_id,actor_id,command_id,request_hash,response) VALUES(?,?,?,?,?)",
        [id, actor, value.commandId, hash, JSON.stringify(response)],
      );
      return response;
    });
  }
  async expire(id: string, turnId: number) {
    return transaction(this.db, async (tx) => {
      const [matches] = await tx.query<any[]>(
        "SELECT * FROM matches WHERE id=? FOR UPDATE",
        [id],
      );
      const match = matches[0];
      if (!match || match.source !== "ONLINE" || match.phase !== "PLAYING")
        return false;
      const state = restoreGame(json(match.state));
      if (state.turnId !== turnId || Date.now() < state.deadline) return false;
      await this.persist(tx, id, timeout(state, turnId, Date.now()));
      return true;
    });
  }
}
