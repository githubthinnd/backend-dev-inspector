import { EventEmitter } from "node:events"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createRecorder, getInspector, resetInspectorForTests } from "sql-dev-inspector"
import nuxtModule from "../src/nuxt"
import nitroPlugin from "../src/nitro"

class FakeRes extends EventEmitter {
  statusCode = 200
  body = ""
  ended = false
  writeHead(status: number) {
    this.statusCode = status
    return this
  }

  write(chunk: string) {
    this.body += chunk
    return true
  }

  end(chunk?: string) {
    this.body += chunk ?? ""
    this.ended = true
    this.emit("close")
  }
}

const analysis = { kind: "select" as const, tables: [], subqueryDepth: 0, subqueryCount: 0, fingerprint: "select 1", selectStar: false, savepoint: null }

function setup() {
  const original = vi.fn(async (event: { node: { res: FakeRes } }) => {
    await Promise.resolve()
    createRecorder(getInspector().store).begin({ driver: "test", api: "run", text: "select 1", connectionId: 1, analysis })?.end()
    event.node.res.end("app")
  })
  const nitroApp = { h3App: { handler: original as (event: never) => unknown } }
  nitroPlugin(nitroApp as never)
  const call = (url: string) => {
    const req = Object.assign(new EventEmitter(), { url, method: "GET", headers: { host: "localhost:3000" } })
    const res = new FakeRes()
    const result = (nitroApp.h3App.handler as (event: unknown) => unknown)({ node: { req, res } })
    return { res, result }
  }
  return { call, original }
}

beforeEach(() => {
  vi.stubEnv("SQL_INSPECTOR", "1")
  vi.stubEnv("SQL_INSPECTOR_LOG", "0")
  vi.stubEnv("SQL_INSPECTOR_NOTICE", "0")
  vi.spyOn(console, "log").mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  getInspector().store.clear()
  resetInspectorForTests()
})

describe("Nitro plugin", () => {
  it("serves the inspector with this package's name, and wraps everything else in the request scope", async () => {
    const { call, original } = setup()

    const page = call("/__sql-inspector/")
    expect(page.res.body).toContain("\"title\":\"Backend Inspector\"")
    expect(original).not.toHaveBeenCalled()

    const handled = call("/api/things")
    await handled.result
    expect(original).toHaveBeenCalledOnce()
    expect(getInspector().store.list()[0]).toMatchObject({ url: "/api/things", status: 200 })
    expect(getInspector().store.list()[0]!.queries).toHaveLength(1)
  })

  it("reports the brand to the floating panel", () => {
    const { call } = setup()
    const settings = JSON.parse(call("/__sql-inspector/api/settings").res.body) as { brand: unknown }
    expect(settings.brand).toEqual({ title: "Backend Inspector", short: "DEV" })
  })

  it("says it is ready, in the log", () => {
    setup()
    expect(vi.mocked(console.log).mock.calls.map(c => String(c[0])).some(text => text.includes("/__sql-inspector/"))).toBe(true)
  })
})

describe("Nuxt module", () => {
  const nuxt = (dev: boolean) => ({ options: { dev, nitro: { plugins: [] as string[] }, plugins: [] as unknown[] } })

  it("registers this package's Nitro plugin and the floating launcher in nuxt dev", () => {
    const config = nuxt(true)
    nuxtModule({}, config as never)
    expect(config.options.nitro.plugins).toHaveLength(1)
    expect(config.options.nitro.plugins[0]).toMatch(/backend-dev-inspector\/src\/nitro\.(ts|js)$/)
    expect(config.options.plugins).toHaveLength(1)
    expect(JSON.stringify(config.options.plugins[0])).toMatch(/nuxt-plugin\.client/)
    expect(JSON.stringify(config.options.plugins[0])).toContain("\"mode\":\"client\"")
  })

  it("adds nothing to a build or generate", () => {
    const config = nuxt(false)
    nuxtModule({}, config as never)
    expect(config.options.nitro.plugins).toEqual([])
    expect(config.options.plugins).toEqual([])
  })
})
