<h1 align="center">backend-dev-inspector</h1>

<p align="center">
  <b>See what your backend does for every request, in development only.</b><br>
  Every SQL query, MongoDB command, Redis call and outbound HTTP request, in order, with N+1 and slow-call warnings.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/backend-dev-inspector"><img alt="npm version" src="https://img.shields.io/npm/v/backend-dev-inspector"></a>
  <a href="https://www.npmjs.com/package/backend-dev-inspector"><img alt="npm downloads" src="https://img.shields.io/npm/dm/backend-dev-inspector"></a>
  <a href="https://github.com/githubthinnd/backend-dev-inspector/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/githubthinnd/backend-dev-inspector/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="TypeScript types included" src="https://img.shields.io/npm/types/backend-dev-inspector">
  <img alt="Node 22+" src="https://img.shields.io/badge/node-%E2%89%A522-339933">
  <img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue">
</p>

<p align="center">
  <img alt="The inspector's terminal output for a request with an N+1: the statements in order, then the warning" src="https://raw.githubusercontent.com/githubthinnd/backend-dev-inspector/main/docs/media/terminal-n-plus-one.svg" width="760">
</p>

When a client calls your API, `backend-dev-inspector` shows **what the server did to answer it**: which queries ran and in what order, inside which transaction, how long each took, how many rows came back, and which calls were repeated, slow or failed. It works the same for PostgreSQL, MySQL / MariaDB, SQLite, MongoDB, Redis and outbound HTTP, so one request that touches several of them reads as one tree.

You see it in three places: **a tree in your terminal**, **a live page** at `/__sql-inspector/`, and **a floating panel inside your app**. In production it does nothing.

<p align="center">
  <img alt="Antimatter, the demo shop admin, running on Nuxt 3 with the inspector's floating button" src="https://raw.githubusercontent.com/githubthinnd/backend-dev-inspector/main/docs/media/nuxt-orders.jpg" width="49%">
  <img alt="The inspector showing an N+1 insight for the Customers screen" src="https://raw.githubusercontent.com/githubthinnd/backend-dev-inspector/main/docs/media/inspector-n-plus-one.jpg" width="49%">
</p>
<p align="center">
  <img alt="The Reports screen after a slow query" src="https://raw.githubusercontent.com/githubthinnd/backend-dev-inspector/main/docs/media/nuxt-reports.jpg" width="32%">
  <img alt="The inspector flagging the slow query" src="https://raw.githubusercontent.com/githubthinnd/backend-dev-inspector/main/docs/media/inspector-slow-query.jpg" width="32%">
  <img alt="The inspector showing a transaction with a rolled-back savepoint" src="https://raw.githubusercontent.com/githubthinnd/backend-dev-inspector/main/docs/media/inspector-transaction.jpg" width="32%">
</p>
<p align="center"><sub>The <a href="https://github.com/githubthinnd/backend-dev-inspector/tree/main/playground">playground</a>: a demo shop admin (Nuxt 3) and what the inspector recorded for the same clicks. It runs without a database.</sub></p>

## Contents

