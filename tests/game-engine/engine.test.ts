import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  legalMoves,
  roll,
  move,
  resolveDie,
  timeout,
  surrender,
} from "../../packages/game-engine";
import { CUSTOM_RULES, STANDARD_RULES } from "../../packages/rulesets";
const game = (count = 2) =>
  createGame(
    Array.from({ length: count }, (_, i) => `player-${i}`),
    CUSTOM_RULES,
    1000,
  );
test("yard release, exact home and same-color collision are deterministic", () => {
  let state = game();
  assert.deepEqual(legalMoves(state, 1), []);
  assert.equal(legalMoves(state, 6).length, 4);
  state = roll(state, "player-0", () => 5, 1001).state;
  state = move(state, "player-0", 0, 1002).state;
  assert.equal(state.players[0].tokens[0], 0);
  assert.equal(state.activeSeat, 0);
  state.players[0].tokens = [52, 55, 56, 56];
  assert.deepEqual(legalMoves(state, 3), []);
  assert.deepEqual(legalMoves(state, 4), [0]);
});
test("collision on one token does not remove a face when another token can move", () => {
  const state = game();
  state.players[0].tokens = [4, 7, -1, -1];
  const result = roll(state, "player-0", (faces) => faces.indexOf(3), 1001);
  assert.equal(result.state.die, 3);
  assert.deepEqual(legalMoves(result.state, 3), [1]);
});
test("two sixes then a non-six; restored fourth-six has zero movement and free reroll", () => {
  let state = game();
  state.players[0].tokens = [0, 10, 20, 30];
  state.consecutiveSixes = 2;
  const result = roll(state, "player-0", () => 0, 1001);
  assert(!result.audit!.eligible.includes(6));
  state = game();
  state.consecutiveSixes = 3;
  const before = structuredClone(state.players);
  const guarded = resolveDie(state, 6, 1001);
  assert.deepEqual(guarded.state.players, before);
  assert.equal(guarded.state.forceNonSix, true);
  assert.equal(guarded.state.activeSeat, 0);
  assert(guarded.events.some((e) => e.type === "FOURTH_SIX_SAFEGUARD"));
});
test("all player counts complete with full unique ordering", () => {
  for (const count of [2, 3, 4]) {
    let state = game(count);
    for (let seat = 0; seat < count - 1; seat++) {
      state.players[seat].tokens = [56, 56, 56, 55];
      state = roll(state, `player-${seat}`, () => 0, 1002 + seat).state;
      state = move(state, `player-${seat}`, 3, 1003 + seat).state;
    }
    assert.equal(state.phase, "COMPLETED");
    assert.equal(new Set(state.finishOrder).size, count);
  }
});
test("timeout and surrender do not accept invalid or stale moves", () => {
  let state = game();
  assert.throws(() => move(state, "player-0", 0, 1001));
  assert.throws(() => roll(state, "player-1", () => 0, 1001));
  assert.throws(() => timeout(state, state.turnId, 1001));
  state = timeout(state, state.turnId, state.deadline).state;
  assert.equal(state.activeSeat, 1);
  state = surrender(state, "player-0", state.deadline - 1).state;
  assert.equal(state.phase, "COMPLETED");
  assert.equal(state.finishOrder[0], "player-1");
});
test("standard dice keeps all six faces and permits unplayable rolls", () => {
  const state = createGame(["a", "b"], STANDARD_RULES, 0);
  const result = roll(state, "a", () => 0, 1);
  assert.deepEqual(result.audit!.eligible, [1, 2, 3, 4, 5, 6]);
  assert.equal(result.state.activeSeat, 1);
});
