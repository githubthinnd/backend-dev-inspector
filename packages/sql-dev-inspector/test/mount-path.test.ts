import type { IncomingMessage, ServerResponse } from "node:http"
import { EventEmitter } from "node:events"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applyToEnv, ENV_KEYS } from "../src/env"
import { inspectorSubPath } from "../src/inspector-server"
import { createSqlInspector } from "../src/node"
import { getInspector, normalizeMount } from "../src/runtime"
import { resetInspectorForTests } from "../src/setup"
import sqlInspectorModule from "../src/nuxt"

describe("normalizing the path", () => {
  it.each([
    [undefined, "__sql-inspector"], ["", "__sql-inspector"], ["/", "__sql-inspector"],
    ["/_dev/sql/", "_dev/sql"], ["_dev/sql", "_dev/sql"], ["sql", "sql"],
    ["/has space", "__sql-inspector"], ["/a?b", "__sql-inspector"]
  ])("%s → %s", (raw, expected) => {
    expect(normalizeMount(raw)).toBe(expected)
  })
})

describe("matching a custom path", () => {
  it.each([
    ["/_dev/sql", "_dev/sql", ""],
    ["/_dev/sql/", "_dev/sql", "/"],
    ["/_dev/sql/api/requests?x=1", "_dev/sql", "/api/requests"],
    ["/app/_dev/sql/api/stream", "_dev/sql", "/api/stream"],
    ["/_dev/sqlx", "_dev/sql", null],
    ["/_dev", "_dev/sql", null],
    ["/__sql-inspector/", "_dev/sql", null],
    ["/dev-sql/", "dev-sql", "/"]
  ])("%s with %s → %s", (url, mount, expected) => {
    expect(inspectorSubPath(url, mount)).toBe(expected)
  })

  it("keeps matching the default path exactly as before", () => {
    expect(inspectorSubPath("/__sql-inspector")).toBe("")
    expect(inspectorSubPath("/x/__sql-inspectorfoo")).toBeNull()
    expect(inspectorSubPath("//__sql-inspector")).toBeNull()
  })
})

class FakeRes extends EventEmitter {
  statusCode = 200
  body = ""
  writeHead(status: number) { this.statusCode = status; return this }
  write(chunk: string) { this.body += chunk; return true }
  end(chunk?: string) { this.body += chunk ?? "" }
}
const request = (url: string) => ({ req: Object.assign(new EventEmitter(), { url, method: "GET", headers: { host: "localhost:3000" } }) as unknown as IncomingMessage, res: new FakeRes() })

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development")
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("sqlDevInspector.runtime")]
  resetInspectorForTests()
  vi.spyOn(console, "log").mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe("serving from a custom path", () => {
  it("answers on the new path and no longer on the old one", () => {
    const inspector = createSqlInspector({ path: "/_dev/sql" })
    const page = request("/_dev/sql/")
    expect(inspector.handle(page.req, page.res as unknown as ServerResponse)).toBe(true)
    expect(page.res.statusCode).toBe(200)
    expect(page.res.body.toLowerCase()).toContain("<html")

    const old = request("/__sql-inspector/")
    expect(inspector.handle(old.req, old.res as unknown as ServerResponse)).toBe(false)
  })

  it("is taken from SQL_INSPECTOR_PATH, and the terminal says where to look", () => {
    vi.stubEnv("SQL_INSPECTOR_PATH", "/dev/queries")
    createSqlInspector()
    expect(getInspector().mount).toBe("dev/queries")
  })
})

describe("the Nuxt module settings", () => {
  const nuxt = () => ({ options: { dev: true, nitro: {} as { plugins?: string[] }, plugins: [], runtimeConfig: { public: {} as Record<string, unknown> } } })

  it("hands the options to the Nitro worker through the environment, and the path to the browser", () => {
    const env: Record<string, string | undefined> = {}
    const target = nuxt()
    // Same path as the module, with a scratch environment instead of the real one.
    applyToEnv({ SQL_INSPECTOR_REDACT: "all", SQL_INSPECTOR_INCLUDE: "/api/**", SQL_INSPECTOR_EXCLUDE: undefined, SQL_INSPECTOR_PATH: "/_dev/sql" }, env as never)
    expect(env).toEqual({ SQL_INSPECTOR_REDACT: "all", SQL_INSPECTOR_INCLUDE: "/api/**", SQL_INSPECTOR_PATH: "/_dev/sql" })

    sqlInspectorModule({ path: "/_dev/sql" }, target)
    expect(target.options.runtimeConfig.public.sqlInspector).toEqual({ path: "/_dev/sql" })
    // the module wrote to the real environment: put it back
    delete process.env.SQL_INSPECTOR_PATH
  })

  it("only ever writes the keys the package owns", () => {
    const env: Record<string, string | undefined> = { OTHER: "x" }
    applyToEnv({ SQL_INSPECTOR_REDACT: "off", NODE_ENV: "development" }, env as never)
    expect(Object.keys(env).sort()).toEqual(["NODE_ENV", "OTHER", "SQL_INSPECTOR_REDACT"].sort())
    expect(ENV_KEYS).toEqual(expect.arrayContaining(["SQL_INSPECTOR_REDACT", "SQL_INSPECTOR_INCLUDE", "SQL_INSPECTOR_EXCLUDE", "SQL_INSPECTOR_PATH"]))
  })
})
