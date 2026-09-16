import { type Database, transaction } from "../database";
export interface EmailProvider {
  send(input: { to: string; subject: string; text: string }): Promise<void>;
}
export async function deliverOne(
  db: Database,
  provider: EmailProvider,
  appUrl: string,
): Promise<boolean> {
  const event = await transaction(db, async (tx) => {
    const [events] = await tx.query<any[]>(
      `SELECT * FROM outbox_events WHERE kind='ACCOUNT_EMAIL' AND delivered_at IS NULL AND available_at<=CURRENT_TIMESTAMP(6) AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP(6)) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
    );
    if (!events[0]) return null;
    await tx.execute(
      "UPDATE outbox_events SET attempts=attempts+1,lease_until=DATE_ADD(CURRENT_TIMESTAMP(6),INTERVAL 5 MINUTE) WHERE id=?",
      [events[0].id],
    );
    return events[0];
  });
  if (!event) return false;
  const payload =
    typeof event.payload === "string"
      ? JSON.parse(event.payload)
      : event.payload;
  try {
    const route =
      payload.purpose === "VERIFY_EMAIL" ? "verify-email" : "reset-password";
    const link = new URL(`/${route}`, appUrl);
    link.hash = `token=${encodeURIComponent(payload.token)}`;
    await provider.send({
      to: payload.email,
      subject:
        payload.purpose === "VERIFY_EMAIL"
          ? "Verify your Ludo Platform email"
          : "Reset your Ludo Platform password",
      text: `Open this link to continue: ${link.toString()}\nIf you did not request this, ignore this email.`,
    });
    await db.execute(
      "UPDATE outbox_events SET delivered_at=CURRENT_TIMESTAMP(6),lease_until=NULL,payload=JSON_OBJECT('redacted',true) WHERE id=?",
      [event.id],
    );
  } catch {
    await db.execute(
      "UPDATE outbox_events SET lease_until=NULL,last_error='DELIVERY_FAILED',available_at=DATE_ADD(CURRENT_TIMESTAMP(6),INTERVAL ? SECOND) WHERE id=?",
      [Math.min(3600, 30 * 2 ** Math.min(event.attempts, 7)), event.id],
    );
  }
  return true;
}
