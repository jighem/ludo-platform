import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  verifyPassword,
  normalizeRegistration,
} from "../../packages/auth/passwords";
test("password hashing uses random salts and rejects wrong passwords", async () => {
  const password = "correct horse battery staple";
  const first = await hashPassword(password),
    second = await hashPassword(password);
  assert.notEqual(first, second);
  assert(await verifyPassword(password, first));
  assert.equal(await verifyPassword("wrong", first), false);
  assert.equal(await verifyPassword(password, "broken"), false);
});
test("registration normalizes identifiers and rejects unsafe input", () => {
  assert.deepEqual(
    normalizeRegistration({
      email: " PLAYER@Example.com ",
      username: " Player_1 ",
      password: "a-long-password!",
      displayName: " Player ",
    }),
    {
      email: "player@example.com",
      username: "player_1",
      password: "a-long-password!",
      displayName: "Player",
    },
  );
  for (const input of [
    {},
    { email: "wrong", username: "valid", password: "long-password" },
    { email: "a@b.com", username: "a", password: "long-password" },
    { email: "a@b.com", username: "valid", password: "short" },
  ])
    assert.throws(() => normalizeRegistration(input));
});
