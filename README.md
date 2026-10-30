<h1 align="center">backend-dev-inspector</h1>

<p align="center">
  <b>See what your backend does for every request, in development only.</b><br>
  Every SQL query, MongoDB command, Redis call and outbound HTTP request, in order, with N+1 and slow-call warnings.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/backend-dev-inspector"><img alt="backend-dev-inspector on npm" src="https://img.shields.io/npm/v/backend-dev-inspector?label=backend-dev-inspector"></a>
  <a href="https://www.npmjs.com/package/sql-dev-inspector"><img alt="sql-dev-inspector on npm" src="https://img.shields.io/npm/v/sql-dev-inspector?label=sql-dev-inspector"></a>
  <a href="https://github.com/githubthinnd/backend-dev-inspector/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/githubthinnd/backend-dev-inspector/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Node 22+" src="https://img.shields.io/badge/node-%E2%89%A522-339933">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue"></a>
</p>

<p align="center">
  <img alt="The inspector's terminal output for a request with an N+1: the statements in order, then the warning" src="docs/media/terminal-n-plus-one.svg" width="760">
</p>
<p align="center"><sub>Real output of the <a href="playground/apps/express-sqlite">express-sqlite playground app</a>, which you can run without a database.</sub></p>

<p align="center">
  <img alt="Antimatter, the demo shop admin, running on Nuxt 3 with the inspector's floating button" src="docs/media/nuxt-orders.jpg" width="49%">
  <img alt="The inspector showing an N+1 insight for the Customers screen" src="docs/media/inspector-n-plus-one.jpg" width="49%">
</p>
<p align="center">
  <img alt="The Reports screen after a slow query" src="docs/media/nuxt-reports.jpg" width="32%">
  <img alt="The inspector flagging the slow query" src="docs/media/inspector-slow-query.jpg" width="32%">
  <img alt="The inspector showing a transaction with a rolled-back savepoint" src="docs/media/inspector-transaction.jpg" width="32%">
</p>
<p align="center"><sub>The <a href="playground">playground</a>: a demo shop admin on Nuxt 3, and what the inspector recorded for the same clicks.</sub></p>

## Contents

