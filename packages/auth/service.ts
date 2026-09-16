import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { type Database, transaction } from "../database";
import {
  DomainError,
  hashPassword,
  normalizeRegistration,
  validPassword,
  verifyPassword,
} from "./passwords";
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export interface Identity extends RowDataPacket {
  id: string;
  email: string;
  username: string;
  email_verified_at: string | null;
  platform_role: "PLAYER" | "SUPER_ADMIN";
  disabled_at: string | null;
}
const secret = () => randomBytes(32).toString("base64url");
export class AuthService {
  constructor(private db: Database) {}
  private async issueAccountToken(
    tx: PoolConnection,
    userId: string,
    email: string,
    purpose: "VERIFY_EMAIL" | "RESET_PASSWORD",
  ) {
    const token = secret(),
      hours = purpose === "VERIFY_EMAIL" ? 24 : 1;
    await tx.execute(
      "UPDATE account_tokens SET consumed_at=CURRENT_TIMESTAMP(6) WHERE user_id=? AND purpose=? AND consumed_at IS NULL",
      [userId, purpose],
    );
    await tx.execute(
      "INSERT INTO account_tokens(token_hash,user_id,purpose,expires_at) VALUES (?,?,?,DATE_ADD(CURRENT_TIMESTAMP(6),INTERVAL ? HOUR))",
      [digest(token), userId, purpose, hours],
    );
    const id = randomUUID();
    await tx.execute(
      "INSERT INTO outbox_events(id,kind,payload,deduplication_key) VALUES (?,?,?,?)",
      [
        id,
        "ACCOUNT_EMAIL",
        JSON.stringify({ email, purpose, token }),
        `account:${id}`,
      ],
    );
  }
  async register(input: unknown) {
    const data = normalizeRegistration(input),
      passwordHash = await hashPassword(data.password),
      id = randomUUID();
    try {
      await transaction(this.db, async (tx) => {
        await tx.execute(
          "INSERT INTO users(id,email,username,password_hash) VALUES(?,?,?,?)",
          [id, data.email, data.username, passwordHash],
        );
        await tx.execute(
          "INSERT INTO user_profiles(user_id,player_id,display_name) VALUES(?,?,?)",
          [
            id,
            `LP-${randomBytes(9).toString("hex").toUpperCase()}`,
            data.displayName,
          ],
        );
        await this.issueAccountToken(tx, id, data.email, "VERIFY_EMAIL");
      });
    } catch (error: any) {
      if (error.code === "ER_DUP_ENTRY")
        throw new DomainError("ACCOUNT_ALREADY_EXISTS", 409);
      throw error;
    }
    return { id, username: data.username, emailVerificationRequired: true };
  }
  async login(email: unknown, password: unknown) {
    if (typeof email !== "string" || typeof password !== "string")
      throw new DomainError("INVALID_CREDENTIALS", 401);
    const [found] = await this.db.query<
      (Identity & { password_hash: string })[]
    >("SELECT * FROM users WHERE email=?", [email.trim().toLowerCase()]);
    const user = found[0];
    // Spend the same KDF cost for unknown accounts; never log password/hash values.
    const fallback = "scrypt-v1$" + "0".repeat(32) + "$" + "0".repeat(128);
    if (
      !(await verifyPassword(password, user?.password_hash || fallback)) ||
      !user ||
      user.disabled_at
    )
      throw new DomainError("INVALID_CREDENTIALS", 401);
    const token = secret(),
      sessionId = randomUUID();
    await transaction(this.db, async (tx) => {
      const [current] = await tx.query<
        (Identity & { password_hash: string })[]
      >("SELECT * FROM users WHERE id=? FOR UPDATE", [user.id]);
      if (
        !current[0] ||
        current[0].disabled_at ||
        current[0].password_hash !== user.password_hash
      )
        throw new DomainError("INVALID_CREDENTIALS", 401);
      await tx.execute(
        "INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES(?,?,?,DATE_ADD(CURRENT_TIMESTAMP(6),INTERVAL 7 DAY))",
        [sessionId, user.id, digest(token)],
      );
    });
    return { token, user: await this.authenticate(token) };
  }
  async authenticate(token: string): Promise<Identity> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new DomainError("AUTHENTICATION_REQUIRED", 401);
    const [found] = await this.db.query<Identity[]>(
      `SELECT u.id,u.email,u.username,u.email_verified_at,u.platform_role,u.disabled_at
    FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>CURRENT_TIMESTAMP(6) AND u.disabled_at IS NULL`,
      [digest(token)],
    );
    if (!found[0]) throw new DomainError("AUTHENTICATION_REQUIRED", 401);
    return found[0];
  }
  async logout(token: string) {
    await this.db.execute(
      "UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP(6) WHERE token_hash=?",
      [digest(token)],
    );
  }
  async requestRecovery(email: unknown) {
    if (typeof email !== "string" || email.length > 254) return;
    await transaction(this.db, async (tx) => {
      const [users] = await tx.query<Identity[]>(
        "SELECT * FROM users WHERE email=? AND disabled_at IS NULL FOR UPDATE",
        [email.trim().toLowerCase()],
      );
      if (users[0])
        await this.issueAccountToken(
          tx,
          users[0].id,
          users[0].email,
          "RESET_PASSWORD",
        );
    });
  }
  async resendVerification(user: Identity) {
    await transaction(this.db, async (tx) => {
      const [users] = await tx.query<Identity[]>(
        "SELECT * FROM users WHERE id=? AND disabled_at IS NULL FOR UPDATE",
        [user.id],
      );
      if (users[0] && !users[0].email_verified_at)
        await this.issueAccountToken(
          tx,
          user.id,
          users[0].email,
          "VERIFY_EMAIL",
        );
    });
  }
  async consumeToken(
    token: unknown,
    purpose: "VERIFY_EMAIL" | "RESET_PASSWORD",
    password?: unknown,
  ) {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new DomainError("INVALID_OR_EXPIRED_TOKEN");
    let passwordHash: string | undefined;
    if (purpose === "RESET_PASSWORD") {
      validPassword(password);
      passwordHash = await hashPassword(password);
    }
    await transaction(this.db, async (tx) => {
      // Lock identity before token, matching issue/reset/login lock order.
      const [lookup] = await tx.query<RowDataPacket[]>(
        "SELECT user_id FROM account_tokens WHERE token_hash=?",
        [digest(token)],
      );
      if (!lookup[0]) throw new DomainError("INVALID_OR_EXPIRED_TOKEN");
      const id = lookup[0].user_id;
      const [users] = await tx.query<Identity[]>(
        "SELECT * FROM users WHERE id=? AND disabled_at IS NULL FOR UPDATE",
        [id],
      );
      if (!users[0]) throw new DomainError("INVALID_OR_EXPIRED_TOKEN");
      const [tokens] = await tx.query<RowDataPacket[]>(
        "SELECT * FROM account_tokens WHERE token_hash=? AND purpose=? AND consumed_at IS NULL AND expires_at>CURRENT_TIMESTAMP(6) FOR UPDATE",
        [digest(token), purpose],
      );
      if (!tokens[0]) throw new DomainError("INVALID_OR_EXPIRED_TOKEN");
      await tx.execute(
        "UPDATE account_tokens SET consumed_at=CURRENT_TIMESTAMP(6) WHERE token_hash=?",
        [digest(token)],
      );
      if (purpose === "VERIFY_EMAIL")
        await tx.execute(
          "UPDATE users SET email_verified_at=CURRENT_TIMESTAMP(6) WHERE id=?",
          [id],
        );
      else {
        await tx.execute("UPDATE users SET password_hash=? WHERE id=?", [
          passwordHash,
          id,
        ]);
        await tx.execute(
          "UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP(6) WHERE user_id=?",
          [id],
        );
      }
    });
  }
}
