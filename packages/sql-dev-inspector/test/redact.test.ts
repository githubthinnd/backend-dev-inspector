import { describe, expect, it } from "vitest"
import { runInRequest } from "../src/context"
import { parseRedactMode, redactParams, redactValue } from "../src/redact"
import { createRecorder } from "../src/recorder"
import { analyzeSql } from "../src/sql-analyzer"
import { TraceStore } from "../src/store"

const begin = (store: TraceStore, extra = {}) => {
  const trace = store.startRequest("GET", "/x")
  const text = "select * from users where email = 'a@b.c' and id = 7"
  const handle = runInRequest(trace, () => createRecorder(store).begin({ driver: "test", api: "query", text, connectionId: 1, analysis: analyzeSql(text), ...extra }))!
  return handle.event
}
const storeWith = (redact: "params" | "all" | "off") => Object.assign(new TraceStore({ maxRequests: 10, maxQueriesPerRequest: 10 }), { redact })

describe("redact mode", () => {
  it.each([
    [undefined, "params"], ["", "params"], ["params", "params"], ["1", "params"], ["true", "params"], ["bogus", "params"],
    ["all", "all"], ["STRICT", "all"],
    ["off", "off"], ["0", "off"], ["false", "off"], ["none", "off"]
  ])("%s → %s", (raw, mode) => {
    expect(parseRedactMode(raw)).toBe(mode)
  })

  it("a bare store keeps everything, as the tests of the drivers rely on", () => {
    expect(new TraceStore({ maxRequests: 1, maxQueriesPerRequest: 1 }).redact).toBe("off")
  })
})

describe("redacting values", () => {
  it("keeps the type and the size, never the value", () => {
    expect(redactValue("secret")).toBe("<string:6>")
    expect([redactValue(42), redactValue(true), redactValue(10n)]).toEqual(["<number>", "<boolean>", "<bigint>"])
    expect(redactValue(null)).toBe("<null>")
    expect(redactValue(undefined)).toBe("<null>")
    expect(redactValue(new Date())).toBe("<date>")
    expect(redactValue(Buffer.from("abc"))).toBe("<buffer:3>")
    expect(redactValue([1, 2])).toBe("<array:2>")
    expect(redactValue({ a: 1 })).toBe("<object>")
    expect(redactParams(["a@b.c", 7])).toEqual(["<string:5>", "<number>"])
    expect(redactParams(null)).toBeNull()
  })
})

describe("the recorder and redaction", () => {
  it("params (the default of the inspector): bind values are hidden, the statement is kept", () => {
    const event = begin(storeWith("params"), { params: ["a@b.c", 7] })
    expect(event.params).toEqual(["<string:5>", "<number>"])
    expect(event.sql).toContain("a@b.c") // typed into the SQL by the caller: not a bind value
  })

  it("params: a statement built from a template is shown as the template", () => {
    const event = begin(storeWith("params"), { template: "select * from users where email = ?", params: ["a@b.c"] })
    expect(event.sql).toBe("select * from users where email = ?")
    expect(JSON.stringify(event)).not.toContain("a@b.c")
  })

  it("all: the statement is shown with every value masked", () => {
    const event = begin(storeWith("all"), { params: ["a@b.c"] })
    expect(event.sql).not.toContain("a@b.c")
    expect(event.sql).not.toContain("7")
    expect(event.sql).toContain("?")
    expect(event.params).toEqual(["<string:5>"])
  })

  it("off: nothing is hidden", () => {
    const event = begin(storeWith("off"), { template: "select ?", params: ["a@b.c"] })
    expect(event.params).toEqual(["a@b.c"])
    expect(event.sql).toContain("a@b.c")
  })
})

describe("redaction and the N+1 detector", () => {
  const run = (rows: Array<{ params: unknown[] }>) => {
    const store = storeWith("params")
    const trace = store.startRequest("GET", "/x")
    runInRequest(trace, () => rows.forEach(({ params }) => createRecorder(store).begin({
      driver: "test", api: "query", text: "select * from users where id = ?", params, connectionId: 1, analysis: analyzeSql("select * from users where id = ?")
    })?.end()))
    return trace
  }

  it("still tells an N+1 (different values) from a duplicate (the same values), without showing a value", async () => {
    const { buildReport } = await import("../src/report")
    const loop = run([1, 2, 3, 4].map(id => ({ params: [id] })))
    expect(buildReport(loop).insights.map(i => i.type)).toContain("n-plus-one")
    expect(JSON.stringify(loop.queries)).not.toMatch(/"params":\[\s*[1-4]\s*\]/)

    const same = run([1, 1, 1, 1].map(id => ({ params: [id] })))
    const types = buildReport(same).insights.map(i => i.type)
    expect(types).toContain("duplicate")
    expect(types).not.toContain("n-plus-one")
  })
})
