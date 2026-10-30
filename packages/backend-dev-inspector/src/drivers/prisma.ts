import type { DriverAdapter, OperationEnd, StatementKind } from "sql-dev-inspector"
import { describeOperation, runInOperation } from "sql-dev-inspector"
import { wrapperDriver } from "./wrapper.js"

/**
 * Prisma, through a client extension. Prisma runs queries in a native engine that gives the
 * application no hook per call, but a client extension runs inside the application's own async
 * context, so every operation can be attributed to its request:
 *
 *   import { prismaExtension } from "backend-dev-inspector/prisma"
 *   const prisma = new PrismaClient().$extends(prismaExtension())
 *
 * An operation is listed by model and operation (`User.findMany {"where":…}`), which is what the code says and
 * where the stack points. The SQL Prisma generates for it is not available at this point, but it is run through a
 * database driver the inspector watches (`@prisma/adapter-pg`, `-libsql`, `-better-sqlite3`… sit on `pg`, libSQL,
 * better-sqlite3): whatever those report while the operation runs is kept on the operation as `statements`, so the
 * page shows the real SQL under it, and it is not counted a second time. Outside development (no inspector
 * running) the extension passes every call through untouched.
 */

const wrapper = wrapperDriver("prisma")

export const prismaDriver: DriverAdapter = wrapper.driver

const MAX_TEXT = 300

function kindOf(operation: string): StatementKind {
  if (/^(find|count|aggregate|groupBy|\$queryRaw)/.test(operation)) {
    return "select"
  }
  if (/^(create|\$executeRaw)/.test(operation)) {
    return operation.startsWith("$executeRaw") ? "update" : "insert"
  }
  if (/^(update|upsert)/.test(operation)) {
    return "update"
  }
  return operation.startsWith("delete") ? "delete" : "other"
}

function render(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? String(item) : item) ?? ""
  } catch {
    return "{…}"
  }
}

/** `$queryRaw` hands over either a plain SQL string (the Unsafe variants) or a tagged template. */
function rawText(args: unknown): string | null {
  if (Array.isArray(args) && typeof args[0] === "string") {
    return args[0]
  }
  const strings = args && typeof args === "object" ? (args as { strings?: unknown }).strings : null
  return Array.isArray(strings) ? strings.join("?") : null
}

function outcomeOf(result: unknown): OperationEnd {
  if (Array.isArray(result)) {
    return { rowCount: result.length }
  }
  if (result && typeof result === "object" && "count" in result && typeof result.count === "number") {
    return { affectedRows: result.count }
  }
  return { rowCount: result === null || result === undefined ? 0 : 1 }
}

interface OperationParams {
  model?: string
  operation: string
  args: unknown
  query: (args: unknown) => Promise<unknown>
}

async function record({ model, operation, args, query }: OperationParams): Promise<unknown> {
  const recorder = wrapper.recorder()
  if (!recorder) {
    return await query(args)
  }
  const raw = operation.startsWith("$") ? rawText(args) : null
  const text = (raw ?? `${model ? `${model}.` : ""}${operation}${args === undefined || args === null ? "" : ` ${render(args)}`}`).slice(0, MAX_TEXT)
  const handle = recorder.begin({
    driver: "prisma",
    api: operation,
    text,
    connectionId: 0,
    analysis: describeOperation({ kind: kindOf(operation), label: operation.replace(/^\$/, "").toUpperCase(), targets: model ? [model] : [], text })
  })
  try {
    const result = await (handle ? runInOperation(handle.event, () => query(args)) : query(args))
    handle?.end(outcomeOf(result))
    return result
  } catch (error) {
    handle?.end({ error })
    throw error
  }
}

/** The argument of `prisma.$extends(...)`. */
export function prismaExtension() {
  return {
    name: "backend-dev-inspector",
    query: {
      // The top-level handler gets model operations (with `model`) and raw queries alike. Prisma runs a handler
      // registered under `$allModels` as well, so registering both recorded every model operation twice.
      $allOperations: (params: OperationParams) => record(params)
    }
  }
}
