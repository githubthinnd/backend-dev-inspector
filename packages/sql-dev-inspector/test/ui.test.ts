import type { Locale } from "../src/i18n"
import type { QueryEvent, RequestTrace } from "../src/types"
import { createWindow } from "./dom"
import { describe, expect, it, vi } from "vitest"
import { compareReports } from "../src/compare"
import { buildOverview } from "../src/overview"
import { buildReport } from "../src/report"
import { analyzeSql, formatSql } from "../src/sql-analyzer"
import { renderPage } from "../src/ui/page"

let seq = 0
function query(sql: string, extra: Partial<QueryEvent> = {}): QueryEvent {
  return {
    seq: seq++,
    requestId: "r",
    connectionId: 7,
    api: "query",
    sql,
    params: null,
    startedAt: 1000 + seq * 3,
    durationMs: 2.5,
    rowCount: 2,
    affectedRows: null,
    error: null,
    analysis: analyzeSql(sql),
    ...extra
  }
}

const WHERE = { file: "/proj/src/orders.ts", line: 42, column: 7, fn: "loadItems" }

function trace(id: string, url: string, queries: QueryEvent[], method = "GET", logs?: RequestTrace["logs"]): RequestTrace {
  return {
    ...(logs ? { logs } : {}),
    id,
    method,
    url,
    status: 200,
    startedAt: 1000,
    durationMs: 40,
    queries,
    droppedQueries: 0
  }
}

const nPlusOne = [1, 2, 3].map(i => query(`select \`id\` from \`order_items\` where \`order_id\` = ${i}`, { caller: WHERE }))
function buildTraces(layered = false, values: "real" | "hidden" | null = null, custom?: { sql: string, params: unknown[] }) {
  return [
    trace("a", "/api/order-detail/1", [
      ...nPlusOne,
      query("select * from `x` where `id` in (select `id` from `y`)"),
      query("begin"),
      query("insert into `<img src=x onerror=window.__pwned=1>` values (1)", { rowCount: null, affectedRows: 1 }),
      query("commit")
    ], "GET", [{ level: "warn", at: 1020, message: "cache miss for order 1\nsecond line", caller: WHERE }, { level: "log", at: 1030, message: "done" }]),
    trace("b", "/api/customers", [query(custom ? custom.sql : values ? "select 1 from `customers` where `id` = ? and `note` = 'a?b' and `n` = ?" : "select 1 from `customers`", custom ? { params: custom.params } : values ? { params: values === "real" ? [7, "O'Brien"] : ["<number>", "<string:7>"] } : layered ? { driver: "prisma", details: { status: 200, requestBytes: 7, responseBytes: 2048, contentType: "application/json" }, statements: [query("select `id` from `customers` limit 1", { driver: "libsql", rowCount: 1 })] } : {})], "POST"),
    trace("c", "/api/broken", [query("select boom", { error: "You have an error in your SQL syntax" })])
  ]
}

interface Options {
  languages?: string[]
  hint?: Locale | null
  stored?: Record<string, string>
  width?: number
  clipboard?: (text: string) => Promise<void>
  /** What the server says about the slow-query threshold. */
  slow?: { slowMs: number, defaultSlowMs: number }
  layered?: boolean
  values?: "real" | "hidden"
  recordedUnder?: "params" | "all" | "off"
  statement?: { sql: string, params: unknown[] }
}

interface Source { onopen: (() => void) | null, onmessage: ((event: { data: string }) => void) | null, onerror: (() => void) | null }

function render(options: Options = {}) {
  const traces = buildTraces(options.layered, options.values ?? null, options.statement)
  if (options.recordedUnder) {
    traces.forEach((t) => { t.redact = options.recordedUnder })
  }
  const reports = new Map(traces.map(t => [t.id, buildReport(t)]))
  const window = createWindow({ url: "http://localhost/__sql-inspector/", width: options.width ?? 1280, height: 800 })
  Object.defineProperty(window.navigator, "languages", { value: options.languages ?? ["en-US"], configurable: true })
  for (const [key, value] of Object.entries(options.stored ?? {})) {
    window.localStorage.setItem(key, value)
  }
  const calls: { path: string, init?: RequestInit }[] = []
  const sources: Source[] = []
  const slow = { slowMs: 100, defaultSlowMs: 100, min: 1, max: 600000, redact: "params", include: [] as string[], exclude: [] as string[], mount: "__sql-inspector", ...options.slow }
  const respond = (path: string, init?: RequestInit) => {
    calls.push({ path, init })
    if (path === "settings") {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { slowMs?: number | null, redact?: string | null, include?: string[] | null, exclude?: string[] | null, stack?: boolean | null, logs?: boolean | null, editor?: string | null }
        if ("slowMs" in body) {
          slow.slowMs = body.slowMs ?? slow.defaultSlowMs
        }
        if ("redact" in body) {
          slow.redact = body.redact ?? "params"
        }
        if ("include" in body) {
          slow.include = body.include ?? []
        }
        if ("exclude" in body) {
          slow.exclude = body.exclude ?? []
        }
        if ("logs" in body) {
          ;(slow as { logs?: boolean }).logs = body.logs ?? false
        }
        if ("stack" in body) {
          ;(slow as { stack?: boolean }).stack = body.stack ?? true
        }
        if ("editor" in body) {
          ;(slow as { editor?: unknown }).editor = { name: body.editor ?? "vscode", template: "" }
        }
      }
      return { ...slow }
    }
    if (path === "clear") {
      return { ok: true }
    }
    if (path === "requests") {
      return Array.from(reports.values(), ({ trace: t, totals, insights }) => ({
        id: t.id,
        method: t.method,
        url: t.url,
        status: t.status,
        startedAt: t.startedAt,
        durationMs: t.durationMs,
        queryCount: totals.queryCount,
        sqlTimeMs: totals.sqlTimeMs,
        warnings: insights.filter(i => i.severity === "warn").length,
        errors: insights.filter(i => i.severity === "error").length
      }))
    }
    const report = reports.get(path.replace("requests/", ""))!
    return { ...report, formattedSql: Object.fromEntries(report.trace.queries.map(q => [q.seq, formatSql(q.sql)])) }
  }
  const clipboard = options.clipboard ?? (() => Promise.resolve())
  Object.assign(window, {
    fetch: (url: string, init?: RequestInit) => Promise.resolve({ json: () => Promise.resolve(respond(String(url).replace("./api/", ""), init)) }),
    EventSource: class {
      onopen: (() => void) | null = null
      onmessage: ((event: { data: string }) => void) | null = null
      onerror: (() => void) | null = null
      constructor() {
        sources.push(this)
      }
    }
  })
  Object.defineProperty(window.navigator, "clipboard", { value: { writeText: clipboard }, configurable: true })

  // the page script is not run by the DOM when written into the document, so written into the document, so the page's one script is
  // evaluated by hand, against the same markup the browser would get.
  const html = renderPage(options.hint ?? null)
  const script = /<script>([\s\S]*)<\/script>/.exec(html)![1]!
  window.document.open()
  window.document.write(html.replace(/<script>[\s\S]*<\/script>/, ""))
  window.document.close()
  window.eval(script)
  return { window, document: window.document, html, calls, sources, slow, traces }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 25))
