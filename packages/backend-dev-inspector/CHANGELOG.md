# Changelog

## [1.1.0] - 2026-10-30

### Added

- **libSQL / Turso** (`@libsql/client` 0.14 or newer): the local, HTTP and WebSocket clients, in both their ESM and CommonJS copies, with transactions listed as BEGIN … COMMIT and the statements of a `batch` listed one by one. Driver name `libsql`.
- **postgres.js** (`postgres`): version 4 is reported through its own tracing channel, with nothing to set up; version 3 through `instrumentPostgres(sql)`, which also covers `sql.unsafe()` and the `sql` of `begin()` / `savepoint()` / `reserve()` callbacks. Driver name `postgres`.
- **db0** (Nitro `useDatabase()`, NuxtHub): calls through a connector whose driver is already watched (`better-sqlite3`, libSQL, `pg`, `mysql2`) are recorded once, at the driver. For other connectors (PGlite, Neon, D1…) the `db0.query` tracing channel of `withTracing(db)` is followed, leaving the watched connectors out so nothing is listed twice. Driver name `db0`.
- **Query budgets for tests** (`backend-dev-inspector/testing`): `capture(fn)` and the matchers `toHaveNoNPlusOne`, `toHaveNoDuplicates`, `toHaveNoSlowQueries`, `toHaveNoErrors`, `toHaveNoInsights`, `toHaveMaxQueries`, `toRunQueries`; a failure lists the findings, where they were called from and how to fix them.
- tRPC lines tell the store (the page refreshes, a cached report is rebuilt) and carry the time the procedure ended. Elasticsearch `_mget` / `_msearch` and DynamoDB `TransactGetItems` count as reads, so a loop of them is an N+1. The D1, BullMQ, Neon and postgres.js wrappers read properties with the object itself as the receiver, so accessors of a platform object work.
- Neon: a query used with `.catch()` or `.finally()` instead of `await` is recorded too.
- BullMQ: a queue whose methods return plain values is still one call (no TypeError of the inspector's own). The recorder of the wrappers (AWS, Elasticsearch, BullMQ, Neon, D1, postgres.js 3) is kept under one key shared by every copy of the package.
- **Wrappers called before the inspector starts.** `instrumentAws`, `instrumentElasticsearch`, `instrumentBullmq`, `instrumentNeon`, `instrumentD1` (and `instrumentPostgres`) look the recorder up when a call is made, so a client wrapped at the top of a module, before the application starts the inspector, is still watched. They return the client untouched only when the inspector is off for the process.
- **NestJS, tRPC and Remix / React Router adapters** (`backend-dev-inspector/nest`, `/trpc`, `/remix`): `inspectNest(app)` picks Express or Fastify; `trpcInspector()` leaves a line per procedure under its request (a batch is one HTTP request) or makes it a request of its own; `inspectRemix(handler)` wraps the request handler of Remix and React Router. None loads its framework.
- **Next.js server components and server actions**: `withInspectorPage(path, Component)` and `withInspectorAction(name, action)` make each one a request (`GET /orders`, `ACTION createOrder`); `redirect()` and `notFound()` end as 307 and 404, and a call inside a wrapped route handler joins it. The core's `WebInspector.run()` does the same for any unit of work.
- **AWS SDK v3, Elasticsearch / OpenSearch, BullMQ, Neon (HTTP) and Cloudflare D1**, each through one wrapper line (`instrumentAws`, `instrumentElasticsearch`, `instrumentBullmq`, `instrumentNeon`, `instrumentD1`) that works on the object you pass and loads nothing, so no dependency is added. Resource names are recorded; bodies, items and job data are not. A command the AWS SDK retried is one call with its attempts.
- **Prisma shows the SQL it sent**, under the operation, when its adapter runs on a watched driver (`pg`, libSQL, better-sqlite3), and no longer counts it twice.
- **`toBeWithinBudget({ calls, ms, callMs })`** for tests: a run may make at most this many calls, take this long, and spend this long in calls.
- **`npx backend-dev-inspector doctor`**, and library checks for the settings' "Check the setup": a library the inspector cannot load, or two copies of one. Optional peers are now loaded from the application's folder first.
- Errors raised while a SQLite statement is prepared (a syntax error, a missing table) are recorded.
- Optional peer dependencies `@libsql/client` and `postgres`; `tryImport` for libraries with a separate ESM copy.
- Everything new in `sql-dev-inspector` 1.3: value redaction, route filters, a custom path, and the Nuxt module options.

### Changed

- Requires `sql-dev-inspector` 1.3 or newer. **Bind parameters are no longer shown by default**: set `SQL_INSPECTOR_REDACT=off` to get the previous behavior.

### Documentation

- README rewritten: contents, a support matrix that says how each technology is observed and how far it was verified, the full configuration table, API reference, limitations and troubleshooting.

## [1.0.2] - 2026-10-30

### Fixed

- `prismaExtension()` recorded every model operation twice, because it registered a handler under both `$allModels` and the top-level `$allOperations` and Prisma runs both. It now registers the top-level handler only, which also receives raw queries. Found by running the real Prisma client in the playground; the unit tests called each handler on its own and could not see it.

### Documentation

- README: screenshots of the playground app and of what the inspector recorded for it.

## [1.0.1] - 2026-10-28

### Fixed

- Package links (`repository`, `homepage`, `bugs`) point at the renamed GitHub repository, so npm provenance matches the repository that builds the release.
- The outbound HTTP driver no longer lets an unexpected `diagnostics_channel` message throw inside a subscriber (which would reach the application as an uncaught exception); the response and error handlers are best effort, like the start handlers.

### Documentation

- README: badges, a clearer introduction, and a "Dependencies and supply chain" section explaining that scanner alerts (eval, network, minified code, unmaintained packages) come from the optional peers and their dependencies, not from this package's code.

## [1.0.0] - 2026-10-28

First release. It builds on [`sql-dev-inspector`](https://www.npmjs.com/package/sql-dev-inspector) 1.2 and exports everything it does.

### Added

- Drivers: PostgreSQL (`pg`), SQLite (`better-sqlite3`, and `node:sqlite` on request), MongoDB (`mongodb`, Mongoose), Redis (`ioredis` 5 and 6, `redis` 6), outbound HTTP (`node:http`, `node:https`, `fetch`, `undici`), the `mariadb` connector (`instrumentMariadb`) and Prisma (`prismaExtension`).
- Adapters: Express / Connect / Node `http` (as in `sql-dev-inspector`), Nuxt and Nitro, Fastify, Koa, Hono, Next.js (App Router), SvelteKit, Astro, Vite and `wrapFetch` for any `(request) => Response` handler.
- `SQL_INSPECTOR_DRIVERS` to choose the drivers; `node:sqlite` only when named there.
- Calls to services that are not SQL are judged by the same rules: N+1, repeated and slow calls.
