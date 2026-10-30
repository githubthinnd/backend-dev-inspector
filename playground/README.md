# Playground

Runnable example apps for [`backend-dev-inspector`](../packages/backend-dev-inspector) (and the core, [`sql-dev-inspector`](../packages/sql-dev-inspector)): one small app per framework and data layer, all serving the **same six scenarios**, so you can see what the inspector shows for each stack, try a change to the packages, or copy a setup into your own project.

No database server is needed: the data is a seeded SQLite database (in memory, or a file for Prisma) and the "outside service" is a tiny fake HTTP server started by the apps.

## Apps

| App | Framework | Data layer | Inspector hookup |
|---|---|---|---|
| [`express-sqlite`](apps/express-sqlite) | Express 5 | `better-sqlite3`, hand-written SQL | `createInspector().middleware` |
| [`express-drizzle`](apps/express-drizzle) | Express 5 | Drizzle ORM | `createInspector().middleware` |
| [`fastify-sqlite`](apps/fastify-sqlite) | Fastify 5 | `better-sqlite3` | `backend-dev-inspector/fastify` |
| [`koa-sqlite`](apps/koa-sqlite) | Koa 3 | `better-sqlite3` | `backend-dev-inspector/koa` |
| [`hono-sqlite`](apps/hono-sqlite) | Hono | `better-sqlite3` | `backend-dev-inspector/hono` |
| [`nuxt3-drizzle`](apps/nuxt3-drizzle) | Nuxt 3 | Drizzle ORM | module `backend-dev-inspector/nuxt` |
| [`nuxt3-prisma`](apps/nuxt3-prisma) | Nuxt 3 | Prisma 7 (libSQL adapter) | module `backend-dev-inspector/nuxt` + `prismaExtension()` |

Not here: Nuxt 2 (the packages support Nuxt 3 and 4), Next.js, SvelteKit, Astro and the databases that need a server (PostgreSQL, MySQL, MongoDB, Redis). Their adapters are covered by the packages' own tests; an app for one of them follows the pattern below.

## Run one

From the repository root:

```bash
npm run playground:install      # builds both packages, then installs the playground
npm run dev:express-sqlite --prefix playground
```

Open the address it prints, click a scenario, then open `/__sql-inspector/` (Nuxt apps also get the floating **SQL** button). Replace `express-sqlite` by any app above; `npm run dev:nuxt3-prisma` needs `npm run generate --prefix playground` first (it generates the Prisma client).

The apps use the packages **from this checkout** (linked, not downloaded from npm). After you change a package, run `npm run build` in the repository root; the apps pick up the new build on restart.

## The scenarios

Every app serves the same routes; the table says what the inspector should show.

| Route | What it does | What you should see |
|---|---|---|
| `/api/orders` | one joined query | one statement, no warning |
| `/api/orders/n-plus-one` | the orders, then each order's customer | an **N+1** warning (11 statements) |
| `/api/orders/slow` | a heavy aggregate (a few hundred ms) | a **slow query** warning |
| `/api/orders/error` | an item for an order that does not exist | an **error** insight (foreign key) |
| `/api/orders/transaction` | an order and its items in a transaction, with a savepoint that rolls back | a transaction node that commits, with a rolled-back savepoint (Prisma has no savepoints: the failing item is caught inside the transaction) |
| `/api/orders/external` | three calls to the fake customer service | an **N+1 over HTTP** |

The scenarios live in [`shared/src/scenarios.ts`](shared/src/scenarios.ts); each data layer implements the small `Repository` interface (`shared/src/sqlite.ts`, `shared/src/drizzle.ts`, `apps/nuxt3-prisma/server/utils/prisma-repository.ts`).

## Tests

```bash
npm test --prefix playground          # or: npm run playground:test
```

[`tests/scenarios.test.ts`](tests/scenarios.test.ts) boots each app **without opening a port** and checks that the inspector reports the expected insights for every scenario. The outbound-HTTP scenario is not part of it, because it needs the fake service on a port. The Prisma check is skipped until the client is generated.

CI runs this as its own job (`playground` in `.github/workflows/ci.yml`). The playground is a separate npm project with its own lockfile: its dependencies (Nuxt, Prisma…) never reach the packages, the root install or the publish workflow.

## Add an app

1. Copy the closest app in `apps/`, rename it, and wire the inspector the way the package README shows for that framework.
2. Serve `scenarios` from `@playground/shared` and answer with `runScenario(scenario, repo, context)`; add a `Repository` for a new data layer.
3. Add the app to `tests/stacks.ts` (a `boot()` that returns a `get(path)` function) and to the table above.

## Troubleshooting

- **The inspector page is empty.** The packages are linked from `../packages/*/dist`: run `npm run build` in the repository root. The inspector only runs outside production (the apps set `NODE_ENV=development` themselves).
- **`better-sqlite3` cannot be loaded.** It is a native module, built by the repository's own install: run `npm rebuild better-sqlite3` in the repository root. The playground deliberately has no copy of its own: the packages and the apps must share one, or the inspector would watch a different copy than the one the app uses.
- **`EADDRINUSE` on port 4010.** Another app already serves the fake customer service; that is fine, they share it. Port 3000 busy: set `PORT=3001`.
