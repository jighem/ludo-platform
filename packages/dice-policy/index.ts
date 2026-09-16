import type { Ruleset } from "../rulesets";
export interface DiceAudit {
  base: number[];
  eligible: number[];
  removed: { face: number; reason: string }[];
  selected: number | null;
}
export function evaluateDicePolicy(input: {
  rules: Ruleset;
  consecutiveSixes: number;
  forceNonSix: boolean;
  hasLegalMove: (face: number) => boolean;
  hasPhysicalMove: (face: number) => boolean;
}): DiceAudit {
  const {
    rules,
    consecutiveSixes,
    forceNonSix,
    hasLegalMove,
    hasPhysicalMove,
  } = input;
  const audit: DiceAudit = {
    base: [1, 2, 3, 4, 5, 6],
    eligible: [1, 2, 3, 4, 5, 6],
    removed: [],
    selected: null,
  };
  const remove = (face: number, reason: string) => {
    audit.eligible = audit.eligible.filter((f) => f !== face);
    audit.removed.push({ face, reason });
  };
  if (forceNonSix || (rules.restrictThirdSix && consecutiveSixes >= 2))
    remove(6, "CONSECUTIVE_SIX_LIMIT");
  if (rules.dicePolicy === "CUSTOM_FILTERED") {
    for (const face of [...audit.eligible])
      if (
        rules.preventSameColorCollision &&
        !hasLegalMove(face) &&
        hasPhysicalMove(face)
      )
        remove(face, "ALL_MOVES_COLLIDE");
    const playable = audit.eligible.filter(hasLegalMove);
    if (
      playable.length &&
      (rules.preferPlayableFaces || forceNonSix || consecutiveSixes >= 2)
    ) {
      for (const face of [...audit.eligible])
        if (!playable.includes(face)) remove(face, "PREFER_PLAYABLE_FACE");
    }
  }
  return audit;
}
