import { type GameState } from "./index";
import { validateRules } from "../rulesets";
export function restoreGame(value: unknown): GameState {
  const state = value as GameState;
  if (
    !state ||
    typeof state !== "object" ||
    !Array.isArray(state.players) ||
    state.players.length < 2 ||
    state.players.length > 4
  )
    throw new Error("INVALID_SAVED_GAME");
  validateRules(state.rules);
  if (
    state.players.some(
      (p) =>
        !p ||
        typeof p.id !== "string" ||
        !p.id ||
        !["PLAYING", "FINISHED", "SURRENDERED"].includes(p.status) ||
        !Array.isArray(p.tokens) ||
        p.tokens.length !== 4 ||
        p.tokens.some((t) => !Number.isInteger(t) || t < -1 || t > 56),
    )
  )
    throw new Error("INVALID_SAVED_GAME");
  const ids = state.players.map((p) => p.id);
  if (
    new Set(ids).size !== ids.length ||
    !Number.isInteger(state.activeSeat) ||
    state.activeSeat < 0 ||
    state.activeSeat >= ids.length ||
    !Number.isFinite(state.deadline) ||
    !Number.isInteger(state.revision) ||
    state.revision < 0 ||
    !Number.isInteger(state.turnId) ||
    state.turnId < 1 ||
    !Number.isInteger(state.consecutiveSixes) ||
    state.consecutiveSixes < 0 ||
    typeof state.forceNonSix !== "boolean" ||
    (state.die !== null &&
      (!Number.isInteger(state.die) || state.die < 1 || state.die > 6))
  )
    throw new Error("INVALID_SAVED_GAME");
  if (
    !["PLAYING", "COMPLETED"].includes(state.phase) ||
    !Array.isArray(state.finishOrder) ||
    !Array.isArray(state.eliminated)
  )
    throw new Error("INVALID_SAVED_GAME");
  for (const list of [state.finishOrder, state.eliminated])
    if (
      new Set(list).size !== list.length ||
      list.some((id) => !ids.includes(id))
    )
      throw new Error("INVALID_SAVED_GAME");
  if (
    state.phase === "PLAYING" &&
    state.players[state.activeSeat].status !== "PLAYING"
  )
    throw new Error("INVALID_SAVED_GAME");
  if (state.phase === "COMPLETED" && state.finishOrder.length !== ids.length)
    throw new Error("INVALID_SAVED_GAME");
  if (
    state.rules.preventSameColorCollision &&
    state.players.some((p) => {
      const occupied = p.tokens.filter((t) => t >= 0 && t < 56);
      return new Set(occupied).size !== occupied.length;
    })
  )
    throw new Error("INVALID_SAVED_GAME");
  return structuredClone(state);
}
