# sql-dev-inspector

Dev-only inspectors that show **what your backend does for each request**: every database query, cache call and outbound HTTP request, in order, with timings, transactions, N+1 and slow-call warnings. Terminal tree, live web page and a floating panel inside your app. Nothing runs in production.

This repository holds two npm packages:

| Package | What it is | Install |
|---|---|---|
| [`backend-dev-inspector`](packages/backend-dev-inspector) | **PostgreSQL, MySQL / MariaDB, SQLite, MongoDB, Redis and outbound HTTP**, plus Prisma, and adapters for Express, Fastify, Koa, Hono, Nuxt / Nitro, Next.js, SvelteKit, Astro and Vite. Builds on `sql-dev-inspector`. | `npm i -D backend-dev-inspector` |
| [`sql-dev-inspector`](packages/sql-dev-inspector) | The original: MySQL through `mysql2` (and with it Drizzle, Knex, Sequelize, TypeORM), on Express, Nuxt and Nitro. It is the base of the other package and keeps working on its own. | `npm i -D sql-dev-inspector` |

Not sure which one? Use **`backend-dev-inspector`**: it exports everything `sql-dev-inspector` does, so switching later means changing an import path.

```
GET /api/orders/42 → 200  210ms total · 9 queries · 188ms in SQL
├─ SELECT [pg] orders 3.2ms · 1 row
├─ GET [redis] 0.4ms
├─ FIND [mongodb] reviews 5.1ms · 12 rows
├─ GET 200 [http] 142ms
⚠ N+1 suspected: 4×, 7.1ms total — GET customer:?
```

## Repository layout

```
packages/sql-dev-inspector/       core: request tree, analysis, UI, MySQL driver, Express / Nuxt / Nitro / web adapters
packages/backend-dev-inspector/   drivers (pg, SQLite, MongoDB, Redis, HTTP, …) and framework adapters, on top of the core
```

```bash
npm install            # both packages (workspaces)
npm run build          # sql-dev-inspector first, then backend-dev-inspector
npm run typecheck
npm test               # needs Node 22+; run `npm rebuild better-sqlite3` if you installed with --ignore-scripts
```

Releases are tagged `<package>@<version>` (`sql-dev-inspector@1.2.0`); a tag starts the publish workflow, which publishes with npm provenance and creates the GitHub Release. Publish `sql-dev-inspector` before `backend-dev-inspector`.

Security: see [SECURITY.md](SECURITY.md). License: MIT.
