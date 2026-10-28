import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createNuxtModule } from "sql-dev-inspector/nuxt"

/** The compiled `.js` when installed from npm, the `.ts` source when used from a checkout. */
function resolveSibling(path: string): string {
  const js = fileURLToPath(new URL(`${path}.js`, import.meta.url))
  return existsSync(js) ? js : fileURLToPath(new URL(`${path}.ts`, import.meta.url))
}

/**
 * Nuxt module: `modules: ["backend-dev-inspector/nuxt"]`. In `nuxt dev` only, it registers this
 * package's Nitro plugin (every driver) and sql-dev-inspector's floating launcher.
 */
export default createNuxtModule({ nitroPlugin: resolveSibling("./nitro") })
