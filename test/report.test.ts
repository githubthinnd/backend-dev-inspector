import type { QueryEvent, RequestTrace, TraceNode } from "../src/types"
import { describe, expect, it } from "vitest"
import { buildReport, buildTree, DEFAULT_REPORT_OPTIONS } from "../src/report"
import { analyzeSql } from "../src/sql-analyzer"

let seq = 0
function event(sql: string, overrides: Partial<QueryEvent> = {}): QueryEvent {
  return {
    seq: seq++,
    requestId: "r",
    connectionId: 1,
    api: "query",
    sql,
    params: null,
    startedAt: 1000 + seq,
    durationMs: 2,
    rowCount: null,
    affectedRows: null,
    error: null,
    analysis: analyzeSql(sql),
    ...overrides
  }
}

function trace(queries: QueryEvent[]): RequestTrace {
  return {
    id: "r",
    method: "GET",
    url: "/x",
    status: 200,
    startedAt: 1000,
    durationMs: 50,
    queries,
    droppedQueries: 0
  }
}

function shape(nodes: TraceNode[]): unknown[] {
  return nodes.map(n => n.type === "query" ? n.query.analysis.kind : { [n.type + (n.name ? `:${n.name}` : "")]: shape(n.children), status: n.status })
}

describe("buildTree", () => {
  it("keeps statements outside a transaction at the top level, in call order", () => {
    expect(shape(buildTree([event("select 1"), event("insert into t values (1)")]))).toEqual(["select", "insert"])
  })

  it("nests statements in begin..commit and hides the control statements", () => {
    const tree = buildTree([event("begin"), event("insert into t values (1)"), event("update t set a = 1"), event("commit"), event("select 1")])
    expect(shape(tree)).toEqual([{ transaction: ["insert", "update"], status: "committed" }, "select"])
  })

  it("nests savepoints, and marks a rolled back savepoint inside a committed transaction", () => {
    const tree = buildTree([
      event("begin"),
      event("insert into t values (1)"),
      event("savepoint sp1"),
      event("insert into t values (2)"),
      event("savepoint sp2"),
      event("update t set a = 1"),
      event("rollback to savepoint sp2"),
      event("release savepoint sp1"),
      event("commit")
    ])
    expect(shape(tree)).toEqual([{
      transaction: [
        "insert",
        { "savepoint:sp1": ["insert", { "savepoint:sp2": ["update"], "status": "rolled-back" }], "status": "committed" }
      ],
      status: "committed"
    }])
  })

  it("marks a rolled back transaction, and leaves an unfinished one open", () => {
    expect(shape(buildTree([event("begin"), event("insert into t values (1)"), event("rollback")]))).toEqual([{ transaction: ["insert"], status: "rolled-back" }])
    expect(shape(buildTree([event("begin"), event("insert into t values (1)")]))).toEqual([{ transaction: ["insert"], status: "open" }])
  })

  it("keeps interleaved transactions on different connections apart", () => {
    const tree = buildTree([
      event("begin", { connectionId: 1 }),
      event("begin", { connectionId: 2 }),
      event("insert into a values (1)", { connectionId: 1 }),
      event("insert into b values (1)", { connectionId: 2 }),
      event("select 1", { connectionId: 3 }),
      event("commit", { connectionId: 2 }),
      event("commit", { connectionId: 1 })
    ])
    expect(shape(tree)).toEqual([
      { transaction: ["insert"], status: "committed" },
      { transaction: ["insert"], status: "committed" },
      "select"
    ])
    const [first, second] = tree
    expect(first?.type === "transaction" && (first.children[0] as { query: QueryEvent }).query.sql).toContain("into a")
    expect(second?.type === "transaction" && (second.children[0] as { query: QueryEvent }).query.sql).toContain("into b")
  })

  it("times a transaction from begin to commit", () => {
    const tree = buildTree([event("begin", { startedAt: 1000, durationMs: 1 }), event("commit", { startedAt: 1040, durationMs: 3 })])
    expect(tree[0]).toMatchObject({ type: "transaction", durationMs: 43 })
  })
})

describe("buildReport insights", () => {
  const types = (queries: QueryEvent[], transactionConvention = false) =>
    buildReport(trace(queries), { ...DEFAULT_REPORT_OPTIONS, transactionConvention }).insights.map(i => i.type)

  it("flags N+1: same shape, different values", () => {
    const queries = [1, 2, 3].map(id => event(`select \`id\` from \`orders\` where \`user_id\` = ${id}`))
    const insight = buildReport(trace(queries)).insights.find(i => i.type === "n-plus-one")
    expect(insight?.seqs).toEqual(queries.map(q => q.seq))
  })

  it("does not flag two similar queries, or different shapes", () => {
    expect(types([event("select 1 from a where id = 1"), event("select 1 from a where id = 2")])).toEqual([])
    expect(types([event("select 1 from a"), event("select 1 from b"), event("select 1 from c")])).toEqual([])
  })

  it("flags exact repeats as duplicates, not N+1", () => {
    expect(types([event("select 1 from a"), event("select 1 from a")])).toEqual(["duplicate"])
    expect(types([event("select 1 from a"), event("select 1 from a"), event("select 1 from a")])).toEqual(["duplicate"])
  })

  it("flags slow statements against the threshold", () => {
    expect(types([event("select 1 from a", { durationMs: 99 })])).toEqual([])
    expect(types([event("select 1 from a", { durationMs: 100 })])).toEqual(["slow"])
  })

  it("flags errors, select *, and deep subqueries", () => {
    expect(types([event("select 1 from a", { error: "boom" })])).toContain("error")
    expect(types([event("select * from a")])).toContain("select-star")
    expect(types([event("select * from a where x in (select x from b where y in (select y from c where z in (select z from d)))")])).toContain("deep-subquery")
  })

  it("checks the transaction convention only when asked: reads outside, writes inside", () => {
    const readInside = [event("begin"), event("select 1 from a"), event("commit")]
    expect(types(readInside)).not.toContain("select-in-transaction")
    expect(types(readInside, true)).toContain("select-in-transaction")
    expect(types([event("begin"), event("insert into a values (1)"), event("commit"), event("select 1 from a")], true)).not.toContain("select-in-transaction")

    const loose = [event("insert into a values (1)"), event("update b set x = 1")]
    expect(types(loose)).not.toContain("write-outside-transaction")
    expect(types(loose, true)).toContain("write-outside-transaction")
    expect(types([event("insert into a values (1)")], true)).not.toContain("write-outside-transaction")
  })

  it("totals exclude transaction control statements", () => {
    const report = buildReport(trace([event("begin"), event("insert into a values (1)", { durationMs: 5 }), event("commit")]))
    expect(report.totals).toMatchObject({ queryCount: 1, sqlTimeMs: 5 })
  })
})
