import process from "node:process"

/**
 * Every environment variable this package reads, and the only ones. The process environment
 * holds secrets (database passwords, API keys); the inspector must never see more than its own
 * settings, so nothing else in the package touches `process.env` (a test enforces it).
 */
export const ENV_KEYS = [
  "NODE_ENV",
  "NO_COLOR",
  "SQL_INSPECTOR",
  "SQL_INSPECTOR_ALLOWED_HOSTS",
  "SQL_INSPECTOR_DRIVERS",
  "SQL_INSPECTOR_LANG",
  "SQL_INSPECTOR_LOG",
  "SQL_INSPECTOR_MAX_QUERIES",
  "SQL_INSPECTOR_MAX_REQUESTS",
  "SQL_INSPECTOR_NOTICE",
  "SQL_INSPECTOR_SLOW_MS",
  "SQL_INSPECTOR_TTL_MINUTES",
  "SQL_INSPECTOR_TX_CONVENTION"
] as const

export type InspectorEnv = Partial<Record<(typeof ENV_KEYS)[number], string>>

/** A copy of the process environment reduced to `ENV_KEYS`. */
export function pickEnv(env: NodeJS.ProcessEnv = process.env): InspectorEnv {
  const picked: InspectorEnv = {}
  for (const key of ENV_KEYS) {
    if (env[key] !== undefined) {
      picked[key] = env[key]
    }
  }
  return picked
}
