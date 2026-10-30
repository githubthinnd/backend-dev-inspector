import { Hono } from "hono"
import inspectorMiddleware from "backend-dev-inspector/hono"
import { createSqliteRepository, DEFAULT_MOCK_API_URL, openDatabase, renderIndex, runScenario, scenarios } from "@playground/shared"

export function createApp() {
  const app = new Hono()
  app.use("*", inspectorMiddleware())

  const repo = createSqliteRepository(openDatabase())
  const context = { mockApiUrl: process.env.MOCK_API_URL ?? DEFAULT_MOCK_API_URL }

  app.get("/", c => c.html(renderIndex("hono-sqlite")))
  app.get("/api/health", c => c.json({ ok: true }))
  for (const scenario of scenarios) {
    app.get(scenario.path, async (c) => {
      const { status, body } = await runScenario(scenario, repo, context)
      return c.json(body as object, status as 200 | 500)
    })
  }
  return app
}
