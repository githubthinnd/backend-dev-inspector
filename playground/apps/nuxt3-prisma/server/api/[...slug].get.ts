import { DEFAULT_MOCK_API_URL, findScenario, runScenario } from "@playground/shared"
import { useRepository } from "../utils/repository"

// One handler for every scenario path, so the scenarios stay identical across the playground apps.
export default defineEventHandler(async (event) => {
  const scenario = findScenario(getRequestURL(event).pathname)
  if (!scenario) {
    throw createError({ statusCode: 404, statusMessage: "Unknown scenario" })
  }
  const { status, body } = await runScenario(scenario, useRepository(), { mockApiUrl: process.env.MOCK_API_URL ?? DEFAULT_MOCK_API_URL })
  setResponseStatus(event, status)
  return body
})