const click = (el: unknown) => (el as HTMLElement).click()
async function selectRequest(document: ReturnType<typeof render>["document"], index = 0) {
  click(document.querySelectorAll(".req")[index])
  await settle()
}

describe("inspector page", () => {
  it("lists requests with method, status and query count, and flags the ones with issues", async () => {
    const { document } = render()
    await settle()
    const rows = Array.from(document.querySelectorAll(".req"))
    expect(rows).toHaveLength(3)
    expect(rows[0]!.textContent).toContain("/api/order-detail/1")
    expect(rows[0]!.textContent).toContain("5 queries")
    expect(rows[0]!.classList.contains("has-warn")).toBe(true)
    expect(rows[2]!.classList.contains("has-err")).toBe(true)
    expect(document.getElementById("count")!.textContent).toBe("3")
  })

  it("shows KPIs, insights and the nested tree for a selected request, and escapes SQL", async () => {
    const { document, window } = render()
    await settle()
    await selectRequest(document)

    expect(document.querySelector("#detail h1")!.textContent).toBe("/api/order-detail/1")
    const kpis = Array.from(document.querySelectorAll(".kpi-label"), k => k.textContent)
    expect(kpis).toEqual(["Total time", "Queries", "SQL time", "Transactions", "Max subquery depth"])
    expect(document.querySelectorAll(".tx")).toHaveLength(1)
    expect(document.querySelector(".tx .chip.ok")!.textContent).toBe("Committed")
    expect(document.querySelectorAll(".q")).toHaveLength(5)
    expect(document.querySelectorAll(".tx .q")).toHaveLength(1)
    expect(document.querySelector(".insight.warn .insight-title")!.textContent).toBe("N+1 queries")
    expect(document.querySelector(".insight.warn .insight-msg")!.textContent).toContain("3 similar queries")

    expect(document.querySelector("img")).toBeNull()
    expect(document.body.textContent).toContain("<img src=x onerror=window.__pwned=1>")
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
  })

  it("expands a statement to highlighted, formatted SQL; switches to raw SQL; copies it", async () => {
    const copied: string[] = []
    const { document } = render({ clipboard: (text) => { copied.push(text); return Promise.resolve() } })
    await settle()
    await selectRequest(document)

    const target = Array.from(document.querySelectorAll(".q")).find(q => q.textContent!.includes("Subquery"))!
    expect(target.classList.contains("open")).toBe(false)
    click(target.querySelector(".q-head"))
    expect(target.classList.contains("open")).toBe(true)
    const pre = target.querySelector("pre.sql")!
    expect(pre.textContent).toContain("\nfrom `x`")
    expect(Array.from(pre.querySelectorAll(".kw"), n => n.textContent)).toContain("select")
    expect(Array.from(pre.querySelectorAll(".id"), n => n.textContent)).toContain("`id`")

    click(Array.from(target.querySelectorAll(".seg button")).find(b => b.textContent === "Raw")!)
    expect(target.querySelector("pre.sql")!.textContent).not.toContain("\n")

    click(Array.from(target.querySelectorAll(".btn")).find(b => b.textContent!.includes("Copy SQL"))!)
    await settle()
    expect(copied).toEqual(["select * from `x` where `id` in (select `id` from `y`)"])
    expect(document.getElementById("toast")!.textContent).toBe("SQL copied to clipboard")
  })

  it("highlights the statements an insight is about, and collapses and expands a transaction", async () => {
    const { document } = render()
    await settle()
    await selectRequest(document)

    click(document.querySelector(".insight.warn"))
    expect(document.querySelectorAll(".q.hl")).toHaveLength(3)

    click(document.querySelector(".tx-head"))
    expect(document.querySelectorAll(".tx .q")).toHaveLength(0)
    click(document.querySelector(".tx-head"))
    expect(document.querySelectorAll(".tx .q")).toHaveLength(1)
  })

  it("expand all / collapse all opens and closes every statement", async () => {
    const { document } = render()
    await settle()
    await selectRequest(document)
    click(Array.from(document.querySelectorAll(".section-head .btn")).find(b => b.textContent === "Expand all")!)
    expect(document.querySelectorAll(".q.open")).toHaveLength(5)
    click(Array.from(document.querySelectorAll(".section-head .btn")).find(b => b.textContent === "Collapse all")!)
    expect(document.querySelectorAll(".q.open")).toHaveLength(0)
  })

  it("filters by text and by issues / errors", async () => {
    const { document, window } = render()
    await settle()
    const search = document.getElementById("search") as unknown as HTMLInputElement
    search.value = "customers"
    search.dispatchEvent(new window.Event("input") as never)
    expect(Array.from(document.querySelectorAll(".req"), r => r.textContent)).toEqual([expect.stringContaining("/api/customers")])

    search.value = ""
    search.dispatchEvent(new window.Event("input") as never)
    click(document.querySelector("[data-mode=errors]"))
    expect(Array.from(document.querySelectorAll(".req"), r => r.textContent)).toEqual([expect.stringContaining("/api/broken")])
    click(document.querySelector("[data-mode=issues]"))
    expect(document.querySelectorAll(".req")).toHaveLength(2)

    search.value = "zzz"
    search.dispatchEvent(new window.Event("input") as never)
    expect(document.getElementById("list-body")!.textContent).toBe("No requests match your filter")
  })

  it("follows the latest request when asked", async () => {
    const { document } = render()
    await settle()
    expect(document.querySelector("#detail .empty h3")!.textContent).toBe("Select a request")
    click(document.getElementById("follow"))
    await settle()
    expect(document.getElementById("follow")!.getAttribute("aria-checked")).toBe("true")
    expect(document.querySelector("#detail h1")!.textContent).toBe("/api/order-detail/1")
  })

  it("navigates the list with j / k and focuses the search with /", async () => {
    const { document, window } = render()
    await settle()
    const press = (key: string) => document.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true }) as never)
    press("j")
    await settle()
    expect(document.querySelector("#detail h1")!.textContent).toBe("/api/order-detail/1")
    press("j")
    await settle()
    expect(document.querySelector("#detail h1")!.textContent).toBe("/api/customers")
    press("k")
    await settle()
    expect(document.querySelector("#detail h1")!.textContent).toBe("/api/order-detail/1")
    press("/")
    expect(document.activeElement).toBe(document.getElementById("search"))
  })

  it("cycles the theme through system → light → dark and remembers it", async () => {
    const { document, window } = render()
    await settle()
    const root = document.documentElement
    expect(root.getAttribute("data-theme")).toBeNull()
    click(document.getElementById("theme"))
    expect(root.getAttribute("data-theme")).toBe("light")
    click(document.getElementById("theme"))
    expect(root.getAttribute("data-theme")).toBe("dark")
    expect(window.localStorage.getItem("sqlDevInspector.theme")).toBe("dark")
    click(document.getElementById("theme"))
    expect(root.getAttribute("data-theme")).toBeNull()
  })

  it("shows one pane at a time when narrow, with a way back", async () => {
    const { document, window } = render({ width: 480 })
    ;(window as { innerWidth: number }).innerWidth = 480
    window.dispatchEvent(new window.Event("resize") as never)
    await settle()
    const app = document.getElementById("app")!
    expect(app.classList.contains("narrow")).toBe(true)
    expect(app.getAttribute("data-view")).toBe("list")
    await selectRequest(document)
    expect(app.getAttribute("data-view")).toBe("detail")
    click(document.querySelector(".back"))
    expect(app.getAttribute("data-view")).toBe("list")
  })

  it("clears the history through the API", async () => {
    const calls: string[] = []
    const { document, window } = render()
    const original = (window as unknown as { fetch: (url: string, init?: { method?: string }) => Promise<unknown> }).fetch
    ;(window as unknown as { fetch: unknown }).fetch = (url: string, init?: { method?: string }) => {
      calls.push(`${init?.method ?? "GET"} ${url}`)
      return original(url, init)
    }
    await settle()
    click(document.getElementById("clear"))
    await settle()
    expect(calls).toContain("POST ./api/clear")
  })
})

