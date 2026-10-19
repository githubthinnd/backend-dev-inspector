import type { Locale } from "../src/i18n"
import type { QueryEvent, RequestTrace } from "../src/types"
import { Window } from "happy-dom"
import { describe, expect, it, vi } from "vitest"
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

function trace(id: string, url: string, queries: QueryEvent[], method = "GET"): RequestTrace {
  return {
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

const nPlusOne = [1, 2, 3].map(i => query(`select \`id\` from \`order_items\` where \`order_id\` = ${i}`))
function buildTraces() {
  return [
    trace("a", "/api/order-detail/1", [
      ...nPlusOne,
      query("select * from `x` where `id` in (select `id` from `y`)"),
      query("begin"),
      query("insert into `<img src=x onerror=window.__pwned=1>` values (1)", { rowCount: null, affectedRows: 1 }),
      query("commit")
    ]),
    trace("b", "/api/customers", [query("select 1 from `customers`")], "POST"),
    trace("c", "/api/broken", [query("select boom", { error: "You have an error in your SQL syntax" })])
  ]
}

interface Options {
  languages?: string[]
  hint?: Locale | null
  stored?: Record<string, string>
  width?: number
  clipboard?: (text: string) => Promise<void>
}

function render(options: Options = {}) {
  const traces = buildTraces()
  const reports = new Map(traces.map(t => [t.id, buildReport(t)]))
  const window = new Window({ url: "http://localhost/__sql-inspector/", width: options.width ?? 1280, height: 800 })
  Object.defineProperty(window.navigator, "languages", { value: options.languages ?? ["en-US"], configurable: true })
  for (const [key, value] of Object.entries(options.stored ?? {})) {
    window.localStorage.setItem(key, value)
  }
  const respond = (path: string) => {
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
    fetch: (url: string) => Promise.resolve({ json: () => Promise.resolve(respond(String(url).replace("./api/", ""))) }),
    EventSource: class { onopen: (() => void) | null = null; onmessage: (() => void) | null = null; onerror: (() => void) | null = null }
  })
  Object.defineProperty(window.navigator, "clipboard", { value: { writeText: clipboard }, configurable: true })

  // happy-dom does not run scripts written into the document, so the page's one script is
  // evaluated by hand, against the same markup the browser would get.
  const html = renderPage(options.hint ?? null)
  const script = /<script>([\s\S]*)<\/script>/.exec(html)![1]!
  window.document.write(html.replace(/<script>[\s\S]*<\/script>/, ""))
  window.eval(script)
  return { window, document: window.document, html }
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
    window.innerWidth = 480
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
    const window = new Window({ url: "http://localhost/__sql-inspector/?lang=ja" })
    Object.defineProperty(window.navigator, "languages", { value: ["en"], configurable: true })
    Object.assign(window, { fetch: () => Promise.resolve({ json: () => Promise.resolve([]) }), EventSource: class {} })
    const html = renderPage(null)
    window.document.write(html.replace(/<script>[\s\S]*<\/script>/, ""))
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