- [What it is](#what-it-is)
- [Which package](#which-package)
- [Quick start](#quick-start)
- [Supported technologies](#supported-technologies)
- [What it tells you](#what-it-tells-you)
- [Safe to leave in your project](#safe-to-leave-in-your-project)
- [Try it without a database](#try-it-without-a-database)
- [Repository layout](#repository-layout)
- [Develop](#develop)
- [Security, license](#security-license)

## What it is

A slow endpoint is rarely one slow query. It is the same query run forty times, a cache that misses on every call, or a payment API called inside a loop. Logs do not show that, and an APM is overkill on a laptop. These tools put it in front of you **while you build**:

- **One tree per request**, across SQL, MongoDB, Redis and outbound HTTP, with transactions and savepoints nested the way they ran.
- **Warnings that point at the cause**: N+1 loops, repeated calls, slow calls, errors, too many statements.
- **Three views**: a tree in the terminal, a live page at `/__sql-inspector/`, and a floating panel inside your app.
- **No change to your code paths**: they observe the libraries your app already uses (`pg`, `postgres.js`, `mysql2`, `libSQL`, `mongodb`, `ioredis`, `fetch`…).
- **Finds the line of code** that made each call, opens it in your editor, and says how to fix each warning.
- **Shows where the time went** (database, cache, HTTP, your own code), **compares two requests** before and after a fix, **exports a request** as Markdown or JSON, and holds routes to **budgets** (calls, time).
- **Works with your tools**: a read-only **MCP server** for coding agents (Claude Code, Cursor…), and **query budgets for tests** that fail a pull request adding an N+1.
- **Dev only**: nothing runs when `NODE_ENV=production`.
- **Under your control**: hide values, follow only the routes you choose, and serve the page from a path you pick.

## Which package

This repository holds two npm packages.

| | [`backend-dev-inspector`](packages/backend-dev-inspector) | [`sql-dev-inspector`](packages/sql-dev-inspector) |
|---|---|---|
| **Covers** | PostgreSQL, MySQL / MariaDB, SQLite, MongoDB, Redis, outbound HTTP, Prisma | MySQL / MariaDB through `mysql2` (and Drizzle, Knex, Sequelize, TypeORM on top of it) |
| **Frameworks** | Express, Fastify, Koa, Hono, Nuxt / Nitro, Next.js, SvelteKit, Astro, Vite, plain Node | Express, Nuxt / Nitro, plain Node |
| **Relation** | builds on `sql-dev-inspector` and exports everything it does | the base of the other package; works on its own |
| **Install** | `npm i -D backend-dev-inspector` | `npm i -D sql-dev-inspector` |

Not sure which one? Use **`backend-dev-inspector`**: switching from the other later is a change of import path.

## Quick start

```bash
npm install --save-dev backend-dev-inspector
```

```ts
// Express, Connect, NestJS
import { createInspector } from "backend-dev-inspector"

const inspector = createInspector()
app.use(inspector.middleware) // before any route that uses a database
```

Run your app with `NODE_ENV=development`, make a request, and open `http://localhost:3000/__sql-inspector/`. Setup for every other framework (Fastify, Koa, Hono, Nuxt, Next.js, SvelteKit, Astro, Vite, Bun, Deno, plain Node) is in the [package guide](packages/backend-dev-inspector#quick-start).

## Supported technologies

| Area | Supported |
|---|---|
| **Databases** | PostgreSQL (`pg`, `postgres.js`), MySQL and MariaDB (`mysql2`, `mariadb`), SQLite (`better-sqlite3`, `node:sqlite`), libSQL and Turso (`@libsql/client`), MongoDB (`mongodb`, Mongoose), and db0 (Nitro `useDatabase()`, NuxtHub) |
| **Caches** | Redis (`ioredis` 5 and 6, `redis` 6) |
| **Outbound HTTP** | `node:http`, `node:https`, global `fetch`, `undici` |
| **ORMs and builders** | Drizzle, Prisma 7, Kysely, Knex, Sequelize, TypeORM, Mongoose, through the drivers above |
| **Frameworks** | Express 5, Connect, NestJS, Fastify 5, Koa 3, Hono 4, Nuxt 3 and 4, Nitro, Next.js (App Router), SvelteKit, Astro, Vite, Bun, Deno, Workers, plain Node `http` |
| **Languages of the UI** | English, Vietnamese, Japanese |

Each entry says how it is observed and **how far it has been verified** (real client, protocol mock, documented contract, or only expected to work) in the [package guide](packages/backend-dev-inspector#supported-technologies). Not supported: Nuxt 2, and databases without a driver listed above.

## What it tells you

| Insight | Raised when |
|---|---|
| **N+1** | 3 or more calls of the same shape, with different values, in one request |
| **Duplicate** | the exact same call twice or more |
| **Slow** | a call takes at least the threshold (default 100 ms, adjustable live) |
| **Error** | the call was rejected |
| **Many queries** | 30 or more calls in one request |

Calls that are not SQL count the same way: three `GET customer:<id>` calls to Redis, or three requests to the same endpoint of another service, are an N+1.

## Safe to leave in your project

- **Off in production.** With `NODE_ENV=production` nothing is patched and the middleware only calls `next()`.
- **Local only.** The inspector page refuses non-local `Host` headers (DNS rebinding) and cross-site POSTs. Data lives in the memory of the dev process; nothing is written to disk or sent anywhere.
- **Values stay out by default.** Bind parameters are shown as their type and size (`<string:12>`), Redis values and HTTP credentials are not recorded, credential-looking URL parameters are hidden, and a stricter mode masks whole statements. Statements you wrote yourself can still contain values, so do not share your screen on real data.
- **Small supply chain.** `sql-dev-inspector` has no runtime dependencies; `backend-dev-inspector` has one, `sql-dev-inspector`. The libraries they watch are optional peers. Tests fail if the source uses `eval`, child processes, network calls of its own, or reads environment variables outside one allow-list.
- **Verifiable releases.** Published from GitHub Actions with npm provenance and trusted publishing. Check an install with `npm audit signatures`.

Details, and the reasoning behind scanner alerts: [SECURITY.md](SECURITY.md) and the "Dependencies and supply chain" section of each package guide.

## Try it without a database

The [playground](playground) has a small shop admin, **Antimatter**, for each stack: Nuxt 3 (Drizzle, Prisma), Express (SQL, Drizzle), Fastify, Koa and Hono. Every screen calls its own API and maps to one thing the inspector detects: a healthy request, an N+1, a slow query, a database error, a transaction, an N+1 over HTTP. They run on SQLite, so nothing else needs to be installed.

```bash
npm run playground:install
npm run dev:nuxt3-drizzle --prefix playground   # then open /__sql-inspector/
```

## Repository layout

```
packages/sql-dev-inspector/       core: request tree, analysis, UI, MySQL driver, Express / Nuxt / Nitro / web adapters
packages/backend-dev-inspector/   drivers (pg, SQLite, MongoDB, Redis, HTTP, …) and framework adapters, on top of the core
playground/                       runnable demo apps, one per framework and data layer (a separate npm project)
docs/media/                       screenshots used by the READMEs
```

## Develop

```bash
npm install            # both packages (workspaces)
npm run build          # sql-dev-inspector first, then backend-dev-inspector
npm run typecheck
npm test               # Node 22+; run `npm rebuild better-sqlite3` if you installed with --ignore-scripts
```

Tests drive the real client libraries against in-memory protocol servers, so no database or open port is needed. The playground has its own tests (`npm run playground:test`).

Releases are tagged `<package>@<version>` (for example `sql-dev-inspector@1.2.1`); a tag starts the publish workflow. Publish `sql-dev-inspector` before `backend-dev-inspector`.

## Security, license

Report a vulnerability as described in [SECURITY.md](SECURITY.md). Licensed under the [MIT license](LICENSE).