describe("where a call was made", () => {
  const editor = { name: "vscode", template: "vscode://file/{path}:{line}:{column}" }

  it("shows the calling line of an insight and of a statement, as a link that opens the editor", async () => {
    const { document, sources } = render({ slow: { slowMs: 100, defaultSlowMs: 100, root: "/proj", editor, stack: true } as never })
    sources[0]!.onopen!()
    await settle()
    await selectRequest(document)
    expect(document.querySelector(".insight-where")!.textContent).toBe("Called from src/orders.ts:42")

    const statement = Array.from(document.querySelectorAll(".q")).find(q => q.textContent!.includes("order_items"))!
    click(statement.querySelector(".q-head"))
    const link = statement.querySelector("a.caller") as unknown as HTMLAnchorElement
    expect(link.textContent).toBe("src/orders.ts:42")
    expect(link.getAttribute("href")).toBe("vscode://file/proj/src/orders.ts:42:7")
  })

  it("shows what to do about an insight, under it", async () => {
    const { document } = render()
    await settle()
    await selectRequest(document)
    const hint = document.querySelector(".insight-hint")!
    expect(hint.textContent).toContain("How to fix")
    expect(hint.textContent).toContain("join")
  })

  it("shows the location without a link when the editor is off, and never links a scheme that is not an editor's", async () => {
    for (const template of ["", "javascript:alert(1)//{path}"]) {
      const { document, sources } = render({ slow: { slowMs: 100, defaultSlowMs: 100, root: "/proj", editor: { name: "none", template }, stack: true } as never })
      sources[0]!.onopen!()
      await settle()
      await selectRequest(document)
      const statement = Array.from(document.querySelectorAll(".q")).find(q => q.textContent!.includes("order_items"))!
      click(statement.querySelector(".q-head"))
      expect(statement.querySelector("a.caller")).toBeNull()
      expect(statement.querySelector("span.caller")!.textContent).toBe("src/orders.ts:42")
    }
  })

  it("turns the search for the calling line off and on, and picks the editor, from the settings", async () => {
    const { document, calls, sources } = render({ slow: { slowMs: 100, defaultSlowMs: 100, stack: true, editor } as never })
    sources[0]!.onopen!()
    await settle()
    expect(document.getElementById("stack-switch")!.getAttribute("aria-checked")).toBe("true")
    ;(document.getElementById("stack-switch") as unknown as HTMLElement).click()
    ;(document.querySelector("[data-editor='cursor']") as unknown as HTMLElement).click()
    await settle()
    const posts = calls.filter(c => c.path === "settings" && c.init?.method === "POST").map(c => JSON.parse(String(c.init!.body)))
    expect(posts).toEqual([{ stack: false }, { editor: "cursor" }])
  })
})

