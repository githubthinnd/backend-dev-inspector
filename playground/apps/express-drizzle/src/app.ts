import express from "express"
import { createInspector } from "backend-dev-inspector"
import { DEFAULT_MOCK_API_URL, openDatabase, renderIndex, runScenario, scenarios } from "@playground/shared"
import { createDrizzleRepository } from "@playground/shared/drizzle"

export function createApp() {
  const app = express()
  app.use(createInspector().middleware) // before any route that uses a database

  const repo = createDrizzleRepository(openDatabase())
  const context = { mockApiUrl: process.env.MOCK_API_URL ?? DEFAULT_MOCK_API_URL }

  app.get("/", (_request, response) => {
    response.type("html").send(renderIndex("express-drizzle"))
  })
  app.get("/api/health", (_request, response) => {
    response.json({ ok: true })
  })
  for (const scenario of scenarios) {
    app.get(scenario.path, async (_request, response) => {
      const { status, body } = await runScenario(scenario, repo, context)
      response.status(status).json(body)
    })
  }
  return app
}
