# backend-dev-inspector

<p>
  <a href="https://www.npmjs.com/package/backend-dev-inspector"><img alt="npm version" src="https://img.shields.io/npm/v/backend-dev-inspector"></a>
  <a href="https://www.npmjs.com/package/backend-dev-inspector"><img alt="npm downloads" src="https://img.shields.io/npm/dm/backend-dev-inspector"></a>
  <a href="https://github.com/githubthinnd/backend-dev-inspector/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/githubthinnd/backend-dev-inspector/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Node 22+" src="https://img.shields.io/badge/node-%E2%89%A522-339933">
  <img alt="MIT" src="https://img.shields.io/badge/license-MIT-blue">
</p>

**See what your backend talks to, for each request — in development only.**

When a client calls your API, `backend-dev-inspector` shows every call your server made to **PostgreSQL, MySQL / MariaDB, SQLite, MongoDB, Redis and other services over HTTP**: in what order, inside which transaction, how long each took, how many rows came back. It flags N+1 loops, repeated calls, slow calls and errors, in the terminal, on a live web page and in a floating panel inside your app.

It builds on [`sql-dev-inspector`](https://www.npmjs.com/package/sql-dev-inspector) (which stays the MySQL-focused package) and replaces its import: everything it exports is exported here too, with every driver turned on.

```
GET /api/orders/42 → 200  210ms total · 9 queries · 188ms in SQL
├─ SELECT [pg] orders 3.2ms · 1 row
│  select "id", "customer_id" from "orders" where "id" = $1
├─ GET [redis] 0.4ms
│  GET customer:17
├─ FIND [mongodb] reviews 5.1ms · 12 rows
│  reviews.find {"filter":{"orderId":42}}
├─ TRANSACTION [conn 4011] committed 9.8ms
│  ├─ INSERT [pg] audit_log 1.1ms · 1 affected
│  └─ UPDATE [pg] orders 1.6ms · 1 affected
├─ GET 200 [http] 142ms
│  GET https://payments.example.com/v1/charges/ch_9
⚠ N+1 suspected: 4×, 7.1ms total — GET customer:?
```

## What it sees

| Technology | Library | How | Checked against |
|---|---|---|---|
| MySQL, MariaDB (server) | `mysql2` (Drizzle, Knex, Sequelize, TypeORM…) | via `sql-dev-inspector` | real `mysql2`, wire-protocol mock |
| **PostgreSQL** | `pg` (Drizzle, Kysely, Knex, TypeORM, Sequelize…) | patches `Client#query`, pool-aware | real `pg` 8, wire-protocol mock |
| **SQLite** | `better-sqlite3` | patches statements and `exec`; `db.transaction()` shows as a transaction | real `better-sqlite3` |
| | `node:sqlite` | same; **opt-in** (see below) | real `node:sqlite` |
| **MongoDB** | `mongodb` (and Mongoose) | switches on the driver's command monitoring | real `mongodb` 7, wire-protocol mock |
| **Redis** | `ioredis` 6, `redis` (node-redis) 6 | subscribes to the clients' own tracing channels | real `ioredis` 6, real node-redis 6 |
| | `ioredis` 5 | small patch on `sendCommand` | real `ioredis` 6 with the patch path forced |
| **HTTP out** | `node:http` / `node:https`, `fetch`, `undici` | subscribes to Node's `diagnostics_channel` | real client code over in-memory sockets |
| MariaDB connector | `mariadb` | `instrumentMariadb(module)` helper | the connector's documented API (not the real connector) |
| Prisma | `@prisma/client` | `$extends(prismaExtension())` | Prisma's documented extension contract (no engine) |

Everything is a *driver*: the call is described as the SQL statement it resembles (a read is a `select`, a `find` is a `select`, a `GET` is a `select`), so the same N+1, repeat and slow-call detection applies to all of them. A Redis `GET user:1`, `GET user:2`, `GET user:3` is an N+1 just like three SQL point reads.

Each driver does nothing when its library is not installed in your app. `NODE_ENV=production` switches everything off.

## Install

```bash
npm install --save-dev backend-dev-inspector
```

It brings `sql-dev-inspector` with it. The libraries it watches (`pg`, `better-sqlite3`, `mongodb`, `ioredis`, `mysql2`) are optional peer dependencies: it uses the ones your app already has and installs none.

Requires **Node.js 22+**.

## Quick start

The inspector turns on when `NODE_ENV=development` (or `SQL_INSPECTOR=1`). Open `http://localhost:3000/__sql-inspector/` (under your base path, if any).

### Express / Connect / NestJS (Express)

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

### Hono (Node, Bun, Deno, Workers)

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

Nuxt also gets the floating button, in `nuxt dev` only.

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
// any route handler you want attributed
import { withInspector } from "backend-dev-inspector/next"

export const GET = withInspector(async (request) => Response.json(await loadOrders()))
```

Server components and server actions have no hook, so their calls are listed under "outside any request".

### Bun, Deno, Workers, any `(request) => Response`

```ts
import { wrapFetch } from "backend-dev-inspector"

Bun.serve({ fetch: wrapFetch(handler) }) // or Deno.serve(wrapFetch(handler))
```

### Plain Node `http`, jobs, scripts

Same API as `sql-dev-inspector`: `inspector.handle(req, res)`, `inspector.track(req, res, fn)`, `inspector.task("nightly-sync", fn)`.

### Floating button in any frontend

```ts
if (import.meta.env.DEV) {
  const { mountSqlInspectorWidget } = await import("backend-dev-inspector/client")
  mountSqlInspectorWidget({ baseURL: "/" })
}
```

### Per library

```ts
// MariaDB connector: wrap the module where you import it
import * as mariadbModule from "mariadb"
import { instrumentMariadb } from "backend-dev-inspector"
const mariadb = instrumentMariadb(mariadbModule) // unchanged outside development

// Prisma: add the extension
import { prismaExtension } from "backend-dev-inspector/prisma"
const prisma = new PrismaClient().$extends(prismaExtension())
```

`node:sqlite` is opt-in, because merely loading it prints Node's experimental-feature warning, which an app that does not use SQLite must never see: `SQL_INSPECTOR_DRIVERS=node:sqlite` (or pass `nodeSqliteDriver` to `createInspector({ drivers })`).

## Configuration

Every `SQL_INSPECTOR_*` variable of [`sql-dev-inspector`](https://www.npmjs.com/package/sql-dev-inspector) applies (slow-query threshold, history size and age, language, allowed hosts…). Two matter most here:

| Variable | Default | Meaning |
|---|---|---|
| `SQL_INSPECTOR` | — | `1` turns it on outside `NODE_ENV=development`; `0` turns it off. `NODE_ENV=production` always wins |
| `SQL_INSPECTOR_DRIVERS` | all | comma separated drivers to keep: `mysql2`, `pg`, `better-sqlite3`, `mongodb`, `ioredis`, `redis`, `http`, `fetch`, `mariadb`, `prisma`, and `node:sqlite` (opt-in). `all` or empty keeps everything |

The slow-query threshold can also be changed from the settings menu of the floating panel and from the top bar of the page.

## What it records, and what it hides

- SQL and Mongo filters are shown **with their real values**, like in `sql-dev-inspector`: do not share your screen while connected to real data.
- **Redis**: the clients' own sanitising applies: `SET key ?`, values of writes are never recorded; reads show their key.
- **HTTP**: user names and passwords in a URL are dropped, and the values of query parameters that look like credentials (`token`, `key`, `secret`, `password`, `auth`, `signature`, `session`…) are replaced by `?`. Headers and bodies are never recorded.
- Nothing is written to disk or sent anywhere; everything lives in the memory of the dev process and expires (see `SQL_INSPECTOR_TTL_MINUTES`).
- The page refuses requests whose `Host` is not `localhost` or an IP address (DNS rebinding) and cross-site `POST`s; list your own host names in `SQL_INSPECTOR_ALLOWED_HOSTS`.

## Moving from `sql-dev-inspector`

Change the import path; nothing else:

```diff
- import { createSqlInspector } from "sql-dev-inspector"
+ import { createSqlInspector } from "backend-dev-inspector"
```

`sql-dev-inspector/nuxt` → `backend-dev-inspector/nuxt`, `/nitro` and `/client` likewise. The old package keeps working and keeps printing a one-line tip (hide it with `SQL_INSPECTOR_NOTICE=0`).

## Dependencies and supply chain

- **One runtime dependency:** `sql-dev-inspector`. The libraries it watches (`pg`, `better-sqlite3`, `mongodb`, `ioredis`, `mysql2`) are optional peer dependencies, never installed by this package. Scanners that resolve peers (Socket) attribute the alerts of those libraries and of their own dependencies (`eval` in `mysql2` / `generate-function`, native install scripts in `better-sqlite3`, network access in the database clients, minified or unmaintained transitive packages, URL strings in comments) to this package. None of that is code shipped here.
- **What this package's own code does:** no install scripts, no network calls of its own, no child processes, no `eval` / `new Function` / `new RegExp(string)`, and it reads no environment variable (the only reader is the allow-list in `sql-dev-inspector`). `test/supply-chain.test.ts` fails if any of that appears in `src/`.
- **Reflection:** drivers are observed by patching a prototype, subscribing to a `diagnostics_channel`, or wrapping an object you pass in; the originals are restored on uninstall.
- **Provenance:** releases are built by GitHub Actions with npm provenance and trusted publishing. Check an install with `npm audit signatures`.

## Limitations

- **Connection pools of other drivers**: PostgreSQL and MongoDB statements are attributed to the request that issued them even when the pool is saturated (tested). Other libraries are attributed to the async context in which their event fires, which is the caller's for everything listed above.
- **`mariadb` connector**: cannot be patched from outside, hence the `instrumentMariadb()` helper. Knex, Sequelize and TypeORM load the connector themselves; for them use `mysql2`, which also talks to MariaDB servers.
- **Redis**: needs a client that publishes its commands (`ioredis` 6 or `redis` 6); `ioredis` 5 is patched instead. A `redis` release that publishes no tracing channel is not seen. A `MULTI` in node-redis is one call, because the client does not publish its commands individually; in ioredis `MULTI … EXEC` shows as a transaction.
- **Prisma**: the SQL Prisma generates is not available at that point; calls are shown by model and operation.
- **Next.js**: only route handlers you wrap are attributed to their request. **Bun, Deno, Workers**: `wrapFetch` uses only web APIs and `AsyncLocalStorage`, but this package is tested on Node.js only.
- Not a profiler: durations are wall-clock, measured around each call.

## Development

```bash
npm install
npm run build
npm test
```

The monorepo root runs both packages. Tests drive the real libraries against in-memory servers (PostgreSQL, MongoDB, Redis, HTTP wire protocols) wired in through in-memory sockets, so no database or open port is needed. `better-sqlite3` is a native module; run `npm rebuild better-sqlite3` after installing with `--ignore-scripts` or its tests are skipped.

## License

MIT — see [LICENSE](LICENSE).
