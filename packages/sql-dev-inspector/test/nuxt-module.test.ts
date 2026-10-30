import { existsSync } from "node:fs"
import { describe, expect, it } from "vitest"
import sqlInspectorModule, { createNuxtModule } from "../src/nuxt"

const nuxtWith = (dev: boolean) => ({ options: { dev, nitro: {} as { plugins?: string[] }, plugins: [] as (string | { src: string, mode?: string })[] } })

describe("nuxt module", () => {
  it("registers the nitro plugin in dev, and the file exists", () => {
    const nuxt = nuxtWith(true)
    sqlInspectorModule(undefined, nuxt)
    expect(nuxt.options.nitro.plugins).toHaveLength(1)
    expect(nuxt.options.nitro.plugins![0]).toMatch(/src\/nitro-plugin\.ts$/)
    expect(existsSync(nuxt.options.nitro.plugins![0]!)).toBe(true)
  })

  it("registers the floating launcher as a client-only plugin in dev, and the file exists", () => {
    const nuxt = nuxtWith(true)
    sqlInspectorModule(undefined, nuxt)
    expect(nuxt.options.plugins).toHaveLength(1)
    const plugin = nuxt.options.plugins[0] as { src: string, mode: string }
    expect(plugin.mode).toBe("client")
    expect(existsSync(plugin.src)).toBe(true)
  })

  it("registers nothing for build / generate", () => {
    const nuxt = nuxtWith(false)
    sqlInspectorModule(undefined, nuxt)
    expect(nuxt.options.nitro.plugins).toBeUndefined()
    expect(nuxt.options.plugins).toEqual([])
  })

  it("keeps plugins other modules already registered", () => {
    const nuxt = nuxtWith(true)
    nuxt.options.nitro.plugins = ["/other/plugin"]
    sqlInspectorModule(undefined, nuxt)
    expect(nuxt.options.nitro.plugins).toHaveLength(2)
    expect(nuxt.options.nitro.plugins[0]).toBe("/other/plugin")
  })
})

describe("Nuxt DevTools", () => {
  const withHooks = (path?: string) => {
    const tabs: unknown[] = []
    const nuxt = { hook: (name: string, listener: (list: unknown[]) => void) => { if (name === "devtools:customTabs") { listener(tabs) } }, options: { dev: true, nitro: {}, plugins: [], runtimeConfig: { public: {} } } }
    createNuxtModule()(path ? { path } : undefined, nuxt as never)
    return tabs
  }

  it("adds a tab that shows the inspector's page, at the path it is served from", () => {
    expect(withHooks()).toEqual([{ name: "sql-inspector", title: "Requests", icon: "carbon:data-base", view: { type: "iframe", src: "/__sql-inspector/" } }])
    expect((withHooks("/_dev/sql")[0] as { view: { src: string } }).view.src).toBe("/_dev/sql/")
  })

  it("adds nothing outside nuxt dev, and works when the hook registry is missing", () => {
    const tabs: unknown[] = []
    createNuxtModule()(undefined, { hook: (_n: string, l: (t: unknown[]) => void) => l(tabs), options: { dev: false, nitro: {}, plugins: [] } } as never)
    expect(tabs).toEqual([])
    expect(() => createNuxtModule()(undefined, { options: { dev: true, nitro: {}, plugins: [] } } as never)).not.toThrow()
  })
})
