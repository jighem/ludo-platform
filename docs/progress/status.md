# Build progress

Working directory: D:/Projects/Others/Ludo. Remote: jighem/ludo-platform.

| Phase | Status | Evidence |
|---|---|---|
| 1 | Complete | docs/phase-1 |
| 2 | Foundation implemented; domain schema grows with each phase | MySQL migrations, ledger/checksums/locking; real MySQL install/replay/FK/rollback tests |
| 3 | Backend implemented; account screens and external email delivery pending | Registration, verification, recovery, revocable sessions, origin checks, persistent rate limits, SMTP outbox adapter; 7 automated tests pass |
| 4-20 | Pending | Follow docs/phase-1/build-plan.md |

Use npm and package-lock.json (`npm ci`). bun.lock is historical reference, not the active lockfile. Existing application code remains available while the separate platform API is built. No production database has been modified.

## Local database

MySQL 8.4.11 runs on 127.0.0.1:33316. New databases: ludo_platform and ludo_test_foundation. The dedicated local account is scoped to those databases. Credentials are in ignored .env; administrative credentials and local database files are under ignored .local. Never publish either directory/file. The local instance is not installed as a Windows service.

Run `npm run db:migrate`, `npm test`, `npm run lint`, and `npm run build`. Run `npm run dev:platform` for the new API on localhost:3001. Existing `npm run dev` still runs the legacy application and is not the new production API. Schema migration intentionally refuses an unbaselined legacy database. Historical import remains a separate reviewed step.

## Email and sessions

Email tokens are cryptographically random, hashed in account_tokens, and expire. Transactional email jobs retain the raw link token only until delivered; the worker redacts the payload after success. Configure SMTP_URL, MAIL_FROM and APP_URL, then run `npm run email:deliver` (one job per invocation). SMTP delivery is at-least-once; a crash after sending can duplicate an email. Actual provider delivery has not been tested without SMTP configuration.

Browser login uses a HttpOnly SameSite=Strict cookie, Secure when APP_URL is HTTPS. Native clients can explicitly request a bearer session token. Sessions are checked against the database on every request and are revoked by logout/password reset. Passwords use salted scrypt. Deployment must use HTTPS and a worker scheduler, and add database rate-limit retention cleanup. These backend components do not yet constitute the completed product.
