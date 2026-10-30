import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { buildReport, createRecorder, getInspector, type RequestTrace, resetInspectorForTests, runInRequest, startInspector } from "sql-dev-inspector"
import { prismaDriver, prismaExtension } from "../src/drivers/prisma"

/**
 * No Prisma engine is available to a test, so these call the extension the way Prisma documents
 * it: `query.$allOperations({ model, operation, args, query })` with `query` running
 * the real operation. What Prisma does with the result is not exercised here.
 */
const extension = prismaExtension()

describe("registration", () => {
  it("registers one handler: Prisma runs a $allModels handler as well, which recorded every model operation twice", () => {
    expect(Object.keys(extension.query)).toEqual(["$allOperations"])
  })
})

const model = (operation: string, args: unknown, result: unknown, name = "User") =>
  extension.query.$allOperations({ model: name, operation, args, query: async () => result })

let uninstall: (() => void) | null = null
const request = (url: string): RequestTrace => getInspector().store.startRequest("GET", url)

beforeEach(() => {
  startInspector({ NODE_ENV: "development", SQL_INSPECTOR_LOG: "0", SQL_INSPECTOR_NOTICE: "0" }, { drivers: [] })
  uninstall = prismaDriver.install(createRecorder(getInspector().store))
})
afterEach(() => {
  uninstall?.()
  uninstall = null
  getInspector().store.clear()
  resetInspectorForTests()
})

describe("prisma extension", () => {
  it("records operations by model, with the arguments, the kind they resemble and their result", async () => {
    const trace = request("/users")
    const users = await runInRequest(trace, async () => {
      const found = await model("findMany", { where: { active: true } }, [{ id: 1 }, { id: 2 }])
      await model("create", { data: { name: "ann" } }, { id: 3 })
      await model("updateMany", { where: { active: false }, data: { active: true } }, { count: 4 })
      await model("delete", { where: { id: 3 } }, { id: 3 })
      return found
    })
    expect(users).toHaveLength(2)
    expect(trace.queries.map(q => [q.driver, q.analysis.label, q.analysis.kind, q.sql, q.rowCount, q.affectedRows])).toEqual([
      ["prisma", "FINDMANY", "select", `User.findMany {"where":{"active":true}}`, 2, null],
      ["prisma", "CREATE", "insert", `User.create {"data":{"name":"ann"}}`, 1, null],
      ["prisma", "UPDATEMANY", "update", `User.updateMany {"where":{"active":false},"data":{"active":true}}`, null, 4],
      ["prisma", "DELETE", "delete", `User.delete {"where":{"id":3}}`, 1, null]
    ])
    expect(trace.queries[0]!.analysis.tables).toEqual(["User"])
  })

  it("records raw queries by their SQL, and client-level calls", async () => {
    const trace = request("/raw")
    await runInRequest(trace, async () => {
      await extension.query.$allOperations({ operation: "$queryRawUnsafe", args: ["select id from users where id = $1", 7], query: async () => [{ id: 7 }] })
      await extension.query.$allOperations({ operation: "$queryRaw", args: { strings: ["select 1 where x = ", ""], values: [1] }, query: async () => [] })
    })
    expect(trace.queries.map(q => [q.analysis.label, q.analysis.kind, q.sql])).toEqual([
      ["QUERYRAWUNSAFE", "select", "select id from users where id = $1"],
      ["QUERYRAW", "select", "select 1 where x = ?"]
    ])
  })

  it("records a failure and rethrows it unchanged", async () => {
    const trace = request("/fail")
    const failure = new Error("Unique constraint failed")
    await expect(runInRequest(trace, () => extension.query.$allOperations({ model: "User", operation: "create", args: {}, query: async () => {
      throw failure
    } }))).rejects.toBe(failure)
    expect(trace.queries[0]!.error).toBe("Unique constraint failed")
  })

  it("reports an N+1 of findUnique calls that differ only by an id", async () => {
    const trace = request("/n-plus-one")
    await runInRequest(trace, async () => {
      for (const id of [1, 2, 3, 4]) {
        await model("findUnique", { where: { id } }, { id }, "Post")
      }
    })
    expect(buildReport(trace).insights.find(i => i.type === "n-plus-one")?.params.sql).toBe(`Post.findUnique {"where":{"id":?}}`)
  })

  it("keeps overlapping requests apart", async () => {
    const a = request("/a")
    const b = request("/b")
    const slow = (ms: number) => new Promise(resolve => setTimeout(() => resolve([]), ms))
    await Promise.all([
      runInRequest(a, () => extension.query.$allOperations({ model: "A", operation: "findMany", args: {}, query: () => slow(25) })),
      runInRequest(b, () => model("findMany", {}, [], "B"))
    ])
    expect(a.queries.map(q => q.sql)).toEqual(["A.findMany {}"])
    expect(b.queries.map(q => q.sql)).toEqual(["B.findMany {}"])
  })

  it("passes everything through untouched when no inspector is running", async () => {
    uninstall?.()
    uninstall = null
    const trace = request("/off")
    const result = await runInRequest(trace, () => model("findMany", {}, ["row"]))
    expect(result).toEqual(["row"])
    expect(trace.queries).toHaveLength(0)
  })
})
