import type { Database } from "../database";
import { MatchService } from "./index";
export async function expireDueMatches(db: Database) {
  const [rows] = await db.query<any[]>(
    "SELECT id,state FROM matches WHERE source='ONLINE' AND phase='PLAYING' AND deadline<=CURRENT_TIMESTAMP(6) ORDER BY deadline LIMIT 100",
  );
  const service = new MatchService(db);
  let expired = 0;
  for (const row of rows)
    if (await service.expire(row.id, row.state.turnId)) expired++;
  return expired;
}
