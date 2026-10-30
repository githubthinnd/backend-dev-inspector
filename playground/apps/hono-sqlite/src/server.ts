import "@playground/shared/dev-env"
import { serve } from "@hono/node-server"
import { ensureMockApi } from "@playground/shared"
import { createApp } from "./app.ts"

await ensureMockApi()
const port = Number(process.env.PORT ?? 3000)
serve({ fetch: createApp().fetch, port }, () => {
  console.log(`hono-sqlite: http://localhost:${port}  inspector: http://localhost:${port}/__sql-inspector/`)
})
