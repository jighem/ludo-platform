# Phase 1: Ludo-League assessment

Inspected 2026-09-16: https://github.com/jighem/Ludo-League at a89b8e2. The workspace was initially empty; the user then supplied this repository and identified board structure/design as a priority. A fresh local clone is used; synced sources are unchanged.

See [architecture](architecture.md), [database proposal](database-model.md), [board redesign](board-redesign.md), [build plan](build-plan.md), and [verification](verification.md).

## Repository architecture

```text
server.ts                 Express startup, API registration, Vite/static hosting
server/auth.ts            JWT, role/league checks, audit insertion
server/db.ts              MySQL/sql.js adapters, startup DDL and data rewriting
server/schema.sql         MySQL schema and seed data
server/routes/            auth, users, players, leagues, matches, stats, settings, audit
src/App.tsx               state-based tab navigation
src/context/              auth, settings, active league
src/api/client.ts         HTTP wrapper and localStorage bearer token
src/components/           CRUD forms, navigation and login
src/components/ludo/      board, dice, rules and fairness modal
src/pages/                dashboard, profiles, history, analytics, settings, game
src/utils/                token helpers, client dice, offline queue, browser audio
src/types/                UI/API interfaces
public/favicon.svg        existing branding
package.json, bun.lock    dependencies; no test script
README.md, .env.example   setup documentation
```

All tracked paths, including hidden configuration and assets/.aistudio, were inventoried. Reviewed entrypoints, dependency configuration, README/schema, database startup and transactions, route groups and authorization wiring, game/board/dice/offline paths, client/context wiring and screen inventory. This is an architecture and targeted source review, not an exhaustive security audit of every UI line.

Frontend: React 19, Vite 6, Tailwind 4, Motion, Recharts and Lucide. Backend: Express 4/TypeScript, mysql2, sql.js fallback, bcryptjs and jsonwebtoken. Build: Vite plus esbuild. The lint script only runs TypeScript; strict mode is not enabled. Bun lockfile is committed, but README instructs npm installation.

No native Android/iOS project, migration history, tests, CI workflow, realtime server, signed-offline protocol or tournament engine was found. No repository-specific AGENTS.md was found.

Gameplay currently runs in React: choose dice, update tokens during animation, calculate captures and finish order, then submit results. Express computes points from submitted placements/kills/deaths. There is no server-authoritative online match processor.

## Findings

| Priority | Finding | Source evidence and impact |
|---|---|---|
| Critical | Unauthenticated result creation | server/routes/matchRoutes.ts:82 uses optional authentication; permissions run only when a user exists. Submitted results become scores. This cannot accept competitive results. |
| Critical | Known fallback JWT secret | server/auth.ts:6 reads AUTH_SECRET with a hardcoded fallback while README documents JWT_SECRET. Token middleware trusts seven-day claims without revocation/active-user validation. |
| High | Offline mode is not protected | src/utils/ludoOfflineSync.ts stores mutable snapshots/results and posts them to /matches. No signature, seed, hash chain or replay; local queue ID is not sent as an idempotency key. |
| High | Dice fairness claims are incorrect for gameplay | src/utils/diceEngine.ts has random pity thresholds, guaranteed sixes, candidate filtering and Math.random fallback. DiceFairnessModal.tsx:61 claims uniformity, but simulation uses the no-player branch rather than filtered gameplay. |
| High | Collision filter removes otherwise legal dice faces | diceEngine's primary filter uses wouldAnyMoveCauseSameColorCollision even when another token can move legally. Safe track cells permit own-token stacking; this is not versioned/configurable. |
| High | Gameplay is coupled to rendering | PlayLudoPage.tsx:596 handles rolls; :791 handles moves, captures and winning. executeMove changes intermediate token state and sleeps for animation. |
| High | Startup mutates schema/history | server/db.ts performs ALTERs, bot reclassification, score clamping and SQLite score reconstruction. MySQL failure falls back to local storage; there is no migration ledger. |
| High | Private-league isolation is absent | League/match/player/stat reads use optional/no authentication. Match GET by ID has no membership check; player listing selects contact fields through p.*. |
| High | Results lack immutable revisions | Match editing deletes and recreates placement rows. Audit follows the business transaction and logAudit catches failures; complete before/after results are not retained. |
| High | Bootstrap seeds an administrator | authRoutes GET setup-status inserts an admin with a hardcoded hash if empty; embedded schema also seeds it. Replace with controlled bootstrap. The password described in comments was not dynamically verified. |
| Medium | Global, unversioned scoring | scoring_rules is unique by player_count; combat +5/-5 is duplicated in routes, UI and stats. No per-league scoring version or source eligibility. |
| Medium | Board layout is crowded and tightly coupled | Dice/stats/rank overlays occupy yards; token hit regions are one grid cell; viewport subtraction is duplicated; safe-star positions are hardcoded separately from rules. |

These are source-backed findings for the requested production platform. No live deployment was probed or changed.

## Existing MySQL model

The schema has nine tables: users, leagues, players, matches, match_results, scoring_rules, application_settings, audit_logs and championship_snapshots. Only match_results declares match/player foreign keys. League IDs are not backed by league foreign keys. Player profiles are separate from login identities; users.allowed_leagues serializes access rather than modeling memberships and scoped roles.

There are no source/lifecycle/ruleset columns, immutable event tables, approval states, signed packages, sessions, invitations, tournaments or rating ledgers. Logs are mutable LONGTEXT. README schema is behind server/schema.sql; db.ts contains a third schema definition. No live MySQL schema/data was supplied, so deployed drift and import integrity remain unverified.

## Reuse and replacement ledger

| Component | Decision | Verification needed |
|---|---|---|
| React/TypeScript and Express | Retain language and HTTP foundation; introduce module boundaries | Keep browser admin workflows while adding Expo player app incrementally |
| Track/start/home coordinates | Adapt into versioned topology fixtures | Continuity, rotation, safe cells, home entry, 2/3/4 seats |
| Small token helpers | Adapt after input validation and tests | Existing helpers are useful but not a complete rules engine |
| PlayLudoPage controller | Replace incrementally with pure state machine | Preserve classic/quick/bot/pass-play behavior as explicit legacy configuration |
| LudoBoard/LudoDice | Replace rendering/control composition | Preserve semantic positions; redesign yards, selection and sizing |
| Dice engine/fairness UI | Replace policy and entropy adapters | Exact deterministic cases; no hidden pity in new competitive rules |
| Offline helper | Replace trust protocol; adapt recovery/retry UX | Legacy records never become retrospectively OFFLINE_VERIFIED |
| Match forms/history/profiles/analytics | Adapt and retain useful workflows | Preserve filters, placement entry and combat toggle; add scoped APIs |
| mysql2 transaction pattern | Retain concept; harden implementation | Remove startup DDL/fallback; strengthen migration/connection lifecycle |
| Auth/session handling | Replace configuration/session/authorization design | Validate password-hash migration; revoke legacy sessions at cutover |
| Audit/scoring writes | Replace with immutable revisions/outbox | Preserve historical scores as facts; correction replay |
| Synthesized audio/date helpers | Potential reuse through adapters | Browser audio needs native adaptation; asset provenance review remains |
| Name-based bot detection | Replace with explicit identity type | Preserve legacy mapping without classifying real people by name |

## Phase 1 outcome

The repository assessment and target architecture are documented. No major application change was made. Next is an additive Phase 2 migration baseline, normalized identity/league/rules tables, and disposable-MySQL validation. Existing pages and data remain while new modules are introduced. Board redesign is specified now and implemented after topology/engine fixtures; a color change alone would leave structural problems.
