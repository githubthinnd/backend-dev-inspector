import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

export interface NuxtLike {
  options: {
    dev: boolean
    nitro: { plugins?: string[] }
    plugins: (string | { src: string, mode?: string })[]
  }
}

/** The compiled `.js` when installed from npm, the `.ts` source when used from a checkout. */
function resolveSibling(path: string): string {
  const js = fileURLToPath(new URL(`${path}.js`, import.meta.url))
  return existsSync(js) ? js : fileURLToPath(new URL(`${path}.ts`, import.meta.url))
}

/**
 * Nuxt module. In `nuxt dev` only, registers the SQL Inspector Nitro plugin (server) and the
 * floating launcher (client), so `nuxt build` and `nuxt generate` never see them and nothing
 * ships to a deployed environment. Written as a plain function (no `@nuxt/kit`), so it adds no
 * dependency: `modules: ["<package>/nuxt"]`.
 */
export function createNuxtModule(options: { nitroPlugin?: string } = {}) {
  return function sqlInspectorModule(_options: unknown, nuxt: NuxtLike) {
    if (!nuxt.options.dev) {
      return
    }
    nuxt.options.nitro.plugins ||= []
    nuxt.options.nitro.plugins.push(options.nitroPlugin ?? resolveSibling("./nitro-plugin"))
    nuxt.options.plugins.push({ src: resolveSibling("./client/nuxt-plugin.client"), mode: "client" })
  }
}

export default createNuxtModule()