describe("settings: hiding values and the requests to follow", () => {
  const byId = (document: ReturnType<typeof render>["document"], id: string) => document.getElementById(id) as unknown as HTMLElement
  const posts = (calls: ReturnType<typeof render>["calls"]) => calls.filter(c => c.path === "settings" && c.init?.method === "POST").map(c => JSON.parse(String(c.init!.body)))
  const change = (window: ReturnType<typeof render>["window"], input: HTMLElement, value: string) => {
    ;(input as unknown as HTMLInputElement).value = value
    input.dispatchEvent(new window.Event("change") as never)
  }

  it("shows in the top bar that values are hidden, and opens the settings from it", async () => {
    const { document, sources } = render()
    sources[0]!.onopen!()
    await settle()
    const pill = byId(document, "privacy")
    expect(pill.textContent).toContain("Values hidden")
    expect(pill.getAttribute("data-mode")).toBe("params")
    expect(byId(document, "settings-pop").hidden).toBe(true)
    pill.click()
    expect(byId(document, "settings-pop").hidden).toBe(false)
  })

  it("opens from the gear button, closes on Escape, and keeps the first control reachable", async () => {
    const { document, window } = render()
    await settle()
    const gear = byId(document, "settings")
    const pop = byId(document, "settings-pop")
    gear.click()
    expect(pop.hidden).toBe(false)
    expect(gear.getAttribute("aria-expanded")).toBe("true")
    expect(pop.getAttribute("role")).toBe("dialog")
    pop.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }) as never)
    expect(pop.hidden).toBe(true)
    expect(gear.getAttribute("aria-expanded")).toBe("false")
  })

  it("changes how values are hidden, and the pill follows what the server says", async () => {
    const { document, calls, sources } = render()
    sources[0]!.onopen!()
    await settle()
    const off = document.querySelector("[data-redact='off']") as unknown as HTMLElement
    off.click()
    await settle()
    expect(posts(calls)).toEqual([{ redact: "off" }])
    expect(byId(document, "privacy").getAttribute("data-mode")).toBe("off")
    expect(byId(document, "privacy").textContent).toContain("Values visible")
    expect(off.getAttribute("aria-pressed")).toBe("true")
    expect(byId(document, "redact-hint").textContent).toContain("Do not share your screen")

    ;(document.querySelector("[data-redact='all']") as unknown as HTMLElement).click()
    await settle()
    expect(byId(document, "privacy").textContent).toContain("Statements masked")
  })

  it("sends the routes to include and exclude as lists, and shows what the server holds", async () => {
    const { document, window, calls, sources } = render({ slow: { slowMs: 100, defaultSlowMs: 100, include: ["/api/**"], exclude: [] } as never })
    sources[0]!.onopen!()
    await settle()
    expect((byId(document, "include-input") as unknown as HTMLInputElement).value).toBe("/api/**")
    change(window, byId(document, "exclude-input"), " /health , /api/webhooks/** ,")
    await settle()
    expect(posts(calls)).toEqual([{ exclude: ["/health", "/api/webhooks/**"] }])
    change(window, byId(document, "include-input"), "")
    await settle()
    expect(posts(calls).at(-1)).toEqual({ include: [] })
  })

  it("resets the three settings to the server's defaults, and shows the address of the page", async () => {
    const { document, calls, sources } = render({ slow: { slowMs: 100, defaultSlowMs: 100, mount: "_dev/sql", redact: "off" } as never })
    sources[0]!.onopen!()
    await settle()
    expect(byId(document, "path-value").textContent).toBe("/_dev/sql/")
    byId(document, "settings-reset").click()
    await settle()
    expect(posts(calls)).toEqual([{ redact: null, include: null, exclude: null, budgets: null, stack: null, logs: null, editor: null }])
    expect(byId(document, "privacy").getAttribute("data-mode")).toBe("params")
  })
})

describe("slow query threshold box", () => {
  const SLOW_KEY = "sqlDevInspector.slowMs"
  const box = (document: ReturnType<typeof render>["document"]) => document.getElementById("slow") as unknown as HTMLInputElement
  const commit = (window: ReturnType<typeof render>["window"], input: HTMLInputElement, value: string) => {
    input.value = value
    input.dispatchEvent(new window.Event("change") as never)
  }
  const settingsPosts = (calls: ReturnType<typeof render>["calls"]) => calls.filter(c => c.path === "settings" && c.init?.method === "POST").map(c => JSON.parse(String(c.init!.body)))

  it("is in the top bar, empty, with the server default as its placeholder once connected", async () => {
    const { document, sources } = render({ slow: { slowMs: 150, defaultSlowMs: 150 } })
    await settle()
    expect(document.querySelector(".topbar #slow")).not.toBeNull()
    sources[0]!.onopen!()
    await settle()
    expect(box(document).value).toBe("")
    expect(box(document).placeholder).toBe("150")
    expect(box(document).getAttribute("aria-label")).toBe("Slow query threshold")
  })

  it("sends a typed threshold, remembers it, and goes back to the default when emptied", async () => {
    const { document, window, calls, slow } = render()
    await settle()

    commit(window, box(document), "250")
    await settle()
    expect(settingsPosts(calls)).toEqual([{ slowMs: 250 }])
    expect(slow.slowMs).toBe(250)
    expect(window.localStorage.getItem(SLOW_KEY)).toBe("250")
    expect(box(document).value).toBe("250")

    commit(window, box(document), "")
    await settle()
    expect(settingsPosts(calls).at(-1)).toEqual({ slowMs: null })
    expect(window.localStorage.getItem(SLOW_KEY)).toBeNull()
    expect(box(document).value).toBe("")
  })

  it("ignores values below 1 ms and puts the real value back", async () => {
    const { document, window, calls, sources } = render({ slow: { slowMs: 300, defaultSlowMs: 100 } })
    await settle()
    sources[0]!.onopen!()
    await settle()
    const before = settingsPosts(calls).length

    commit(window, box(document), "0")
    await settle()

    expect(settingsPosts(calls)).toHaveLength(before)
    expect(box(document).value).toBe("300")
  })

  it("re-applies a saved threshold when the stream connects, e.g. after a server restart", async () => {
    const { calls, sources } = render({ stored: { [SLOW_KEY]: "400" } })
    await settle()
    sources[0]!.onopen!()
    await settle()
    expect(settingsPosts(calls)).toEqual([{ slowMs: 400 }])
  })

  it("follows a change announced on the stream, so another viewer's value shows up", async () => {
    const { document, sources, slow } = render()
    await settle()
    sources[0]!.onopen!()
    await settle()
    slow.slowMs = 500

    sources[0]!.onmessage!({ data: JSON.stringify({ changed: ["settings"] }) })
    await settle()

    expect(box(document).value).toBe("500")
  })
})

