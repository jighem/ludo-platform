# Incremental build and migration plan

Status: Phase 1 repository assessment completed at a89b8e2; live MySQL drift and device behavior remain unverified. See assessment.md and verification.md. Follow the user's phase order. Each phase starts with inspection of relevant source, documentation, schema and baseline checks; explain the change, implement narrowly, run relevant tests/lint/typecheck, fix failures, and commit only a verified state in the actual repository. Do not drop working features to simplify the rewrite.

| Phase | Deliverable | Exit evidence |
|---|---|---|
| 1. Inspection/architecture | Real repository map, baseline, reuse/replace ledger, architecture decisions | File-backed assessment; unresolved business decisions recorded; current documentation alone does not close this gate |
| 2. Database | Reviewed MySQL migrations, keys, scope constraints, import strategy | Empty install and upgrade rehearsal; cross-league FK and transaction tests; restore exercise |
| 3. Auth/users | Registration, verification, recovery, secure sessions, profiles | Expiry/reuse/revocation/rate-limit tests; verified-player gates; IDOR tests |
| 4. Rules versions | Immutable publication and validation, compatibility registry | Invalid combinations rejected; historical version cannot change |
| 5. Core engine | Yard/track/home, captures, turns, placement, surrender and system actions | Deterministic 2/3/4-seat fixtures and invariant tests |
| 6. Dice | Standard/custom policies and complete reasoning traces | Exact candidates and entropy boundary tests; fourth-six resolution tested independently |
| 7. Board UI | Original mobile-first board, controls, accessibility | Phone-first viewport screenshots, usable controls and no overflow |
| 8. Pass-and-Play | Single-device controller, durable local state and result | Kill/relaunch recovery; finishing order; source and approval eligibility preserved |
| 9. Leagues | Public/private membership, roles, invites, bulk jobs and requests | Scope-denial matrix, invitation replay/expiry and role escalation tests |
| 10. League scoring | League matches, versioned configurable scoring, standings | Duplicate delivery/correction tests; ranking isolation |
| 11. Manual results | Submission, approval/rejection, immutable edits and history | Pending results excluded; authorized changes only; reversible score effects |
| 12. Offline-Protected | Signed packages, canonical RNG/log format, upload/replay | Tamper matrix, golden vectors, replay consistency and consumed-package tests |
| 13. Realtime | Authenticated intents, durable events, idempotency and room routing | Simultaneous-command tests, stale revisions, disconnect during commit, event recovery |
| 14. Lobby/time/reconnect | Check-in, scheduled start, persisted deadlines, grace and presence | Boundary race tests, crash recovery, background/foreground and multiple sockets |
| 15. League tournaments | Points/qualification/knockout, seeding, byes and schedule | 2-4-seat advancement fixtures, qualifier ties, disputes, no-shows and duplicate jobs |
| 16. Official tournaments | Platform scope and frozen event policies | Platform-only actions; complete qualification-to-final rehearsal |
| 17. Global ranking | Algorithm strategy, periods/seasons, player scorecards | Stable rating order, eligibility, correction replay and reproducible leaderboards |
| 18. Admin portals | League and platform operations, audit/timeline investigation | Role-specific workflow tests; timeline reconstructs authoritative match |
| 19. Native hardening | Android/iOS lifecycle, safe areas, secure storage, slow network | Real-device coverage, accessible controls, background recovery, packaging checks |
| 20. Release | Security, capacity, operations and deployment | Load and failure tests, restore/failover, monitoring, runbooks and release rollback |

## Required engine test inventory

Exact injected entropy covers every face; release permitted/denied; movement from every entry boundary; safe-cell capture prevention; capture and token reset; home entry and exact-home overshoot; bonus on six/capture/home; own-token collision in track/home; a colliding token alongside another legal token; all filtered candidates; no-candidate fallback; first/second six; third-roll non-six restriction; restored fourth-six state with zero token movement/free reroll; non-six counter reset; 2/3/4 players; completion order and last remaining player; surrender and timeout placement; illegal/stale/out-of-turn moves. Property tests add token conservation, valid positions, no forbidden stacking and deterministic replay without replacing exact fixtures.

Offline negative fixtures: package field/signature mutation, wrong match/device/player, altered/missing/reordered events, counter skipping, forged derived events, bad final placement, unsupported version, oversize transcript, expiry/upload cutoff, identical retry, conflicting transcript, and crash during acceptance. A valid rewritten transcript remains a documented offline limitation, not a security test the system can honestly promise to reject.

Authorization tests exercise each resource as unrelated player, league member, league admin from another league, correct league admin and platform admin. Test revoked/expired sessions on HTTP, socket commands and reconnect; bulk operations; duplicate result approval; conflicting result revisions; and unauthorized event-history access.

## Responsive and device matrix

Use these initial logical/CSS viewport fixtures, then add real-device safe-area and lifecycle tests:

| Target | Viewport |
|---|---|
| Small Android | 360 x 640 |
| Normal Android | 393 x 852 |
| Large Android | 412 x 915 |
| Modern iPhone | 393 x 852 |
| Large iPhone | 430 x 932 |
| Tablet portrait / landscape | 768 x 1024 / 1024 x 768 |
| Desktop | 1366 x 768 / 1920 x 1080 |

Verify full board, dice and timer visibility without gameplay scrolling; legible seat/status labels; touch targets; safe-area clearance; no horizontal overflow/overlap; keyboard navigation; screen-reader actions; large text; reduced motion; fitting dialogs with the keyboard open; low-height browser chrome; and foreground resync. Viewport screenshots alone cannot verify actual notch/home-indicator behavior. Native iOS builds/device checks require an appropriate macOS build environment; the supplied Windows workspace cannot establish them by itself.

## Early decision register

These are versioned policy choices to resolve with examples before Phase 4/6 publication, not reasons to halt repository inspection:

- Collision filtering versus general playable-face preference; empty candidate fallback; stacking on safe cells; optional blockade mechanics.
- Whether release/capture/home bonuses combine, and finish/surrender/forfeit placement semantics.
- Timeout warning escalation, deterministic automatic move selection and reconnect grace.
- Pass-play approval defaults, offline upload window and global eligibility authority.
- Two-player versus multi-seat knockout format, advancement count, byes and tie breakers.
- Period leaderboard metric/time zone, multiplayer rating formula and correction handling.

## Reuse and rollout procedure

For each existing module, record path, purpose, observed tests, dependencies, security/architecture findings, decision (retain/adapt/replace), and verification evidence. Retain compatible functionality and licensed original assets. Introduce compatibility adapters at boundaries; migrate one flow at a time behind explicit configuration. Preserve old event/rule semantics and historical source provenance.

Deploy migrations backward-compatibly, validate read-only projections against history, then move eligible newly created matches to the new engine. Do not transfer active games to a new rules implementation mid-match. Reconcile result counts, placements and scoring before retiring old paths. Rollback stops new traffic and keeps historical readers compatible; it must not discard already committed matches.
