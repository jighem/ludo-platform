# Production architecture proposal

Status: proposed following inspection of Ludo-League at a89b8e2; see assessment.md for findings. Retain the current TypeScript/React and Express foundations while introducing these boundaries incrementally. All defaults below are recommendations, not silently established business rules.

## Structure and technology

Use a TypeScript monorepo with a mobile-first Expo/React Native application targeting Android, iOS, and web. Expo documents universal web/native development and monorepo support ([web](https://docs.expo.dev/workflow/web/), [monorepos](https://docs.expo.dev/guides/monorepos/)). Use an independently routed React web admin application for dense platform administration, sharing API contracts, authorization-aware presentation helpers, and design tokens. Backend authorization remains mandatory.

Propose a Node.js/TypeScript API and workers, MySQL with InnoDB as durable truth, Redis for presence/routing/rate limits and realtime fanout, and object storage for future evidence and audit archives. Select and pin supported runtime/library versions after compatibility checks in the real repository. Use a modular backend deployment initially, with separately runnable realtime and worker entrypoints; separate service deployments only when load or operational isolation warrants them.

```text
apps/
  player/                 # Expo: mobile, tablet, responsive web
  admin/                  # browser administration
  api/                    # authenticated HTTP composition root
  realtime/               # authenticated transport + command routing
  worker/                 # outbox, notifications, offline replay, projections
packages/
  game-engine/            # pure state machine; no UI/network/database imports
  dice-policy/            # pure candidate policy and explanation metadata
  rulesets/               # schemas, immutable versions, compatibility registry
  match-engine/           # lifecycle and mode policies
  league-engine/          # membership, roles, approval, points
  tournament-engine/      # registration, qualification, scheduling, advancement
  ranking-engine/         # eligibility, rating algorithms, season projections
  offline-protocol/       # canonical encoding, replay protocol, hash format
  contracts/              # versioned HTTP/events and runtime validation
  database/               # repositories, reviewed SQL migrations
  auth/                   # identity/session/authorization adapters
  notifications/          # provider-independent notification commands
  ui/                     # board rendering, accessible controls, design tokens
tests/                    # cross-module integration, replay, device, load
docs/                     # decisions, threat model, operations, rules examples
```

Do not create empty packages merely to match this diagram. Introduce each boundary when its phase starts. Enforce package import direction in lint/CI. Domain modules accept repository, clock, entropy, and notification interfaces; transport and persistence depend on domain contracts, never the reverse. Tournament and league contexts reference matches rather than inventing alternate Ludo engines.

## Shared game model and rulesets

Model token position semantically as YARD, TRACK(offset), HOME_PATH(index), or FINISHED. Resolve physical shared-track cells through a versioned board topology; UI coordinates are rendering output. This avoids comparing two players' relative offsets as though they were the same physical square. Define home-path length and entry explicitly in fixtures before implementation.

The deterministic transition takes state, validated command, immutable ruleset, and explicit system inputs. It returns next state and ordered domain events. The production wrapper supplies authenticated identity, server time, and secure entropy; tests inject exact inputs. Clients never supply privileged system commands in online games.

State includes phase, active seat, token locations, pending roll, consecutive sixes, free-reroll flag, finish order, surrender/forfeit statuses, revision, turn identifier, and authoritative deadline. Match lifecycle and connection state are separate from token rules. The game engine resolves timeout/surrender effects; transport reports presence changes and the match engine decides when a configured grace period expires.

A match pins ruleset version, topology version, engine/replay version, dice-policy version, scoring version, and eligibility policy. Published versions are immutable. Configuration changes create a new version for future matches. Preserve compatible historical replay implementations or archived replay runtimes and test vectors. Never silently upgrade an active match's semantics.

Rules configuration covers release faces; exact-home behavior; safe cells; collision/stacking scope; captures; bonus on six/capture/home; completion and last-place assignment; timeout actions and strikes; surrender placement; reconnect grace; and dice candidate fallback. Validate incompatible combinations when publishing a version.

## Dice policy and ambiguous edge cases

STANDARD_RANDOM samples all six faces uniformly and may produce an unplayable roll. CUSTOM_FILTERED explicitly changes probabilities. Display that distinction in rules summaries and tournament setup.

Recommended custom algorithm:

1. Begin with ordered faces [1,2,3,4,5,6].
2. For consecutiveSixes >= 2, or a forced non-six reroll, exclude six.
3. Compute all legal token moves for each remaining face using the same move validator used for MOVE_TOKEN.
4. For same-color collision filtering, remove a face only when it has no legal move and an otherwise permitted move is blocked by an own-token collision. A collision on one token must not remove a face if a different token can move legally.
5. A separate published `preferPlayableFaces` option can narrow to all faces with legal moves. Do not silently equate collision prevention with removal of every unplayable face. Recommend this option for the custom policy's playable third-roll intention.
6. If nothing remains, apply the versioned fallback. Recommend NO_MOVE_END_TURN, recording an empty-candidate decision without inventing a dice result or relaxing collision rules. Do not loop indefinitely or restore six after the non-six restriction. The behavior must be visible in the selected ruleset before play.
7. Sample an index uniformly within eligible faces and record the selected face and complete policy explanation.

Yard and FINISHED are collections, not single collision squares. Recommend collision prevention on track and home-path cells; specify this in the ruleset. Safe cells prevent opponent capture but do not override own-token collision prevention. Explicitly decide how multiple opposing tokens and optional blockades behave.

First and second six permit a legal move and bonus roll. There is no traditional third-six forfeiture. Define the consecutive counter as consecutive rolled sixes in the active turn, resetting on a non-six and at a turn boundary; capture/home bonuses must not accidentally preserve a non-consecutive streak.

Defense in depth: if a validated legacy/restored transition resolves another six when the prior count is at least three, emit FOURTH_SIX_SAFEGUARD, move no token (including no yard release), retain the player, and set a forced non-six free reroll. Keep this resolution guard separate from normal candidate selection so it can be tested even though current candidates prevent reaching it. If the free reroll has no legal candidates, use the explicit no-move fallback; do not forfeit solely for rolling six. Restoration/version migration needs validation and an audit reason.

Audit metadata contains before/after candidates for every filter, reason codes, legal token IDs by face, chosen index/face, entropy cursor, state hash, and policy version. Never include unrevealed online entropy in player broadcasts.

Use a server-side cryptographically secure bounded sampler; Node's crypto API provides randomInt and cryptographic primitives ([Node crypto](https://nodejs.org/api/crypto.html)). No Math.random or timestamp seeds. Online replay verifies recorded authoritative outcomes against policy and state; storing random outcomes alone does not prove operator fairness. Publicly verifiable randomness would be a separate protocol.

## Server-authoritative multiplayer

HTTP handles accounts, league administration, scheduling, and history. Socket.IO handles match subscriptions, authenticated intent, acknowledgements, presence, and compact updates. Socket.IO's default delivery is at-most-once, so application persistence and idempotency are required ([delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/)).

Each command envelope contains protocolVersion, commandId, matchId, expectedRevision, type, and a strictly validated payload. Derive actor identity from the session. Client ROLL_DICE and MOVE_TOKEN cannot contain dice, coordinates, winner, score, or trusted timestamps. Authorize participation and league context for every command and subscription, including recovered connections. Bound payloads and rates.

Route a match to one logical processor. In a short MySQL transaction lock or compare-and-swap its revision, check the current deadline and actor, deduplicate the command, compute the transition, append events, persist state/revision and receipt, and insert outbox messages. Commit before acknowledgement/broadcast. A duplicate with the same payload returns its receipt; a reused ID with a different payload is rejected. A stale revision receives a resync response. A database uniqueness constraint backs this behavior across processes.

Ownership leases need fencing epochs checked by persistence; a Redis lock alone is insufficient against a stale worker. Durable events and revision checks remain authoritative on owner failure. The outbox tolerates repeat delivery; clients/projection workers deduplicate by event sequence/ID. This provides one committed effect per command, not an unsupported end-to-end exactly-once claim.

Reconnect with an authenticated session and last received sequence. Return authorized missed events within a bounded window, otherwise a sanitized snapshot plus sequence. Include current deadline, turn ID, phase, pending die, token state, statuses, and finish order. If using clustered fanout, the Redis Streams adapter supports connection-state recovery, but application resync is still required ([adapter](https://socket.io/docs/v4/redis-streams-adapter/)). Keep Redis private and authenticated.

Persist absolute server deadlines. A due-work scanner recovers timers after crashes. Each timeout command is keyed by match/turn/deadline; an old timer cannot act on a new turn. Serialize timeout and player input in the same transaction path with an explicit deadline boundary rule. Client clocks only draw the countdown. Backgrounding does not pause competitive time. On foreground reconcile before enabling input.

Presence heartbeats and reconnect grace are bounded, configurable, and distinct from turn expiry. Multiple sockets do not create multiple seats or reset deadlines. Support SKIP_TURN, AUTO_SELECT_LEGAL_MOVE, WARNING, STRIKE, and FORFEIT with deterministic auto-selection and bounded warning behavior. Loss of authoritative persistence must fail closed instead of letting clients advance online games locally.

## Offline-Protected protocol

Before disconnect, authenticate eligible participants and issue a package bound to match, league/competition, player seats, device/session policy, exact rules/engine hashes, seed material, package ID/nonce, issuedAt, play expiry, upload deadline, and permitted settings. Sign a canonical representation with a server-held signing key and key ID. Never ship signing private keys to clients. Store the issued package server-side and retain verification keys through replay retention.

Use a specified HMAC-SHA-256 counter stream derived from signed seed material with match/domain separation. Convert bytes to candidate indices through rejection sampling to avoid modulo bias. Version canonical encoding, byte order, counter consumption, and rejection behavior; publish golden vectors for native/web/server. Never leave deterministic sampling to platform-specific integer overflow or floating-point behavior.

Store package and append-only command/event records transactionally in native local storage or browser IndexedDB through adapters. Use native protected key storage for local encryption keys; browser storage offers a weaker protection boundary. Warn before browser storage loss and detect failed persistence before allowing more offline play.

Every record carries package ID, sequence, canonical command, derived events, reported timestamp, prior hash, and hash. Bind the genesis hash to the signed package digest and hash domain-separated canonical records. Keep an atomic local checkpoint and do not acknowledge a move locally until its record is durable.

Upload in bounded resumable chunks, then finalize with a transcript digest. Server validation checks signature/key, package ownership/status, server-observed upload deadline, supported versions, bounded event counts, contiguous sequence/hashes, exact entropy consumption, every legal transition, derived event equality, complete finish order and recomputed result. The server independently replays from genesis; it never accepts a submitted winner/points as authoritative.

Consume the package and persist the accepted result atomically. An identical retry returns the same result; a different transcript for a consumed package triggers review. Keep invalid submissions and validation reasons with restricted access and retention limits. OFFLINE_VERIFIED means replay-consistent, not online-equivalent integrity. Invalid signatures or impossible transitions are rejected; unsupported archived versions, conflicts, or policy anomalies require review.

An offline device owner can inspect future seeded outcomes, explore alternative valid move histories, rewrite a hash chain, omit abandoned games, and alter local timestamps. A signature authenticates package issuance, not honest play. Local timestamps cannot prove play occurred before expiry: enforce a server-observed upload cutoff or mark late uploads for review. Device attestation and checkpointing may raise the cost of abuse but cannot remove these limitations. Default global-rating eligibility to false; require an explicit platform policy to enable it. League acceptance is separate.

## Identity, leagues, results, tournaments, rankings

Use verified-email eligibility gates and unique normalized usernames/public player IDs. Hash passwords with a reviewed password KDF; use hashed, expiring, single-use verification/reset tokens, generic recovery responses and rate limits. Rotate/revoke sessions, revoke on password reset, and protect browser sessions with HttpOnly/Secure cookies, CSRF defenses and origin validation. Use platform secure storage for native credentials, short-lived access credentials and replay-aware refresh rotation. Require stronger authentication for platform administrators.

League authorization uses actor + action + league scope + membership status; league roles never imply platform permissions. Invitations and bulk jobs are scoped, expire, deduplicate, and are audited. Public discovery does not expose private membership or game information.

Keep match source ONLINE/OFFLINE_PROTECTED/PASS_PLAY/MANUAL separate from lifecycle, offline verification status, and result approval status. MANUAL_RESULT is a creation workflow mapping to source MANUAL. An offline or pass-play result submitted by a device does not become an online-verified result. Approval, verification, league scoring eligibility and global eligibility are independent gates.

Publish approved result revisions; store placements and metrics separately. Compute points server-side from the pinned scoring version. Require a reason and append an audit event for edits. Apply standing/rating changes idempotently; reverse or rebuild prior projections on corrections rather than silently double-counting. Submitted manual points are explicit audited overrides under configured admin authority. Only platform policy can change default global exclusion for manual results.

Freeze tournament rules, scoring, tie breakers and qualification limits at start. Support normal play, points leagues, knockout and qualification-plus-knockout. Generalize knockout nodes to 2-4 seats and a configured advancement count, while allowing conventional two-player brackets. Specify seeding, byes, tied qualification cutoff, minimum/maximum qualifying games, eligible-game selection order, check-in/no-show handling, rescheduling and disqualification before registration opens. Advancement is an idempotent transaction after a settled result; disputes hold advancement. Corrections after downstream play require an audited resolution workflow.

Keep league points separate from rating events. Isolate a rating strategy (initial multiplayer Elo variant, later Glicko), pin algorithm/parameters, define pairwise normalization and surrender/disqualification effects, and process a stable result order. Late corrections require replay from an appropriate checkpoint. Daily/weekly/monthly/season/all-time leaderboard definitions need explicit time zone, cutoff, metric, tie order and eligibility; they are projections of immutable history, not five independently mutated ratings.

Notification domain commands flow through a transactional outbox to in-app/email providers with retries, deduplication and delivery status. Scheduling and tournament logic do not call a provider directly. Later push, SMS and WhatsApp adapters preserve this interface.

## Mobile and desktop experience

One board renderer consumes shared semantic state, with original vector artwork, tokens and animations. Separate layouts from game logic. Size the board to min(available width, height remaining after safe-area/player/action controls). Prioritize board, current player, die, deadline and connection state; use sheets for secondary details. Reserve 44-48 logical-pixel primary touch controls and use enlarged token hit regions or a reachable legal-token selector when dense cells are too small.

Support portrait phones with native safe-area insets and web dynamic viewport sizing. Respect keyboard/modal bounds and reduced motion. Use labels, token shapes and seat numbers alongside colors, screen-reader descriptions, visible focus and keyboard play on web. Desktop adds information panels around the same board; tablets may use landscape without requiring it.

Persist offline state after each transition. Online foreground/reconnect fetches authoritative state. Animate committed events without placing business rules in animation callbacks; collapse excessive catch-up animations. Disable or serialize pending input, but rely on server idempotency for correctness. Use stable component boundaries and bounded deltas/snapshots rather than entire database records.

## Operations and security gates

Use migrations, least-privilege service credentials, TLS, secret rotation, redacted logs, and separate deployment migration credentials. Append-only audit tables need restricted write permissions and immutable external archival: a normal application table alone is not proof against a database administrator. Define retention and personal-data access policies without putting tokens/seeds/passwords into broad logs.

Instrument command latency, revision conflicts, event/outbox lag, reconnect success, replay failures, timer lag, projection freshness and match-owner health. Provisional load target: 1,000 concurrent four-seat matches; negotiate final latency/error SLOs and validate on specified infrastructure. No scale claim is established by the diagram. Exercise database restore, worker failover, rolling upgrades, mixed client versions and key rotation before deployment.
