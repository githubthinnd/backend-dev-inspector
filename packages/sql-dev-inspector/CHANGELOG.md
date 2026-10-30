# Changelog

## [1.3.0] - 2026-10-30

### Fixed

- **Comparison of a running request.** A comparison is fetched again when either request has changed since, instead of staying as it was at the first answer.
- **"With values"** skips a `?` in a comment, reads `??` as a quoted name, leaves `?` alone beside numbered placeholders, and is not offered when the placeholders and the values do not match one to one.
- **Loading a history file** says how many requests the page kept (`{ loaded, total }`) when the file holds more than the ring.
- The `?token=` redirect keeps the other parameters exactly as they were written; the source-map cache is least-recently-used (256 entries) and, like the overview answer, shared by every copy of the package.
- **Token that is too short.** `SQL_INSPECTOR_TOKEN` shorter than 8 characters used to be ignored, leaving the inspector open to someone who believed it was protected. It now locks the inspector (401 for everyone, with a message at start) until the setting is fixed. The `?token=` redirect always stays on this server.
- **History files.** Loaded requests are no longer expired by the live-request TTL (a file saved days ago opened and vanished at the next read), and a saved request keeps the SQL a library sent for it and the mode it was recorded under.
- **The page redraws less.** The overview is rebuilt at most once a second and cached on the server until a request changes; a comparison already fetched is not fetched again on every change.
- `ReportOptions.budgets` is optional again, so code that builds options by hand still compiles.
- **Hiding values: what the page says.** A request keeps the values it was recorded with, so switching to "Show all" does not reveal what an earlier request hid; the request now says so (`RequestTrace.redact` is the most hidden mode it was recorded under). A prepared statement (`where id = ?`) is sent with its values apart from the text, so a call recorded under "Show all" has a **With values** view that puts them where the `?` are (strings quoted, `'` doubled, placeholders inside quotes left alone), for reading only.
- **The calling line under a dev server's bundle.** In Nuxt / Nitro dev the application runs as one bundle, so a call's stack said `.nuxt/dev/index.mjs:3323` (often a line of the inspector itself, bundled in) instead of the file you wrote. A frame in a bundle is now looked up in the source map the bundle points at (read-only, from the bundle's own folder or inline, once per bundle, at most 64 MB), so it reads as `server/api/orders.get.ts:12`, and a frame that turns out to be a library or the inspector is skipped like any other. Nothing changes when Node already maps stacks (`--enable-source-maps`) or when there is no map.

### Added

- **Hiding values**: `SQL_INSPECTOR_REDACT` (`params`, `all`, `off`; or the `redact` option). In `params` mode bind parameters are shown as their type and size (`<string:12>`, `<number>`), and `mysql2`'s `query(sql, values)` is shown as the statement with its `?`. In `all` mode the statement is shown with every value masked. N+1 and duplicate detection are unchanged: the report compares the calls as they were, from a hash kept outside the event.
- **Route filters**: `SQL_INSPECTOR_INCLUDE` and `SQL_INSPECTOR_EXCLUDE` (or the `include` / `exclude` options): comma-separated path patterns with `*` and `**`. A request that is left out is dropped, its statements are not listed under "(outside request)". Works in the Node, web-standard and Nitro adapters; `task()` is never filtered.
- **Custom path**: `SQL_INSPECTOR_PATH` (or the `path` option) serves the page from another path than `/__sql-inspector/`; the floating panel takes a `path` option and the Nuxt module passes it on.
- **Nuxt module options** (`redact`, `include`, `exclude`, `path`), inline in `modules` or under a top-level `sqlInspector` key.
- **The line of code that made each call**: every call records the first application frame of the stack (file, line, column, function; about 9 microseconds a call). It shows on each statement as a link that opens the editor (VS Code, Cursor, Windsurf, Zed, IntelliJ, WebStorm, or a template of a known editor scheme), on the N+1, duplicate, slow and error warnings, and in the terminal. `SQL_INSPECTOR_STACK`, `SQL_INSPECTOR_EDITOR`.
- **Advice on every warning**, in the server's language, depending on what was called (SQL, Redis, MongoDB, HTTP): in the page ("How to fix"), the terminal and the API (`Insight.hint`).
- **Console output under its request** (`SQL_INSPECTOR_LOGS=1`, off by default): `console.log` / `info` / `warn` / `error` / `debug` while a request is handled, with level, time and calling line. `console` is not touched until it is switched on.
- **Copy a request for a report**: a button in the request detail and `GET /api/requests/:id/markdown` give the findings (with caller and advice), the calls in a table, the console output and the tree as Markdown, as redacted as the inspector is set to. `exportMarkdown()` is exported.
- **Where the time went**: `totals.breakdown` splits a request into database, cache, outbound HTTP and application/waiting time (calls that overlap are counted once). Shown as a bar in the request detail, and in the Markdown export and the MCP `get_request` result.
- **Export as JSON**: a "Download JSON" button and `GET /api/requests/:id/export` give one request as a versioned document (`format: "sql-dev-inspector/request"`, `version: 1`): totals with the time breakdown, findings with advice, every call with timing, tables and caller, and the console. As redacted as the inspector is set to. `exportJson()` is exported.
- **Compare two requests**: a "Compare" section in the request detail, `GET /api/compare/:before/:after` and the MCP tool `compare_requests` show which is faster, the calls that are new, gone, repeated more or fewer times or slower (matched by driver and masked text, so other values do not matter), the time split and the warnings that appeared or went away. `compareReports()` is exported.
- **Budgets per route**: `SQL_INSPECTOR_BUDGETS` (or the `budgets` option, a settings field in the page, and the Nuxt module option): `[METHOD ]/path=calls:10,ms:200,callMs:80`, several separated by `;`, with the route filters' `*` and `**`. A request over its limit gets a warning (`budget-calls`, `budget-time`, `budget-call-time`) that says the route, the limit and the actual value, with advice; it also shows in `find_problems`.
- **The SQL a library sent**: a call that is a layer over a watched driver keeps what that driver ran as `statements` (not counted again). Prisma over its `pg`, libSQL or better-sqlite3 adapter is listed by model and operation with the real SQL under it, in the page, the terminal, the exports and `get_request`. `runInOperation()` is exported for other layers.
- A call described by single-quoted values (`S3 GetObject Key='a.png'`) now has them masked in its fingerprint, so a loop over different values is an N+1.
- **Details of a call** (`QueryEvent.details`): shown when a call is opened, and in the exports and `get_request`. For outbound HTTP: status, bytes sent and received, content type, `retry-after` and `x-request-id`. Cookies, authorization and other headers, and bodies, are never looked at.
- **Overview**: a button in the top bar, `GET /api/overview` and the MCP tool `get_overview` add the recent requests up by route (requests, average, p95, calls, findings), by call across routes, and by finding. `buildOverview()` is exported.
- **Token** (`SQL_INSPECTOR_TOKEN`, at least 8 characters, or `auto` to make one and print the address): the page, the API and MCP then answer only to a request that carries it, as `Authorization: Bearer`, in a `HttpOnly` `SameSite=Strict` cookie, or once as `?token=` (which sets the cookie and redirects). With a token, a non-local `Host` is accepted, so a container or a tunnel can be opened by name; cross-site POSTs are still refused. Compared in constant time.
- **Trace context** (W3C `traceparent`): a request that arrives with one joins the caller's trace; every request has a `traceId` and a `spanId` (shown in the page, searchable in the list, in the exports and MCP). With `SQL_INSPECTOR_PROPAGATE=1`, calls made through `fetch` / undici carry a `traceparent` naming the call as the span the other service's request answers (off by default: it changes the calls the application makes; `node:http` clients cannot carry it, because Node publishes their start after the headers are stored).
- **OpenTelemetry export**: `GET /api/requests/:id/otlp` and `GET /api/otlp` (and `exportOtlp()`) give the requests as OTLP/JSON traces: a server span per request (under the caller's span when it sent a `traceparent`), a client span per call with `db.*` / `http.*` attributes and the calling line, and the SQL a library sent as children of its call. `SQL_INSPECTOR_SERVICE_NAME` sets `service.name`. Nothing is sent anywhere by the inspector.
- **History file**: "Save requests" and "Load a file" in the settings, `GET` and `POST /api/history`. A profile saved to a file you keep can be opened again later (or compared with a new one); loading rebuilds every request field by field with checked types and sizes and new ids (at most 200 requests of 500 calls, 8 MB). The inspector writes nothing to disk by itself.
- **Nuxt DevTools tab**: the Nuxt module adds a "Requests" tab to Nuxt DevTools that shows the inspector's page (at the path it is served from). Nothing happens when the DevTools hook registry is absent.
- **Setup check**: `diagnose()`, `GET /api/doctor`, a "Check the setup" button and the list of active drivers in the settings; packages built on the core can `registerDiagnostics()`.
- **MCP server for coding agents**: `POST <page>/mcp`, read-only, five tools (`list_requests`, `get_request`, `find_problems`, `get_settings`, `diagnose`), with the page's guards. `skills/dev-inspector` is an agent skill.
- **Settings in the interface**: the gear in the page's top bar opens a settings popover (hide values, routes to include and exclude, the page's address, reset to defaults), a pill next to it shows whether values are hidden, and the floating panel's settings menu has the "Hide values" switch. The settings API (`GET` / `POST /api/settings`) now also carries `redact`, `include`, `exclude`, `defaults` and `mount`; English, Vietnamese and Japanese texts.
- Exports: `parseRedactMode`, `redactParams`, `redactValue`, `matchRoute`, `isTracked`, `parsePatterns`, `runIgnored`, `normalizeMount`, `applyToEnv`, `DEFAULT_MOUNT`, and the `RedactMode` and `RouteFilters` types.

### Changed

- **Bind parameters are no longer shown by default.** Set `SQL_INSPECTOR_REDACT=off` to get the previous behavior. A statement built by `query(sql, values)` is now shown as the template with its `?` unless redaction is off.

### Documentation

- README rewritten: contents, a support matrix for libraries and frameworks with how far each was verified, a clearer introduction, and sections for the new settings.

## [1.2.1] - 2026-10-28

### Fixed

- Package links (`repository`, `homepage`, `bugs`) point at the renamed GitHub repository, so npm provenance matches the repository that builds the release.

### Documentation

- README: badges and corrected repository links.

## [1.2.0] - 2026-10-28

The package is now the base of [`backend-dev-inspector`](https://www.npmjs.com/package/backend-dev-inspector), which adds PostgreSQL, SQLite, MongoDB, Redis, outbound HTTP, Prisma and more frameworks. It keeps its own job (MySQL through `mysql2`) and every API it had.

### Added

- **Drivers.** mysql2 is now one `DriverAdapter` among others: `{ name, install(recorder, context) }`. A driver reports calls through a `Recorder`; `startInspector(env, { drivers, brand })` installs each driver once and a driver that fails to install no longer stops the application from starting. `SQL_INSPECTOR_DRIVERS` narrows the list.
- **Dialects.** `analyzeSql`, `fingerprintOf`, `formatSql` and `maskLiterals` take `"mysql"` (default), `"postgres"` or `"sqlite"`: quoting, `E''` and `$$` strings, `$1` / `:name` placeholders, `END` / `ABORT`, `RELEASE` without `SAVEPOINT`.
- `describeOperation` and `genericFingerprint` for calls that are not SQL, which are judged by the same N+1, repeat and slow-call rules.
- `createWebInspector()` for web-standard `Request` / `Response` frameworks (Hono, SvelteKit, Next.js route handlers, Bun, Deno).
- `QueryEvent.driver`, `SqlAnalysis.label`, a driver chip in the UI and the terminal, and `brand` (what the UI calls itself).
- `SQL_INSPECTOR_NOTICE`: a one-line tip about `backend-dev-inspector` is printed once at startup in development; `SQL_INSPECTOR_NOTICE=0` hides it.
- `createNuxtModule(options)` and `createNitroPlugin(options)`, so a package built on this one can reuse them.

### Changed

- `mysql2` is an **optional** peer dependency and is loaded when the inspector starts, so applications that do not use MySQL are not forced to install it.
- The request scope and the statement counter are shared by every copy of this package in a process.
- Statements are classified by their main verb through a `WITH` clause (`WITH … INSERT / UPDATE / DELETE`), and `ROLLBACK [WORK|TRANSACTION] TO` is understood.
- The repository is a monorepo (`packages/sql-dev-inspector`, `packages/backend-dev-inspector`). Releases are tagged `sql-dev-inspector@x.y.z`.

## [1.1.0] - 2026-10-26

### Changed

- **Requires Node.js 22 or newer** (was 20). Node 20 is end of life, and the current test tooling (vitest 5, jsdom 30) no longer runs on it. CI tests on Node 22 and 24.
- Development toolchain: TypeScript 7, vitest 5, jsdom 30, `@types/node` 22 (matches the oldest supported Node) and `@types/jsdom` 30.
- Typecheck under TypeScript 7: the DOM `hidden` property is normalised with `Boolean()` (no behaviour change).

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
