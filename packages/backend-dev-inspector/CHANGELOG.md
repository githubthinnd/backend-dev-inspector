# Changelog

## [1.0.0] - 2026-10-28

First release. It builds on [`sql-dev-inspector`](https://www.npmjs.com/package/sql-dev-inspector) 1.2 and exports everything it does.

### Added

- Drivers: PostgreSQL (`pg`), SQLite (`better-sqlite3`, and `node:sqlite` on request), MongoDB (`mongodb`, Mongoose), Redis (`ioredis` 5 and 6, `redis` 6), outbound HTTP (`node:http`, `node:https`, `fetch`, `undici`), the `mariadb` connector (`instrumentMariadb`) and Prisma (`prismaExtension`).
- Adapters: Express / Connect / Node `http` (as in `sql-dev-inspector`), Nuxt and Nitro, Fastify, Koa, Hono, Next.js (App Router), SvelteKit, Astro, Vite and `wrapFetch` for any `(request) => Response` handler.
- `SQL_INSPECTOR_DRIVERS` to choose the drivers; `node:sqlite` only when named there.
- Calls to services that are not SQL are judged by the same rules: N+1, repeated and slow calls.
