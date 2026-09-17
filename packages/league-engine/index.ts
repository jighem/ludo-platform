import { randomBytes, randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { type Database, transaction } from "../database";
import { DomainError } from "../auth/passwords";
import { digest } from "../auth/service";
export const DEFAULT_SCORING = {
  placements: [50, 30, 20, 0],
  kill: 5,
  home: 0,
  completion: 0,
  passPlayApproval: true,
  offlineApproval: true,
};
export async function requireVerified(tx: PoolConnection, userId: string) {
  const [users] = await tx.query<any[]>(
    "SELECT id FROM users WHERE id=? AND email_verified_at IS NOT NULL AND disabled_at IS NULL",
    [userId],
  );
  if (!users[0]) throw new DomainError("VERIFIED_ACCOUNT_REQUIRED", 403);
}
export async function leaguePermission(
  tx: PoolConnection,
  userId: string,
  leagueId: string,
  admin = false,
) {
  await tx.query("SELECT id FROM leagues WHERE id=? FOR UPDATE", [leagueId]);
  await requireVerified(tx, userId);
  const [members] = await tx.query<any[]>(
    "SELECT role FROM league_members WHERE league_id=? AND user_id=? AND status='ACTIVE'",
    [leagueId, userId],
  );
  if (!members[0] || (admin && members[0].role !== "LEAGUE_ADMIN"))
    throw new DomainError("LEAGUE_ACCESS_DENIED", 403);
}
export async function audit(
  tx: PoolConnection,
  actor: string,
  league: string | null,
  action: string,
  entity: string,
  id: string,
  old: unknown = null,
  value: unknown = null,
  reason: string | null = null,
) {
  await tx.execute(
    "INSERT INTO audit_logs(actor_id,league_id,action,entity_type,entity_id,old_value,new_value,reason) VALUES(?,?,?,?,?,?,?,?)",
    [
      actor,
      league,
      action,
      entity,
      id,
      old === null ? null : JSON.stringify(old),
      value === null ? null : JSON.stringify(value),
      reason,
    ],
  );
}
export class LeagueService {
  constructor(private db: Database) {}
  async create(actor: string, name: unknown, visibility: unknown) {
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 100 ||
      typeof visibility !== "string" ||
      !["PUBLIC", "PRIVATE"].includes(visibility)
    )
      throw new DomainError("INVALID_LEAGUE");
    return transaction(this.db, async (tx) => {
      await requireVerified(tx, actor);
      const id = randomUUID();
      await tx.execute(
        "INSERT INTO leagues(id,name,visibility,created_by) VALUES(?,?,?,?)",
        [id, name.trim(), visibility, actor],
      );
      await tx.execute(
        "INSERT INTO league_members(league_id,user_id,role) VALUES(?,?,'LEAGUE_ADMIN')",
        [id, actor],
      );
      await tx.execute(
        "INSERT INTO league_settings_versions(id,league_id,version,configuration,created_by) VALUES(?,?,1,?,?)",
        [randomUUID(), id, JSON.stringify(DEFAULT_SCORING), actor],
      );
      await audit(tx, actor, id, "LEAGUE_CREATED", "leagues", id, null, {
        name,
        visibility,
      });
      return { id, name, visibility };
    });
  }
  async list(actor: string) {
    const [rows] = await this.db.query<any[]>(
      "SELECT DISTINCT l.* FROM leagues l LEFT JOIN league_members m ON m.league_id=l.id AND m.user_id=? AND m.status='ACTIVE' WHERE l.visibility='PUBLIC' OR m.user_id IS NOT NULL ORDER BY l.created_at DESC",
      [actor],
    );
    return rows;
  }
  async members(actor: string, league: string) {
    return transaction(this.db, async (tx) => {
      await leaguePermission(tx, actor, league);
      const [rows] = await tx.query<any[]>(
        "SELECT m.user_id,m.role,m.status,p.display_name,p.player_id FROM league_members m JOIN user_profiles p ON p.user_id=m.user_id WHERE m.league_id=?",
        [league],
      );
      return rows;
    });
  }
  async invite(actor: string, league: string, invitee: string | null = null) {
    return transaction(this.db, async (tx) => {
      await leaguePermission(tx, actor, league, true);
      if (invitee) await requireVerified(tx, invitee);
      const code = randomBytes(12).toString("base64url"),
        id = randomUUID();
      await tx.execute(
        "INSERT INTO league_invitations(id,league_id,token_hash,invited_user_id,created_by,expires_at) VALUES(?,?,?,?,?,DATE_ADD(CURRENT_TIMESTAMP(6),INTERVAL 7 DAY))",
        [id, league, digest(code), invitee, actor],
      );
      await audit(
        tx,
        actor,
        league,
        "PLAYER_INVITED",
        "league_invitations",
        id,
        null,
        { invitee },
      );
      return { id, code };
    });
  }
  async accept(actor: string, code: unknown) {
    if (typeof code !== "string" || code.length > 100)
      throw new DomainError("INVALID_INVITATION");
    return transaction(this.db, async (tx) => {
      await requireVerified(tx, actor);
      const [invites] = await tx.query<any[]>(
        "SELECT * FROM league_invitations WHERE token_hash=? AND expires_at>CURRENT_TIMESTAMP(6) FOR UPDATE",
        [digest(code)],
      );
      const invite = invites[0];
      if (
        !invite ||
        (invite.invited_user_id && invite.invited_user_id !== actor) ||
        (invite.accepted_by && invite.accepted_by !== actor)
      )
        throw new DomainError("INVALID_INVITATION");
      await tx.query("SELECT id FROM leagues WHERE id=? FOR UPDATE", [
        invite.league_id,
      ]);
      if (invite.accepted_by === actor) return { leagueId: invite.league_id };
      await tx.execute(
        "INSERT INTO league_members(league_id,user_id) VALUES(?,?) ON DUPLICATE KEY UPDATE status='ACTIVE'",
        [invite.league_id, actor],
      );
      await tx.execute(
        "UPDATE league_invitations SET accepted_by=?,accepted_at=CURRENT_TIMESTAMP(6) WHERE id=?",
        [actor, invite.id],
      );
      await audit(
        tx,
        actor,
        invite.league_id,
        "INVITATION_ACCEPTED",
        "league_invitations",
        invite.id,
      );
      return { leagueId: invite.league_id };
    });
  }
  async requestJoin(actor: string, league: string) {
    await transaction(this.db, async (tx) => {
      await tx.query("SELECT id FROM leagues WHERE id=? FOR UPDATE", [league]);
      await requireVerified(tx, actor);
      const [leagues] = await tx.query<any[]>(
        "SELECT id FROM leagues WHERE id=? AND visibility='PUBLIC'",
        [league],
      );
      if (!leagues[0]) throw new DomainError("LEAGUE_NOT_FOUND", 404);
      await tx.execute(
        "INSERT INTO league_join_requests(league_id,user_id) VALUES(?,?) ON DUPLICATE KEY UPDATE status='PENDING'",
        [league, actor],
      );
      await audit(
        tx,
        actor,
        league,
        "JOIN_REQUESTED",
        "league_join_requests",
        actor,
      );
    });
  }
  async decideJoin(
    actor: string,
    league: string,
    user: string,
    approved: boolean,
  ) {
    if (typeof approved !== "boolean")
      throw new DomainError("INVALID_DECISION");
    await transaction(this.db, async (tx) => {
      await leaguePermission(tx, actor, league, true);
      const [requests] = await tx.query<any[]>(
        "SELECT status FROM league_join_requests WHERE league_id=? AND user_id=? FOR UPDATE",
        [league, user],
      );
      if (requests[0]?.status !== "PENDING")
        throw new DomainError("REQUEST_NOT_PENDING");
      await tx.execute(
        "UPDATE league_join_requests SET status=? WHERE league_id=? AND user_id=?",
        [approved ? "APPROVED" : "REJECTED", league, user],
      );
      if (approved)
        await tx.execute(
          "INSERT INTO league_members(league_id,user_id) VALUES(?,?) ON DUPLICATE KEY UPDATE status='ACTIVE'",
          [league, user],
        );
      await audit(
        tx,
        actor,
        league,
        approved ? "JOIN_APPROVED" : "JOIN_REJECTED",
        "league_members",
        user,
      );
    });
  }
  async setMember(
    actor: string,
    league: string,
    user: string,
    role: "LEAGUE_ADMIN" | "MEMBER",
    status: "ACTIVE" | "REMOVED",
  ) {
    if (
      !["LEAGUE_ADMIN", "MEMBER"].includes(role) ||
      !["ACTIVE", "REMOVED"].includes(status)
    )
      throw new DomainError("INVALID_MEMBERSHIP");
    await transaction(this.db, async (tx) => {
      await tx.query("SELECT id FROM leagues WHERE id=? FOR UPDATE", [league]);
      const [members] = await tx.query<any[]>(
        "SELECT * FROM league_members WHERE league_id=? ORDER BY user_id FOR UPDATE",
        [league],
      );
      await leaguePermission(tx, actor, league, true);
      const old = members.find((m) => m.user_id === user);
      if (!old) throw new DomainError("MEMBER_NOT_FOUND", 404);
      if (
        old.role === "LEAGUE_ADMIN" &&
        old.status === "ACTIVE" &&
        (role !== "LEAGUE_ADMIN" || status !== "ACTIVE") &&
        members.filter(
          (m) => m.role === "LEAGUE_ADMIN" && m.status === "ACTIVE",
        ).length <= 1
      )
        throw new DomainError("LAST_ADMIN_REQUIRED");
      await tx.execute(
        "UPDATE league_members SET role=?,status=? WHERE league_id=? AND user_id=?",
        [role, status, league, user],
      );
      await audit(
        tx,
        actor,
        league,
        "MEMBER_CHANGED",
        "league_members",
        user,
        old,
        { role, status },
      );
    });
  }
  async configureScoring(
    actor: string,
    league: string,
    value: typeof DEFAULT_SCORING,
  ) {
    if (
      !value ||
      !Array.isArray(value.placements) ||
      value.placements.length !== 4 ||
      [...value.placements, value.kill, value.home, value.completion].some(
        (n) =>
          typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 10000,
      ) ||
      typeof value.passPlayApproval !== "boolean" ||
      typeof value.offlineApproval !== "boolean"
    )
      throw new DomainError("INVALID_SCORING");
    await transaction(this.db, async (tx) => {
      await tx.query("SELECT id FROM leagues WHERE id=? FOR UPDATE", [league]);
      await leaguePermission(tx, actor, league, true);
      const [last] = await tx.query<any[]>(
        "SELECT version,configuration FROM league_settings_versions WHERE league_id=? ORDER BY version DESC LIMIT 1",
        [league],
      );
      const id = randomUUID();
      await tx.execute(
        "INSERT INTO league_settings_versions(id,league_id,version,configuration,created_by) VALUES(?,?,?,?,?)",
        [id, league, last[0].version + 1, JSON.stringify(value), actor],
      );
      await audit(
        tx,
        actor,
        league,
        "SCORING_CHANGED",
        "league_settings_versions",
        id,
        last[0].configuration,
        value,
      );
    });
  }
}
