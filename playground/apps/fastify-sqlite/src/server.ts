import "@playground/shared/dev-env"
import { ensureMockApi } from "@playground/shared"
import { createApp } from "./app.ts"

await ensureMockApi()
const port = Number(process.env.PORT ?? 3000)
const app = await createApp()
await app.listen({ port })
console.log(`fastify-sqlite: http://localhost:${port}  inspector: http://localhost:${port}/__sql-inspector/`)
