# Changelog

## [1.0.4] - 2026-10-26

### Security

- Release workflow: the publishing job now installs with `npm ci --ignore-scripts` (exactly the lockfile, no dependency script in a job that can mint publish credentials), checkout no longer keeps the token, and `publishConfig.provenance` makes a publish outside a trusted CI fail instead of going out unsigned.
- CI installs with `npm ci`, and a new `audit` job runs `npm audit` and `npm audit signatures` on every push and weekly. Dependabot is enabled for npm and GitHub Actions. Added `SECURITY.md`.
- The package reads environment variables in one module, through an allow-list of its own settings (`src/env.ts`), never the whole environment.
- No code is compiled from strings anywhere in the package: the two remaining `new RegExp(...)` calls are literals now.

### Changed

- Tests use `jsdom` instead of `happy-dom`, which had an open high-severity advisory with no fix. `npm audit` reports 0 vulnerabilities (the advisory only ever affected the development environment, never the published package).
- Tests check the package's supply-chain properties: no runtime dependencies, no install scripts, `process.env` only in `src/env.ts`, no `eval` / `new Function` / child processes / outbound HTTP, and every `files` entry exists.
- README documents the dependency and supply-chain posture, including why scanners list `mysql2`.

## [1.0.3] - 2026-10-19

### Added

- Slow-query threshold setting, in the floating panel's settings menu and in the top bar of the inspector page. It is sent to the server (`GET` / `POST /__sql-inspector/api/settings`), so the terminal and every open viewer use it. It is remembered in the browser, re-applied when the connection comes back after a server restart, and an empty box returns to `SQL_INSPECTOR_SLOW_MS`.

### Security

- The inspector now answers only requests whose `Host` is `localhost`, `*.localhost` or an IP address, so a page that rebinds a hostile domain to the dev server can no longer read your SQL. Other names (`myapp.test`, a tunnel) are allowed with `SQL_INSPECTOR_ALLOWED_HOSTS`; a refused request gets a `403` that says so.
- Clearing the history and setting the threshold refuse requests a browser marks as cross-site (`Sec-Fetch-Site`, `Origin`).

### Changed

- The request list and the detail view reuse a request's report until the request changes (or a report option does), instead of rebuilding up to 200 reports on every event. Formatted SQL is computed once per statement.

### Fixed

- Prepared statements (`execute`) were judged by their text alone, so an N+1 was reported as a plain repeat and two runs with different values as duplicates. The bound values now count.
- Releasing or rolling back to a savepoint that was not open closed the whole transaction in the tree; it is now ignored.
- A failed statement was counted as a warning as well as an error in the request list.
- The panel's hotkeys (`Alt+Shift+S`, `Esc`) stopped working inside the inspector page after it reloaded, for example after a language change.
- Grouping statements copied an array per statement, which made requests with thousands of identical statements slow to analyse on every update.
- The package no longer lists `README.VI.md` and `docs`, which are not in the repository, and the README no longer links to a file it does not ship.

## [1.0.2] - 2026-10-19

### Added

- `SQL_INSPECTOR_TTL_MINUTES` (default `60`, `0` disables): requests with no new query for that long are dropped from memory, on top of the existing request and query caps.

### Changed

- Republished from the current repository history so the npm provenance points to an existing source commit.

## [1.0.1] - 2026-10-19

### Changed

- CI: publish to npm automatically through trusted publishing (OIDC) when a GitHub Release is published. Provenance is attached automatically.

## [1.0.0] - 2026-10-19

### Added

- Initial release.
