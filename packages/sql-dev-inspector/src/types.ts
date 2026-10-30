export type StatementKind
  = | "select"
    | "insert"
    | "update"
    | "delete"
    | "replace"
    | "tx-begin"
    | "tx-commit"
    | "tx-rollback"
    | "tx-config"
    | "savepoint"
    | "savepoint-release"
    | "savepoint-rollback"
    | "other"

/** SQL flavours the analyser understands; they differ in quoting, placeholders, comments and transaction syntax. */
export type Dialect = "mysql" | "postgres" | "sqlite"

export interface SqlAnalysis {
  kind: StatementKind
  /**
   * What to show instead of the kind, for calls that are not SQL (`FIND`, `GET`, `HTTP GET`).
   * Their `kind` is the closest SQL statement (a read is a `select`) so that N+1 and repeat
   * detection work on them unchanged.
   */
  label?: string
  tables: string[]
  /** Deepest level of `(SELECT ...)` nesting; 0 = no subquery. */
  subqueryDepth: number
  subqueryCount: number
  /** SQL with literals masked, so two calls that differ only in values share one fingerprint. */
  fingerprint: string
  selectStar: boolean
  /** Savepoint name for savepoint / release / rollback-to statements. */
  savepoint: string | null
}

export interface QueryEvent {
  /** Monotonic across the process; also the call order. */
  seq: number
  requestId: string | null
  /** MySQL thread id of the connection that ran the statement (0 until the handshake is known). */
  connectionId: number
  api: string
  /** The SQL, or for other drivers the call rendered as one line (`users.find {"age":{"$gt":18}}`, `GET user:42`). */
  sql: string
  /** Which driver produced it (`mysql2`, `pg`, `redis`...). Absent on events built by hand. */
  driver?: string
  params: unknown[] | null
  /** Wall-clock start, ms since epoch. */
  startedAt: number
  /** null while the statement is still running. */
  durationMs: number | null
  rowCount: number | null
  affectedRows: number | null
  error: string | null
  analysis: SqlAnalysis
  /** Where in the application the call was made; absent when it is not looked for or the call came from a library alone. */
  caller?: { file: string, line: number, column: number, fn?: string }
  /**
   * What a library ran to carry out this call, for a call that is a layer over another watched driver: the SQL Prisma sent
   * to the database for `User.findMany {...}`. They are not counted as calls of their own.
   */
  statements?: QueryEvent[]
  /**
   * Facts about the call that are not its text: for an outbound HTTP call the status, the sizes and the content type.
   * Only plain, non-secret values (numbers and short strings).
   */
  details?: Record<string, string | number>
}

export interface RequestTrace {
  id: string
  method: string
  url: string
  status: number | null
  startedAt: number
  durationMs: number | null
  /** W3C trace context: the trace this request belongs to (the caller's when it sent a `traceparent`), and this request's own span. */
  traceId?: string
  spanId?: string
  /** The span of the call in another service that this request answers. */
  parentSpanId?: string
  queries: QueryEvent[]
  /** Statements dropped from the front of `queries` once the per-request cap was hit. */
  droppedQueries: number
  /** What the application printed while handling the request, when that is switched on (`SQL_INSPECTOR_LOGS`). */
  logs?: LogEntry[]
}

export interface LogEntry {
  level: "log" | "info" | "warn" | "error" | "debug"
  /** Wall-clock time, ms since epoch. */
  at: number
  message: string
  caller?: { file: string, line: number, column: number, fn?: string }
}

export type TraceNode
  = | { type: "query", query: QueryEvent }
    | TransactionNode

export interface TransactionNode {
  type: "transaction" | "savepoint"
  connectionId: number
  /** Savepoint name; null for a top-level transaction. */
  name: string | null
  status: "open" | "committed" | "rolled-back"
  startedAt: number
  durationMs: number | null
  children: TraceNode[]
}

export type InsightType
  = | "n-plus-one"
    | "duplicate"
    | "slow"
    | "select-star"
    | "select-in-transaction"
    | "write-outside-transaction"
    | "deep-subquery"
    | "error"
    | "many-queries"
    | "budget-calls"
    | "budget-time"
    | "budget-call-time"

export interface Insight {
  type: InsightType
  severity: "info" | "warn" | "error"
  /** Language-neutral values for the message template `insight.msg.<type>`. */
  params: Record<string, string | number>
  /** Already phrased in the server's locale (terminal, API consumers); front ends re-phrase from `params`. */
  message: string
  /** `seq` of the statements the insight is about. */
  seqs: number[]
  /** What to do about it, phrased in the server's locale; absent for an insight with nothing general to say (an error). */
  hint?: string
}

export interface RequestReport {
  trace: RequestTrace
  tree: TraceNode[]
  insights: Insight[]
  totals: {
    queryCount: number
    /** Sum of statement durations; overlapping statements (Promise.all) are counted in full. */
    sqlTimeMs: number
    /** Deepest `(SELECT ...)` nesting across the request's statements. */
    maxSubqueryDepth: number
    /** Where the request's time went. */
    breakdown: TimeBreakdown
  }
}

/**
 * Milliseconds of wall-clock time per kind of call. Calls that ran at the same time (Promise.all) are counted once,
 * so the parts never add up to more than `total`; `app` is what is left: the application's own work and waiting.
 */
export interface TimeBreakdown {
  database: number
  cache: number
  http: number
  app: number
  /** The request's duration, or until its last call ended while it is still running. */
  total: number
}
