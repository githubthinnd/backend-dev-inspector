import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { currentTrace, runInRequest } from "../src/context"
import { getInspector } from "../src/runtime"
import { installedDrivers, markSiblingLoaded, parseDriverList, resetInspectorForTests, startInspector } from "../src/setup"
import { analyzeSql } from "../src/sql-analyzer"

const DEV = { NODE_ENV: "development", SQL_INSPECTOR_LOG: "0", SQL_INSPECTOR_NOTICE: "0" } as const

function fake(name: string, present = true) {
  const calls = { install: 0, uninstall: 0 }
  return {
    calls,
    driver: {
      name,
      install: () => {
        calls.install++
        return present ? () => void calls.uninstall++ : null
      }
    }
  }
}

beforeEach(() => resetInspectorForTests())
afterEach(() => {
  vi.restoreAllMocks()
  resetInspectorForTests()
})

describe("driver registry", () => {
  it("installs only the drivers it is given, and each one once", () => {
    const a = fake("a")
    const b = fake("b")
    startInspector({ ...DEV }, { drivers: [a.driver] })
    startInspector({ ...DEV }, { drivers: [a.driver, b.driver] })
    startInspector({ ...DEV }, { drivers: [a.driver, b.driver] })
    expect(a.calls.install).toBe(1)
    expect(b.calls.install).toBe(1)
    expect(installedDrivers()).toEqual(["a", "b"])
  })

  it("retries a driver whose library was not there before, and does not record it as installed", () => {
    const missing = fake("late", false)
    startInspector({ ...DEV }, { drivers: [missing.driver] })
    expect(installedDrivers()).toEqual([])
    startInspector({ ...DEV }, { drivers: [missing.driver] })
    expect(missing.calls.install).toBe(2)
  })

  it("lets SQL_INSPECTOR_DRIVERS narrow the list, and `all` or nothing keeps everything", () => {
    const a = fake("a")
    const b = fake("b")
    startInspector({ ...DEV, SQL_INSPECTOR_DRIVERS: "B, other" }, { drivers: [a.driver, b.driver] })
    expect(installedDrivers()).toEqual(["b"])

    resetInspectorForTests()
    startInspector({ ...DEV, SQL_INSPECTOR_DRIVERS: "all" }, { drivers: [a.driver, b.driver] })
    expect(installedDrivers()).toEqual(["a", "b"])
    expect(parseDriverList(undefined)).toEqual([])
    expect(parseDriverList(" Pg , redis ")).toEqual(["pg", "redis"])
  })

  it("starts the application even when a driver cannot be installed, and still installs the others", () => {
    const broken = { name: "broken", install: () => {
      throw new Error("the native module was never built")
    } }
    const fine = fake("fine")
    expect(() => startInspector({ ...DEV }, { drivers: [broken, fine.driver] })).not.toThrow()
    expect(installedDrivers()).toEqual(["fine"])
  })

  it("does nothing in production or when switched off", () => {
    const a = fake("a")
    expect(startInspector({ NODE_ENV: "production", SQL_INSPECTOR: "1" }, { drivers: [a.driver] })).toBeNull()
    expect(startInspector({ ...DEV, SQL_INSPECTOR: "0" }, { drivers: [a.driver] })).toBeNull()
    expect(a.calls.install).toBe(0)
  })

  it("hands drivers a recorder wired to the shared store", () => {
    startInspector({ ...DEV }, {
      drivers: [{
        name: "probe",
        install: (recorder) => {
          const inspector = getInspector()
          expect(recorder.store).toBe(inspector.store)
          const handle = recorder.begin({ driver: "probe", api: "x", text: "select 1", connectionId: 1, analysis: analyzeSql("select 1") })
          handle?.end()
          return () => {}
        }
      }]
    })
    expect(getInspector().store.get("background")?.queries[0]).toMatchObject({ driver: "probe", sql: "select 1" })
    expect(currentTrace()).toBeUndefined()
    expect(runInRequest(getInspector().store.startRequest("GET", "/"), () => currentTrace()?.url)).toBe("/")
  })

  it("sets what the UI calls itself", () => {
    startInspector({ ...DEV }, { drivers: [], brand: { title: "Backend Inspector", short: "DEV" } })
    expect(getInspector().brand).toEqual({ title: "Backend Inspector", short: "DEV" })
  })
})

describe("the tip about backend-dev-inspector", () => {
  it("is printed once, with the package name and how to hide it", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    startInspector({ NODE_ENV: "development", SQL_INSPECTOR_LOG: "0" }, { drivers: [] })
    startInspector({ NODE_ENV: "development", SQL_INSPECTOR_LOG: "0" }, { drivers: [] })
    const tips = log.mock.calls.map(call => String(call[0])).filter(text => text.includes("backend-dev-inspector"))
    expect(tips).toHaveLength(1)
    expect(tips[0]).toContain("npm i backend-dev-inspector")
    expect(tips[0]).toContain("SQL_INSPECTOR_NOTICE=0")
  })

  it("can be hidden, and is not shown once the package it advertises is loaded", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    startInspector({ ...DEV }, { drivers: [] })
    expect(log).not.toHaveBeenCalled()

    resetInspectorForTests()
    markSiblingLoaded()
    startInspector({ NODE_ENV: "development", SQL_INSPECTOR_LOG: "0" }, { drivers: [] })
    expect(log).not.toHaveBeenCalled()
  })
})
