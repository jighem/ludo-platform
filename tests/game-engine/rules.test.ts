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
  targetStep,
} from "../../packages/game-engine";
import {
  CUSTOM_RULES,
  STANDARD_RULES,
  validateRules,
} from "../../packages/rulesets";
for (const face of [1, 2, 3, 4, 5, 6])
  test(`face ${face}: movement bounds and pure transition`, () => {
    const state = createGame(["a", "b"], STANDARD_RULES, 0);
    state.players[0].tokens = [10, -1, -1, -1];
    const before = structuredClone(state),
      rolled = roll(state, "a", () => face - 1, 1);
    const moved = move(rolled.state, "a", 0, 2);
    assert.equal(moved.state.players[0].tokens[0], 10 + face);
    assert.deepEqual(state, before);
    assert.equal(targetStep(55, face), face === 1 ? 56 : null);
  });
test("captures use physical shared-track cells and safe cells prevent capture", () => {
  for (const safe of [false, true]) {
    const state = createGame(["a", "b"], CUSTOM_RULES, 0);
    state.players[0].tokens = [safe ? 7 : 4, -1, -1, -1];
    state.players[1].tokens = [safe ? 34 : 31, -1, -1, -1];
    const result = move(roll(state, "a", () => 0, 1).state, "a", 0, 2);
    assert.equal(result.state.players[1].tokens[0], safe ? 34 : -1);
    assert.equal(
      result.events.filter((e) => e.type === "TOKEN_KILLED").length,
      safe ? 0 : 1,
    );
    assert.equal(result.state.activeSeat, safe ? 1 : 0);
  }
});
test("first/second six give bonus, third roll excludes six, non-six resets the streak", () => {
  let state = createGame(["a", "b"], CUSTOM_RULES, 0);
  for (let count = 1; count <= 2; count++) {
    state = move(
      roll(state, "a", (faces) => faces.indexOf(6), count).state,
      "a",
      0,
      count + 1,
    ).state;
    assert.equal(state.consecutiveSixes, count);
    assert.equal(state.activeSeat, 0);
  }
  const result = roll(state, "a", () => 0, 4);
  assert(!result.audit!.eligible.includes(6));
  assert.equal(result.state.consecutiveSixes, 0);
});
test("own tokens cannot share safe or home-path cells in custom rules; finish slots remain shared", () => {
  const state = createGame(["a", "b"], CUSTOM_RULES, 0);
  state.players[0].tokens = [7, 8, 55, 56];
  assert(!legalMoves(state, 1).includes(0));
  assert(legalMoves(state, 1).includes(2));
  state.players[0].tokens = [51, 52, 56, 56];
  assert(!legalMoves(state, 1).includes(0));
});
test("invalid dice, bad entropy and token identifiers fail closed", () => {
  const state = createGame(["a", "b"], CUSTOM_RULES, 0);
  for (const face of [0, -1, 7, NaN, 1.2])
    assert.equal(targetStep(0, face), null);
  for (const index of [-1, 6, NaN, 0.1])
    assert.throws(() => roll(state, "a", () => index, 1));
  const rolled = roll(state, "a", () => 5, 1).state;
  for (const token of [-1, 4, NaN, 0.1])
    assert.throws(() => move(rolled, "a", token, 2));
});
test("standard has no third-six forfeiture; fourth guard does not release yard tokens", () => {
  const state = createGame(["a", "b"], STANDARD_RULES, 0);
  state.consecutiveSixes = 2;
  assert.equal(resolveDie(state, 6, 1).state.die, 6);
  state.rules = CUSTOM_RULES;
  state.consecutiveSixes = 3;
  const result = resolveDie(state, 6, 1);
  assert.deepEqual(result.state.players[0].tokens, [-1, -1, -1, -1]);
  assert.equal(result.state.die, null);
  assert(!roll(result.state, "a", () => 0, 2).audit!.eligible.includes(6));
});
test("timeout auto-selection and forfeit produce bounded deterministic results", () => {
  let state = createGame(
    ["a", "b"],
    validateRules({ ...CUSTOM_RULES, timeoutAction: "AUTO_SELECT_LEGAL_MOVE" }),
    0,
  );
  state = roll(state, "a", () => 5, 1).state;
  const result = timeout(state, state.turnId, state.deadline);
  assert.equal(result.state.players[0].tokens[0], 0);
  assert.throws(() =>
    timeout(result.state, state.turnId, result.state.deadline),
  );
  state = createGame(
    ["a", "b"],
    validateRules({ ...CUSTOM_RULES, timeoutAction: "FORFEIT" }),
    0,
  );
  assert.deepEqual(
    timeout(state, state.turnId, state.deadline).state.finishOrder,
    ["b", "a"],
  );
});
test("surrender order is complete and duplicate surrender cannot alter it", () => {
  let state = createGame(["a", "b", "c", "d"], CUSTOM_RULES, 0);
  state = surrender(state, "c", 1).state;
  assert.throws(() => surrender(state, "c", 2));
  state = surrender(state, "a", 2).state;
  state = surrender(state, "d", 3).state;
  assert.deepEqual(state.finishOrder, ["b", "d", "a", "c"]);
});
test("version validation rejects hidden standard filters and freezes configuration", () => {
  assert.throws(() =>
    validateRules({ ...STANDARD_RULES, restrictThirdSix: true }),
  );
  assert.throws(() => validateRules({ ...CUSTOM_RULES, turnSeconds: 0 }));
  assert.throws(() => validateRules({ ...CUSTOM_RULES, safeCells: [1, 1] }));
  assert(Object.isFrozen(CUSTOM_RULES));
  assert(Object.isFrozen(CUSTOM_RULES.safeCells));
});

