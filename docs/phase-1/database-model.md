# Proposed MySQL model

This is a logical model for Phase 2, not an inspection of an existing database or executable migration. Physical column types and compatibility will be fixed after inspecting the actual MySQL version and existing data. Use InnoDB, UTC timestamps with fractional seconds, explicit collation/normalization, primary/foreign keys, and reviewed migrations.

## Ownership and relations

| Domain | Entities and essential relations |
|---|---|
| Identity | users; user_profiles (unique user_id, public_player_id, normalized username); user_devices; sessions (hashed refresh secrets, expiry, revocation); email_verifications; password_resets |
| League | leagues (creator); league_members (league_id,user_id unique); league_roles; league_role_permissions; member_role_assignments; league_invitations (hashed code, expiry, invitee, use limits); invitation_recipients; league_join_requests; league_settings_versions |
| Rules | rulesets; ruleset_versions with ruleset_id, version, immutable config, schema version, content hash, publication timestamp; engine compatibility registry |
| Matches | matches (source, phase, ruleset_version_id, revision, owner_epoch, deadline); match_players (unique match/seat and match/player); match_snapshots; match_commands (idempotency receipt); match_events (unique match/sequence); match_turns; match_tokens; match_connections |
| League scope | league_matches (league_id,match_id), with match_id unique to prevent assigning one match to multiple leagues; scoped match permissions/results must join this relation |
| Results | match_results (match_id,revision unique, approval state, creator, change reason); result_placements (unique result/player and result/place); result_player_metrics; result_approvals; match_current_result (one accepted pointer per match) |
| Offline | offline_match_packages (unique package/match, signature/key/version, encrypted server seed, expiry, consumption); offline_uploads (digest/status); offline_match_events (unique upload/sequence); offline_match_validations (versioned replay attempt/reason/result) |
| Competition | competitions; league_competitions; competition_players; competition_matches; competition_standings (derived); competition_settings_versions |
| Tournament | tournaments (competition_id unique, schedule/settings snapshot); tournament_players (registration/check-in); tournament_rounds; tournament_matches; tournament_bracket_nodes; bracket_slots (entrant or predecessor advancement); tournament_schedule_revisions |
| Scoring | score_rules; score_rule_versions; player_score_events (result revision/component/idempotency); player_scores and league_rankings (projections) |
| Rating | rating_algorithms; rating_policy_versions; seasons; rating_events (result revision/player/algorithm unique); player_ratings; rating_checkpoints; global_rankings (period/metric/as_of) |
| Delivery | notifications; notification_deliveries; outbox_events; scheduled_jobs |
| Audit | audit_logs (actor/action/entity/old/new/reason/time/request/session); privileged access records |

Match token/turn rows and snapshots are rebuildable projections, not a second mutable game authority. Store schema-versioned event payloads as JSON where suitable; normalize identities, ownership, placements, membership, schedules and referenceable values.

## League isolation

All league-owned children carry non-null league_id, including membership, settings, invitations, join requests, role assignment, league scoring, competition links and scoped audit access. Define composite unique parent keys `(league_id,id)` and matching composite foreign keys on children to reject cross-league references. MySQL requires appropriate referenced keys and indexes ([MySQL foreign keys](https://dev.mysql.com/doc/refman/8.4/en/create-table-foreign-keys.html)).

Global matches and platform competitions use base tables with dedicated league ownership extension tables rather than relying on nullable league IDs in composite foreign keys. Every league API resolves through its scoped ownership relation, then checks the actor's permission. Scope should also be included in repository signatures, background job payloads, cache keys, object-storage keys and notification recipient selection. A guess-resistant identifier never substitutes for this check.

League competition match links use `(league_id,competition_id,match_id)` with composite references to league competitions and league matches. A transactional service also ensures tournament entrants and match seats agree. Platform competitions cannot acquire league ownership through a client-supplied field.

## Constraints and indexes

- Unique normalized email/username and public player ID; document account deletion/reuse policy.
- Unique match seat/player, result placement/player, ruleset version, invitation recipient, and accepted package consumption.
- Unique `(match_id,actor_id,command_id)` with request digest; payload mismatch is a conflict.
- Unique `(match_id,sequence)` events, and monotonic aggregate revisions enforced in transactions.
- Unique projection receipts by consumer/event ID or result revision to make retries harmless.
- Index league membership by `(league_id,status,user_id)`, pending results by league/state/date, matches by phase/deadline, events by match/sequence, ratings by season/algorithm/player and ranking sort keys.
- Index invitations by token hash/expiry; sessions by token hash and user/revocation; outbox by state/next_attempt_at; tournament lobbies by schedule/status.
- Check dice bounds, positive sequence, valid source/status, seat bounds and nonnegative metrics where supported. Cross-row invariants such as complete finish order require transactional domain validation.

Use created_at/updated_at on mutable business rows; immutable versions, events, results history and audit records have creation timestamps and no ordinary update/delete path. Restrict cascades on competitive history. Soft delete leagues/accounts only with an explicit retention/anonymization design; do not soft delete raw history as a substitute for cancellation events.

## Transaction boundaries

Match command: authorization and scope check, revision/deadline validation, command receipt, events, snapshot/revision, outbox commit together. Membership removal and sensitive league mutations serialize against relevant authorization state where needed.

Result approval/edit: scoped permission, immutable revision, current-result pointer, audit, and projection job commit together. Projection consumers atomically store receipt plus scoring/rating updates. Store projection watermark/as-of for eventual consistency visibility.

Offline acceptance: lock package, check prior transcript, replay result reference, consume package, accepted result and outbox together. Perform expensive replay before the short acceptance transaction, then recheck all eligibility and package state within it.

Tournament advancement: lock bracket node, confirm settled eligible result and expected bracket revision, fill successor slots, audit and enqueue notifications atomically. Concurrent workers must not advance twice.

## Migration safety

Inspect existing schema and data before choosing an ORM or migration tool; reviewed version-controlled SQL is the baseline. Never use schema push against production. Establish a baseline only after comparing it to the actual database. Keep migration credentials separate from application accounts.

Prefer expand/backfill/validate/switch/contract. Inventory old IDs, source flags, score definitions and rule versions; ambiguous historical values remain LEGACY_UNCLASSIFIED in a staging import rather than being relabeled ONLINE. Quarantine unknown rules for review and exclude unverified history from competitive ranking. Preserve provenance and old IDs in mapping tables.

Validate fresh installation and upgrade from a representative prior snapshot, duplicate/null/orphan checks, checksums and row counts, retained indexes, query plans and migration runtime. Rehearse backup restore and application rollback compatibility. Destructive contraction follows retention and a separate reviewed migration; MySQL DDL must not be assumed transactionally reversible. Do not modify any production database in this phase.
