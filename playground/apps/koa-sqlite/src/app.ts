import Koa from "koa"
import inspectorMiddleware from "backend-dev-inspector/koa"
import { createSqliteRepository, DEFAULT_MOCK_API_URL, findScenario, openDatabase, runScenario, serveWeb } from "@playground/shared"

export function createApp() {
  const app = new Koa()
  app.use(inspectorMiddleware()) // first

  const repo = createSqliteRepository(openDatabase())
  const context = { mockApiUrl: process.env.MOCK_API_URL ?? DEFAULT_MOCK_API_URL }

  const info = { framework: "Koa 3", data: "better-sqlite3" }
  app.use(async (ctx) => {
    const page = serveWeb(ctx.path, info)
    if (page) {
      ctx.status = page.status
      ctx.type = page.type
      ctx.body = page.body
      return
    }
    if (ctx.path === "/api/health") {
      ctx.body = { ok: true }
      return
    }
    const scenario = findScenario(ctx.path)
    if (!scenario) {
      ctx.status = 404
      ctx.body = { error: "not found" }
      return
    }
    const { status, body } = await runScenario(scenario, repo, context)
    ctx.status = status
    ctx.body = body
  })
  return app
}
