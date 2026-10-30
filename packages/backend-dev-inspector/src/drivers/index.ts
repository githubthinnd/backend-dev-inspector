import type { DriverAdapter } from "sql-dev-inspector"
import { mysql2Driver } from "sql-dev-inspector"
import { awsDriver } from "./aws.js"
import { bullmqDriver } from "./bullmq.js"
import { d1Driver } from "./d1.js"
import { db0Driver } from "./db0.js"
import { elasticsearchDriver } from "./elasticsearch.js"
import { neonDriver } from "./neon.js"
import { httpDriver, fetchDriver } from "./http.js"
import { libsqlDriver } from "./libsql.js"
import { mariadbDriver } from "./mariadb.js"
import { mongodbDriver } from "./mongodb.js"
import { pgDriver } from "./pg.js"
import { postgresJsDriver } from "./postgres-js.js"
import { prismaDriver } from "./prisma.js"
import { ioredisDriver, nodeRedisDriver } from "./redis.js"
import { betterSqlite3Driver, nodeSqliteDriver } from "./sqlite.js"

export { awsDriver, instrumentAws } from "./aws.js"
export { bullmqDriver, instrumentBullmq } from "./bullmq.js"
export { d1Driver, instrumentD1 } from "./d1.js"
export { db0Driver } from "./db0.js"
export { elasticsearchDriver, instrumentElasticsearch } from "./elasticsearch.js"
export { instrumentNeon, neonDriver } from "./neon.js"
export { fetchDriver, httpDriver, safeUrl } from "./http.js"
export { libsqlDriver } from "./libsql.js"
export { instrumentMariadb, type MariadbModule, mariadbDriver } from "./mariadb.js"
export { mongodbDriver } from "./mongodb.js"
export { pgDriver } from "./pg.js"
export { instrumentPostgres, postgresJsDriver } from "./postgres-js.js"
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
  postgresJsDriver,
  betterSqlite3Driver,
  libsqlDriver,
  db0Driver,
  mongodbDriver,
  ioredisDriver,
  nodeRedisDriver,
  httpDriver,
  fetchDriver,
  mariadbDriver,
  prismaDriver,
  awsDriver,
  elasticsearchDriver,
  bullmqDriver,
  neonDriver,
  d1Driver
]

/** Drivers that must be asked for by name, because merely loading their library has a visible side effect. */
export const optInDrivers: DriverAdapter[] = [nodeSqliteDriver]
