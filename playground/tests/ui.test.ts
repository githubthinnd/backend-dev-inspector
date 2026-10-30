import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it } from "vitest"
import { JSDOM } from "jsdom"
import { getInspector, resetInspectorForTests } from "backend-dev-inspector"
import { stacks } from "./stacks.ts"

const appJs = readFileSync(new URL("../shared/web/app.js", import.meta.url), "utf8")

afterEach(() => {
  getInspector().store.clear()
  resetInspectorForTests()
})

async function waitFor<T>(read: () => T | null | undefined | false, what: string): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = read()
    if (value) {
      return value
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** Opens the page the app serves in jsdom, with `fetch` answered by the app itself (no port). */
async function openPage(get: (path: string) => Promise<{ status: number, body: string }>) {
  const home = await get("/")
  const dom = new JSDOM(home.body.replace(/<script src="[^"]*"><\/script>/, ""), { runScripts: "outside-only", url: "http://localhost/" })
  const { window } = dom
  ;(window as unknown as { fetch: unknown }).fetch = async (path: string) => {
    const response = await get(path)
    return { ok: response.status < 400, status: response.status, json: async () => JSON.parse(response.body) as unknown }
  }
  // jsdom does not run the page's inline script (it is a test of app.js): hand over the config the same way.
  window.eval(`window.__PLAYGROUND__ = ${/window\.__PLAYGROUND__ = (.*);<\/script>/.exec(home.body)![1]}`)
  window.eval(appJs)
  const $ = (selector: string) => window.document.querySelector(selector)
  const $$ = (selector: string) => [...window.document.querySelectorAll(selector)]
  return { window, $, $$, click: (selector: string) => ($(selector) as HTMLElement).click() }
}

describe.each(stacks.filter(stack => stack.available?.() !== false && !stack.name.includes("prisma")))("$name front end", ({ boot }) => {
  it("serves the page and its assets", async () => {
    const get = await boot()
    const home = await get("/")
    expect(home.status).toBe(200)
    expect(home.body).toContain('<div id="app">')
    expect(home.body).toContain("/assets/app.js")
    expect(home.body).toMatch(/"framework":"[^"]+"/)
    expect((await get("/assets/app.css")).body).toContain(".shell")
    expect((await get("/assets/app.js")).body).toContain("Antimatter")
    expect((await get("/assets/nothing.js")).status).toBe(404)
  })

  it("shows the orders with their totals, and opens an order", async () => {
    const page = await openPage(await boot())
    const rows = await waitFor(() => { const found = page.$$("tbody tr"); return found.length ? found : null }, "the orders table")
    expect(rows).toHaveLength(10)
    expect(page.$$(".kpi .value").map(node => node.textContent)[0]).toBe("10")
    expect(rows[0]!.textContent).toContain("#40")
    expect(rows[0]!.textContent).toMatch(/\$\d/)
    // "Behind this screen" explains the screen in three steps.
    expect(page.$$(".explain .step")).toHaveLength(3)
    expect(page.$(".explain")?.textContent).toContain("What to look for in the inspector")

    ;(rows[0] as HTMLElement).click()
    expect(page.$(".drawer.open h2")?.textContent).toBe("Order #40")
  })

  it("places an order and shows it first in the list", async () => {
    const page = await openPage(await boot())
    await waitFor(() => page.$$("tbody tr").length === 10, "the orders table")
    page.click('[data-action="new-order"]')
    await waitFor(() => page.$(".toast strong")?.textContent?.startsWith("Order #41"), "the success message")
    const first = await waitFor(() => { const row = page.$$("tbody tr")[0]; return row?.textContent?.includes("#41") ? row : null }, "the new order in the list")
    expect(first.textContent).toContain("pending")
  })

  it("reports the database error when an item cannot be added", async () => {
    const page = await openPage(await boot())
    const rows = await waitFor(() => { const found = page.$$("tbody tr"); return found.length ? found : null }, "the orders table")
    ;(rows[0] as HTMLElement).click()
    page.click('[data-action="add-item"]')
    const toast = await waitFor(() => page.$(".toast.err span")?.textContent, "the error message")
    expect(toast).toContain("FOREIGN KEY")
  })

  it("lists the customers behind the recent orders", async () => {
    const page = await openPage(await boot())
    page.click('[data-view="customers"]')
    const tiles = await waitFor(() => { const found = page.$$(".tile"); return found.length ? found : null }, "the customer tiles")
    expect(tiles).toHaveLength(10)
    expect(page.$(".view-head .pill")?.textContent).toContain("N+1")
  })

  it("runs the slow report and keeps its history", async () => {
    const page = await openPage(await boot())
    page.click('[data-view="reports"]')
    await waitFor(() => page.$('[data-action="run-report"]'), "the report page")
    page.click('[data-action="run-report"]')
    const result = await waitFor(() => { const text = page.$(".stat-line strong")?.textContent; return text?.includes(" rows in ") ? text : null }, "the report result")
    expect(result).toContain("6,000,000 rows")
    expect(page.$$(".list-row")).toHaveLength(1)
  })

  it("explains it when the customer service is not reachable", async () => {
    const page = await openPage(await boot())
    page.click('[data-view="loyalty"]')
    // The fake customer service listens on a port; these tests open none, so the page must show the failure, not break.
    const message = await waitFor(() => page.$(".error-state")?.textContent, "the error state")
    expect(message).toContain("customer service")
    expect(page.$('[data-action="retry"]')).not.toBeNull()
  })

  it("filters the orders with the search box", async () => {
    const page = await openPage(await boot())
    await waitFor(() => page.$$("tbody tr").length === 10, "the orders table")
    const input = page.$('[data-input="search"]') as HTMLInputElement
    input.value = "zzzz-no-such-customer"
    input.dispatchEvent(new page.window.Event("input", { bubbles: true }))
    expect(page.$(".empty")?.textContent).toContain("No orders match")
  })
})
