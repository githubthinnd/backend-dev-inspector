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

export interface SqlAnalysis {
  kind: StatementKind
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
  api: "query" | "execute"
  sql: string
  params: unknown[] | null
  /** Wall-clock start, ms since epoch. */
  startedAt: number
  /** null while the statement is still running. */
  durationMs: number | null
  rowCount: number | null
  affectedRows: number | null
  error: string | null
  analysis: SqlAnalysis
}

export interface RequestTrace {
  id: string
  method: string
  url: string
  status: number | null
  startedAt: number
  durationMs: number | null
  queries: QueryEvent[]
  /** Statements dropped from the front of `queries` once the per-request cap was hit. */
  droppedQueries: number
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

export interface Insight {
  type: InsightType
  severity: "info" | "warn" | "error"
  /** Language-neutral values for the message template `insight.msg.<type>`. */
  params: Record<string, string | number>
  /** Already phrased in the server's locale (terminal, API consumers); front ends re-phrase from `params`. */
  message: string
  /** `seq` of the statements the insight is about. */
  seqs: number[]
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
  }
}
