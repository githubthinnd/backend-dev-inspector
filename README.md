<h1 align="center">backend-dev-inspector</h1>

<p align="center">
  <b>See what your backend does for every request — in development only.</b><br>
  Every query, cache call and outbound HTTP request, in order, with N+1 and slow-call warnings.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/backend-dev-inspector"><img alt="npm" src="https://img.shields.io/npm/v/backend-dev-inspector?label=backend-dev-inspector"></a>
  <a href="https://www.npmjs.com/package/sql-dev-inspector"><img alt="npm" src="https://img.shields.io/npm/v/sql-dev-inspector?label=sql-dev-inspector"></a>
  <a href="https://github.com/githubthinnd/backend-dev-inspector/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/githubthinnd/backend-dev-inspector/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Node 22+" src="https://img.shields.io/badge/node-%E2%89%A522-339933">
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>
</p>

<p align="center">
  <img alt="The inspector's terminal output for a request with an N+1: the statements in order, then the warning" src="https://raw.githubusercontent.com/githubthinnd/backend-dev-inspector/main/docs/media/terminal-n-plus-one.svg" width="760">
</p>

<p align="center"><sub>Real output of the <a href="playground/apps/express-sqlite">express-sqlite playground app</a>, which you can run without a database.</sub></p>

## Why

A slow endpoint is usually not one slow query: it is the same query run forty times, a cache that misses on every call, or a payment API called inside a loop. Logs do not show that, and an APM is overkill on your laptop. This tool puts it in front of you while you build:

- **A tree per request**, in your terminal (as above), on a live page (`/__sql-inspector/`) and in a floating panel inside your app.
- **Warnings that point at the cause**: N+1 loops, repeated calls, slow calls, SQL errors.
- **Works across technologies**: PostgreSQL, MySQL / MariaDB, SQLite, MongoDB, Redis, outbound HTTP and Prisma, behind Express, Fastify, Koa, Hono, Nuxt / Nitro, Next.js, SvelteKit, Astro or plain Node.
- **No change to your code paths**: it observes the libraries your app already uses.

## Get started

```bash
npm install --save-dev backend-dev-inspector
```

```ts
// Express, Connect, NestJS
import { createInspector } from "backend-dev-inspector"

const inspector = createInspector()
app.use(inspector.middleware)
```

Run your app with `NODE_ENV=development`, make a request, then open `http://localhost:3000/__sql-inspector/`. Setup for every framework is in the [package guide](packages/backend-dev-inspector#quick-start).

## Two packages

| Package | What it is | Install |
|---|---|---|
| [`backend-dev-inspector`](packages/backend-dev-inspector) | **PostgreSQL, MySQL / MariaDB, SQLite, MongoDB, Redis and outbound HTTP**, plus Prisma, and adapters for Express, Fastify, Koa, Hono, Nuxt / Nitro, Next.js, SvelteKit, Astro and Vite. | `npm i -D backend-dev-inspector` |
| [`sql-dev-inspector`](packages/sql-dev-inspector) | The original: MySQL through `mysql2` (and with it Drizzle, Knex, Sequelize, TypeORM) on Express, Nuxt and Nitro. It is the core of the other package and keeps working on its own. | `npm i -D sql-dev-inspector` |

Not sure which one? Use **`backend-dev-inspector`**. It exports everything `sql-dev-inspector` does, so switching later is an import path.

## Safe to leave in your project

- **Off in production.** With `NODE_ENV=production` nothing is patched and the middleware only calls `next()`.
- **Local only.** The inspector page refuses non-local `Host` headers (DNS rebinding) and cross-site POSTs. Data stays in the memory of the dev process; nothing is written to disk or sent anywhere.
- **Secrets stay out.** Redis values and HTTP credentials are not recorded; credential-looking URL parameters are hidden.
- **Small supply chain.** `sql-dev-inspector` has no runtime dependencies; `backend-dev-inspector` has one, `sql-dev-inspector`. The libraries it watches are optional peers. Tests fail if the source uses `eval`, child processes, network calls of its own or reads environment variables outside one allow-list.
- **Verifiable releases.** Published from GitHub Actions with npm provenance and trusted publishing. Check an install with `npm audit signatures`.

Details and the reasoning behind scanner alerts: [SECURITY.md](SECURITY.md) and the "Dependencies and supply chain" sections of each package.

## Try it without a database

The [playground](playground) has a small app for each stack (Express, Fastify, Koa, Hono, Nuxt 3 with Drizzle or Prisma), all serving the same scenarios: a healthy request, an N+1, a slow query, an error, a transaction and outbound HTTP. They run on SQLite, so nothing else needs to be installed.

```bash
npm run playground:install
npm run dev:express-sqlite --prefix playground   # then open /__sql-inspector/
```

## Develop

```bash
npm install            # both packages (workspaces)
npm run build          # sql-dev-inspector first, then backend-dev-inspector
npm run typecheck
npm test               # Node 22+; run `npm rebuild better-sqlite3` if you installed with --ignore-scripts
```

Tests drive the real client libraries against in-memory protocol servers, so no database or open port is needed.

```
packages/sql-dev-inspector/       core: request tree, analysis, UI, MySQL driver, Express / Nuxt / Nitro / web adapters
packages/backend-dev-inspector/   drivers (pg, SQLite, MongoDB, Redis, HTTP, …) and framework adapters, on top of the core
```

Releases are tagged `<package>@<version>` (`sql-dev-inspector@1.2.1`); a tag starts the publish workflow. Publish `sql-dev-inspector` before `backend-dev-inspector`.

## License

[MIT](LICENSE)
