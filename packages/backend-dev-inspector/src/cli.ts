#!/usr/bin/env node
import { diagnose, startInspector, type Check } from "sql-dev-inspector"
import { withDefaults } from "./options.js"

const MARKS: Record<Check["status"], string> = { ok: "✓", warn: "!", error: "✗" }

/** `backend-dev-inspector doctor`: starts the inspector the way an app in development would, and reports what it found. */
export function main(argv: string[], write: (text: string) => void = text => void process.stdout.write(text)): number {
  const [command] = argv
  if (command !== "doctor") {
    write("Usage: backend-dev-inspector doctor\n\nChecks the setup: Node.js, which libraries the inspector watches, and whether two copies of one are loaded.\n")
    return command === undefined || command === "help" || command === "--help" ? 0 : 1
  }
  const env = { NODE_ENV: "development", SQL_INSPECTOR_LOG: "0", SQL_INSPECTOR_NOTICE: "0" }
  const inspector = startInspector(env, withDefaults({}, env))
  const checks = diagnose(inspector, env)
  write(`backend-dev-inspector doctor\n\n${checks.map(check => `  ${MARKS[check.status]} ${check.message}`).join("\n")}\n`)
  return checks.some(check => check.status === "error") ? 1 : 0
}

if (process.argv[1] && /backend-dev-inspector|cli\.[jt]s$/.test(process.argv[1]) && !process.argv[1].includes("vitest")) {
  process.exitCode = main(process.argv.slice(2))
}
