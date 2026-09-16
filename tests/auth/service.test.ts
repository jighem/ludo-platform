import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../../packages/database";
import { AuthService, digest } from "../../packages/auth/service";
const url = process.env.TEST_DATABASE_URL;
test(
  "MySQL auth: registration, verification, reset, revocation and concurrent token consumption",
  { skip: !url },
  async () => {
    assert.match(new URL(url!).pathname, /^\/ludo_test_/);
    const db = createDatabase(url!),
      auth = new AuthService(db),
      email = `${randomUUID()}@example.invalid`,
      username = randomUUID().replaceAll("-", "").slice(0, 24),
      password = "initial-long-password";
    const readToken = async (purpose: string) => {
      const [events] = await db.query<any[]>(
        "SELECT payload FROM outbox_events WHERE kind='ACCOUNT_EMAIL' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.email'))=? AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.purpose'))=? ORDER BY created_at DESC LIMIT 1",
        [email, purpose],
      );
      const payload =
        typeof events[0].payload === "string"
          ? JSON.parse(events[0].payload)
          : events[0].payload;
      return payload.token as string;
    };
    try {
      await auth.register({ email, username, password });
      await assert.rejects(
        auth.register({ email, username, password }),
        /ACCOUNT_ALREADY_EXISTS/,
      );
      const login = await auth.login(email, password);
      assert.equal(login.user.email_verified_at, null);
      const verify = await readToken("VERIFY_EMAIL");
      const attempts = await Promise.allSettled([
        auth.consumeToken(verify, "VERIFY_EMAIL"),
        auth.consumeToken(verify, "VERIFY_EMAIL"),
      ]);
      assert.equal(attempts.filter((a) => a.status === "fulfilled").length, 1);
      assert.notEqual(
        (await auth.authenticate(login.token)).email_verified_at,
        null,
      );
      await auth.requestRecovery("not-registered@example.invalid");
      await auth.requestRecovery(email);
      const reset = await readToken("RESET_PASSWORD");
      await auth.consumeToken(
        reset,
        "RESET_PASSWORD",
        "replacement-long-password",
      );
      await assert.rejects(
        auth.authenticate(login.token),
        /AUTHENTICATION_REQUIRED/,
      );
      await assert.rejects(auth.login(email, password), /INVALID_CREDENTIALS/);
      await assert.rejects(
        auth.consumeToken(reset, "RESET_PASSWORD", "another-long-password"),
      );
      const second = await auth.login(email, "replacement-long-password");
      await auth.logout(second.token);
      await assert.rejects(auth.authenticate(second.token));
      const third = await auth.login(email, "replacement-long-password");
      await db.execute(
        "UPDATE sessions SET expires_at=DATE_SUB(CURRENT_TIMESTAMP(6),INTERVAL 1 SECOND) WHERE token_hash=?",
        [digest(third.token)],
      );
      await assert.rejects(auth.authenticate(third.token));
    } finally {
      await db.end();
    }
  },
);