describe("inspector page i18n", () => {
  it("speaks English by default and has no untranslated keys on screen", async () => {
    const { document } = render()
    await settle()
    await selectRequest(document)
    expect(document.documentElement.lang).toBe("en")
    expect(document.title).toBe("SQL Inspector")
    expect(document.body.textContent).not.toMatch(/\b(?:insight|kpi|tree|sql|tx|status|requests|detail|filter|search|shortcuts)\.[a-z-]+/)
  })

  it("follows the browser language", async () => {
    const { document } = render({ languages: ["ja-JP", "en"] })
    await settle()
    expect(document.documentElement.lang).toBe("ja")
    expect(document.querySelector("[data-mode=errors]")!.textContent).toBe("エラー")
  })

  it("lets the server's configured language beat the browser, and a saved choice beat both", async () => {
    const hinted = render({ languages: ["ja-JP"], hint: "vi" })
    await settle()
    expect(hinted.document.documentElement.lang).toBe("vi")

    const saved = render({ languages: ["ja-JP"], hint: "vi", stored: { "sqlDevInspector.lang": "en" } })
    await settle()
    expect(saved.document.documentElement.lang).toBe("en")
  })

  it("switches language live from a custom menu, re-phrases insights from their parameters, and remembers the choice", async () => {
    const { document, window } = render()
    await settle()
    await selectRequest(document)
    const button = document.getElementById("lang") as unknown as HTMLElement
    const menu = document.getElementById("lang-menu") as unknown as HTMLElement
    expect(menu.hidden).toBe(true)
    click(button)
    expect(menu.hidden).toBe(false)
    expect(button.getAttribute("aria-expanded")).toBe("true")
    expect(Array.from(menu.querySelectorAll(".dd-item"), o => o.getAttribute("data-code"))).toEqual(["en", "vi", "ja"])
    expect(menu.querySelector("[data-code=en]")!.getAttribute("aria-selected")).toBe("true")

    click(menu.querySelector("[data-code=vi]"))
    expect(menu.hidden).toBe(true)
    expect(document.getElementById("lang-label")!.textContent).toBe("Tiếng Việt")
    expect(document.documentElement.lang).toBe("vi")
    expect(document.querySelector(".insight.warn .insight-title")!.textContent).toBe("Query N+1")
    expect(document.querySelector(".insight.warn .insight-msg")!.textContent).toContain("3 query giống nhau")
    expect(document.querySelector("[data-mode=all]")!.textContent).toBe("Tất cả")
    expect(window.localStorage.getItem("sqlDevInspector.lang")).toBe("vi")

    click(button)
    click(menu.querySelector("[data-code=ja]"))
    expect(document.querySelector(".insight.warn .insight-title")!.textContent).toBe("N+1クエリ")
  })

  it("drives the language menu from the keyboard and closes it on Escape or an outside click", async () => {
    const { document, window } = render()
    await settle()
    const button = document.getElementById("lang") as unknown as HTMLElement
    const menu = document.getElementById("lang-menu") as unknown as HTMLElement
    const key = (target: unknown, k: string) => (target as HTMLElement).dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true }) as never)

    key(button, "ArrowDown")
    expect(menu.hidden).toBe(false)
    expect(document.activeElement).toBe(menu.querySelector("[data-code=en]") as never)
    key(document.activeElement!, "ArrowDown")
    expect(document.activeElement).toBe(menu.querySelector("[data-code=vi]") as never)
    key(document.activeElement!, "End")
    expect(document.activeElement).toBe(menu.querySelector("[data-code=ja]") as never)
    key(document.activeElement!, "Escape")
    expect(menu.hidden).toBe(true)
    expect(document.activeElement).toBe(button as never)

    key(button, "ArrowDown")
    key(document.activeElement!, "ArrowDown")
    key(document.activeElement!, "Enter")
    expect(document.documentElement.lang).toBe("vi")

    click(button)
    expect(menu.hidden).toBe(false)
    click(document.body)
    expect(menu.hidden).toBe(true)
  })

  it("has no native <select> anywhere: the OS draws its popup and no CSS can style it", async () => {
    const { document } = render()
    await settle()
    expect(document.querySelector("select")).toBeNull()
  })

  it("a ?lang= query parameter wins, so the floating panel can pass its language on", async () => {
    const window = createWindow({ url: "http://localhost/__sql-inspector/?lang=ja" })
    Object.defineProperty(window.navigator, "languages", { value: ["en"], configurable: true })
    Object.assign(window, { fetch: () => Promise.resolve({ json: () => Promise.resolve([]) }), EventSource: class {} })
    const html = renderPage(null)
    window.document.open()
    window.document.write(html.replace(/<script>[\s\S]*<\/script>/, ""))
    window.document.close()
    window.eval(/<script>([\s\S]*)<\/script>/.exec(html)![1]!)
    await settle()
    expect(window.document.documentElement.lang).toBe("ja")
  })
})

