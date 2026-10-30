import { ensureMockApi } from "@playground/shared"

// The fake customer service the "Outbound HTTP" scenario calls.
export default defineNitroPlugin(async () => {
  await ensureMockApi()
})
