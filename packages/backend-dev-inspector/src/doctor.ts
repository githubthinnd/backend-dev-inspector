import type { Check } from "sql-dev-inspector"
import { locate, type Location } from "./peer.js"

/** The libraries the drivers watch, by the name the application imports. */
export const WATCHED_LIBRARIES = ["pg", "postgres", "mysql2", "mariadb", "better-sqlite3", "@libsql/client", "mongodb", "ioredis", "redis"]

/**
 * What the inspector can say about the libraries in the application. The usual silent failure is two copies of one
 * library (the application's, and one the inspector resolves): the inspector patches the second, the application calls
 * the first, and nothing is ever recorded.
 */
export function libraryChecks(find: (name: string) => Location = locate): Check[] {
  const found: string[] = []
  const checks: Check[] = []
  for (const name of WATCHED_LIBRARIES) {
    const { fromApp, fromPackage } = find(name)
    if (!fromApp && !fromPackage) {
      continue
    }
    if (fromApp && !fromPackage) {
      checks.push({ id: `library:${name}`, status: "error", message: `${name} is installed in your project but the inspector cannot load it, so its calls are not recorded (a strict node_modules layout such as pnpm's: declare ${name} so it is linked next to backend-dev-inspector).` })
    } else if (fromApp && fromPackage && fromApp !== fromPackage) {
      checks.push({ id: `library:${name}`, status: "warn", message: `Two copies of ${name}: yours at ${fromApp}, the inspector's at ${fromPackage}. The inspector watches the second, so calls made through yours may not be recorded. Make them one (dedupe, or hoist ${name} to the root).` })
    } else {
      found.push(name)
    }
  }
  if (found.length > 0) {
    checks.unshift({ id: "libraries", status: "ok", message: `Found: ${found.join(", ")}.` })
  }
  return checks
}