describe("page document", () => {
  it("is self-contained: no external requests, no inline event handlers, JSON that cannot break out of the script", () => {
    const html = renderPage(null)
    expect(html).not.toMatch(/https?:\/\//)
    expect(html).not.toMatch(/<link\b/i)
    expect(html).not.toMatch(/\son\w+="/)
    expect(html.match(/<script>/g)).toHaveLength(1)
    const config = /var __SQLI__ = (.*);\n/.exec(html)![1]!
    expect(config).not.toContain("</")
    expect(() => JSON.parse(config)).not.toThrow()
  })

  it("declares a color scheme so native controls match the theme, and defines every control's look", () => {
    const html = renderPage(null)
    expect(html).toContain("color-scheme")
    expect(html).toContain("appearance: none")
    expect(html).toContain("prefers-color-scheme: dark")
    expect(html).toContain("prefers-reduced-motion")
    expect(html).toContain(":focus-visible")
  })
})

vi.setConfig({ testTimeout: 10000 })

describe("the SQL a library sent", () => {
  it("is listed under the call when it is opened", async () => {
    const { document } = render({ layered: true })
    await settle()
    await selectRequest(document, 1)
    click(document.querySelector(".q-head"))
    const text = document.querySelector(".q-body")?.textContent ?? ""
    expect(text).toContain("Sent to the database (1)")
    expect(text).toContain("libsql")
    expect(document.querySelectorAll(".sent pre").length).toBe(1)
    expect(document.querySelector(".http-details")?.textContent).toBe("status 200 · sent 7 B · received 2 KB · application/json")
  })
})

describe("saving and loading history", () => {
  it("downloads the saved requests and posts a chosen file back", async () => {
    const { document, window } = render()
    await settle()
    const calls: Array<[string, RequestInit | undefined]> = []
    Object.assign(window, { fetch: (url: string, init?: RequestInit) => { calls.push([String(url), init]); return Promise.resolve({ text: () => Promise.resolve("{}"), json: () => Promise.resolve({ loaded: 2 }) }) } })
    Object.assign(window.URL, { createObjectURL: () => "blob:x" })
    click(document.querySelector("#history-save"))
    await settle()
    expect(calls[0]![0]).toBe("./api/history")
    const input = document.querySelector("#history-file") as HTMLInputElement
    Object.defineProperty(input, "files", { value: [{ text: () => Promise.resolve("{\"format\":\"x\"}") }], configurable: true })
    input.dispatchEvent(new window.Event("change"))
    await settle()
    const post = calls.find(([, init]) => init?.method === "POST")
    expect(post![0]).toBe("./api/history")
    expect(post![1]!.body).toBe("{\"format\":\"x\"}")
    expect(document.querySelector("#toast, .toast")?.textContent ?? "").toContain("Loaded 2 requests")
  })
})

describe("warnings come first", () => {
  it("are the first thing under the request's title, above the totals", async () => {
    const { document } = render()
    await settle()
    await selectRequest(document)
    const sections = Array.from(document.querySelectorAll(".detail-inner > *"))
    const warnings = sections.findIndex(el => el.querySelector(".insight, .empty-ok"))
    const totals = sections.findIndex(el => el.classList.contains("kpis"))
    expect(warnings).toBe(1)
    expect(totals).toBeGreaterThan(warnings)
  })
})

describe("values in place of placeholders", () => {
  it("offers the statement with its values when they were kept, and puts them where the placeholders are, not inside quotes", async () => {
    const { document } = render({ values: "real", slow: { slowMs: 100, defaultSlowMs: 100, redact: "off" } as never })
    await settle()
    await selectRequest(document, 1)
    click(document.querySelector(".q-head"))
    const button = Array.from(document.querySelectorAll(".seg-btn")).find(b => b.textContent === "With values") as HTMLElement
    expect(button).toBeTruthy()
    click(button)
    expect(document.querySelector(".q-body pre.sql")?.textContent).toBe("select 1 from `customers` where `id` = 7 and `note` = 'a?b' and `n` = 'O''Brien'")
  })

  it("does not offer it when the values were hidden when the call was recorded", async () => {
    const { document } = render({ values: "hidden" })
    await settle()
    await selectRequest(document, 1)
    click(document.querySelector(".q-head"))
    expect(Array.from(document.querySelectorAll(".seg-btn")).some(b => b.textContent === "With values")).toBe(false)
  })
})

describe("values in place of placeholders: what is not a placeholder", () => {
  const view = async (statement: { sql: string, params: unknown[] }) => {
    const { document } = render({ statement, slow: { slowMs: 100, defaultSlowMs: 100, redact: "off" } as never })
    await settle()
    await selectRequest(document, 1)
    click(document.querySelector(".q-head"))
    const button = Array.from(document.querySelectorAll(".seg-btn")).find(b => b.textContent === "With values") as HTMLElement | undefined
    if (!button) {
      return null
    }
    click(button)
    return document.querySelector(".q-body pre.sql")?.textContent
  }

  it("skips a ? in a comment", async () => {
    expect(await view({ sql: "select 1 -- is it ok?\nwhere id = ?", params: [7] })).toBe("select 1 -- is it ok?\nwhere id = 7")
    expect(await view({ sql: "select /* why? */ 1 where id = ?", params: [7] })).toBe("select /* why? */ 1 where id = 7")
  })

  it("reads ?? as a quoted name", async () => {
    expect(await view({ sql: "select ?? from t where id = ?", params: ["name", 7] })).toBe("select `name` from t where id = 7")
  })

  it("leaves ? alone in a statement with numbered placeholders (Postgres JSON operators)", async () => {
    expect(await view({ sql: "select * from t where data ? 'k' and id = $1", params: [7] })).toBe("select * from t where data ? 'k' and id = 7")
  })

  it("is not offered when the placeholders and the values do not match one to one", async () => {
    expect(await view({ sql: "select 1 where id = ?", params: [1, 2] })).toBeNull()
    expect(await view({ sql: "select 1 where a = ? and b = ?", params: [1] })).toBeNull()
    expect(await view({ sql: "select 1 where a = $3", params: [1] })).toBeNull()
  })
})

describe("a request recorded while values were hidden", () => {
  it("says so once values are shown, and not when the setting still matches", async () => {
    const shown = render({ recordedUnder: "params", slow: { slowMs: 100, defaultSlowMs: 100, redact: "off" } as never })
    await settle()
    shown.sources[0]!.onopen!() // the page asks the server for its settings when the live connection opens
    await settle()
    await selectRequest(shown.document)
    expect(shown.document.querySelector(".stale-note")?.textContent).toContain("recorded while values were Parameters")
    const same = render({ recordedUnder: "params" })
    await settle()
    same.sources[0]!.onopen!()
    await settle()
    await selectRequest(same.document)
    expect(same.document.querySelector(".stale-note")).toBeNull()
  })
})

describe("redrawing while requests arrive", () => {
  it("does not fetch a comparison again on every change, nor the overview on every call", async () => {
    const r = render()
    await settle()
    await selectRequest(r.document)
    const urls: string[] = []
    const traces = buildTraces()
    const data = compareReports(buildReport(traces[1]!), buildReport(traces[0]!))
    const overview = buildOverview(traces.map(t => buildReport(t)))
    const real = r.window.fetch.bind(r.window)
    Object.assign(r.window, { fetch: (url: string, init?: RequestInit) => {
      urls.push(String(url))
      const body = String(url).includes("overview") ? overview : String(url).includes("compare") ? data : null
      return body ? Promise.resolve({ json: () => Promise.resolve(body), text: () => Promise.resolve("") }) : real(url, init)
    } })
    const select = r.document.querySelector(".compare-select") as HTMLSelectElement
    select.value = "b"
    select.dispatchEvent(new r.window.Event("change"))
    await settle()
    r.sources[0]!.onmessage!({ data: "{}" })
    await settle()
    expect(urls.filter(u => u.includes("compare"))).toHaveLength(1)
    expect(r.document.querySelector(".compare-result")?.textContent).toContain("About as fast")

    click(r.document.querySelector("#overview"))
    await settle()
    const before = urls.filter(u => u.includes("overview")).length
    for (let i = 0; i < 6; i++) { r.sources[0]!.onmessage!({ data: "{}" }) }
    await settle()
    expect(urls.filter(u => u.includes("overview")).length - before).toBeLessThanOrEqual(1)
  })
})

describe("a comparison against a request that keeps changing", () => {
  it("is fetched again once either request has changed, and not before", async () => {
    const r = render()
    await settle()
    await selectRequest(r.document)
    const urls: string[] = []
    const traces = buildTraces()
    const data = compareReports(buildReport(traces[1]!), buildReport(traces[0]!))
    const real = r.window.fetch.bind(r.window)
    Object.assign(r.window, { fetch: (url: string, init?: RequestInit) => {
      urls.push(String(url))
      return String(url).includes("compare") ? Promise.resolve({ json: () => Promise.resolve(data), text: () => Promise.resolve("") }) : real(url, init)
    } })
    const select = r.document.querySelector(".compare-select") as HTMLSelectElement
    select.value = "b"
    select.dispatchEvent(new r.window.Event("change"))
    await settle()
    r.sources[0]!.onmessage!({ data: "{}" })
    await settle()
    expect(urls.filter(u => u.includes("compare"))).toHaveLength(1)
    r.traces[1]!.durationMs = 999 // the compared request finishes later than it was first seen
    r.sources[0]!.onmessage!({ data: "{}" })
    await settle()
    expect(urls.filter(u => u.includes("compare"))).toHaveLength(2)
  })
})

describe("loading a history file larger than the page keeps", () => {
  it("says how many were kept", async () => {
    const { document, window } = render()
    await settle()
    Object.assign(window, { fetch: () => Promise.resolve({ text: () => Promise.resolve("{}"), json: () => Promise.resolve({ loaded: 1, total: 3 }) }) })
    const input = document.querySelector("#history-file") as HTMLInputElement
    Object.defineProperty(input, "files", { value: [{ text: () => Promise.resolve("{}") }], configurable: true })
    input.dispatchEvent(new window.Event("change"))
    await settle()
    expect(document.querySelector("#toast, .toast")?.textContent ?? "").toContain("Loaded 1 of 3 requests")
  })
})

describe("the overview", () => {
  it("opens from the top bar, shows the routes and opens the slowest request of one", async () => {
    const { document, window } = render()
    await settle()
    const traces = buildTraces()
    const data = buildOverview(traces.map(t => buildReport(t)))
    Object.assign(window, { fetch: (url: string) => Promise.resolve({ json: () => Promise.resolve(String(url).includes("overview") ? data : {}), text: () => Promise.resolve("") }) })
    click(document.querySelector("#overview"))
    await settle()
    const text = document.querySelector("#detail")?.textContent ?? ""
    expect(text).toContain("Routes, by what they cost in all")
    expect(text).toContain("GET /api/order-detail/:id")
    expect(document.querySelectorAll(".ov-table tr.clickable").length).toBe(data.routes.length)
    expect(document.querySelector("#overview")?.getAttribute("aria-pressed")).toBe("true")
    // a row that can be focused can be opened from the keyboard too
    const row = document.querySelector(".ov-table tr.clickable") as HTMLElement
    row.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as never)
    await settle()
    expect(document.querySelector("#overview")?.getAttribute("aria-pressed")).toBe("false")
  })
})

describe("time breakdown", () => {
  it("shows a bar and a legend for the request", async () => {
    const { document } = render()
    await settle()
    await selectRequest(document)
    expect(document.querySelector(".split")).not.toBeNull()
    expect(document.querySelector(".legend")?.textContent).toMatch(/Database .*%/)
  })
})

describe("copying a request for a report", () => {
  it("fetches the Markdown of the request and copies it", async () => {
    const copied: string[] = []
    const { document, window } = render({ clipboard: (text) => { copied.push(text); return Promise.resolve() } })
    await settle()
    await selectRequest(document)
    const urls: string[] = []
    Object.assign(window, { fetch: (url: string) => { urls.push(String(url)); return Promise.resolve({ text: () => Promise.resolve("## GET /api/order-detail/1\n"), json: () => Promise.resolve({}) }) } })
    click(document.querySelector(".detail-head .export"))
    await settle()
    expect(urls).toEqual(["./api/requests/a/markdown"])
    expect(copied).toEqual(["## GET /api/order-detail/1\n"])
  })
})

describe("comparing two requests", () => {
  it("offers the other requests, fetches the comparison and shows what differs", async () => {
    const { document, window } = render()
    await settle()
    await selectRequest(document)
    const select = document.querySelector(".compare-select") as HTMLSelectElement
    expect(select.options).toHaveLength(3) // the prompt and the two other requests
    const traces = buildTraces()
    const data = compareReports(buildReport(traces[1]!), buildReport(traces[0]!))
    const urls: string[] = []
    Object.assign(window, { fetch: (url: string) => { urls.push(String(url)); return Promise.resolve({ json: () => Promise.resolve(data), text: () => Promise.resolve("") }) } })
    select.value = "b"
    select.dispatchEvent(new window.Event("change"))
    await settle()
    expect(urls).toEqual(["./api/compare/b/a"])
    const text = document.querySelector(".compare-result")?.textContent ?? ""
    expect(text).toContain("About as fast as the other request")
    expect(text).toContain("order_items")
    expect(text).toMatch(/new/)
  })
})

describe("downloading a request as JSON", () => {
  it("has a button that fetches the export of the selected request", async () => {
    const { document, window } = render()
    await settle()
    await selectRequest(document)
    const urls: string[] = []
    Object.assign(window, { fetch: (url: string) => { urls.push(String(url)); return Promise.resolve({ text: () => Promise.resolve("{}"), json: () => Promise.resolve({}) }) } })
    Object.assign(window.URL, { createObjectURL: () => "blob:x" })
    click(document.querySelector(".detail-head .export-json"))
    await settle()
    expect(urls).toEqual(["./api/requests/a/export"])
  })
})

describe("console output of a request", () => {
  it("lists what the application printed under its request, with level, time and calling line, as text", async () => {
    const { document, sources } = render({ slow: { slowMs: 100, defaultSlowMs: 100, root: "/proj", editor: { name: "vscode", template: "vscode://file/{path}:{line}:{column}" } } as never })
    sources[0]!.onopen!()
    await settle()
    await selectRequest(document)
    const rows = Array.from(document.querySelectorAll(".log"))
    expect(rows.map(row => row.querySelector(".lvl")!.textContent)).toEqual(["warn", "log"])
    expect(rows[0]!.querySelector(".msg")!.textContent).toBe("cache miss for order 1\nsecond line")
    expect(rows[0]!.querySelector("a.caller")!.textContent).toBe("src/orders.ts:42")
    expect(document.body.textContent).toContain("Console output")
  })

  it("has no section for a request that printed nothing, and a switch in the settings", async () => {
    const { document, calls, sources } = render()
    sources[0]!.onopen!()
    await settle()
    await selectRequest(document, 1)
    expect(document.querySelector(".log")).toBeNull()
    ;(document.getElementById("logs-switch") as unknown as HTMLElement).click()
    await settle()
    expect(calls.filter(c => c.path === "settings" && c.init?.method === "POST").map(c => JSON.parse(String(c.init!.body)))).toEqual([{ logs: true }])
  })
})

describe("status: the drivers, and the setup check", () => {
  it("lists the drivers that are watching, and says so when there are none", async () => {
    const { document, sources } = render({ slow: { slowMs: 100, defaultSlowMs: 100, drivers: ["mysql2", "pg"] } as never })
    sources[0]!.onopen!()
    await settle()
    expect(Array.from(document.querySelectorAll("#drivers .chip"), c => c.textContent)).toEqual(["mysql2", "pg"])

    const none = render({ slow: { slowMs: 100, defaultSlowMs: 100, drivers: [] } as never })
    none.sources[0]!.onopen!()
    await settle()
    expect(none.document.querySelector("#drivers .chip.none")!.textContent).toBe("No driver is active")
  })

  it("runs the check and shows what it found", async () => {
    const { document, window } = render()
    Object.assign(window, { fetch: (url: string) => Promise.resolve({ json: () => Promise.resolve(String(url).includes("doctor") ? { checks: [{ id: "a", status: "ok", message: "All good" }, { id: "b", status: "warn", message: "Look here" }] } : {}) }) })
    ;(document.getElementById("check") as unknown as HTMLElement).click()
    await settle()
    const items = Array.from(document.querySelectorAll("#checks li"))
    expect(items.map(li => li.textContent)).toEqual(["All good", "Look here"])
    expect(items[1]!.className).toBe("warn")
  })
})

describe("answers that arrive out of order, and requests that fail", () => {
  it("shows the answer to the latest comparison question, and says the inspector could not be reached when a fetch fails", async () => {
    const r = render()
    await settle()
    await selectRequest(r.document)
    const traces = buildTraces()
    const fresh = compareReports(buildReport(traces[1]!), buildReport(traces[0]!))
    const older = { ...fresh, verdict: "slower", totals: { ...fresh.totals, totalMs: { a: 10, b: 90, delta: 80 } } }
    const waiting: Array<(value: unknown) => void> = []
    const real = r.window.fetch.bind(r.window)
    Object.assign(r.window, { fetch: (url: string, init?: RequestInit) => String(url).includes("compare")
      ? new Promise((resolve) => { waiting.push(resolve) })
      : real(url, init) })
    const select = r.document.querySelector(".compare-select") as HTMLSelectElement
    select.value = "b"
    select.dispatchEvent(new r.window.Event("change"))
    r.traces[1]!.durationMs = 999 // the compared request changes: the page asks again
    r.sources[0]!.onmessage!({ data: "{}" })
    await settle()
    expect(waiting).toHaveLength(2)
    waiting[1]!({ json: () => Promise.resolve(fresh) }) // the newer question is answered first
    await settle()
    waiting[0]!({ json: () => Promise.resolve(older) }) // then the older one arrives late
    await settle()
    expect(r.document.querySelector(".compare-result")?.textContent).toContain("About as fast")
    expect(r.document.querySelector(".compare-result")?.textContent).not.toContain("slower than")

    Object.assign(r.window, { fetch: () => Promise.reject(new Error("down")) })
    click(r.document.querySelector(".detail-head .export-json"))
    await settle()
    expect(r.document.querySelector("#toast, .toast")?.textContent ?? "").toContain("Couldn't reach the inspector")
  })
})