- [Features](#features)
- [Install](#install)
- [Quick start](#quick-start)
- [Supported technologies](#supported-technologies)
- [What it tells you](#what-it-tells-you)
- [Configuration](#configuration)
- [API](#api)
- [What it records and what it hides](#what-it-records-and-what-it-hides)
- [Limitations](#limitations)
- [Troubleshooting](#troubleshooting)
- [Moving from `sql-dev-inspector`](#moving-from-sql-dev-inspector)
- [Dependencies and supply chain](#dependencies-and-supply-chain)
- [Playground, development and license](#playground-development-and-license)

## Features

- **One tree per request** across SQL, MongoDB, Redis and HTTP, with transactions and savepoints nested the way they ran.
- **Warnings that point at the cause**: N+1 loops, repeated calls, slow calls, errors, too many statements.
- **Per-request attribution** that survives concurrency and connection pools (`AsyncLocalStorage`).
- **Three views**: terminal tree, live web page (search, filters, timeline waterfall, formatted SQL), floating in-app panel with keyboard shortcuts.
- **Works with what you already use**: it observes your existing libraries (`pg`, `postgres.js`, `mysql2`, `better-sqlite3`, `libSQL` / Turso, `mongodb`, `ioredis`, `fetch`…), so your code does not change.
- **Adapters** for Express, Fastify, Koa, Hono, Nuxt / Nitro, Next.js, SvelteKit, Astro, Vite and plain Node `http`.
- **Values hidden by default**: bind parameters are shown as their type and size (`<string:12>`), and a stricter mode masks the whole statement. N+1 detection still works. [Details](#hiding-values).
- **Choose what to follow**: include or exclude requests by route (`/api/**`), and serve the page from a path of your choosing. [Details](#choosing-which-requests-are-traced).
- **Safe by default**: off in production, local only, in memory only, secrets kept out of what it records. [Details](#what-it-records-and-what-it-hides).
- **English, Vietnamese and Japanese** in the terminal, the page and the panel.
- **No network access and no telemetry**: no CDN, no fonts, no analytics.

## Install

```bash
npm install --save-dev backend-dev-inspector
```

Requires **Node.js 22 or newer**. It depends on [`sql-dev-inspector`](https://www.npmjs.com/package/sql-dev-inspector) (installed with it). The libraries it watches (`pg`, `mysql2`, `better-sqlite3`, `mongodb`, `ioredis`…) are **optional peer dependencies**: it uses the copy your app already has and installs none.

## Quick start

1. Install the package (above).
2. Add the adapter for your framework (below), before any route that touches a database.
3. Run your app in development and open `http://localhost:3000/__sql-inspector/` (under your base path, if you have one).

The inspector turns on when `NODE_ENV=development`, or when `SQL_INSPECTOR=1`. Most dev servers set `NODE_ENV` for you; for a plain script, run `NODE_ENV=development node server.js`. `NODE_ENV=production` always switches it off.

### Express, Connect, NestJS (Express)

```ts
import { createInspector } from "backend-dev-inspector"

const inspector = createInspector()
app.use(inspector.middleware) // before any route that uses a database
```

### Fastify (and NestJS on Fastify)

```ts
import inspectorPlugin from "backend-dev-inspector/fastify"

await app.register(inspectorPlugin())
```

### Koa

```ts
import inspectorMiddleware from "backend-dev-inspector/koa"

app.use(inspectorMiddleware()) // first
```

### Hono

```ts
import inspectorMiddleware from "backend-dev-inspector/hono"

app.use("*", inspectorMiddleware())
```

### Nuxt 3 / 4 and Nitro

```ts
// nuxt.config.ts
export default defineNuxtConfig({ modules: ["backend-dev-inspector/nuxt"] })

// Nitro without Nuxt, nitro.config.ts
export default defineNitroConfig({ plugins: ["backend-dev-inspector/nitro"] })
```

The Nuxt module is active in `nuxt dev` only and also adds the floating button. Nothing is added to `nuxt build`.

### Next.js (App Router)

```ts
// instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await (await import("backend-dev-inspector/next")).register()
  }
}
```

```ts
// app/%5F%5Fsql-inspector/[[...path]]/route.ts   (%5F is "_": a folder starting with "_" is private in Next.js)
import { inspectorRoute } from "backend-dev-inspector/next"

export const { GET, POST } = inspectorRoute()
```

```ts
// any route handler you want attributed to its request
import { withInspector } from "backend-dev-inspector/next"

export const GET = withInspector(async (request) => Response.json(await loadOrders()))
```

Server components and server actions have no hook, so their calls are listed under "outside any request".

### SvelteKit

```ts
// src/hooks.server.ts
import inspectorHandle from "backend-dev-inspector/sveltekit"
import { sequence } from "@sveltejs/kit/hooks"

export const handle = sequence(inspectorHandle(), yourHandle)
```

### Astro

```ts
// src/middleware.ts
import inspectorMiddleware from "backend-dev-inspector/astro"

export const onRequest = inspectorMiddleware()
```

### Vite dev server (SvelteKit, Remix, Astro, any SSR setup on Vite)

```ts
// vite.config.ts
import inspector from "backend-dev-inspector/vite"

export default { plugins: [inspector()] }
```

### Bun, Deno, Workers, any `(request) => Response`

```ts
import { wrapFetch } from "backend-dev-inspector"

Bun.serve({ fetch: wrapFetch(handler) }) // or Deno.serve(wrapFetch(handler))
```

### Plain Node `http`, jobs and scripts

```ts
import http from "node:http"
import { createInspector } from "backend-dev-inspector"

const inspector = createInspector()

http.createServer((req, res) => {
  if (inspector.handle(req, res)) return           // serves the inspector's own pages
  inspector.track(req, res, () => myApp(req, res)) // everything awaited inside belongs to this request
}).listen(3000)

// Work that is not an HTTP request: shows up as a TASK in the list
await inspector.task("nightly-sync", async () => { await syncCustomers() })
```

### Floating button in any frontend

```ts
if (import.meta.env.DEV) {
  const { mountSqlInspectorWidget } = await import("backend-dev-inspector/client")
  mountSqlInspectorWidget({ baseURL: "/" }) // baseURL = path prefix of your server
}
```

If your frontend runs on another origin than the API (Vite on `:5173`, API on `:3000`), open `http://localhost:3000/__sql-inspector/` directly, or proxy `/__sql-inspector` through the dev server.

### Libraries that need one more line

```ts
// MariaDB connector (it cannot be patched from outside): wrap the module where you import it
import * as mariadbModule from "mariadb"
import { instrumentMariadb } from "backend-dev-inspector"
const mariadb = instrumentMariadb(mariadbModule) // unchanged outside development

// Prisma: add the client extension
import { prismaExtension } from "backend-dev-inspector/prisma"
const prisma = new PrismaClient().$extends(prismaExtension())

// postgres.js 3 (version 4 needs nothing): wrap the client once
import postgres from "postgres"
import { instrumentPostgres } from "backend-dev-inspector"
const sql = instrumentPostgres(postgres(process.env.DATABASE_URL))
```

## Supported technologies

Every technology is a *driver*: its calls are described as the SQL statement they resemble (a read is a `select`, a Redis `GET` is a `select`, an HTTP `POST` is an `insert`), so the same N+1, repeat and slow-call detection applies to all of them. A driver does nothing when its library is not in your app.

**How to read the "Verified" column**

| Mark | Meaning |
|---|---|
| ✅ Real client | tested with the real client library, against an in-memory server that speaks the real protocol, or in-process |
| 🧪 Documented contract | tested against the library's documented extension point, not the real library |
| 🟡 Expected | built on a supported driver, not tested on its own |

### Databases, caches and HTTP

| Technology | Library (peer range) | How it is observed | Verified |
|---|---|---|---|
| **PostgreSQL** | `pg` ≥ 8 | patches `Client#query`; pool-aware | ✅ Real client, `pg` 8 + protocol mock |
| **MySQL, MariaDB server** | `mysql2` ≥ 3 | patches `Connection#query` / `execute` (via `sql-dev-inspector`) | ✅ Real client, `mysql2` 3 + protocol mock |
| **PostgreSQL** (postgres.js) | `postgres` ≥ 3 | 4: subscribes to its tracing channel. 3: `instrumentPostgres(sql)` wrapper | ✅ Real client, `postgres` 4 and 3 + protocol mock |
| **SQLite** | `better-sqlite3` ≥ 9 | patches statements and `exec`; `db.transaction()` shows as a transaction | ✅ Real client, v13 |
| | `node:sqlite` (built in) | the same; **opt-in** | ✅ Real, Node 22+ |
| **libSQL, Turso** | `@libsql/client` ≥ 0.14 | patches the client and transaction classes of the local, HTTP and WebSocket clients (the ESM and the CommonJS copy) | ✅ Real client, in-memory database; remote client on a refused connection |
| **db0** (Nitro `useDatabase()`, NuxtHub) | `db0` | through the driver under the connector (`better-sqlite3`, libSQL, `pg`, `mysql2`): nothing to set up. Other connectors (PGlite, Neon, D1…): `withTracing(db)` from `db0/tracing` | ✅ over `better-sqlite3` and libSQL; 🧪 the tracing channel, with a stand-in connector |
| **MongoDB** | `mongodb` ≥ 5 (and Mongoose) | switches on the driver's command monitoring | ✅ Real client, `mongodb` 7 + protocol mock |
| **Redis** | `ioredis` 6, `redis` 6 (node-redis) | subscribes to the clients' own tracing channels | ✅ Real clients |
| | `ioredis` 5 | small patch on `sendCommand` | ✅ Real client, patch path forced |
| **HTTP out** | `node:http`, `node:https`, global `fetch`, `undici` | subscribes to Node's `diagnostics_channel` | ✅ Real client code over in-memory sockets |
| **MariaDB connector** | `mariadb` 3 | `instrumentMariadb(module)` helper | 🧪 Documented API |
| **Prisma** | `@prisma/client` 7 | `$extends(prismaExtension())` | ✅ Real Prisma 7 client (libSQL adapter), in the playground |

### ORMs and query builders

These sit on a driver above, so they are watched through it. Statements are the SQL the ORM sends.

| ORM / builder | Runs on | Verified |
|---|---|---|
| Drizzle ORM | `pg`, `postgres`, `mysql2`, `better-sqlite3`, `@libsql/client` | ✅ with `better-sqlite3` and `mysql2` |
| Prisma | its own engine | ✅ through `prismaExtension()` (calls shown by model and operation) |
| Mongoose | `mongodb` | 🟡 |
| Kysely, Knex, Sequelize, TypeORM | `pg`, `postgres`, `mysql2`, `better-sqlite3` | 🟡 |

### Frameworks

| Framework | Import | Verified |
|---|---|---|
| Express 5 / Connect | `createInspector().middleware` | ✅ real app in the playground; unit tests with a faithful `req` / `res` |
| NestJS | the Express or Fastify entry above | 🟡 |
| Fastify 5 | `backend-dev-inspector/fastify` | ✅ real Fastify |
| Koa 3 | `backend-dev-inspector/koa` | ✅ real Koa |
| Hono 4 | `backend-dev-inspector/hono` | ✅ real Hono (Node) |
| Nuxt 3 / Nitro | `backend-dev-inspector/nuxt`, `/nitro` | ✅ Nuxt 3 dev server in the playground |
| Nuxt 4 | the same module | 🟡 |
| Vite dev server | `backend-dev-inspector/vite` | ✅ real Vite |
| Next.js (App Router) | `backend-dev-inspector/next` | 🧪 adapters tested without a running Next.js |
| SvelteKit, Astro | `/sveltekit`, `/astro` | 🧪 adapters tested without a running app |
| Bun, Deno, Workers | `wrapFetch` | 🟡 uses web APIs and `AsyncLocalStorage` only; tested on Node.js |
| Plain Node `http`, scripts, cron | `handle` / `track` / `task` | ✅ |

Not supported: Nuxt 2 (EOL), runtimes without `AsyncLocalStorage`, and databases without a driver listed above (for example Oracle, SQL Server, DynamoDB).

## What it tells you

| Insight | Raised when | Level |
|---|---|---|
| **N+1** | 3 or more statements of the same shape (different values) in one request | warn |
| **Duplicate** | the exact same statement twice or more | warn |
| **Slow** | a call takes at least the threshold (default 100 ms) | warn |
| **Error** | the call was rejected | error |
| **Many queries** | 30 or more statements in one request | warn |
| `SELECT *`, deep subquery (3+ levels) | | info |
| Transaction convention (opt-in, `SQL_INSPECTOR_TX_CONVENTION=1`) | reads inside a transaction; several writes outside one | info |

The slow-call threshold can also be set from the page's top bar or the panel's settings menu; the server remembers it. Calls that are not SQL count the same way: three `GET customer:<id>` calls to Redis, or three `GET /customers/<id>` calls to another service, are an N+1.

## Configuration

Every `SQL_INSPECTOR_*` variable below is read from the environment through an allow-list; nothing else in `process.env` is touched.

| Variable | Default | Meaning |
|---|---|---|
| `NODE_ENV` | — | `production` is **always off**, even with `SQL_INSPECTOR=1`; `development` is on |
| `SQL_INSPECTOR` | — | `1` turns it on outside development (for example `test`); `0` turns it off |
| `SQL_INSPECTOR_DRIVERS` | all | Comma-separated drivers to keep: `mysql2`, `pg`, `postgres`, `better-sqlite3`, `libsql`, `db0`, `mongodb`, `ioredis`, `redis`, `http`, `fetch`, `mariadb`, `prisma`, and `node:sqlite` (opt-in). `all` or empty keeps everything |
| `SQL_INSPECTOR_REDACT` | `params` | What is kept of values: `params` (bind parameters become their type and size), `all` (the statement is shown with every value masked), `off` (everything as sent). See [Hiding values](#hiding-values) |
| `SQL_INSPECTOR_INCLUDE` | — | Comma-separated route patterns: only matching requests are traced (`/api/**`). See [Choosing which requests are traced](#choosing-which-requests-are-traced) |
| `SQL_INSPECTOR_EXCLUDE` | — | Comma-separated route patterns that are never traced (`/health,/assets/**`) |
| `SQL_INSPECTOR_PATH` | `__sql-inspector` | Where the page is served: `_dev/sql` serves it at `/_dev/sql/` |
| `SQL_INSPECTOR_SLOW_MS` | `100` | Slow-call threshold in milliseconds |
| `SQL_INSPECTOR_LANG` | `en` | Terminal language and the page's starting language: `en`, `vi`, `ja`. Your machine's `LANG` is deliberately ignored |
| `SQL_INSPECTOR_LOG` | on | `0` turns the terminal output off |
| `SQL_INSPECTOR_MAX_REQUESTS` | `200` | Requests kept in memory |
| `SQL_INSPECTOR_MAX_QUERIES` | `1000` | Calls kept per request |
| `SQL_INSPECTOR_TTL_MINUTES` | `60` | Drop a request with no new call for this long; `0` keeps it until the cap pushes it out |
| `SQL_INSPECTOR_ALLOWED_HOSTS` | — | Extra host names allowed to open the inspector, comma-separated (`myapp.test,*.dev.example.com`; `*` allows any). `localhost`, `*.localhost` and IP addresses are always allowed |
| `SQL_INSPECTOR_TX_CONVENTION` | off | `1` turns on the transaction-convention insights |
| `SQL_INSPECTOR_NOTICE` | on | `0` hides the one-line tip that `sql-dev-inspector` prints about this package |
| `NO_COLOR` | — | turns terminal colors off |

`node:sqlite` is opt-in because merely loading it prints Node's experimental-feature warning, which an app that does not use SQLite must never see: set `SQL_INSPECTOR_DRIVERS=node:sqlite`, or pass `nodeSqliteDriver` to `createInspector({ drivers })`.

### Hiding values

You can also change it while the app runs: the **gear** in the page's top bar opens the settings (hide values, routes to include or exclude, the page's address), the pill next to it always says whether values are hidden, and the floating panel's settings menu has the same "Hide values" switch. Changes apply to calls recorded from then on and are lost when the server restarts, which then starts from the environment again.

<p align="center">
  <img alt="The inspector page with its settings open: hide values, the routes to follow, the page address" src="https://raw.githubusercontent.com/githubthinnd/backend-dev-inspector/main/docs/media/inspector-settings.jpg" width="640">
</p>

The calls often carry personal data. By default the inspector keeps **the shape of a call, not its values**:

| `SQL_INSPECTOR_REDACT` | Bind parameters | The statement |
|---|---|---|
| `params` (default) | shown as type and size: `<string:12>`, `<number>`, `<null>` | as written; a statement a driver builds from a template (`mysql2`'s `query(sql, values)`) is shown as the template, with its `?` |
| `all` | as above | shown with every value masked (`where email = ?`), the way the N+1 detector sees it |
| `off` | as sent | as sent |

N+1 detection and duplicate detection keep working: the inspector compares the calls as they really were, in memory, and never shows or sends the values. Two limits to know: in `params` mode a value that **you typed into the SQL** is still visible (use `all`), and error messages from the database can quote a value (`Duplicate entry 'a@b.c'`).

### Choosing which requests are traced

```bash
SQL_INSPECTOR_INCLUDE="/api/**" SQL_INSPECTOR_EXCLUDE="/api/webhooks/**,/health" npm run dev
```

A pattern is a path: `/api/orders` (exactly that), `/api/*` (one segment), `/api/**` (that path and everything under it), `/*-webhook` (`*` inside a segment matches any characters). The query string is ignored. When `INCLUDE` is set only matching requests are traced; `EXCLUDE` then removes from those. A request that is left out is dropped entirely: its calls are not listed under "(outside request)" either. Jobs started with `inspector.task()` are never filtered. The same settings exist as options: `createInspector({ include: ["/api/**"], exclude: ["/health"] })`.

### Moving the page

`SQL_INSPECTOR_PATH=_dev/sql` (or `createInspector({ path: "/_dev/sql" })`) serves the page, its API and its event stream under `/_dev/sql/` instead of `/__sql-inspector/`, under your base path as before. The floating panel follows (`mountSqlInspectorWidget({ baseURL, path })`; the Nuxt module does it for you). Next.js is the exception: its route is a folder in your project (`app/%5F%5Fsql-inspector/`), so rename that folder instead.

### Nuxt module options

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: [["backend-dev-inspector/nuxt", {
    redact: "params",                 // "params" | "all" | "off"
    include: ["/api/**"],
    exclude: ["/api/health"],
    path: "/_dev/sql"
  }]]
  // or, equivalently, a top-level `sqlInspector: { ... }` key
})
```

The module applies them in `nuxt dev` only, and passes them to the Nitro server.

### Floating panel

The number on the button is the call count of the latest request (amber with warnings, red with errors).

| Action | How |
|---|---|
| Open / close the panel | Click the button, or `Alt+Shift+S` (`Esc` closes it) |
| Hide / show the button | `Alt+Shift+D` |
| Move the button · resize the panel | Drag the button · drag the panel's edge |
| Dock bottom / right | The two dock icons in the panel header |
| Auto-open on warnings or errors | Settings menu (off by default) |
| Open in a new tab · clear history | The ↗ icon · "Clear history" in the settings menu |

Page shortcuts: `/` search, `↑` `↓` (or `j` `k`) previous / next request, `e` expand / collapse all. Language and theme (system / light / dark) are in the top bar and the settings menu, and are stored in `localStorage`.

## API

```ts
createInspector(options?: StartOptions): SqlInspector   // Node req / res frameworks
createWebInspector(options?: StartOptions): WebInspector // web-standard Request / Response
wrapFetch(handler): handler                              // wraps any (request) => Response

interface SqlInspector {
  enabled: boolean                       // false in production or when switched off: everything below is a no-op
  middleware(req, res, next): void       // Connect / Express
  handle(req, res): boolean              // true if the URL belongs to the inspector (already served)
  track<T>(req, res, fn: () => T): T     // run fn as one tracked request
  task<T>(name: string, fn: () => T | Promise<T>): Promise<T> // a unit of work that is not HTTP
}

// StartOptions: {
//   drivers?: DriverAdapter[], brand?: { title: string, short: string },
//   redact?: "params" | "all" | "off", include?: string[], exclude?: string[], path?: string
// }
```

| Import | For |
|---|---|
| `backend-dev-inspector` | the API above, `instrumentMariadb`, `instrumentPostgres`, every export of `sql-dev-inspector` |
| `/fastify` `/koa` `/hono` `/next` `/sveltekit` `/astro` `/vite` | framework adapters |
| `/nuxt` `/nitro` | Nuxt module, Nitro plugin |
| `/prisma` | `prismaExtension()` |
| `/client` | `mountSqlInspectorWidget({ baseURL })`, the floating button |

Lower level, for custom integrations: `startInspector`, `getInspector`, `buildReport`, `TraceStore`, `analyzeSql`, `describeOperation`, the `DriverAdapter` and `Recorder` types, and the rest of what [`sql-dev-inspector`](https://www.npmjs.com/package/sql-dev-inspector#api) exports.

The page's HTTP routes, all under `/__sql-inspector/`: `GET /` (page), `GET /api/requests`, `GET /api/requests/:id`, `GET /api/stream` (server-sent events), `GET` / `POST /api/settings`, `POST /api/clear`.

## What it records and what it hides

- **Bind parameters are hidden by default** (type and size only), see [Hiding values](#hiding-values). SQL text you wrote yourself, MongoDB filters and error messages can still contain values: use `SQL_INSPECTOR_REDACT=all` to mask statements too, and do not share your screen while connected to real data.
- **Redis**: the clients' own sanitising applies (`SET key ?`); values of writes are never recorded, reads show their key.
- **HTTP**: user names and passwords in a URL are dropped; values of query parameters that look like credentials (`token`, `key`, `secret`, `password`, `auth`, `signature`, `session`…) are replaced by `?`. Headers and bodies are never recorded.
- Everything lives in the memory of the dev process and expires (see `SQL_INSPECTOR_TTL_MINUTES`). Nothing is written to disk or sent anywhere.
- The page has no login, so it is meant for `localhost`. It refuses requests whose `Host` is not `localhost` or an IP address (this stops DNS-rebinding pages from reading your data) and cross-site `POST`s. Do not expose your dev server to a shared network while it is on; list your own host names in `SQL_INSPECTOR_ALLOWED_HOSTS`.

## Limitations

- **Connection pools**: PostgreSQL and MongoDB statements are attributed to the request that issued them even when the pool is saturated (tested). Other libraries are attributed to the async context in which their event fires, which is the caller's for everything listed above.
- **`mariadb` connector** cannot be patched from outside, hence `instrumentMariadb()`. Knex, Sequelize and TypeORM load the connector themselves; for them use `mysql2`, which also talks to MariaDB servers.
- **Redis** needs a client that publishes its commands (`ioredis` 6 or `redis` 6); `ioredis` 5 is patched instead. A `MULTI` in node-redis is one call, because the client does not publish its commands individually; in ioredis `MULTI … EXEC` shows as a transaction.
- **Prisma** shows calls by model and operation (the SQL Prisma generates is not available at that point), and has no savepoints.
- **SQLite** errors raised while *preparing* a statement (a missing table, a syntax error) are not recorded; errors raised when it runs are.
- **postgres.js 3** has to be wrapped (`instrumentPostgres`), because the copy an application imports cannot be patched from outside; version 4 needs nothing. A statement built with helpers (`sql(columns)`) is shown with placeholders.
- **libSQL**: a transaction is listed as BEGIN … COMMIT with its statements; the client's internal statements are not.
- **db0**: connectors whose driver is not watched (PGlite, Neon, D1…) are only seen when you wrap the database with `withTracing()`.
- **A lazy query awaited outside its request** (a postgres.js query or Drizzle builder created in a handler but awaited elsewhere) is attributed to where it is awaited.
- **Next.js**: only route handlers you wrap are attributed to their request.
- Statements outside any request or task are grouped under one "(outside request)" entry. Requests that make no recorded call (assets, HMR) are not kept.
- Not a profiler: durations are wall-clock, measured around each call.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Nothing shows up | `NODE_ENV` is not `development`. Run with `NODE_ENV=development` or `SQL_INSPECTOR=1` (never `production`) |
| Terminal output, but `/__sql-inspector/` is 404 | Express: mount the middleware before your router. Nuxt / Nitro: check `app.baseURL` |
| Everything is under "(outside request)" | The adapter is mounted after the route, or the work runs outside an awaited handler (timers, queues): wrap it in `inspector.task()` |
| A library's calls are missing | See the support tables; for MariaDB and Prisma you must add the helper line |
| Two copies of a library in `node_modules` | The inspector patches the copy it can import; make sure the app and the inspector share one (a hoisted peer) |
| The floating button is missing | Outside Nuxt you must call `mountSqlInspectorWidget`. Try `Alt+Shift+D`, or clear the `sqlDevInspector.widget` key in `localStorage` |
| Calls show `<number>` / `<string:5>` instead of values | That is `SQL_INSPECTOR_REDACT` at its default; set it to `off` to see values |
| Requests I excluded still appear | The pattern must match the path (`/api/**` matches `/api` and below); the query string is ignored |
| `403` on the inspector page | The `Host` is not local: add it to `SQL_INSPECTOR_ALLOWED_HOSTS` |

## Moving from `sql-dev-inspector`

Change the import path; nothing else:

```diff
- import { createSqlInspector } from "sql-dev-inspector"
+ import { createSqlInspector } from "backend-dev-inspector"
```

`sql-dev-inspector/nuxt` becomes `backend-dev-inspector/nuxt`, and `/nitro` and `/client` likewise. The old package keeps working and prints a one-line tip about this one (hide it with `SQL_INSPECTOR_NOTICE=0`).

## Dependencies and supply chain

- **One runtime dependency:** `sql-dev-inspector`. The watched libraries (`pg`, `postgres`, `mysql2`, `better-sqlite3`, `@libsql/client`, `mongodb`, `ioredis`) are optional peer dependencies, never installed by this package. Scanners that resolve peers (Socket) attribute the alerts of those libraries and of their own dependencies (`eval` in `mysql2` and `generate-function`, native install scripts in `better-sqlite3`, network access in the database clients, minified or unmaintained transitive packages, URL strings in comments) to this package. None of that is code shipped here.
- **Its own code**: no install scripts, no network calls, no child processes, no `eval` / `new Function` / `new RegExp(string)`, and it reads no environment variable itself (the only reader is the allow-list in `sql-dev-inspector`). A test fails if any of that appears in `src/`.
- **Reflection**: drivers are observed by patching a prototype, subscribing to a `diagnostics_channel`, or wrapping an object you pass in. The originals are restored on uninstall.
- **Provenance**: releases are built by GitHub Actions with npm provenance and trusted publishing. Verify an install with `npm audit signatures`.

## Playground, development and license

- **Playground**: [`playground/`](https://github.com/githubthinnd/backend-dev-inspector/tree/main/playground) has a demo app for Nuxt 3 (Drizzle, Prisma), Express (SQL, Drizzle), Fastify, Koa and Hono, all runnable without a database.
- **Develop**: from the repository root, `npm install`, `npm run build`, `npm test`. Tests drive the real libraries against in-memory servers (PostgreSQL, MongoDB, Redis and HTTP protocols), so no database or open port is needed. `better-sqlite3` is a native module: run `npm rebuild better-sqlite3` after installing with `--ignore-scripts`, or its tests are skipped.
- **Report a vulnerability**: see [SECURITY.md](https://github.com/githubthinnd/backend-dev-inspector/blob/main/SECURITY.md). **Changes**: [CHANGELOG.md](CHANGELOG.md).
- **License**: MIT, see [LICENSE](LICENSE).
