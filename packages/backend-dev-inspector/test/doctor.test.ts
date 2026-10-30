import { afterEach, describe, expect, it } from "vitest"
import { getInspector, resetInspectorForTests } from "sql-dev-inspector"
import { libraryChecks, WATCHED_LIBRARIES } from "../src/doctor"
import { main } from "../src/cli"
import { locate } from "../src/peer"

afterEach(() => resetInspectorForTests())

describe("library checks", () => {
  const only = (name: string, location: { fromApp: string | null, fromPackage: string | null }) => (asked: string) => asked === name ? location : { fromApp: null, fromPackage: null }

  it("says which watched libraries it found, once each", () => {
    const checks = libraryChecks(name => ["pg", "mysql2"].includes(name) ? { fromApp: `/app/node_modules/${name}/index.js`, fromPackage: `/app/node_modules/${name}/index.js` } : { fromApp: null, fromPackage: null })
    expect(checks).toEqual([{ id: "libraries", status: "ok", message: "Found: pg, mysql2." }])
  })

  it("warns about two copies of one library, naming both", () => {
    const [check] = libraryChecks(only("pg", { fromApp: "/app/node_modules/pg/lib/index.js", fromPackage: "/repo/node_modules/pg/lib/index.js" }))
    expect(check).toMatchObject({ id: "library:pg", status: "warn" })
    expect(check!.message).toContain("/app/node_modules/pg")
    expect(check!.message).toContain("/repo/node_modules/pg")
  })

  it("errors when the application has a library the inspector cannot load", () => {
    const [check] = libraryChecks(only("mongodb", { fromApp: "/app/node_modules/mongodb/lib/index.js", fromPackage: null }))
    expect(check).toMatchObject({ id: "library:mongodb", status: "error" })
  })

  it("says nothing about libraries the application does not have", () => {
    expect(libraryChecks(() => ({ fromApp: null, fromPackage: null }))).toEqual([])
  })

  it("knows where the real libraries of this checkout are", () => {
    const where = locate("better-sqlite3")
    expect(where.fromApp ?? where.fromPackage).toMatch(/better-sqlite3/)
    expect(WATCHED_LIBRARIES).toContain("@libsql/client")
  })
})

describe("the doctor command", () => {
  it("prints what it found, and succeeds when nothing is wrong", () => {
    let out = ""
    const code = main(["doctor"], (text) => { out += text })
    expect(out).toContain("backend-dev-inspector doctor")
    expect(out).toContain("Watching:")
    expect(out).toMatch(/✓ Node\.js/)
    expect([0, 1]).toContain(code) // 1 only if a library of this checkout cannot be loaded
    expect(getInspector()).toBeDefined()
  })

  it("explains its usage, and refuses an unknown command", () => {
    let out = ""
    expect(main([], (text) => { out += text })).toBe(0)
    expect(out).toContain("Usage")
    expect(main(["nonsense"], () => {})).toBe(1)
  })
})
