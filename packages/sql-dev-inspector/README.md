<h1 align="center">sql-dev-inspector</h1>

<p align="center">
  <b>See exactly which SQL your backend ran for each request, in development only.</b><br>
  For Node apps that talk to MySQL or MariaDB through <code>mysql2</code>: plain, Drizzle, Knex, Sequelize, TypeORM.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/sql-dev-inspector"><img alt="npm version" src="https://img.shields.io/npm/v/sql-dev-inspector"></a>
  <a href="https://www.npmjs.com/package/sql-dev-inspector"><img alt="npm downloads" src="https://img.shields.io/npm/dm/sql-dev-inspector"></a>
  <a href="https://github.com/githubthinnd/backend-dev-inspector/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/githubthinnd/backend-dev-inspector/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="TypeScript types included" src="https://img.shields.io/npm/types/sql-dev-inspector">
  <img alt="Node 22+" src="https://img.shields.io/badge/node-%E2%89%A522-339933">
  <img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue">
</p>

> **Need more than MySQL?** [`backend-dev-inspector`](https://www.npmjs.com/package/backend-dev-inspector) builds on this package and adds PostgreSQL, SQLite, MongoDB, Redis, outbound HTTP, Prisma, and adapters for Fastify, Koa, Hono, Next.js, SvelteKit, Astro and Vite, with the same UI and warnings. This package keeps working and stays focused on MySQL / `mysql2`. In development it prints a one-line tip about the other package (hide it with `SQL_INSPECTOR_NOTICE=0`).

When a client calls your API, `sql-dev-inspector` shows **every statement your server sent to MySQL**: in what order, inside which transaction or savepoint, how deeply subqueries nest, how long each took and how many rows it returned. It also flags N+1 loops, repeated queries, slow queries and SQL errors.

You see it in three places: **a tree in your terminal**, **a live page** at `/__sql-inspector/`, and **a floating panel inside your app**. In production it does nothing.

```
GET /api/orders/42 → 200  163ms total · 12 queries · 148ms in SQL
├─ SELECT order_items 3.86ms · 2 rows
│  select `id`, `sku` from `order_items` where `order_id` = 11
├─ SELECT customers, orders ⤷subquery×3 (depth 3) 1.50ms · 2 rows
├─ TRANSACTION [conn 101] committed 10.2ms
│  ├─ INSERT orders 1.39ms · 1 affected
│  ├─ SAVEPOINT sp1 [conn 101] rolled-back 4.30ms
│  │  └─ SELECT 0.18ms ✖ You have an error in your SQL syntax …
│  └─ SELECT orders 1.33ms · 2 rows
⚠ N+1 suspected: 4×, 8.4ms total — select `id`, `sku` from `order_items` where `order_id` = ?
```

<p align="center"><sub>Example output. The <a href="https://github.com/githubthinnd/backend-dev-inspector/tree/main/playground">playground</a> has runnable demo apps (they use SQLite, so they need no database).</sub></p>

## Contents

- [Features](#features)
- [Install](#install)
- [Supported technologies](#supported-technologies)
- [Quick start](#quick-start)
- [Viewing the results](#viewing-the-results)
- [Insights](#insights)
- [Configuration](#configuration)
- [API](#api)
- [How it works](#how-it-works)
- [Languages](#languages)
- [Styling and isolation](#styling--isolation)
- [Beyond the tree](#beyond-the-tree)
- [Security and privacy](#security--privacy)
- [Limitations](#limitations)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

## Features

- **Per-request attribution**: every statement is tied to the request that caused it, including concurrent requests and a saturated connection pool (`AsyncLocalStorage`).
- **A nesting tree**: transactions and savepoints with committed / rolled-back / open status; two transactions running in parallel inside one request are kept apart.
- **Warnings that point at the cause**: N+1, duplicates, slow statements, errors, too many statements, `SELECT *`, deep subqueries.
- **Subquery depth** and formatted, syntax-highlighted SQL, with a timeline waterfall per statement.
- **Three views**: terminal tree, live web page, floating in-app panel with keyboard shortcuts. Light, dark and system themes; responsive down to a narrow docked panel.
- **English, Vietnamese and Japanese** in the terminal, the page and the panel; adding a language is one block of text (see [Languages](#languages)).
- **Nothing changes in your code**: it works at the `mysql2` driver level, so every library built on `mysql2` is covered.
- **Finds the line of code** that made each call and opens it in your editor, **advises how to fix** each warning, and has a read-only **MCP server** for coding agents ([Beyond the tree](#beyond-the-tree)).
- **Values hidden by default**: bind parameters are shown as their type and size, and a stricter mode masks the whole statement; N+1 detection still works ([Hiding values](#hiding-values)).
- **Choose what to follow**: include or exclude requests by route, and serve the page from a path of your choosing ([Choosing which requests are traced](#choosing-which-requests-are-traced)).
- **Safe by default**: never active when `NODE_ENV=production`; local only; in memory only.
- **No runtime dependencies** (the `mysql2` you already have is an optional peer). No CDN, no fonts, no analytics.

## Install

```bash
npm install --save-dev sql-dev-inspector
# or: pnpm add -D sql-dev-inspector
# or: yarn add -D sql-dev-inspector
```

Requires **Node.js 22 or newer** and an application that sends SQL through **`mysql2` 3 or newer** (the optional peer dependency; tested with 3.20). It is optional only so that packages built on this one, which may not use MySQL at all, do not pull it in; this package itself needs it to see anything.

## Supported technologies

**How to read the "Verified" column**

| Mark | Meaning |
|---|---|
| ✅ Real client | tested with the real library, against an in-memory server that speaks the real protocol, or in-process |
| 🧪 Faithful fake | tested against a faithful fake of the framework's request and response, not the real framework |
| 🟡 Expected | built on a supported library, not tested on its own |

### Database access

| Library | How it is observed | Verified |
|---|---|---|
| **`mysql2`** (pool, connection, promise API, manual transactions) | patches `Connection#query` / `execute` and `Pool#getConnection` | ✅ real `mysql2` 3 + MySQL protocol mock |
| **Drizzle ORM** (MySQL) | through `mysql2` | ✅ |
| Knex, Sequelize, TypeORM (MySQL) | through `mysql2` | 🟡 |
| MariaDB servers | through `mysql2` | 🟡 |

Not covered here: other MySQL drivers (`mariadb`, `mysql`) and ORMs with their own engine (Prisma). PostgreSQL, SQLite, MongoDB, Redis and HTTP are covered by [`backend-dev-inspector`](https://www.npmjs.com/package/backend-dev-inspector).

### Frameworks

| Framework | Hookup | Verified |
|---|---|---|
| **Nuxt 3** | module `sql-dev-inspector/nuxt` (also the floating button) | ✅ Nuxt 3 dev server (in the playground, with `backend-dev-inspector`) |
| Nuxt 4 | the same module | 🟡 |
| **Nitro** (without Nuxt) | plugin `sql-dev-inspector/nitro` | ✅ plugin tests |
| **Express 5 / Connect** | `createSqlInspector().middleware` | ✅ real Express app in the playground; 🧪 unit tests with a fake `req` / `res` |
| Any Node `http` server, jobs, scripts | `handle` / `track` / `task` | ✅ |
| Hono, SvelteKit, Next.js route handlers, Bun, Deno | `createWebInspector()` (web-standard `Request` / `Response`) | ✅ web adapter tests; for ready-made adapters use `backend-dev-inspector` |

Not supported: Nuxt 2 (end of life) and runtimes without `AsyncLocalStorage`.

## Quick start

The inspector turns on when `NODE_ENV=development` (or `SQL_INSPECTOR=1`). Most dev servers (`nuxt dev`, `next dev`, `vite`) set `NODE_ENV` for you; for a plain Node script run `NODE_ENV=development node server.js`.

### Nuxt 3 / 4

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ["sql-dev-inspector/nuxt"]
})
```

That's it. The module registers itself in `nuxt dev` only (nothing is added to `build` / `generate`): a Nitro plugin on the server and a floating **SQL** button in the app. Open `http://localhost:3000/__sql-inspector/` or click the button. If you set `app.baseURL`, prefix the path with it.

### Nitro (without Nuxt)

```ts
// nitro.config.ts
export default defineNitroConfig({
  plugins: ["sql-dev-inspector/nitro"]
})
```

### Express / Connect

```ts
import express from "express"
import { createSqlInspector } from "sql-dev-inspector"

const app = express()
const sqlInspector = createSqlInspector()

app.use(sqlInspector.middleware) // mount BEFORE any route that runs SQL

app.get("/orders/:id", async (req, res) => {
  const [rows] = await pool.query("select * from orders where id = ?", [req.params.id])
  res.json(rows)
})

app.listen(3000)
// open http://localhost:3000/__sql-inspector/
```

### Plain Node `http` (or any other framework)

```ts
import http from "node:http"
import { createSqlInspector } from "sql-dev-inspector"

const sqlInspector = createSqlInspector()

http.createServer((req, res) => {
  if (sqlInspector.handle(req, res)) return           // serves the inspector's own pages
  sqlInspector.track(req, res, () => myApp(req, res)) // everything awaited inside belongs to this request
}).listen(3000)
```

### Jobs, cron, scripts (not HTTP requests)

```ts
await sqlInspector.task("nightly-sync", async () => {
  await syncCustomers()
})
// shows up in the list as a TASK named "nightly-sync"
```

### Floating button in a non-Nuxt frontend

In your browser entry point (same origin as the server):

```ts
if (import.meta.env.DEV) {
  const { mountSqlInspectorWidget } = await import("sql-dev-inspector/client")
  mountSqlInspectorWidget({ baseURL: "/" }) // baseURL = path prefix of your server
}
```

If your frontend runs on a different origin than the API (e.g. Vite on :5173, API on :3000), open `http://localhost:3000/__sql-inspector/` directly, or proxy `/__sql-inspector` through the frontend dev server.

## Viewing the results

1. **Terminal** — each request that ran SQL prints a tree when its response finishes. Silence with `SQL_INSPECTOR_LOG=0`.
2. **Web page** `/__sql-inspector/` — live list of requests with search and *All / Issues / Errors* filters; click one for KPIs (total time, queries, SQL time and its share, transactions, subquery depth), insights, and a timeline of statements with a waterfall bar each. Click a statement for highlighted + formatted SQL, raw SQL, parameters and a copy button; click an insight to highlight the statements it is about; collapse a transaction. *Follow latest* jumps to each new request. Keyboard: `/` search, `↑` `↓` (or `j` `k`) previous / next request, `e` expand / collapse all. Language and theme (system / light / dark) are in the top bar.
3. **Floating button** — the number on it is the query count of the latest request (amber with warnings, red with errors).

| Action | How |
|---|---|
| Open / close the panel | Click the button, or `Alt+Shift+S`; `Esc` closes it while focus is inside |
| Hide / show the button | `Alt+Shift+D` (the panel shortcut keeps working while hidden) |
| Move the button | Drag it |
| Resize the panel | Drag its edge |
| Dock bottom / right | the two dock icons in the panel header |
| Auto-open on warnings or errors | Settings menu (off by default) |
| Slow-query threshold | Settings menu, or the box in the inspector page's top bar: a number of ms (1 to 600000), empty for the default. Applies to every viewer and the terminal, and is re-applied after a server restart |
| Open in a new tab · clear history | the ↗ icon in the header · "Clear history" in the settings menu |
| Turn it off completely | Settings menu → disable (`Alt+Shift+S` brings it back) |

Settings (including language) are stored in `localStorage`. The panel loads only the first time it is opened.

## Insights

| Insight | Triggered by | Level |
|---|---|---|
| N+1 | ≥ 3 SELECTs with the same shape (different values) in one request | warn |
| Duplicate | the exact same statement ≥ 2 times | warn |
| Slow | ≥ 100 ms (`SQL_INSPECTOR_SLOW_MS`) | warn |
| SQL error | the statement was rejected | error |
| Many queries | ≥ 30 statements in one request | warn |
| `SELECT *` · deep subquery (≥ 3 levels) | | info |
| Transaction convention *(opt-in via `SQL_INSPECTOR_TX_CONVENTION=1`)* | reads inside a transaction; several writes outside one | info |


## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `NODE_ENV` | — | `production` ⇒ **always off** (even with `SQL_INSPECTOR=1`); `development` ⇒ on |
| `SQL_INSPECTOR` | — | `1` forces on outside production (e.g. `test`); `0` forces off |
| `SQL_INSPECTOR_LANG` | `en` | Language of terminal output (`en`, `vi`, `ja`) and the web page's starting language. Only this variable counts — your machine's `LANG` is deliberately ignored |
| `SQL_INSPECTOR_LOG` | on | `0` disables the terminal output |
| `SQL_INSPECTOR_SLOW_MS` | `100` | slow-query threshold (the floating panel's settings menu can override it while the app runs) |
| `SQL_INSPECTOR_MAX_REQUESTS` | `200` | requests kept in memory |
| `SQL_INSPECTOR_TTL_MINUTES` | `60` | drop requests with no new query for this many minutes (`0` = keep until the request cap pushes them out) |
| `SQL_INSPECTOR_ALLOWED_HOSTS` | — | extra host names allowed to open the inspector, comma separated (`myapp.test,*.dev.example.com`; `*` allows any). `localhost`, `*.localhost` and IP addresses are always allowed |
| `SQL_INSPECTOR_NOTICE` | on | `0` hides the one-line tip about `backend-dev-inspector` printed once at startup |
| `SQL_INSPECTOR_DRIVERS` | all | comma separated driver names to keep (`mysql2`); `all` or empty keeps every driver that is installed. Mostly useful with packages built on this one |
| `SQL_INSPECTOR_MAX_QUERIES` | `1000` | statements kept per request |
| `SQL_INSPECTOR_TX_CONVENTION` | off | `1` enables the transaction-convention insights |
| `SQL_INSPECTOR_REDACT` | `params` | What is kept of values: `params` (bind parameters become their type and size), `all` (the statement is shown with every value masked), `off` (everything as sent) |
| `SQL_INSPECTOR_INCLUDE` | — | Comma-separated route patterns: only matching requests are traced (`/api/**`) |
| `SQL_INSPECTOR_EXCLUDE` | — | Comma-separated route patterns that are never traced (`/health,/assets/**`) |
| `SQL_INSPECTOR_STACK` | on | `0` stops looking for the line of code that made each call |
| `SQL_INSPECTOR_EDITOR` | `vscode` | The editor that location links open: `vscode`, `cursor`, `windsurf`, `zed`, `idea`, `webstorm`, `none`, or a link template |
| `SQL_INSPECTOR_LOGS` | off | `1` lists what the application prints under its request |
| `SQL_INSPECTOR_PATH` | `__sql-inspector` | Where the page is served: `_dev/sql` serves it at `/_dev/sql/` |
| `NO_COLOR` | — | disables terminal colors |

### Hiding values

You can also change it while the app runs: the **gear** in the page's top bar opens the settings (hide values, routes to include or exclude, the page's address), the pill next to it always says whether values are hidden, and the floating panel's settings menu has the same "Hide values" switch. Changes apply to calls recorded from then on and are lost when the server restarts, which then starts from the environment again.

<p align="center">
  <img alt="The inspector page with its settings open: hide values, the routes to follow, the page address" src="https://raw.githubusercontent.com/githubthinnd/backend-dev-inspector/main/docs/media/inspector-settings.jpg" width="640">
</p>

The statements often carry personal data. By default the inspector keeps **the shape of a call, not its values**:

| `SQL_INSPECTOR_REDACT` | Bind parameters | The statement |
|---|---|---|
| `params` (default) | shown as type and size: `<string:12>`, `<number>`, `<null>` | as written; `query(sql, values)` is shown as the template, with its `?` (mysql2 puts the values into the text before sending it) |
| `all` | as above | shown with every value masked (`where email = ?`), the way the N+1 detector sees it |
| `off` | as sent | as sent |

N+1 and duplicate detection keep working: the inspector compares the calls as they really were, in memory, and never shows or sends the values. In `params` mode a value **you typed into the SQL** is still visible (use `all`), and a database error message can quote a value (`Duplicate entry 'a@b.c'`).

### Choosing which requests are traced

```bash
SQL_INSPECTOR_INCLUDE="/api/**" SQL_INSPECTOR_EXCLUDE="/api/webhooks/**,/health" npm run dev
```

A pattern is a path: `/api/orders` (exactly that), `/api/*` (one segment), `/api/**` (that path and everything under it), `/*-webhook` (`*` inside a segment matches any characters). The query string is ignored. When `INCLUDE` is set only matching requests are traced; `EXCLUDE` then removes from those. A request that is left out is dropped entirely (its statements are not listed under "(outside request)" either); `task()` is never filtered. The same settings are options: `createSqlInspector({ include: ["/api/**"], exclude: ["/health"] })`.

### Moving the page

`SQL_INSPECTOR_PATH=_dev/sql` (or `createSqlInspector({ path: "/_dev/sql" })`) serves the page, its API and its event stream under `/_dev/sql/` instead of `/__sql-inspector/`, under your base path as before. The floating panel follows: `mountSqlInspectorWidget({ baseURL, path })`; the Nuxt module does it for you.

### Nuxt module options

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: [["sql-dev-inspector/nuxt", {
    redact: "params",                 // "params" | "all" | "off"
    include: ["/api/**"],
    exclude: ["/api/health"],
    path: "/_dev/sql"
  }]]
  // or, equivalently, a top-level `sqlInspector: { ... }` key
})
```

The module applies them in `nuxt dev` only, and passes them to the Nitro server.

## API

```ts
createSqlInspector(options?: StartOptions): SqlInspector

// StartOptions: { drivers?, brand?, redact?: "params" | "all" | "off", include?: string[], exclude?: string[], path?: string }

interface SqlInspector {
  enabled: boolean                       // false in production / when switched off: everything below is a no-op
  middleware(req, res, next): void       // Connect / Express
  handle(req, res): boolean              // true if the URL belongs to the inspector (already served)
  track<T>(req, res, fn: () => T): T     // run fn as one tracked request
  task<T>(name: string, fn: () => T | Promise<T>): Promise<T> // a unit of work that is not HTTP
}
```

Lower level, for custom integrations: `startInspector`, `getInspector`, `isInspectorEnabled`, `installTracer`, `runInRequest`, `TraceStore`, `buildReport`, `buildTree`, `analyzeSql`, `fingerprintOf`, `formatSql`, plus all types.

Web-standard `Request` / `Response` frameworks (Hono, SvelteKit, Next.js route handlers, Bun, Deno) use `createWebInspector()`:

```ts
const web = createWebInspector()                         // WebInspector: { enabled, handle, track }
const served = await web.handle(request)                 // Response for /__sql-inspector/*, else null
const response = served ?? await web.track(request, () => handler(request))
```

### Drivers and dialects (for packages built on this one)

mysql2 is just the first *driver*. A driver is a `DriverAdapter` (`{ name, install(recorder, context) }`): it patches a library, or subscribes to what the library publishes, and reports each call through the `Recorder` (`recorder.begin({ driver, api, text, params, connectionId, analysis })`, then `handle.end({ error, rowCount, affectedRows })`). Everything after that — request tree, N+1 / repeat / slow detection, terminal output, web UI — is shared. SQL is analysed per dialect: `analyzeSql(sql, "mysql" | "postgres" | "sqlite")`. A call that is not SQL (a Mongo command, a Redis command, an HTTP request) is described as the statement it resembles with `describeOperation({ kind, label, targets, text })`.

`startInspector(env, { drivers, brand })` installs the drivers it is given (mysql2 by default) once each, and a driver that fails to install never stops the application from starting. [`backend-dev-inspector`](https://www.npmjs.com/package/backend-dev-inspector) is built this way.

| Import | For |
|---|---|
| `sql-dev-inspector` | main API above |
| `sql-dev-inspector/nuxt` | Nuxt module |
| `sql-dev-inspector/nitro` | Nitro plugin |
| `sql-dev-inspector/client` | `mountSqlInspectorWidget({ baseURL })` — floating button for any frontend |

HTTP routes, all under `/__sql-inspector/`: `GET /` (page), `GET /api/requests`, `GET /api/requests/:id`, `GET /api/stream` (SSE), `GET` / `POST /api/settings` (slow-query threshold, JSON body `{"slowMs": 250}` or `{"slowMs": null}` to reset), `POST /api/clear`.

## How it works

Every statement — from `pool.query`, a transaction or an ORM — goes through `Connection.prototype.query/execute` in `mysql2`. The inspector patches exactly that point (once, reversibly) to record the SQL, parameters, duration, row count, error and **which connection ran it**. The connection is what lets it rebuild transaction and savepoint nesting, which neither an ORM logger nor mysql2's `diagnostics_channel` can do. Each adapter wraps your request handler in an `AsyncLocalStorage` scope; the pool's `getConnection` callback is bound to the caller's context so statements queued behind a busy pool are not attributed to the wrong request.

## Languages

English, Tiếng Việt (`vi`) and 日本語 (`ja`) are built in.

- **Web page**: first the saved choice, then `SQL_INSPECTOR_LANG` if set, then the browser language, then English. Change it any time from the top bar; `?lang=ja` in the URL overrides for that visit.
- **Floating button**: follows the browser language, or pick one in its settings menu (the panel reloads in that language).
- **Terminal and API `message` fields**: `SQL_INSPECTOR_LANG`, default English.

Insights are returned as data (`type` + `params`) next to the ready-made `message`, so any client can phrase them itself.

**Adding a language**: copy the `en` block in `src/i18n/messages.ts`, translate the values (keep every `{placeholder}`; add a `.one` variant where the singular differs, e.g. `"term.queries.one"`), add the code to the `Locale` type and to `LOCALES` in `src/i18n/index.ts`. `npm test` fails if a key or placeholder is missing. Pull requests welcome.

## Styling & isolation

The tool must never make your app look worse, so:

- **Floating button and panel** live in a **shadow root**, reset with `all: initial`, use a custom-element host (not a `<div>`) and zero-specificity resets. Your global CSS (`button { … }`, `* { … }`, `select`, `body > *`) cannot restyle them, and they add no CSS to your page. They are `position: fixed`, never shift your layout, and don't steal focus.
- **Inspector page** is its own document (inside an `<iframe>` when docked), so it cannot touch your page either. Every native control (buttons, switch, scrollbars) is restyled, and the language picker is a custom listbox — a native `<select>` popup is drawn by the OS and cannot be styled, so none is used anywhere (a test enforces it), with `color-scheme` declared so nothing falls back to a browser-default look in dark mode.
- **No external requests**: no web fonts, no CDN, no analytics — system font stacks only (Latin, Japanese and Vietnamese included).
- Respects `prefers-color-scheme`, `prefers-reduced-motion`, and keyboard focus (`:focus-visible`).
- If your app sets a strict Content-Security-Policy, the floating button needs `style-src 'unsafe-inline'` (it injects one `<style>` into its shadow root) and `frame-src 'self'`. This is a dev-only tool; relax the policy for development only.

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

From the terminal, `npx backend-dev-inspector doctor` (from [`backend-dev-inspector`](https://www.npmjs.com/package/backend-dev-inspector)) runs the same check and also finds duplicate copies of your libraries. It says whether it is on, which drivers are watching, whether a library the inspector cannot load is in your project, **whether two copies of one library are loaded** (the usual silent failure: the inspector patches one, your code calls the other), and, in the page, whether calls reach requests.

### Query budgets in tests

[`backend-dev-inspector/testing`](https://www.npmjs.com/package/backend-dev-inspector#query-budgets-in-tests) has `capture()` and matchers (`toHaveNoNPlusOne`, `toHaveMaxQueries`…) that fail a test when code adds an N+1; they work with this package's `mysql2` support too.

### Use it from an AI agent

The inspector serves a read-only [Model Context Protocol](https://modelcontextprotocol.io) endpoint at `/__sql-inspector/mcp`, so a coding agent can ask the running application what it did:

```bash
claude mcp add --transport http dev-inspector http://localhost:3000/__sql-inspector/mcp
```

For Cursor and other clients, add `{ "mcpServers": { "dev-inspector": { "url": "http://localhost:3000/__sql-inspector/mcp" } } }` to their `mcp.json`. Six tools, none of which can change anything: `find_problems`, `list_requests`, `get_request`, `compare_requests`, `get_settings`, `diagnose`. Values are redacted as you configured, and the same guards as the page apply (local `Host` only). [`skills/dev-inspector`](https://github.com/githubthinnd/backend-dev-inspector/tree/main/skills/dev-inspector) is an agent skill that teaches the workflow: find the problem, read the line it came from, fix it, call the endpoint again and compare.

## Security & privacy

- `NODE_ENV=production` is a hard stop: nothing is patched and the middleware only calls `next()`.
- The Nuxt module registers only in `nuxt dev`; `build` / `generate` contain nothing of this tool.
- Data lives in the memory of the dev process only: no files written, no network calls.
- ⚠️ **Displayed SQL contains real values**, possibly personal data from the database you point at. Don't share your screen or screenshots while connected to staging or production-like data.
- `/__sql-inspector/` has **no authentication** — it is meant for `localhost`. Don't expose your dev server to a shared network (e.g. `--host 0.0.0.0`) while it is on.
- It refuses any request whose `Host` is not `localhost`, `*.localhost` or an IP address (this stops DNS-rebinding pages from reading your SQL), answering `403` with the variable to set. If you open your dev server by another name (`myapp.test`, a tunnel), list it in `SQL_INSPECTOR_ALLOWED_HOSTS`.
- State-changing calls (clear history, set the threshold) refuse requests a browser marks as cross-site.

### Dependencies and supply chain

- **No runtime dependencies.** `package.json` has no `dependencies`: the only requirement is the `mysql2` your application already has, declared as an optional peer dependency. Scanners that resolve peers (Socket lists "1 dependency: mysql2") attribute the alerts of `mysql2` and its own dependencies to this package; they are not code shipped here.
- **No install scripts**, no network calls, no child processes, no `eval` / `new Function` / `new RegExp(string)`. Tests fail if any of that appears in `src/`.
- **Environment variables:** the package reads only the ones in [`src/env.ts`](https://github.com/githubthinnd/backend-dev-inspector/blob/main/packages/sql-dev-inspector/src/env.ts) (`NODE_ENV`, `NO_COLOR` and `SQL_INSPECTOR_*`), through an allow-list, never the whole environment. Scanners still flag "environment variable access" because the tool is configured that way, and `NODE_ENV=production` is its safety switch.
- **Reflection:** the tracer wraps `Connection.prototype.query` / `execute` and `Pool.prototype.getConnection` of `mysql2` (that is how it sees every statement) and keeps request context with `AsyncLocalStorage`. It restores the originals when uninstalled.
- **Provenance:** releases are built and published by GitHub Actions with npm provenance, using npm trusted publishing (no long-lived token). Check an install with `npm audit signatures`. The publishing job installs with `npm ci --ignore-scripts`, so no dependency script runs where the publish credentials exist.
- CI runs `npm audit` and `npm audit signatures` weekly and on every push; Dependabot proposes dependency and Actions updates. Report a vulnerability as described in [SECURITY.md](https://github.com/githubthinnd/backend-dev-inspector/blob/main/SECURITY.md).

## Limitations

- **MySQL via `mysql2` only.** Not PostgreSQL, SQLite, or other MySQL drivers (e.g. `mariadb`). ORMs that don't use `mysql2` underneath (e.g. Prisma's own engine) bypass the patched point.
- **Tested with**: plain `mysql2` (pool, connection, manual transactions) and Drizzle ORM. Knex / Sequelize / TypeORM use `mysql2` and should work, but have no dedicated tests — please open an issue if they don't.
- The Express/Connect adapter is tested with a faithful fake `req` / `res` and with a real Express 5 app in the playground; the floating button outside Nuxt is tested in happy-dom only, and in a real browser only on Nuxt.
- **No "caller" line**: ORMs like Drizzle return lazy thenables, so by the time the query runs the call stack no longer contains your code.
- A lazy builder created inside a request scope but awaited outside it is not attributed to that request.
- Statements outside any request or task are grouped under one "(outside request)" entry.
- Requests that run no SQL (assets, HMR) are not kept.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Nothing shows up | `NODE_ENV` isn't `development`; run with `NODE_ENV=development` or `SQL_INSPECTOR=1` (and never `production`) |
| Terminal output but `/__sql-inspector/` is 404 | Express: mount the middleware before your router. Nuxt/Nitro: check `app.baseURL` |
| All queries under "(outside request)" | middleware mounted after the route that ran SQL, or SQL ran outside an awaited handler (timers, queues) — wrap it in `sqlInspector.task()` |
| Floating button missing | Non-Nuxt: you haven't called `mountSqlInspectorWidget`. Nuxt: it exists in `nuxt dev` only. Try `Alt+Shift+D`, or clear the `sqlDevInspector.widget` key in `localStorage` |
| An ORM's queries are missing | It doesn't use `mysql2` underneath |
| Statements show `<number>` / `<string:5>` instead of values | That is `SQL_INSPECTOR_REDACT` at its default; set it to `off` to see values |
| Requests I excluded still appear | The pattern must match the path (`/api/**` matches `/api` and below); the query string is ignored |
| Two copies of `mysql2` in `node_modules` | The inspector patches the copy it can import; make sure app and inspector share one (hoisted peer) |

## Development

```bash
npm install
npm run typecheck
npm test            # 440 tests: real mysql2 + Drizzle against an in-memory MySQL protocol server
npm run build
```

Tests need no MySQL installation and open no ports: `test/mock-mysql-server.ts` speaks the real wire protocol over in-memory streams.

This package lives in the `packages/sql-dev-inspector` folder of the [monorepo](https://github.com/githubthinnd/backend-dev-inspector); run the commands above from the repository root (they cover both packages) or with `-w sql-dev-inspector`.

## License

MIT — see [LICENSE](LICENSE).
