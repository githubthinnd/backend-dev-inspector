import type { DriverAdapter } from "sql-dev-inspector"
import { mysql2Driver } from "sql-dev-inspector"
import { httpDriver, fetchDriver } from "./http.js"
import { mariadbDriver } from "./mariadb.js"
import { mongodbDriver } from "./mongodb.js"
import { pgDriver } from "./pg.js"
import { prismaDriver } from "./prisma.js"
import { ioredisDriver, nodeRedisDriver } from "./redis.js"
import { betterSqlite3Driver, nodeSqliteDriver } from "./sqlite.js"

export { fetchDriver, httpDriver, safeUrl } from "./http.js"
export { instrumentMariadb, type MariadbModule, mariadbDriver } from "./mariadb.js"
export { mongodbDriver } from "./mongodb.js"
export { pgDriver } from "./pg.js"
export { prismaDriver, prismaExtension } from "./prisma.js"
export { ioredisDriver, nodeRedisDriver } from "./redis.js"
export { betterSqlite3Driver, nodeSqliteDriver } from "./sqlite.js"
export { mysql2Driver }

/**
 * Every driver that is on by default. Each one does nothing when its library is not installed in
 * the application. `SQL_INSPECTOR_DRIVERS=pg,redis` narrows the list.
 */
export const allDrivers: DriverAdapter[] = [
  mysql2Driver,
  pgDriver,
  betterSqlite3Driver,
  mongodbDriver,
  ioredisDriver,
  nodeRedisDriver,
  httpDriver,
  fetchDriver,
  mariadbDriver,
  prismaDriver
]

/** Drivers that must be asked for by name, because merely loading their library has a visible side effect. */
export const optInDrivers: DriverAdapter[] = [nodeSqliteDriver]
