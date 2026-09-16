import { createHash } from "node:crypto";
import { transaction, type Database } from "../database";
import { DomainError } from "../auth/passwords";
export async function enforceRate(
  db: Database,
  key: string,
  limit: number,
  seconds: number,
) {
  const bucket = createHash("sha256").update(key).digest("hex");
  await transaction(db, async (tx) => {
    await tx.execute(
      "INSERT INTO rate_limits(bucket,hits,expires_at) VALUES (?,0,DATE_ADD(CURRENT_TIMESTAMP(6),INTERVAL ? SECOND)) ON DUPLICATE KEY UPDATE bucket=VALUES(bucket)",
      [bucket, seconds],
    );
    const [rows] = await tx.query<any[]>(
      "SELECT hits,expires_at<=CURRENT_TIMESTAMP(6) AS expired FROM rate_limits WHERE bucket=? FOR UPDATE",
      [bucket],
    );
    const hits = rows[0].expired ? 0 : rows[0].hits;
    if (hits >= limit) throw new DomainError("RATE_LIMITED", 429);
    await tx.execute(
      "UPDATE rate_limits SET hits=?,expires_at=IF(expires_at<=CURRENT_TIMESTAMP(6),DATE_ADD(CURRENT_TIMESTAMP(6),INTERVAL ? SECOND),expires_at) WHERE bucket=?",
      [hits + 1, seconds, bucket],
    );
  });
}
