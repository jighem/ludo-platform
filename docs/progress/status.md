# Build progress

Workspace: D:/Projects/Others/Ludo. Repository: https://github.com/jighem/ludo-platform.

This is an incremental rebuild, not a completed production release. Legacy features remain in the original app while their replacements are introduced separately.

| Phase | Current evidence and remaining work |
|---|---|
| 1. Assessment | Repository inspection, architecture and migration plan documented in phase-1. |
| 2. Database | Three tracked MySQL migrations; checksum/history guards; real database replay, foreign key and rollback tests. Legacy data import and restore rehearsal remain. |
| 3. Accounts | Verified accounts, password recovery, revocable sessions, origin checks, persistent limits and SMTP outbox backend. Account screens and real SMTP delivery remain. |
| 4–6. Rules and gameplay | Shared versioned pure engine, standard/custom audited dice, timeout and surrender; tests for 2–4 players, collisions, captures and six rules. History is append-only through the API; production database role hardening remains. |
| 7–8. Board and pass-and-play | Expo player app, original SVG board, local durable game/history, secure random sampling, restore validation, background return handling. Web export and phone/desktop visual checks pass. Actual Android/iOS lifecycle testing remains. |
| 9. Leagues | Scoped creation, invitations, join requests, roles, last-admin protection and audit backend; concurrent invitation/admin tests. League screens and bulk operations remain. |
| 10–11. Scoring and manual results | Pinned scoring versions, manual pending/approve/reject/correct/cancel/dispute revisions, scoped standings and history. Online completion produces server-derived approved results. UI workflows remain. |
| 12. Protected offline | Pending. Local pass-and-play is not protected offline and does not claim tamper resistance. |
| 13–14. Online foundations | Authenticated REST intents, cryptographic server dice, transactional idempotency, revision guards, event recovery, check-in and persisted deadline scanner. WebSocket delivery, presence/reconnect grace and online player screens remain. |
| 15–18. Tournaments, global ranking, portals | Pending. League points are not global ratings. |
| 19–20. Hardening and release | GitHub checks configured. Native builds/devices, capacity tests, deployment, monitoring and recovery rehearsals remain. |

## Run locally

Use Node 24 and npm: `npm ci`, `npm run db:migrate`, `npm test`, `npm run lint`.

- API: `npm run dev:platform` (localhost:3001).
- Player: `npm run dev:player`, then choose web or a connected Expo-compatible device.
- Web export: `npm run build:player` (apps/player/dist).
- Player typecheck: `npm exec --workspace=player -- tsc --noEmit`.
- `npm run dev` and `npm run build` still target the retained legacy application.

Local MySQL 8.4.11 listens only on 127.0.0.1:33316. Databases are ludo_platform and ludo_test_foundation. Credentials remain in ignored .env; local database files and administrator credentials remain in ignored .local. This instance is not a Windows service. Restart it after reboot before running database checks.

The API and player are separate development targets; the current player screen is local pass-and-play. Account/league/online API routes are not yet connected to player navigation. Rules must be published by a platform administrator through the rules repository before creating API matches; an operator bootstrap flow remains to be delivered.

## Verification

30 tests pass against the real local MySQL instance. They cover auth, migrations, engine/dice, cross-league denial, concurrent single-use invitations, last-admin changes, duplicate roll receipts, stale commands, competing deadline workers, manual approval/correction/cancellation and historical scoring. Root/player TypeScript checks and web builds are also run. GitHub workflow results must be checked separately; configuration alone is not a successful CI run.

The board was checked at phone, tablet and desktop viewports from 360x640 through 1920x1080. The updated 360x640 view keeps the board, timer, dice and four move controls visible. Browser checks do not replace native device tests. App launcher artwork is still the Expo template; the in-game board is original code-rendered artwork.

## Remaining operational work

Configure SMTP_URL, MAIL_FROM and APP_URL for real account mail. `npm run email:deliver` sends one queued job; provider delivery has not been tested. Browser sessions need HTTPS in production. Persisted match-update outbox records are prepared for realtime delivery but do not yet have a broadcasting worker.

Result, scoring and rules histories have no mutation API. Database-level append-only permissions/triggers require a separate migration/owner role in production. An attempted trigger migration was rejected before applying any DDL by the limited local account; zero triggers were verified and only its failed migration marker was removed. No application privileges were expanded.

Dependencies include an unresolved moderate advisory through Expo's xcode/uuid build-tool chain. Review and verify a compatible fix before native release; do not claim a clean dependency audit. Backups, restore tests, least-privilege production roles, retention cleanup, observability and release rollback are still release gates.
