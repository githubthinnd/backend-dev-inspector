import { createRequire } from "node:module"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as oldApi from "sql-dev-inspector"
import { createRecorder, getInspector, markSiblingLoaded, resetInspectorForTests, type RequestTrace } from "sql-dev-inspector"
import * as newApi from "../src/index"
import { allDrivers, optInDrivers } from "../src/drivers/index"
import { inspectorMiddleware as astro } from "../src/frameworks/astro"
import { inspectorPlugin as fastifyPlugin } from "../src/frameworks/fastify"
import { inspectorMiddleware as honoMiddleware } from "../src/frameworks/hono"
import { inspectorMiddleware as koaMiddleware } from "../src/frameworks/koa"
import { inspectNest } from "../src/frameworks/nest"
import { inspectorRoute, withInspector, withInspectorAction, withInspectorPage } from "../src/frameworks/next"
import { inspectReactRouter, inspectRemix } from "../src/frameworks/remix"
import { inspectorHandle } from "../src/frameworks/sveltekit"
import { trpcInspector } from "../src/frameworks/trpc"
import { inspector as vitePlugin } from "../src/frameworks/vite"
import { BRAND, withDefaults } from "../src/options"
import { wrapFetch } from "../src/web"

const load = createRequire(import.meta.url)
const { default: Fastify } = { default: load("fastify") as typeof import("fastify") }
const Koa = load("koa") as new () => { use: (fn: unknown) => void, callback: () => (req: unknown, res: unknown) => void }
const { Hono } = load("hono") as typeof import("hono")
const inject = load("light-my-request") as (handler: unknown, options: { url: string, method?: string, headers?: Record<string, string>, payload?: unknown }) => Promise<{ statusCode: number, body: string, headers: Record<string, string>, json: () => unknown }>
const vite = load("vite") as typeof import("vite")

const URL_BASE = "http://localhost:3000"
const store = () => getInspector().store
const recorder = () => createRecorder(store())
const analysis = { kind: "select" as const, tables: [], subqueryDepth: 0, subqueryCount: 0, fingerprint: "select 1", selectStar: false, savepoint: null }
/** What an application's handler does: one recorded call, after some awaiting. */
async function callDatabase(label = "select 1") {
  await Promise.resolve()
  recorder().begin({ driver: "test", api: "run", text: label, connectionId: 1, analysis })?.end()
}
const traceOf = (url: string): RequestTrace | undefined => store().list().find(trace => trace.url === url)

beforeEach(() => {
  vi.stubEnv("SQL_INSPECTOR", "1")
  vi.stubEnv("SQL_INSPECTOR_LOG", "0")
  vi.stubEnv("SQL_INSPECTOR_NOTICE", "0")
})
afterEach(() => {
  vi.unstubAllEnvs()
  store().clear()
  resetInspectorForTests()
})

describe("defaults", () => {
  it("turns on every driver, names the UI, and tells sql-dev-inspector it is in use", () => {
    const options = withDefaults({}, {})
    expect(options.drivers!.map(driver => driver.name)).toEqual(allDrivers.map(driver => driver.name))
    expect(options.brand).toEqual(BRAND)
    expect(allDrivers.map(driver => driver.name)).toEqual(expect.arrayContaining(["mysql2", "pg", "better-sqlite3", "mongodb", "ioredis", "redis", "http", "fetch", "mariadb", "prisma"]))
  })

  it("adds node:sqlite only when it is asked for by name, because loading it prints a Node warning", () => {
    expect(withDefaults({}, {}).drivers!.map(d => d.name)).not.toContain("node:sqlite")
    expect(withDefaults({}, { SQL_INSPECTOR_DRIVERS: "pg,node:sqlite" }).drivers!.map(d => d.name)).toContain("node:sqlite")
    expect(optInDrivers.map(d => d.name)).toEqual(["node:sqlite"])
  })

  it("keeps the drivers and brand the caller chose", () => {
    const custom = { name: "x", install: () => null }
    const options = withDefaults({ drivers: [custom], brand: { title: "Mine", short: "M" } }, {})
    expect(options.drivers).toEqual([custom])
    expect(options.brand).toEqual({ title: "Mine", short: "M" })
  })

  it("is a drop-in replacement: it exports everything sql-dev-inspector does", () => {
    const missing = Object.keys(oldApi).filter(name => !(name in newApi))
    expect(missing).toEqual([])
    expect(newApi.createInspector).toBeTypeOf("function")
    expect(newApi.createSqlInspector).toBe(newApi.createInspector)
  })

  it("starts mysql2 and the other drivers through the same call as sql-dev-inspector", () => {
    markSiblingLoaded()
    const inspector = newApi.startInspector(undefined, {})
    expect(inspector).not.toBeNull()
    expect(inspector!.brand).toEqual(BRAND)
    expect(oldApi.installedDrivers()).toEqual(expect.arrayContaining(["mysql2", "pg", "better-sqlite3", "mongodb"]))
  })
})

