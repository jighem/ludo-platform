# Board structure and design brief

The user explicitly dislikes the current board structure and design. This is a source-based assessment; visual/device testing remains to be performed.

## Problems to resolve

LudoBoard puts names, dice, combat statistics and rank overlays inside the yards, competing with token storage. Token buttons occupy one grid cell: on a 360px-wide board that is at most 24px before margins. Visible pawns use fixed sizes; stacked tokens shrink further. The board also recomputes legal moves rather than receiving permitted token IDs from its controller.

Both parent and board subtract 115px from viewport height instead of measuring safe-area/header/control space. Large combat popups can cover the board and shake it; dice in upper yards are harder to reach. Board arms hardcode color and safe-star rules separately from engine constants.

## Proposed composition

```text
Phone portrait
  Top safe area
  Match / connection status
  Compact opponent labels
  Square board: yards, routes, safe cells and tokens
  Remaining seat labels
  Current player and turn countdown
  Reachable die / roll button and legal-token choices
  Bottom safe area

Desktop/tablet with space
  Player panel | Same board | Match/standings panel
                  Turn and die controls
```

Create original vector artwork with clean paths, evenly spaced yard sockets and a restrained palette. Seat numbers and distinct symbols supplement colors. Move statistics into expandable details and capture announcements outside the board. Avoid a center decoration covering token routes. Support reduced motion.

Use one normalized scene coordinate system. BoardTopology defines cell IDs, connectivity, color entry, home route and safe flags. BoardTheme defines palette and token graphics. BoardView receives semantic positions, legal-token IDs, selection and animation events; it contains no RNG, capture, score or turn-transition logic. Share scene definitions across web/native rendering adapters.

Keep logical cell IDs stable when artwork changes. Validate every rendered step against its intended cell, safe markers against capture rules and animation against adjacency. Provide a 48px legal-token selector below the board on small screens; enlarging all tightly packed board hit regions creates ambiguity. Direct taps remain available where unambiguous.

## Delivery and acceptance

1. Characterize legacy topology, then separate it from CSS positions and styles.
2. Build shared engine/rules/dice fixtures in the assigned phases.
3. Develop the renderer in isolation using yard, release, safe overlap, home-path, capture and completion fixtures.
4. Verify the build-plan viewport matrix, large text and real-device safe areas.
5. Integrate Pass-and-Play first, then authoritative online events into the same view.

Acceptance: board, die, player and timer visible without gameplay scrolling; no clipped controls under OS areas; legible numbered/symbolized tokens; reachable input; screen-reader and keyboard support; no decorative layer intercepting input; reduced motion; and identical movement legality across themes/layouts.
