import type { Brand, StartOptions } from "sql-dev-inspector"
import { markSiblingLoaded, parseDriverList, pickEnv } from "sql-dev-inspector"
import { allDrivers, optInDrivers } from "./drivers/index.js"

export const BRAND: Brand = { title: "Backend Inspector", short: "DEV" }

/**
 * What every entry point of this package starts the inspector with: all drivers (plus the opt-in
 * ones named in `SQL_INSPECTOR_DRIVERS`), and this package's name on the UI. Calling it also tells
 * sql-dev-inspector that this package is in use, so it stops suggesting it.
 */
export function withDefaults(options: StartOptions = {}, env = pickEnv()): StartOptions {
  markSiblingLoaded()
  const base = options.drivers ?? allDrivers
  const wanted = parseDriverList(env.SQL_INSPECTOR_DRIVERS)
  const extra = optInDrivers.filter(driver => wanted.includes(driver.name) && !base.some(known => known.name === driver.name))
  return { drivers: [...base, ...extra], brand: options.brand ?? BRAND }
}
