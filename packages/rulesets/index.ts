export interface Ruleset {
  readonly id: string;
  readonly version: number;
  readonly engineVersion: "1";
  readonly dicePolicy: "STANDARD_RANDOM" | "CUSTOM_FILTERED";
  readonly preventSameColorCollision: boolean;
  readonly restrictThirdSix: boolean;
  readonly fourthSixSafeguard: boolean;
  readonly preferPlayableFaces: boolean;
  readonly bonusOnSix: boolean;
  readonly bonusOnCapture: boolean;
  readonly bonusOnHome: boolean;
  readonly tokensToFinish: 1 | 4;
  readonly turnSeconds: number;
  readonly safeCells: readonly number[];
  readonly timeoutAction: "SKIP_TURN" | "AUTO_SELECT_LEGAL_MOVE" | "FORFEIT";
}
export function validateRules(value: Ruleset): Ruleset {
  if (!value || typeof value !== "object") throw new Error("INVALID_RULESET");
  if (
    typeof value.id !== "string" ||
    !value.id ||
    value.id.length > 80 ||
    !Number.isInteger(value.version) ||
    value.version < 1 ||
    value.engineVersion !== "1"
  )
    throw new Error("INVALID_RULESET_VERSION");
  if (
    !["STANDARD_RANDOM", "CUSTOM_FILTERED"].includes(value.dicePolicy) ||
    ![1, 4].includes(value.tokensToFinish) ||
    !Number.isInteger(value.turnSeconds) ||
    value.turnSeconds < 5 ||
    value.turnSeconds > 300
  )
    throw new Error("INVALID_RULESET");
  for (const key of [
    "preventSameColorCollision",
    "restrictThirdSix",
    "fourthSixSafeguard",
    "preferPlayableFaces",
    "bonusOnSix",
    "bonusOnCapture",
    "bonusOnHome",
  ] as const)
    if (typeof value[key] !== "boolean") throw new Error("INVALID_RULESET");
  if (
    value.dicePolicy === "STANDARD_RANDOM" &&
    (value.restrictThirdSix ||
      value.preferPlayableFaces ||
      value.fourthSixSafeguard)
  )
    throw new Error("STANDARD_RANDOM_CANNOT_FILTER_DICE");
  if (
    !Array.isArray(value.safeCells) ||
    value.safeCells.some((c) => !Number.isInteger(c) || c < 0 || c > 51) ||
    new Set(value.safeCells).size !== value.safeCells.length
  )
    throw new Error("INVALID_SAFE_CELLS");
  if (
    !["SKIP_TURN", "AUTO_SELECT_LEGAL_MOVE", "FORFEIT"].includes(
      value.timeoutAction,
    )
  )
    throw new Error("INVALID_TIMEOUT_ACTION");
  return Object.freeze({
    ...value,
    safeCells: Object.freeze([...value.safeCells]),
  });
}
export const CUSTOM_RULES = validateRules({
  id: "CUSTOM_FILTERED",
  version: 1,
  engineVersion: "1",
  dicePolicy: "CUSTOM_FILTERED",
  preventSameColorCollision: true,
  restrictThirdSix: true,
  fourthSixSafeguard: true,
  preferPlayableFaces: false,
  bonusOnSix: true,
  bonusOnCapture: true,
  bonusOnHome: true,
  tokensToFinish: 4,
  turnSeconds: 20,
  safeCells: [0, 8, 13, 21, 26, 34, 39, 47],
  timeoutAction: "SKIP_TURN",
});
export const STANDARD_RULES = validateRules({
  ...CUSTOM_RULES,
  id: "STANDARD_RANDOM",
  dicePolicy: "STANDARD_RANDOM",
  preventSameColorCollision: false,
  restrictThirdSix: false,
  fourthSixSafeguard: false,
});
