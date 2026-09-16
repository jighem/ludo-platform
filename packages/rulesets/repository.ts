import { randomUUID, createHash } from "node:crypto";
import { type Database, transaction } from "../database";
import { validateRules, type Ruleset } from "./index";
export function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  throw new Error("NON_CANONICAL_VALUE");
}
export async function publishRules(
  db: Database,
  actorId: string,
  input: Ruleset,
) {
  const config = validateRules(input),
    body = canonical(config),
    hash = createHash("sha256").update(body).digest("hex");
  return transaction(db, async (tx) => {
    const [actors] = await tx.query<any[]>(
      "SELECT platform_role FROM users WHERE id=? AND disabled_at IS NULL FOR UPDATE",
      [actorId],
    );
    if (actors[0]?.platform_role !== "SUPER_ADMIN")
      throw new Error("PLATFORM_ADMIN_REQUIRED");
    const [existing] = await tx.query<any[]>(
      "SELECT id FROM rulesets WHERE name=?",
      [config.id],
    );
    const rulesetId = existing[0]?.id || randomUUID();
    if (!existing[0])
      await tx.execute("INSERT INTO rulesets(id,name) VALUES(?,?)", [
        rulesetId,
        config.id,
      ]);
    const id = randomUUID();
    await tx.execute(
      "INSERT INTO ruleset_versions(id,ruleset_id,version,engine_version,content_hash,configuration) VALUES(?,?,?,?,?,?)",
      [id, rulesetId, config.version, config.engineVersion, hash, body],
    );
    await tx.execute(
      "INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,new_value) VALUES (?,'RULESET_PUBLISHED','ruleset_versions',?,?)",
      [actorId, id, body],
    );
    return { id, hash, configuration: config };
  });
}
