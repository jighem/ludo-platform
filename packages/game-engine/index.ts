import { evaluateDicePolicy, type DiceAudit } from "../dice-policy";
import { validateRules, type Ruleset } from "../rulesets";
export interface Player {
  id: string;
  tokens: number[];
  status: "PLAYING" | "FINISHED" | "SURRENDERED";
}
export interface GameState {
  rules: Ruleset;
  players: Player[];
  activeSeat: number;
  die: number | null;
  consecutiveSixes: number;
  forceNonSix: boolean;
  phase: "PLAYING" | "COMPLETED";
  finishOrder: string[];
  eliminated: string[];
  revision: number;
  turnId: number;
  deadline: number;
}
export interface GameEvent {
  type: string;
  [key: string]: unknown;
}
export interface Transition {
  state: GameState;
  events: GameEvent[];
  audit?: DiceAudit;
}
const faces = [1, 2, 3, 4, 5, 6];
function requireValue(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}
export function createGame(
  ids: string[],
  rules: Ruleset,
  now: number,
): GameState {
  requireValue(
    ids.length >= 2 &&
      ids.length <= 4 &&
      new Set(ids).size === ids.length &&
      ids.every(
        (id) => typeof id === "string" && id.length > 0 && id.length < 100,
      ),
    "INVALID_PLAYERS",
  );
  const validated = validateRules(rules);
  requireValue(Number.isFinite(now), "INVALID_TIME");
  return {
    rules: validated,
    players: ids.map((id) => ({
      id,
      tokens: [-1, -1, -1, -1],
      status: "PLAYING",
    })),
    activeSeat: 0,
    die: null,
    consecutiveSixes: 0,
    forceNonSix: false,
    phase: "PLAYING",
    finishOrder: [],
    eliminated: [],
    revision: 0,
    turnId: 1,
    deadline: now + validated.turnSeconds * 1000,
  };
}
// Opposite seats for two players; clockwise occupied colors for three/four.
export function seatColor(seat: number, count: number): number {
  return count === 2 ? seat * 2 : seat;
}
export function trackCell(
  state: GameState,
  seat: number,
  step: number,
): number | null {
  return step >= 0 && step <= 50
    ? (seatColor(seat, state.players.length) * 13 + step) % 52
    : null;
}
export function targetStep(step: number, face: number): number | null {
  if (
    !Number.isInteger(face) ||
    face < 1 ||
    face > 6 ||
    !Number.isInteger(step) ||
    step < -1 ||
    step >= 56
  )
    return null;
  if (step === -1) return face === 6 ? 0 : null;
  return step + face <= 56 ? step + face : null;
}
export function legalMoves(
  state: GameState,
  face: number,
  seat = state.activeSeat,
): number[] {
  const player = state.players[seat];
  if (!player || player.status !== "PLAYING") return [];
  return player.tokens.flatMap((step, token) => {
    const target = targetStep(step, face);
    if (target === null) return [];
    if (
      state.rules.preventSameColorCollision &&
      target !== 56 &&
      player.tokens.some((other, i) => i !== token && other === target)
    )
      return [];
    return [token];
  });
}
export function candidates(state: GameState): DiceAudit {
  return evaluateDicePolicy({
    rules: state.rules,
    consecutiveSixes: state.consecutiveSixes,
    forceNonSix: state.forceNonSix,
    hasLegalMove: (face) => legalMoves(state, face).length > 0,
    hasPhysicalMove: (face) =>
      state.players[state.activeSeat].tokens.some(
        (step) => targetStep(step, face) !== null,
      ),
  });
}
export function cloneGame(state: GameState): GameState {
  return {
    ...state,
    rules: validateRules(state.rules),
    players: state.players.map((player) => ({
      ...player,
      tokens: [...player.tokens],
    })),
    finishOrder: [...state.finishOrder],
    eliminated: [...state.eliminated],
  };
}
function fresh(state: GameState): Transition {
  return { state: cloneGame(state), events: [] };
}
function validateActor(state: GameState, actor: string, now: number) {
  requireValue(state.phase === "PLAYING", "MATCH_COMPLETED");
  requireValue(state.players[state.activeSeat]?.id === actor, "NOT_YOUR_TURN");
  requireValue(Number.isFinite(now) && now < state.deadline, "TURN_EXPIRED");
}
function completeIfNeeded(result: Transition) {
  const s = result.state,
    remaining = s.players.filter((p) => p.status === "PLAYING");
  if (remaining.length > 1) return;
  if (remaining[0]) {
    remaining[0].status = "FINISHED";
    s.finishOrder.push(remaining[0].id);
    result.events.push({
      type: "PLAYER_FINISHED",
      playerId: remaining[0].id,
      reason: "LAST_REMAINING",
    });
  }
  s.finishOrder.push(...[...s.eliminated].reverse());
  s.phase = "COMPLETED";
  s.die = null;
  result.events.push({
    type: "MATCH_COMPLETED",
    finishOrder: [...s.finishOrder],
  });
}
function nextTurn(result: Transition, now: number) {
  const s = result.state;
  s.die = null;
  s.consecutiveSixes = 0;
  s.forceNonSix = false;
  completeIfNeeded(result);
  if (s.phase === "COMPLETED") return;
  do {
    s.activeSeat = (s.activeSeat + 1) % s.players.length;
  } while (s.players[s.activeSeat].status !== "PLAYING");
  s.turnId++;
  s.deadline = now + s.rules.turnSeconds * 1000;
  result.events.push({
    type: "TURN_STARTED",
    playerId: s.players[s.activeSeat].id,
    turnId: s.turnId,
    deadline: s.deadline,
  });
}
export function roll(
  state: GameState,
  actor: string,
  sample: (eligible: number[]) => number,
  now: number,
): Transition {
  validateActor(state, actor, now);
  requireValue(state.die === null, "MOVE_REQUIRED");
  const audit = candidates(state);
  if (!audit.eligible.length) {
    const result = fresh(state);
    result.audit = audit;
    result.events.push({ type: "NO_CANDIDATE", audit });
    nextTurn(result, now);
    result.state.revision++;
    return result;
  }
  const index = sample([...audit.eligible]);
  requireValue(
    Number.isInteger(index) && index >= 0 && index < audit.eligible.length,
    "INVALID_ENTROPY_INDEX",
  );
  const selected = audit.eligible[index],
    result = resolveDie(state, selected, now);
  audit.selected = selected;
  result.audit = audit;
  result.events[0] = { ...result.events[0], audit };
  return result;
}
// Internal/system entry point for trusted replay and legacy-state safeguard tests, never a client API.
export function resolveDie(
  state: GameState,
  face: number,
  now: number,
): Transition {
  requireValue(
    state.phase === "PLAYING" && state.die === null,
    "ROLL_NOT_ALLOWED",
  );
  requireValue(faces.includes(face), "INVALID_DIE");
  const result = fresh(state),
    s = result.state;
  s.revision++;
  result.events.push({
    type: "DICE_ROLLED",
    playerId: s.players[s.activeSeat].id,
    face,
  });
  if (face === 6 && s.consecutiveSixes >= 3 && s.rules.fourthSixSafeguard) {
    s.forceNonSix = true;
    s.die = null;
    s.deadline = now + s.rules.turnSeconds * 1000;
    s.turnId++;
    result.events.push(
      { type: "FOURTH_SIX_SAFEGUARD", steps: 0 },
      { type: "BONUS_ROLL", reason: "FREE_NON_SIX_REROLL" },
    );
    return result;
  }
  requireValue(
    candidates(state).eligible.includes(face),
    "DIE_EXCLUDED_BY_POLICY",
  );
  s.forceNonSix = false;
  s.consecutiveSixes = face === 6 ? s.consecutiveSixes + 1 : 0;
  if (!legalMoves(s, face).length) {
    result.events.push({ type: "NO_LEGAL_MOVE", face });
    nextTurn(result, now);
    return result;
  }
  s.die = face;
  return result;
}
export function move(
  state: GameState,
  actor: string,
  token: number,
  now: number,
): Transition {
  validateActor(state, actor, now);
  requireValue(state.die !== null, "ROLL_REQUIRED");
  requireValue(
    Number.isInteger(token) && legalMoves(state, state.die).includes(token),
    "ILLEGAL_MOVE",
  );
  const result = fresh(state),
    s = result.state,
    player = s.players[s.activeSeat],
    face = s.die!,
    from = player.tokens[token],
    to = targetStep(from, face)!;
  player.tokens[token] = to;
  s.revision++;
  s.die = null;
  result.events.push({ type: "TOKEN_MOVED", playerId: actor, token, from, to });
  const cell = trackCell(s, s.activeSeat, to);
  let captures = 0;
  if (cell !== null && !s.rules.safeCells.includes(cell)) {
    s.players.forEach((opponent, seat) => {
      if (seat === s.activeSeat || opponent.status !== "PLAYING") return;
      opponent.tokens.forEach((step, index) => {
        if (trackCell(s, seat, step) === cell) {
          opponent.tokens[index] = -1;
          captures++;
          result.events.push({
            type: "TOKEN_KILLED",
            playerId: actor,
            victimId: opponent.id,
            token: index,
            cell,
          });
        }
      });
    });
  }
  if (to === 56)
    result.events.push({ type: "TOKEN_HOME", playerId: actor, token });
  if (
    player.tokens.filter((step) => step === 56).length >= s.rules.tokensToFinish
  ) {
    player.status = "FINISHED";
    s.finishOrder.push(player.id);
    result.events.push({
      type: "PLAYER_FINISHED",
      playerId: actor,
      place: s.finishOrder.length,
    });
    nextTurn(result, now);
    return result;
  }
  if (
    (face === 6 && s.rules.bonusOnSix) ||
    (captures > 0 && s.rules.bonusOnCapture) ||
    (to === 56 && s.rules.bonusOnHome)
  ) {
    s.deadline = now + s.rules.turnSeconds * 1000;
    s.turnId++;
    result.events.push({
      type: "BONUS_ROLL",
      playerId: actor,
      turnId: s.turnId,
      deadline: s.deadline,
    });
  } else nextTurn(result, now);
  return result;
}
export function surrender(
  state: GameState,
  actor: string,
  now: number,
): Transition {
  requireValue(state.phase === "PLAYING", "MATCH_COMPLETED");
  const seat = state.players.findIndex(
    (p) => p.id === actor && p.status === "PLAYING",
  );
  requireValue(seat >= 0, "PLAYER_NOT_ACTIVE");
  const result = fresh(state),
    s = result.state;
  s.players[seat].status = "SURRENDERED";
  s.eliminated.push(actor);
  s.revision++;
  result.events.push({ type: "PLAYER_SURRENDERED", playerId: actor });
  if (seat === s.activeSeat) nextTurn(result, now);
  else completeIfNeeded(result);
  return result;
}
export function timeout(
  state: GameState,
  turnId: number,
  now: number,
): Transition {
  requireValue(
    state.phase === "PLAYING" &&
      turnId === state.turnId &&
      Number.isFinite(now) &&
      now >= state.deadline,
    "STALE_OR_EARLY_TIMEOUT",
  );
  let result: Transition;
  if (state.rules.timeoutAction === "FORFEIT")
    result = surrender(state, state.players[state.activeSeat].id, now);
  else if (
    state.rules.timeoutAction === "AUTO_SELECT_LEGAL_MOVE" &&
    state.die !== null &&
    legalMoves(state, state.die).length
  ) {
    // System action uses a temporary deadline only for validation; resulting deadlines are based on server now.
    const adjusted = { ...state, deadline: now + 1 };
    result = move(
      adjusted,
      state.players[state.activeSeat].id,
      legalMoves(state, state.die)[0],
      now,
    );
  } else {
    result = fresh(state);
    result.state.revision++;
    nextTurn(result, now);
  }
  result.events.unshift({
    type: "TURN_TIMEOUT",
    playerId: state.players[state.activeSeat].id,
    turnId,
    action: state.rules.timeoutAction,
  });
  return result;
}
