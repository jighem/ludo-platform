# Phase 1 verification

Baseline: a89b8e2. Date: 2026-09-16. Windows, Node v24.13.0, npm 11.6.2.

| Check | Outcome |
|---|---|
| Tracked-file/hidden-file inventory | Completed; no repository-specific AGENTS.md, migration directory, tests or CI workflow found |
| Dependency installation | npm install --ignore-scripts --package-lock=false succeeded; 280 packages added; npm reported zero audit findings |
| Type checking | npm run lint (tsc --noEmit) passed |
| Production build | npm run build passed for browser and server bundles |
| Build warning | Main browser JS bundle 1,177.81 kB, 314.50 kB gzip; Vite emitted its large-chunk warning |
| Behavioral tests | No test script or committed test suite available; no claim of gameplay correctness |
| Live MySQL/migration tests | Not run; no disposable database provisioned or live schema provided |
| Browser/device visual checks | Not run; board findings are based on source inspection and layout dimensions |
| Application changes | None; only assessment/planning documents added |

The repository has a Bun lockfile but Bun is not installed on this host. npm resolved the declared ranges without creating a package lock, so these checks establish a local resolved-dependency baseline rather than reproduction of the committed Bun dependency graph. Vite resolved to 6.4.3. Installation scripts were disabled. No application server was started, avoiding its automatic database/schema changes during assessment.

The npm audit result is a package check, not a security certification. The source findings include serious authentication/result-integrity issues despite a passing build. No functional test failures were hidden or repaired incidentally. Runtime behavior, MySQL compatibility, deterministic replay and mobile accessibility need the planned phase-specific checks.

Before code implementation, standardize the package manager/lockfile policy and capture a reproducible CI baseline. Do not adopt an untested dependency upgrade simply because the local build passed.
