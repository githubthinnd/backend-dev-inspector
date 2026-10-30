import { describe, expect, it } from "vitest"
import { createRecorder } from "../src/recorder"
import { runInRequest } from "../src/context"
import { EDITORS, findCaller, resolveEditor, shortLocation } from "../src/caller"
import { buildReport } from "../src/report"
import { analyzeSql } from "../src/sql-analyzer"
import { TraceStore } from "../src/store"

/** What an application function that makes a call looks like to the stack: a frame of this test file. */
function applicationFunction() {
  return findCaller()
}

describe("finding the calling line", () => {
  it("is the first frame of the application: this file, with its line, not the inspector's or a library's", () => {
    const caller = applicationFunction()!
    expect(caller.file).toMatch(/test\/caller\.test\.ts$/)
    expect(caller.line).toBeGreaterThan(0)
    expect(caller.fn).toBe("applicationFunction")
  })

  it("is recorded on the call, only when the store asks for it", () => {
    const store = new TraceStore({ maxRequests: 10, maxQueriesPerRequest: 10 })
    const begin = () => {
      const trace = store.startRequest("GET", "/x")
      return runInRequest(trace, () => createRecorder(store).begin({ driver: "t", api: "q", text: "select 1", connectionId: 1, analysis: analyzeSql("select 1") }))!.event
    }
    expect(begin().caller).toBeUndefined()
    store.captureCaller = true
    expect(begin().caller!.file).toMatch(/test\/caller\.test\.ts$/)
  })

  it("puts the location on the insight that is about the call", () => {
    const store = new TraceStore({ maxRequests: 10, maxQueriesPerRequest: 20 })
    store.captureCaller = true
    const trace = store.startRequest("GET", "/loop")
    runInRequest(trace, () => {
      for (const id of [1, 2, 3, 4]) {
        const text = `select * from users where id = ${id}`
        createRecorder(store).begin({ driver: "t", api: "q", text, connectionId: 1, analysis: analyzeSql(text) })?.end()
      }
    })
    const insight = buildReport(trace).insights.find(i => i.type === "n-plus-one")!
    expect(String(insight.params.caller)).toMatch(/test\/caller\.test\.ts:\d+$/)
  })

  it("shows a location relative to the project when it is under it", () => {
    expect(shortLocation({ file: "/proj/src/a.ts", line: 3 }, "/proj")).toBe("src/a.ts:3")
    expect(shortLocation({ file: "/elsewhere/a.ts", line: 3 }, "/proj")).toBe("/elsewhere/a.ts:3")
  })
})

describe("the editor of the links", () => {
  it("takes a name, or a link template of an editor's own scheme, and falls back to VS Code otherwise", () => {
    expect(resolveEditor(undefined).name).toBe("vscode")
    expect(resolveEditor("Cursor")).toEqual({ name: "cursor", template: EDITORS.cursor })
    expect(resolveEditor("none")).toEqual({ name: "none", template: "" })
    expect(resolveEditor("idea://open?file={file}&line={line}").name).toBe("custom")
    expect(resolveEditor("zed://file/{path}:{line}").name).toBe("custom")
    for (const bad of ["javascript://{file}", "https://example.com/{file}", "vscode://nofile", "unknown"]) {
      expect(resolveEditor(bad).name, bad).toBe("vscode")
    }
  })
})
