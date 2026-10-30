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
- [Beyond the tree](#beyond-the-tree)
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
- **Finds the line of code** that made each call and opens it in your editor, and **advises how to fix** each warning. [Details](#beyond-the-tree).
- **Built for the tools around you**: a read-only **MCP server** for coding agents, **query budgets for tests** that fail a pull request adding an N+1, and a `doctor` command. [Details](#beyond-the-tree).
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

Server components and server actions get no `Request` Next.js lets you hook, so wrap them and name them; each is then a request of its own in the inspector:

```tsx
import { withInspectorAction, withInspectorPage } from "backend-dev-inspector/next"

export default withInspectorPage("/orders", async function OrdersPage() { /* … */ })          // GET /orders
export const createOrder = withInspectorAction("createOrder", async (data: FormData) => { /* … */ })  // ACTION createOrder
```

`redirect()` and `notFound()` are not failures (they end as 307 and 404), and a component called inside a wrapped route handler joins that request. Without the wrapper, those calls are listed under "outside any request".

### NestJS, tRPC, Remix and React Router

```ts
// NestJS main.ts: before listen(); picks the Express or Fastify adapter by itself
import { inspectNest } from "backend-dev-inspector/nest"
await inspectNest(app)

// tRPC: every procedure leaves a line under its request (a batch is one request), or is a request of its own without one
import { trpcInspector } from "backend-dev-inspector/trpc"
const inspected = t.procedure.use(trpcInspector())

// Remix / React Router framework mode: wrap the request handler
import { inspectRemix } from "backend-dev-inspector/remix"
const handler = inspectRemix(createRequestHandler(build))
```

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

// AWS SDK v3 (S3, DynamoDB, SQS, SNS, Lambda…): one line per client, through its own middleware stack
import { instrumentAws } from "backend-dev-inspector"
const s3 = instrumentAws(new S3Client({}))   // a call per command, with its status, request id and retries

// Elasticsearch / OpenSearch: through the client's diagnostic events
import { instrumentElasticsearch } from "backend-dev-inspector"
const es = instrumentElasticsearch(new Client({ node }))

// BullMQ: what the request adds to a queue (its Redis commands are kept under the call)
import { instrumentBullmq } from "backend-dev-inspector"
const emails = instrumentBullmq(new Queue("emails", { connection }))

// Neon over HTTP, and Cloudflare D1
import { instrumentNeon, instrumentD1 } from "backend-dev-inspector"
const sql = instrumentNeon(neon(databaseUrl))
const db = instrumentD1(env.DB)
```

None of these load the library: they work on the object you pass, so they add no dependency. Resource names (bucket, queue, index, table) are recorded; bodies, items, message and job data are not (a job's data and a search's query are kept as parameters, hidden unless values are shown).

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
| **AWS SDK v3** | any `@aws-sdk/client-*` | `instrumentAws(client)`: a middleware that runs before the SDK's retries, so one call per command with its attempts | ✅ Real `@aws-sdk/client-sqs` with a stand-in transport |
| **Elasticsearch** | `@elastic/elasticsearch` 8 and 9 | `instrumentElasticsearch(client)`: the transport's `request` / `response` diagnostic events | ✅ Real client with a stand-in connection. OpenSearch: 🟡 same events, not run |
| **BullMQ** | `bullmq` | `instrumentBullmq(queue)`: `add`, `addBulk`, `upsertJobScheduler`; its Redis commands are kept under the call | 🧪 A stand-in queue of the documented shape; not run against Redis |
| **Neon (HTTP)** | `@neondatabase/serverless` | `instrumentNeon(sql)`: tagged queries, `sql.query()`, `sql.transaction()` | ✅ Real `neon()` with a stand-in `fetch`. The WebSocket `Pool` / `Client`: ❌ not covered |
| **Cloudflare D1** | the `env.DB` binding | `instrumentD1(db)`: `prepare().bind()` + `first` / `all` / `run` / `raw`, `batch`, `exec` | 🧪 A stand-in binding of the documented shape; not run in `workerd` |
| **Prisma** | `@prisma/client` 7 | `$extends(prismaExtension())` | ✅ Real Prisma 7 client (libSQL adapter), in the playground |

### ORMs and query builders

These sit on a driver above, so they are watched through it. Statements are the SQL the ORM sends.

| ORM / builder | Runs on | Verified |
|---|---|---|
| Drizzle ORM | `pg`, `postgres`, `mysql2`, `better-sqlite3`, `@libsql/client` | ✅ with `better-sqlite3` and `mysql2` |
| Prisma | its own engine and the watched drivers under its adapters | ✅ through `prismaExtension()` (listed by model and operation, with the real SQL under it when the adapter's driver is watched) |
| Mongoose | `mongodb` | 🟡 |
| Kysely, Knex, Sequelize, TypeORM | `pg`, `postgres`, `mysql2`, `better-sqlite3` | 🟡 |

### Frameworks

| Framework | Import | Verified |
|---|---|---|
| Express 5 / Connect | `createInspector().middleware` | ✅ real app in the playground; unit tests with a faithful `req` / `res` |
| NestJS | `await inspectNest(app)` from `backend-dev-inspector/nest` (picks Express or Fastify) | ✅ on Fastify through a stand-in app object; 🧪 on Express; not run inside a real Nest container |
| tRPC | `trpcInspector()` from `backend-dev-inspector/trpc`, as a procedure middleware | 🧪 with the documented middleware arguments |
| Remix, React Router (framework mode) | `inspectRemix(handler)` from `backend-dev-inspector/remix` | 🧪 with a handler of the documented shape |
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

Not supported: Nuxt 2 (EOL), runtimes without `AsyncLocalStorage`, and databases without a driver listed above (for example Oracle, SQL Server).

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
| `SQL_INSPECTOR_STACK` | on | `0` stops looking for the line of code that made each call. See [Finding the line of code](#finding-the-line-of-code) |
| `SQL_INSPECTOR_EDITOR` | `vscode` | The editor that location links open: `vscode`, `cursor`, `windsurf`, `zed`, `idea`, `webstorm`, `none`, or a link template |
| `SQL_INSPECTOR_LOGS` | off | `1` lists what the application prints under its request. See [Console output](#console-output) |
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
| `/fastify` `/koa` `/hono` `/next` `/sveltekit` `/astro` `/vite` `/nest` `/trpc` `/remix` | framework adapters |
| `/nuxt` `/nitro` | Nuxt module, Nitro plugin |
| `/prisma` | `prismaExtension()` |
| `/client` | `mountSqlInspectorWidget({ baseURL })`, the floating button |
| `/testing` | `capture()` and the matchers for query budgets in tests |

Lower level, for custom integrations: `startInspector`, `getInspector`, `buildReport`, `TraceStore`, `analyzeSql`, `describeOperation`, the `DriverAdapter` and `Recorder` types, and the rest of what [`sql-dev-inspector`](https://www.npmjs.com/package/sql-dev-inspector#api) exports.

The page's HTTP routes, all under `/__sql-inspector/`: `GET /` (page), `GET /api/requests`, `GET /api/requests/:id`, `GET /api/stream` (server-sent events), `GET` / `POST /api/settings`, `POST /api/clear`.

## Beyond the tree

### Finding the line of code

Every call records **the first line of your own code that made it**: not a library, not the inspector. It shows on each statement as `src/orders.ts:42`, a link that opens your editor at that line, on the N+1, duplicate, slow and error warnings, and in the terminal tree (`↳ src/orders.ts:42`). Finding it costs about 9 microseconds a call.

| Setting | Meaning |
|---|---|
| `SQL_INSPECTOR_STACK` | `0` turns the search off (default on). Also a switch in the settings |
| `SQL_INSPECTOR_EDITOR` | `vscode` (default), `cursor`, `windsurf`, `zed`, `idea`, `webstorm`, `vscode-insiders`, `none`, or a link template of one of those editors' schemes, with `{file}`, `{path}`, `{line}`, `{column}`. Also a choice in the settings |

A call made inside a library alone has no line. The inspector never turns a location into a link of any other scheme.

### Advice on every warning

Each warning says what to do about it, in the language of the page and the terminal, and what it advises depends on what was called: an N+1 over SQL points at joins, `IN` lists and your ORM's eager loading (Drizzle `with`, Prisma `include`); over Redis at `MGET` and pipelines; over MongoDB at `$in` and `$lookup`; over HTTP at batch endpoints. It shows under the warning in the page ("How to fix"), in the terminal, in the API (`hint`) and for agents.

### Console output

`SQL_INSPECTOR_LOGS=1` (or the switch in the settings) lists what your application prints while it handles a request (`console.log`, `info`, `warn`, `error`, `debug`) under that request, with its level, time and calling line. It is **off by default**, because a log line can hold a token or a person's data. At most 200 lines of 2000 characters per request. Your console keeps printing as before, and is not touched until you switch this on.

### Overview

The **Overview** button in the top bar adds the recent requests up: the routes that cost the most in all (requests, average and 95th-percentile time, calls per request, which findings they raise; ids in a path are folded, so `/orders/1` and `/orders/2` are one route), the calls that cost the most across routes, and the findings that keep coming back. A row opens the slowest request of its route. `GET /api/overview` and the MCP tool `get_overview` give the same data.

### Where the time went

Every request shows its time split into **database**, **cache**, **outbound HTTP** and **application and waiting**, as a bar. Calls that ran at the same time (`Promise.all`) are counted once, so the parts never add up to more than the request took. It is also in the Markdown export, the JSON export and the `get_request` tool.

### Compare two requests

Pick another request under **Compare** in the request detail (the ones for the same route come first) to see which is faster and by how much, the calls that are new, gone, run more often or slower, the time split side by side, and the warnings that appeared or went away. Calls are matched by what they are (driver and statement with its values masked), not by order, so the same call with other values is one. Use it before and after a fix: `GET /api/compare/<before>/<after>` and the MCP tool `compare_requests` do the same.

### Copy or export a request

**Copy for a report** puts one request in your clipboard as Markdown (findings with where they were called from and how to fix them, the calls in a table, the console, the tree), ready for a bug report or a chat with an assistant. **Download JSON** (`GET /api/requests/<id>/export`) saves it as a versioned document (`format: "sql-dev-inspector/request"`, `version: 1`) for scripts and CI artifacts. Both are as redacted as the inspector is set to redact.

### Budgets per route

```bash
SQL_INSPECTOR_BUDGETS="/api/**=calls:20,ms:300; GET /api/orders=calls:5,callMs:80"
```

`calls` is the number of calls, `ms` the time of the request, `callMs` the time spent in calls; the path takes the same `*` and `**` as the route filters, and the first budget that matches applies. A request over its limit gets a warning that names the route, the limit and the actual value, with advice. Also a `budgets` option (`startInspector`, the Nuxt module) and a field in the settings. In tests, [`toBeWithinBudget`](https://www.npmjs.com/package/backend-dev-inspector#query-budgets-in-tests) does the same for a `capture()`.

### Check your setup

When nothing shows up, ask the inspector. In the page, the settings have a **Check the setup** button and a list of the drivers that are watching. From the terminal:

```bash
npx backend-dev-inspector doctor
```

It says whether it is on, which drivers are watching, whether a library the inspector cannot load is in your project, **whether two copies of one library are loaded** (the usual silent failure: the inspector patches one, your code calls the other), and, in the page, whether calls reach requests.

### Query budgets in tests

Fail a pull request that adds an N+1:

```ts
import { capture, matchers } from "backend-dev-inspector/testing"

expect.extend(matchers) // once, in your test setup

it("lists the orders without an N+1", async () => {
  const run = await capture(() => app.get("/orders"))
  expect(run).toHaveNoNPlusOne()
  expect(run).toHaveMaxQueries(5)
})
```

`capture(fn)` runs `fn` and returns what it did (SQL, Redis, MongoDB, HTTP) as the inspector sees it; it needs nothing from your application, and switches the inspector on even under `NODE_ENV=test`. The matchers are `toHaveNoNPlusOne`, `toHaveNoDuplicates`, `toHaveNoSlowQueries`, `toHaveNoErrors`, `toHaveNoInsights`, `toHaveMaxQueries(n)`, `toRunQueries(n)` and `toBeWithinBudget({ calls, ms, callMs })`. A failure lists what was found, where it was called from and how to fix it. For types in Vitest:

```ts
import type { InspectorMatchers } from "backend-dev-inspector/testing"
declare module "vitest" {
  interface Assertion<R extends void | Promise<void> = void, T = unknown> extends InspectorMatchers<R> {}
}
```

### Use it from an AI agent

The inspector serves a read-only [Model Context Protocol](https://modelcontextprotocol.io) endpoint at `/__sql-inspector/mcp`, so a coding agent can ask the running application what it did:

```bash
claude mcp add --transport http dev-inspector http://localhost:3000/__sql-inspector/mcp
```

For Cursor and other clients, add `{ "mcpServers": { "dev-inspector": { "url": "http://localhost:3000/__sql-inspector/mcp" } } }` to their `mcp.json`. Seven tools, none of which can change anything: `find_problems`, `get_overview`, `list_requests`, `get_request`, `compare_requests`, `get_settings`, `diagnose`. Values are redacted as you configured, and the same guards as the page apply (local `Host` only). [`skills/dev-inspector`](https://github.com/githubthinnd/backend-dev-inspector/tree/main/skills/dev-inspector) is an agent skill that teaches the workflow: find the problem, read the line it came from, fix it, call the endpoint again and compare.

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
- **Prisma** is listed by model and operation (what your code says, and where the line of code points). The SQL it generates is shown under the operation **when Prisma runs it through a driver the inspector watches** (the `pg`, libSQL and better-sqlite3 adapters do), and is not counted a second time; with another adapter you see the operation alone. Prisma has no savepoints.
- **SQLite** errors raised while *preparing* a statement (a missing table, a syntax error) are not recorded; errors raised when it runs are.
- **postgres.js 3** has to be wrapped (`instrumentPostgres`), because the copy an application imports cannot be patched from outside; version 4 needs nothing. A statement built with helpers (`sql(columns)`) is shown with placeholders.
- **libSQL**: a transaction is listed as BEGIN … COMMIT with its statements; the client's internal statements are not.
- **db0**: connectors whose driver is not watched (PGlite, Neon, D1…) are only seen when you wrap the database with `withTracing()`.
- **A lazy query awaited outside its request** (a postgres.js query or Drizzle builder created in a handler but awaited elsewhere) is attributed to where it is awaited.
- **Next.js**: only route handlers, server components and server actions you wrap are attributed to a request. A layout and a page are separate wrapped functions, so a navigation is more than one entry.
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
| No line of code on a call, or the link does not open | The call was made inside a library alone (no line), `SQL_INSPECTOR_STACK=0`, or `SQL_INSPECTOR_EDITOR=none` |
| Nothing is recorded and nothing says why | Run `npx backend-dev-inspector doctor`, or open the settings and press **Check the setup** |
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