describe("Fastify", () => {
  it("serves the inspector, and attributes calls made in hooks and handlers to their request", async () => {
    const app = Fastify()
    await app.register(fastifyPlugin())
    app.addHook("preHandler", async () => callDatabase("select pre"))
    app.get("/things/:id", async (request) => {
      await callDatabase("select handler")
      return { id: (request.params as { id: string }).id }
    })
    await app.ready()

    expect((await app.inject({ url: "/things/7" })).json()).toEqual({ id: "7" })
    const trace = traceOf("/things/7")!
    expect(trace.status).toBe(200)
    expect(trace.queries.map(q => q.sql)).toEqual(["select pre", "select handler"])

    const list = await app.inject({ url: "/__sql-inspector/api/requests" })
    expect(list.statusCode).toBe(200)
    expect((list.json() as { url: string }[]).map(row => row.url)).toEqual(["/things/7"])
    const page = await app.inject({ url: "/__sql-inspector/" })
    expect(page.body).toContain("Backend Inspector")
    await app.close()
  })

  it("keeps overlapping requests apart", async () => {
    const app = Fastify()
    await app.register(fastifyPlugin())
    app.get("/slow", async () => {
      await new Promise(resolve => setTimeout(resolve, 25))
      await callDatabase("select slow")
      return "slow"
    })
    app.get("/fast", async () => {
      await callDatabase("select fast")
      return "fast"
    })
    await app.ready()
    await Promise.all([app.inject({ url: "/slow" }), app.inject({ url: "/fast" })])
    expect(traceOf("/slow")!.queries.map(q => q.sql)).toEqual(["select slow"])
    expect(traceOf("/fast")!.queries.map(q => q.sql)).toEqual(["select fast"])
    await app.close()
  })

  it("refuses a rebound host", async () => {
    const app = Fastify()
    await app.register(fastifyPlugin())
    await app.ready()
    const res = await app.inject({ url: "/__sql-inspector/api/requests", headers: { host: "evil.example.com" } })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it("applies to routes registered inside other plugins too", async () => {
    const app = Fastify()
    await app.register(fastifyPlugin())
    await app.register(async (child) => {
      child.get("/nested", async () => {
        await callDatabase("select nested")
        return "ok"
      })
    })
    await app.ready()
    await app.inject({ url: "/nested" })
    expect(traceOf("/nested")!.queries).toHaveLength(1)
    await app.close()
  })
})

describe("Koa", () => {
  function build() {
    const app = new Koa()
    app.use(koaMiddleware())
    app.use(async (ctx: { path: string, body: unknown }) => {
      await callDatabase(`select ${ctx.path}`)
      ctx.body = { path: ctx.path }
    })
    return app.callback()
  }

  it("serves the inspector and attributes calls to their request", async () => {
    const handler = build()
    const res = await inject(handler, { url: "/orders" })
    expect(res.json()).toEqual({ path: "/orders" })
    expect(traceOf("/orders")!.queries.map(q => q.sql)).toEqual(["select /orders"])
    expect(traceOf("/orders")!.status).toBe(200)

    const list = await inject(handler, { url: "/__sql-inspector/api/requests" })
    expect(list.statusCode).toBe(200)
    expect((list.json() as { url: string }[]).map(row => row.url)).toEqual(["/orders"])
  })

  it("keeps overlapping requests apart", async () => {
    const handler = build()
    await Promise.all([inject(handler, { url: "/a" }), inject(handler, { url: "/b" })])
    expect(traceOf("/a")!.queries.map(q => q.sql)).toEqual(["select /a"])
    expect(traceOf("/b")!.queries.map(q => q.sql)).toEqual(["select /b"])
  })
})

describe("Hono", () => {
  function build() {
    const app = new Hono()
    app.use("*", honoMiddleware() as never)
    app.get("/things/:id", async (c) => {
      await callDatabase("select thing")
      return c.json({ id: c.req.param("id") }, 201)
    })
    return app
  }

  it("serves the inspector, and the request ends with the response's status", async () => {
    const app = build()
    const res = await app.request("/things/9")
    expect(res.status).toBe(201)
    const trace = traceOf("/things/9")!
    expect(trace.status).toBe(201)
    expect(trace.queries.map(q => q.sql)).toEqual(["select thing"])

    const list = await app.request("/__sql-inspector/api/requests")
    expect(((await list.json()) as { url: string }[]).map(row => row.url)).toEqual(["/things/9"])
    expect((await (await app.request("/__sql-inspector/")).text())).toContain("Backend Inspector")
  })

  it("keeps overlapping requests apart", async () => {
    const app = new Hono()
    app.use("*", honoMiddleware() as never)
    app.get("/slow", async (c) => {
      await new Promise(resolve => setTimeout(resolve, 20))
      await callDatabase("select slow")
      return c.text("s")
    })
    app.get("/fast", async (c) => {
      await callDatabase("select fast")
      return c.text("f")
    })
    await Promise.all([app.request("/slow"), app.request("/fast")])
    expect(traceOf("/slow")!.queries.map(q => q.sql)).toEqual(["select slow"])
    expect(traceOf("/fast")!.queries.map(q => q.sql)).toEqual(["select fast"])
  })
})

describe("Vite", () => {
  it("serves the inspector and runs the dev server's own middleware in the request scope", async () => {
    const server = await vite.createServer({
      configFile: false,
      logLevel: "silent",
      appType: "custom",
      server: { middlewareMode: true },
      plugins: [
        vitePlugin() as never,
        {
          name: "app",
          configureServer: (s: { middlewares: { use: (h: (req: unknown, res: { end: (b: string) => void }) => void) => void } }) => () => {
            s.middlewares.use((_req, res) => {
              void callDatabase("select ssr").then(() => res.end("rendered"))
            })
          }
        }
      ]
    })
    try {
      expect((await inject(server.middlewares, { url: "/page" })).body).toBe("rendered")
      expect(traceOf("/page")!.queries.map(q => q.sql)).toEqual(["select ssr"])
      const list = await inject(server.middlewares, { url: "/__sql-inspector/api/requests" })
      expect((list.json() as { url: string }[]).map(row => row.url)).toEqual(["/page"])
    } finally {
      await server.close()
    }
  })

  it("only applies to the dev server", () => {
    expect(vitePlugin().apply).toBe("serve")
  })
})

describe("web-standard adapters", () => {
  it("SvelteKit: serves the inspector, wraps resolve, and passes everything else through", async () => {
    const handle = inspectorHandle()
    const resolve = vi.fn(async () => {
      await callDatabase("select kit")
      return new Response("page", { status: 202 })
    })
    const served = await handle({ event: { request: new Request(`${URL_BASE}/__sql-inspector/api/requests`) }, resolve })
    expect(served.status).toBe(200)
    expect(resolve).not.toHaveBeenCalled()

    const res = await handle({ event: { request: new Request(`${URL_BASE}/blog`) }, resolve })
    expect(res.status).toBe(202)
    expect(traceOf("/blog")).toMatchObject({ status: 202 })
    expect(traceOf("/blog")!.queries).toHaveLength(1)
  })

  it("Astro: the same, through onRequest", async () => {
    const onRequest = astro()
    const res = await onRequest({ request: new Request(`${URL_BASE}/about`) }, async () => {
      await callDatabase("select astro")
      return new Response("about")
    })
    expect(await res.text()).toBe("about")
    expect(traceOf("/about")!.queries).toHaveLength(1)
    expect((await onRequest({ request: new Request(`${URL_BASE}/__sql-inspector/api/settings`) }, async () => new Response("never"))).status).toBe(200)
  })

  it("Next.js: a route for the inspector, and route handlers wrapped to belong to their request", async () => {
    const { GET } = inspectorRoute()
    expect((await GET(new Request(`${URL_BASE}/__sql-inspector/api/requests`))).status).toBe(200)
    expect((await GET(new Request(`${URL_BASE}/elsewhere`))).status).toBe(404)

    const handler = withInspector(async (request: Request, context: { params: { id: string } }) => {
      await callDatabase("select next")
      return Response.json({ url: new URL(request.url).pathname, id: context.params.id })
    })
    const res = await handler(new Request(`${URL_BASE}/api/users/3`), { params: { id: "3" } })
    expect(await res.json()).toEqual({ url: "/api/users/3", id: "3" })
    expect(traceOf("/api/users/3")!.queries).toHaveLength(1)
  })

  it("Next.js: server components and server actions are requests of their own, and redirect() is not a failure", async () => {
    const page = withInspectorPage("/orders", async (id: string) => {
      await callDatabase(`select page ${id}`)
      return `page ${id}`
    })
    expect(await page("7")).toBe("page 7")
    expect(traceOf("/orders")).toMatchObject({ method: "GET", status: 200 })
    expect(traceOf("/orders")!.queries).toHaveLength(1)

    const action = withInspectorAction("createOrder", async () => {
      await callDatabase("insert action")
      throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/orders/1;307;" })
    })
    await expect(action()).rejects.toThrow("NEXT_REDIRECT")
    expect(traceOf("createOrder")).toMatchObject({ method: "ACTION", status: 307 })

    const broken = withInspectorAction("explode", async () => {
      await callDatabase("select boom")
      throw new Error("boom")
    })
    await expect(broken()).rejects.toThrow("boom")
    expect(traceOf("explode")!.status).toBe(500)
  })

  it("Next.js: a component called inside a wrapped route handler joins that request", async () => {
    const part = withInspectorPage("/part", async () => {
      await callDatabase("select part")
    })
    const handler = withInspector(async () => {
      await callDatabase("select handler")
      await part()
      return new Response("ok")
    })
    await handler(new Request(`${URL_BASE}/api/joined`), undefined)
    expect(traceOf("/api/joined")!.queries).toHaveLength(2)
    expect(traceOf("/part")).toBeUndefined()
  })

  it("wrapFetch: any (request) => Response handler, as Bun.serve / Deno.serve / workers take", async () => {
    const fetchHandler = wrapFetch(async (request: Request, tag: string) => {
      await callDatabase("select fetch")
      return new Response(`${tag}:${new URL(request.url).pathname}`)
    })
    expect(await (await fetchHandler(new Request(`${URL_BASE}/hello`), "x")).text()).toBe("x:/hello")
    expect(traceOf("/hello")!.queries).toHaveLength(1)
    expect((await fetchHandler(new Request(`${URL_BASE}/__sql-inspector/api/requests`), "x")).headers.get("content-type")).toContain("json")
  })

  it("does nothing outside development", async () => {
    vi.stubEnv("SQL_INSPECTOR", "0")
    resetInspectorForTests()
    const handler = async () => new Response("plain")
    expect(wrapFetch(handler)).toBe(handler)
    const res = await withInspector(handler)(new Request(`${URL_BASE}/x`), undefined)
    expect(await res.text()).toBe("plain")
  })
})

describe("NestJS", () => {
  it("on Express: adds the middleware to the application", async () => {
    const used: unknown[] = []
    const app = { getHttpAdapter: () => ({ getType: () => "express" }), use: (fn: unknown) => used.push(fn) }
    expect(await inspectNest(app)).toBe(app)
    expect(used).toHaveLength(1)
    const handler = (req: never, res: { end: (body?: string) => void }) => (used[0] as (req: never, res: unknown, next: () => void) => void)(req, res, () => {
      void callDatabase("select nest").then(() => res.end("ok"))
    })
    const res = await inject(handler, { url: "/cats" })
    expect(res.body).toBe("ok")
    expect(traceOf("/cats")!.queries.map(q => q.sql)).toEqual(["select nest"])
  })

  it("on Fastify: registers the plugin, so guards, pipes and handlers belong to their request", async () => {
    const fastify = Fastify()
    const app = { getHttpAdapter: () => ({ getType: () => "fastify" }), register: (plugin: never) => fastify.register(plugin) }
    await inspectNest(app)
    fastify.get("/dogs", async () => {
      await callDatabase("select dogs")
      return { ok: true }
    })
    await fastify.ready()
    await fastify.inject({ url: "/dogs" })
    expect(traceOf("/dogs")!.queries.map(q => q.sql)).toEqual(["select dogs"])
    await fastify.close()
  })

  it("does nothing outside development", async () => {
    vi.stubEnv("SQL_INSPECTOR", "0")
    resetInspectorForTests()
    const used: unknown[] = []
    await inspectNest({ getHttpAdapter: () => ({ getType: () => "express" }), use: (fn: unknown) => used.push(fn) })
    expect(used).toEqual([])
  })
})

describe("tRPC", () => {
  const procedure = (path: string, type: string, work: () => Promise<unknown>, ok = true) => trpcInspector()({ path, type, next: async () => {
    await work()
    return ok ? { ok: true, data: 1 } : { ok: false, error: { code: "INTERNAL_SERVER_ERROR" } }
  } })

  it("leaves a line for every procedure of a batch under its request, and does not change the result", async () => {
    const web = (await import("sql-dev-inspector")).createWebInspector()
    const res = await web.track(new Request(`${URL_BASE}/api/trpc/orders.list,users.get`), async () => {
      expect(await procedure("orders.list", "query", () => callDatabase("select orders"))).toEqual({ ok: true, data: 1 })
      await procedure("users.get", "query", () => callDatabase("select users"), false)
      return new Response("[]")
    })
    expect(res.status).toBe(200)
    const trace = traceOf("/api/trpc/orders.list,users.get")!
    expect(trace.queries).toHaveLength(2)
    expect(trace.logs!.map(l => [l.level, l.message.replace(/ · [\d.]+ ms/, "")])).toEqual([
      ["info", "tRPC query orders.list · ok"],
      ["error", "tRPC query users.get · INTERNAL_SERVER_ERROR"]
    ])
  })

  it("is a request of its own where there is none, and a failure is a 500", async () => {
    await procedure("orders.list", "query", () => callDatabase("select alone"))
    expect(traceOf("orders.list")).toMatchObject({ method: "QUERY", status: 200 })
    await procedure("orders.create", "mutation", () => callDatabase("insert alone"), false)
    expect(traceOf("orders.create")).toMatchObject({ method: "MUTATION", status: 500 })
  })

  it("passes through outside development", async () => {
    vi.stubEnv("SQL_INSPECTOR", "0")
    resetInspectorForTests()
    expect(await procedure("a.b", "query", async () => undefined)).toEqual({ ok: true, data: 1 })
  })
})

describe("Remix and React Router", () => {
  it("wraps the request handler: loaders and actions belong to their request, and the inspector's pages are answered", async () => {
    const handler = inspectRemix(async (request: Request, context: { user: string }) => {
      await callDatabase("select loader")
      return new Response(`${new URL(request.url).pathname}:${context.user}`)
    })
    expect(await (await handler(new Request(`${URL_BASE}/orders`), { user: "ann" })).text()).toBe("/orders:ann")
    expect(traceOf("/orders")!.queries.map(q => q.sql)).toEqual(["select loader"])
    expect((await handler(new Request(`${URL_BASE}/__sql-inspector/api/requests`), { user: "x" })).headers.get("content-type")).toContain("json")
    expect(inspectReactRouter).toBe(inspectRemix)
  })
})
