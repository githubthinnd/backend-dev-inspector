# Changelog

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
