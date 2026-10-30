import { ensureMockApi } from "@playground/shared"

// At startup, before any request: the fake customer service the "Loyalty" screen calls, and the database with
// its demo data. Seeding inside the first request would put a hundred inserts into that request's tree.
export default defineNitroPlugin(async () => {
  await ensureMockApi()
  useRepository()
})
