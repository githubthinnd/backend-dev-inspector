# sql-dev-inspector

**See exactly which SQL your backend ran for each request — in development only.**

When a client calls your API, `sql-dev-inspector` shows every statement your server sent to MySQL: in what order, inside which transaction or savepoint, how deeply subqueries nest, how long each one took and how many rows it returned. It also flags N+1 loops, repeated queries, slow queries and SQL errors.

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

## Features

- **Per-request attribution** — every statement is tied to the request that caused it (concurrent requests and a saturated connection pool included), using `AsyncLocalStorage`.
- **Nesting tree** — transactions and savepoints, with committed / rolled-back / open status. Two transactions running in parallel inside one request are kept apart.
- **Subquery depth** and pretty-printed SQL.
- **Multilingual**: English, Vietnamese and Japanese — terminal, web page and floating button — and adding a language is one block of text (see [Languages](#languages)).
- **Professional UI**: light / dark / system theme, responsive down to a narrow docked panel, keyboard navigation, syntax-highlighted SQL, timeline waterfall per statement.
- **Three ways to look**: a tree in the terminal, a live web page (`/__sql-inspector/`), and a floating in-app launcher button with keyboard shortcuts.
- **No changes to your queries** — it works at the `mysql2` driver level, so it covers plain `mysql2` and Drizzle ORM (both tested), and in principle anything else built on `mysql2`.
- **Zero runtime dependencies** besides the `mysql2` peer. The web UI is a single self-contained page; nothing is loaded from a CDN.
- **Safe by default** — never active when `NODE_ENV=production`; there it is a complete no-op.

## Requirements

- Node.js **20+**
- `mysql2` **3+** (peer dependency; tested with 3.20)
- Your app must send SQL through `mysql2` (pool, connection, or an ORM that uses it)

## Install

```bash
npm install --save-dev sql-dev-inspector
# or
pnpm add -D sql-dev-inspector
yarn add -D sql-dev-inspector
```

Other ways to install (from GitHub, from a `.tgz` file): see [docs/PUBLISH-AND-INSTALL.md](docs/PUBLISH-AND-INSTALL.md) *(Vietnamese)*.

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
| `SQL_INSPECTOR_SLOW_MS` | `100` | slow-query threshold |
| `SQL_INSPECTOR_MAX_REQUESTS` | `200` | requests kept in memory |
| `SQL_INSPECTOR_TTL_MINUTES` | `60` | drop requests with no new query for this many minutes (`0` = keep until the request cap pushes them out) |
| `SQL_INSPECTOR_MAX_QUERIES` | `1000` | statements kept per request |
| `SQL_INSPECTOR_TX_CONVENTION` | off | `1` enables the transaction-convention insights |
| `NO_COLOR` | — | disables terminal colors |

## API

```ts
createSqlInspector(): SqlInspector

interface SqlInspector {
  enabled: boolean                       // false in production / when switched off: everything below is a no-op
  middleware(req, res, next): void       // Connect / Express
  handle(req, res): boolean              // true if the URL belongs to the inspector (already served)
  track<T>(req, res, fn: () => T): T     // run fn as one tracked request
  task<T>(name: string, fn: () => T | Promise<T>): Promise<T> // a unit of work that is not HTTP
}
```

Lower level, for custom integrations: `startInspector`, `getInspector`, `isInspectorEnabled`, `installTracer`, `runInRequest`, `TraceStore`, `buildReport`, `buildTree`, `analyzeSql`, `fingerprintOf`, `formatSql`, plus all types.

| Import | For |
|---|---|
| `sql-dev-inspector` | main API above |
| `sql-dev-inspector/nuxt` | Nuxt module |
| `sql-dev-inspector/nitro` | Nitro plugin |
| `sql-dev-inspector/client` | `mountSqlInspectorWidget({ baseURL })` — floating button for any frontend |

HTTP routes, all under `/__sql-inspector/`: `GET /` (page), `GET /api/requests`, `GET /api/requests/:id`, `GET /api/stream` (SSE), `POST /api/clear`.

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

## Security & privacy

- `NODE_ENV=production` is a hard stop: nothing is patched and the middleware only calls `next()`.
- The Nuxt module registers only in `nuxt dev`; `build` / `generate` contain nothing of this tool.
- Data lives in the memory of the dev process only: no files written, no network calls.
- ⚠️ **Displayed SQL contains real values**, possibly personal data from the database you point at. Don't share your screen or screenshots while connected to staging or production-like data.
- `/__sql-inspector/` has **no authentication** — it is meant for `localhost`. Don't expose your dev server to a shared network (e.g. `--host 0.0.0.0`) while it is on.

## Limitations

- **MySQL via `mysql2` only.** Not PostgreSQL, SQLite, or other MySQL drivers (e.g. `mariadb`). ORMs that don't use `mysql2` underneath (e.g. Prisma's own engine) bypass the patched point.
- **Tested with**: plain `mysql2` (pool, connection, manual transactions) and Drizzle ORM. Knex / Sequelize / TypeORM use `mysql2` and should work, but have no dedicated tests — please open an issue if they don't.
- The Express/Connect adapter is tested with a faithful fake `req`/`res`, not with `express` itself; the floating button outside Nuxt is tested in happy-dom only.
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
| Two copies of `mysql2` in `node_modules` | The inspector patches the copy it can import; make sure app and inspector share one (hoisted peer) |

## Development

```bash
npm install
npm run typecheck
npm test            # 131 tests: real mysql2 + Drizzle against an in-memory MySQL protocol server
npm run build
```

Tests need no MySQL installation and open no ports: `test/mock-mysql-server.ts` speaks the real wire protocol over in-memory streams.

## License

MIT — see [LICENSE](LICENSE).
