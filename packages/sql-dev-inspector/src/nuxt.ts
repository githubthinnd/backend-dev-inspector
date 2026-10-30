import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { applyToEnv } from "./env.js"
import type { RedactMode } from "./redact.js"

/** What the Nuxt module accepts, as `modules: [["sql-dev-inspector/nuxt", { ... }]]` or under a `sqlInspector` key. */
export interface NuxtModuleOptions {
  /** What is kept of values: `params` (default), `all` or `off`. */
  redact?: RedactMode
  /** Only requests matching these paths are traced (`/api/**`). */
  /** Limits per route, as `[METHOD ]/path=calls:10,ms:200,callMs:80`. */
  budgets?: string[]
  include?: string[]
  /** Requests matching these paths are never traced. */
  exclude?: string[]
  /** Where the inspector is served, instead of `/__sql-inspector/`. */
  path?: string
}

export interface NuxtLike {
  options: {
    dev: boolean
    nitro: { plugins?: string[] }
    plugins: (string | { src: string, mode?: string })[]
    runtimeConfig?: { public?: Record<string, unknown> }
    sqlInspector?: NuxtModuleOptions
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
  return function sqlInspectorModule(inline: NuxtModuleOptions | undefined, nuxt: NuxtLike) {
    if (!nuxt.options.dev) {
      return
    }
    // The Nitro plugin starts in the Nitro worker, which begins with a copy of this process's environment:
    // that is how the settings reach it.
    const settings = { ...nuxt.options.sqlInspector, ...inline }
    applyToEnv({
      SQL_INSPECTOR_REDACT: settings.redact,
      SQL_INSPECTOR_BUDGETS: settings.budgets?.join(";"),
      SQL_INSPECTOR_INCLUDE: settings.include?.join(","),
      SQL_INSPECTOR_EXCLUDE: settings.exclude?.join(","),
      SQL_INSPECTOR_PATH: settings.path
    })
    if (settings.path && nuxt.options.runtimeConfig) {
      nuxt.options.runtimeConfig.public ??= {}
      nuxt.options.runtimeConfig.public.sqlInspector = { path: settings.path }
    }
    nuxt.options.nitro.plugins ||= []
    nuxt.options.nitro.plugins.push(options.nitroPlugin ?? resolveSibling("./nitro-plugin"))
    nuxt.options.plugins.push({ src: resolveSibling("./client/nuxt-plugin.client"), mode: "client" })
  }
}

export default createNuxtModule()
