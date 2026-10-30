import { Hono } from "hono"
import inspectorMiddleware from "backend-dev-inspector/hono"
import { createSqliteRepository, DEFAULT_MOCK_API_URL, openDatabase, runScenario, scenarios, serveWeb } from "@playground/shared"

export function createApp() {
  const app = new Hono()
  app.use("*", inspectorMiddleware())

  const repo = createSqliteRepository(openDatabase())
  const context = { mockApiUrl: process.env.MOCK_API_URL ?? DEFAULT_MOCK_API_URL }

  const info = { framework: "Hono", data: "better-sqlite3" }
  const web = (c: { req: { path: string }, body: (data: string, status: 200, headers: Record<string, string>) => Response, json: (data: object, status: 404) => Response }) => {
    const page = serveWeb(c.req.path, info)
    return page ? c.body(page.body, 200, { "content-type": page.type }) : c.json({ error: "not found" }, 404)
  }
  app.get("/", web)
  app.get("/assets/:file", web)
  app.get("/api/health", c => c.json({ ok: true }))
  for (const scenario of scenarios) {
    app.get(scenario.path, async (c) => {
      const { status, body } = await runScenario(scenario, repo, context)
      return c.json(body as object, status as 200 | 500)
    })
  }
  return app
}
