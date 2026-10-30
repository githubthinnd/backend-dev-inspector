import { createWindow } from "./dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import { HOTKEYS, mountSqlInspectorWidget, SLOW_STORAGE_KEY, STORAGE_KEY, type WidgetHandle } from "../src/client/widget"

type Summary = { id: string, queryCount: number, warnings: number, errors: number }

class FakeEventSource {
  static instances: FakeEventSource[] = []
  onmessage: (() => void) | null = null
  onopen: (() => void) | null = null
  closed = false
  constructor(public url: string) {
    FakeEventSource.instances.push(this)
  }

  close() {
    this.closed = true
  }
}

let handle: WidgetHandle | null = null
let list: Summary[] = []
const fetchCalls: string[] = []

function mount(stored?: object, baseURL = "/", path?: string) {
  FakeEventSource.instances = []
  fetchCalls.length = 0
  const win = createWindow({ url: "http://localhost:3000/" })
  if (stored) {
    win.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  }
  Object.assign(win, {
    EventSource: FakeEventSource,
    fetch: (url: string) => {
      fetchCalls.push(url)
      return Promise.resolve({ json: () => Promise.resolve(list) })
    }
  })
  handle = mountSqlInspectorWidget({ baseURL, path, win: win as never })
  const root = win.document.querySelector("[data-sql-inspector]")!.shadowRoot!
  const q = <T extends Element>(selector: string) => root.querySelector(selector) as unknown as T
  const press = (code: string, extra: object = {}) =>
    win.dispatchEvent(new win.KeyboardEvent("keydown", { code, altKey: true, shiftKey: true, bubbles: true, ...extra }) as never)
  const stored$ = () => JSON.parse(win.localStorage.getItem(STORAGE_KEY)!)
  return { win, root, q, press, stored: stored$ }
}

function mountWithLanguages(languages: string[], stored?: object) {
  FakeEventSource.instances = []
  const win = createWindow({ url: "http://localhost:3000/" })
  Object.defineProperty(win.navigator, "languages", { value: languages, configurable: true })
  if (stored) {
    win.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  }
  Object.assign(win, { EventSource: FakeEventSource, fetch: () => Promise.resolve({ json: () => Promise.resolve([]) }) })
  handle = mountSqlInspectorWidget({ baseURL: "/", win: win as never })
  const root = win.document.querySelector("[data-sql-inspector]")!.shadowRoot!
  return {
    win,
    root,
    q: <T extends Element>(selector: string) => root.querySelector(selector) as unknown as T,
    stored: () => JSON.parse(win.localStorage.getItem(STORAGE_KEY)!)
  }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 200))

afterEach(() => {
  handle?.destroy()
  handle = null
  list = []
})

describe("floating launcher", () => {
  it("shows a closed button and does not load the inspector until opened", () => {
    const { q } = mount()
    expect(q<HTMLElement>(".fab").textContent).toContain("SQL")
    expect(q<HTMLElement>(".panel").classList.contains("open")).toBe(false)
    expect(q<HTMLIFrameElement>("iframe").getAttribute("src")).toBeNull()
  })

  it("opens on a click, but a drag only moves the button", () => {
    const { win, q, stored } = mount()
    const fire = (target: { dispatchEvent: (event: never) => unknown }, type: string, x: number, y: number) =>
      target.dispatchEvent(Object.assign(new win.Event(type), { clientX: x, clientY: y }) as never)
    const button = q<HTMLElement>(".fab")

    // A browser sends pointerdown, pointerup, then click for a plain click.
    fire(button, "pointerdown", 100, 100)
    fire(win, "pointerup", 100, 100)
    button.click()
    expect(q<HTMLElement>(".panel").classList.contains("open")).toBe(true)
    button.click()
    expect(q<HTMLElement>(".panel").classList.contains("open")).toBe(false)

    // A drag ends with a click too, which must not toggle the panel.
    fire(button, "pointerdown", 100, 100)
    fire(win, "pointermove", 60, 70)
    fire(win, "pointerup", 60, 70)
    button.click()
    expect(q<HTMLElement>(".panel").classList.contains("open")).toBe(false)
    expect(stored().offset).toEqual({ right: 60, bottom: 50 })
    expect(button.style.right).toBe("60px")
  })

  it("loads the page from a custom path, under the base path", () => {
    const { q, press } = mount(undefined, "/app", "/_dev/sql/")
    press("KeyS")
    expect(q<HTMLIFrameElement>("iframe").getAttribute("src")).toBe("/app/_dev/sql/#latest")
  })

  it("toggles the panel with the hotkey and loads the page under the base path", () => {
    const { q, press } = mount(undefined, "/app")
    press("KeyS")
    expect(q<HTMLElement>(".panel").classList.contains("open")).toBe(true)
    expect(q<HTMLIFrameElement>("iframe").getAttribute("src")).toBe("/app/__sql-inspector/#latest")
    press("KeyS")
    expect(q<HTMLElement>(".panel").classList.contains("open")).toBe(false)
    expect(HOTKEYS.togglePanel).toBe("Alt+Shift+S")
  })

  it("ignores the hotkey without the full modifier combination", () => {
    const { q, press } = mount()
    press("KeyS", { shiftKey: false })
    press("KeyS", { altKey: false })
    expect(q<HTMLElement>(".panel").classList.contains("open")).toBe(false)
  })

  it("hides and shows the button with its hotkey, and remembers it", () => {
    const { q, press, stored } = mount()
    press("KeyD")
    expect(q<HTMLElement>(".fab").style.display).toBe("none")
    expect(stored().buttonVisible).toBe(false)
    press("KeyS")
    expect(q<HTMLElement>(".panel").classList.contains("open")).toBe(true)
    press("KeyD")
    expect(q<HTMLElement>(".fab").style.display).toBe("")
  })

  it("closes with the close button and the dock button switches side", () => {
    const { q, press, stored } = mount()
    press("KeyS")
    q<HTMLElement>("[data-act=dock-right]").click()
    expect(q<HTMLElement>(".panel").classList.contains("right")).toBe(true)
    expect(stored().dock).toBe("right")
    q<HTMLElement>("[data-act=close]").click()
    expect(q<HTMLElement>(".panel").classList.contains("open")).toBe(false)
  })

  it("restores saved settings, and survives corrupt storage", () => {
    const { q } = mount({ open: true, dock: "right", size: 500, buttonVisible: false })
    expect(q<HTMLElement>(".panel").classList.contains("open")).toBe(true)
    expect(q<HTMLElement>(".panel").classList.contains("right")).toBe(true)
    expect(q<HTMLElement>(".panel").style.width).toBe("500px")
    expect(q<HTMLElement>(".fab").style.display).toBe("none")
    handle!.destroy()

    const win = createWindow({ url: "http://localhost:3000/" })
    win.localStorage.setItem(STORAGE_KEY, "{not json")
    Object.assign(win, { EventSource: FakeEventSource, fetch: () => Promise.resolve({ json: () => Promise.resolve([]) }) })
    handle = mountSqlInspectorWidget({ baseURL: "/", win: win as never })
    expect(handle.settings()).toMatchObject({ enabled: true, dock: "bottom", open: false })
  })

  it("shows the newest request's query count, amber on warnings and red on errors", async () => {
    list = [{ id: "a", queryCount: 7, warnings: 0, errors: 0 }]
    const { q } = mount()
    await settle()
    expect(q<HTMLElement>(".badge").textContent).toBe("7")
    expect(q<HTMLElement>(".badge").className).toBe("badge")

    list = [{ id: "b", queryCount: 12, warnings: 2, errors: 0 }, ...list]
    FakeEventSource.instances[0]!.onmessage!()
    await settle()
    expect(q<HTMLElement>(".badge").textContent).toBe("12")
    expect(q<HTMLElement>(".badge").classList.contains("warn")).toBe(true)

    list = [{ id: "c", queryCount: 3, warnings: 1, errors: 1 }]
    FakeEventSource.instances[0]!.onmessage!()
    await settle()
    expect(q<HTMLElement>(".badge").classList.contains("err")).toBe(true)
  })

  it("opens by itself on a warning only when asked to, once per request", async () => {
    list = [{ id: "a", queryCount: 4, warnings: 1, errors: 0 }]
    const off = mount()
    await settle()
    expect(off.q<HTMLElement>(".panel").classList.contains("open")).toBe(false)
    handle!.destroy()

    const on = mount({ autoOpen: true })
    await settle()
    expect(on.q<HTMLElement>(".panel").classList.contains("open")).toBe(true)
    on.q<HTMLElement>("[data-act=close]").click()
    FakeEventSource.instances[0]!.onmessage!()
    await settle()
    expect(on.q<HTMLElement>(".panel").classList.contains("open")).toBe(false)

    list = [{ id: "b", queryCount: 4, warnings: 0, errors: 1 }]
    FakeEventSource.instances[0]!.onmessage!()
    await settle()
    expect(on.q<HTMLElement>(".panel").classList.contains("open")).toBe(true)
  })

  it("disables completely, closes the stream, and the hotkey brings it back", async () => {
    const { q, press, win } = mount()
    press("KeyS")
    q<HTMLElement>("[data-act=disable]").click()
    expect(FakeEventSource.instances[0]!.closed).toBe(true)
    expect((win.document.querySelector("[data-sql-inspector]") as unknown as HTMLElement).style.display).toBe("none")
    expect(handle!.settings().enabled).toBe(false)

    press("KeyS")
    expect(handle!.settings()).toMatchObject({ enabled: true, open: true })
    expect(FakeEventSource.instances).toHaveLength(2)
  })

  it("hooks the hotkeys into the panel page on every load, not only the first (a language change reloads it)", () => {
    const { q, press } = mount()
    press("KeyS")
    const frame = q<HTMLIFrameElement>("iframe")
    const added: string[] = []
    const innerWindow = { addEventListener: (type: string) => added.push(type) }
    Object.defineProperty(frame, "contentWindow", { value: innerWindow, configurable: true })

    frame.dispatchEvent(new (frame.ownerDocument.defaultView as unknown as { Event: typeof Event }).Event("load"))
    frame.dispatchEvent(new (frame.ownerDocument.defaultView as unknown as { Event: typeof Event }).Event("load"))

    expect(added).toEqual(["keydown", "keydown"])
  })

  it("clears the history through the inspector API", () => {
    const { q, press } = mount()
    press("KeyS")
    const post = vi.fn(() => Promise.resolve({ json: () => Promise.resolve([]) }))
    ;(q<HTMLElement>("[data-act=clear]")).ownerDocument.defaultView!.fetch = post as never
    q<HTMLElement>("[data-act=clear]").click()
    expect(post).toHaveBeenCalledWith("/__sql-inspector/api/clear", { method: "POST" })
  })

  describe("slow query threshold", () => {
    const SETTINGS_URL = "/__sql-inspector/api/settings"
    const settingsReply = (slowMs: number, defaultSlowMs = 100) => ({ slowMs, defaultSlowMs, min: 1, max: 600000 })

    function mountWithServer(saved?: number, reply = settingsReply(100)) {
      const view = mount()
      if (saved !== undefined) {
        view.win.localStorage.setItem(SLOW_STORAGE_KEY, String(saved))
      }
      const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve({ json: () => Promise.resolve(reply) }))
      ;(view.win as unknown as { fetch: unknown }).fetch = fetchMock
      const input = view.q<HTMLInputElement>("[data-slow-input]")
      const commit = (value: string) => {
        input.value = value
        input.dispatchEvent(new view.win.Event("change") as never)
      }
      const connect = async () => {
        FakeEventSource.instances[0]!.onopen!()
        await settle()
      }
      const saved$ = () => view.win.localStorage.getItem(SLOW_STORAGE_KEY)
      return { ...view, fetchMock, input, commit, connect, saved: saved$ }
    }

    it("starts empty with the server default as the placeholder", async () => {
      const { input, connect, q } = mountWithServer()
      await connect()
      expect(input.value).toBe("")
      expect(input.placeholder).toBe("100")
      expect(q<HTMLElement>("[data-slow-hint]").textContent).toContain("100")
    })

    it("shows a value that is set on the server", async () => {
      const { input, connect } = mountWithServer(undefined, settingsReply(250))
      await connect()
      expect(input.value).toBe("250")
    })

    it("sends the new threshold, remembers it, and resets to the default when emptied", async () => {
      const { commit, fetchMock, saved } = mountWithServer()

      commit("250")
      expect(fetchMock).toHaveBeenLastCalledWith(SETTINGS_URL, expect.objectContaining({ method: "POST", body: JSON.stringify({ slowMs: 250 }) }))
      expect(saved()).toBe("250")

      commit("")
      expect(fetchMock).toHaveBeenLastCalledWith(SETTINGS_URL, expect.objectContaining({ body: JSON.stringify({ slowMs: null }) }))
      expect(saved()).toBeNull()
    })

    it("rounds decimals and ignores values below 1 ms", async () => {
      const { commit, fetchMock, input, saved, connect } = mountWithServer(300, settingsReply(300))
      await connect()
      fetchMock.mockClear()

      commit("0")
      commit("-5")
      expect(fetchMock).not.toHaveBeenCalled()
      expect(saved()).toBe("300")
      expect(input.value).toBe("300")

      commit("99.6")
      expect(saved()).toBe("100")
    })

    it("re-applies the saved threshold whenever the stream (re)connects, e.g. after a server restart", async () => {
      const { connect, fetchMock } = mountWithServer(300)
      await connect()
      expect(fetchMock).toHaveBeenCalledWith(SETTINGS_URL, expect.objectContaining({ method: "POST", body: JSON.stringify({ slowMs: 300 }) }))
    })

    it("only reads the server's value when nothing was saved", async () => {
      const { connect, fetchMock } = mountWithServer()
      await connect()
      expect(fetchMock).toHaveBeenCalledWith(SETTINGS_URL, undefined)
    })

    it("follows a change made elsewhere, announced on the stream", async () => {
      const reply = settingsReply(100)
      const { input, fetchMock } = mountWithServer(undefined, reply)
      fetchMock.mockImplementation(() => Promise.resolve({ json: () => Promise.resolve(reply) }))
      reply.slowMs = 400

      ;(FakeEventSource.instances[0]!.onmessage as unknown as (event: { data: string }) => void)({ data: JSON.stringify({ changed: ["settings"] }) })
      await settle()

      expect(input.value).toBe("400")
    })
  })

  it("speaks the browser language by default, and an explicit choice wins over it", () => {
    const ja = mountWithLanguages(["ja-JP", "en"])
    expect(ja.q<HTMLElement>("[data-act=close]").getAttribute("title")).toBe("閉じる（Esc）")
    handle!.destroy()

    const vi = mountWithLanguages(["ja-JP"], { lang: "vi", open: true })
    expect(vi.q<HTMLElement>("[data-act=close]").getAttribute("title")).toBe("Đóng (Esc)")
    expect(vi.q<HTMLIFrameElement>("iframe").getAttribute("src")).toBe("/__sql-inspector/?lang=vi#latest")
  })

  it("falls back to English for an unsupported browser language", () => {
    const m = mountWithLanguages(["fr-FR"])
    expect(m.q<HTMLElement>("[data-act=close]").getAttribute("title")).toBe("Close (Esc)")
  })

  it("changing the language relabels the widget, reloads the panel and is remembered", () => {
    const m = mountWithLanguages(["en"], { open: true })
    m.q<HTMLElement>("[data-act=menu]").click()
    const toggle = m.q<HTMLElement>("[data-lang-toggle]")
    expect(m.q<HTMLElement>("[data-lang-options]").hidden).toBe(true)
    toggle.click()
    expect(m.q<HTMLElement>("[data-lang-options]").hidden).toBe(false)
    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    const options = Array.from(m.root.querySelectorAll("[data-lang-opt]"))
    expect(options.map(o => o.getAttribute("data-lang-opt"))).toEqual(["auto", "en", "vi", "ja"])
    expect(options.map(o => o.getAttribute("aria-selected"))).toEqual(["true", "false", "false", "false"])

    m.q<HTMLElement>("[data-lang-opt=ja]").click()
    expect(m.q<HTMLElement>("[data-act=close]").getAttribute("title")).toBe("閉じる（Esc）")
    expect(m.q<HTMLIFrameElement>("iframe").getAttribute("src")).toBe("/__sql-inspector/?lang=ja#latest")
    expect(m.stored().lang).toBe("ja")
    expect(m.q<HTMLElement>("[data-lang-options]").hidden).toBe(true)
    expect(m.q<HTMLElement>("[data-lang-current]").textContent).toBe("日本語")
    expect(m.q<HTMLElement>("[data-lang-opt=ja]").getAttribute("aria-selected")).toBe("true")
  })

  it("picks a language with the keyboard, and Escape closes the list without closing the panel", () => {
    const m = mountWithLanguages(["en"], { open: true })
    m.q<HTMLElement>("[data-act=menu]").click()
    const toggle = m.q<HTMLElement>("[data-lang-toggle]")
    toggle.dispatchEvent(new m.win.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as never)
    expect(m.q<HTMLElement>("[data-lang-options]").hidden).toBe(false)

    const vi = m.q<HTMLElement>("[data-lang-opt=vi]")
    vi.dispatchEvent(new m.win.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as never)
    expect(m.stored().lang).toBe("vi")

    toggle.click()
    m.q<HTMLElement>("[data-lang-opt=en]").dispatchEvent(new m.win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }) as never)
    expect(m.q<HTMLElement>("[data-lang-options]").hidden).toBe(true)
    expect(m.q<HTMLElement>(".panel").classList.contains("open")).toBe(true)
    expect(m.stored().lang).toBe("vi")
  })

  it("has no native <select>: its popup is drawn by the OS and cannot be styled", () => {
    const { root } = mountWithLanguages(["en"], { open: true })
    expect(root.querySelector("select")).toBeNull()
  })

  it("toggles its options from the settings menu with the mouse and the keyboard", () => {
    const { q, win, press, stored } = mount()
    press("KeyS")
    q<HTMLElement>("[data-act=menu]").click()
    expect(q<HTMLElement>(".menu").hidden).toBe(false)
    const row = q<HTMLElement>("[data-opt=autoOpen]")
    expect(row.getAttribute("aria-checked")).toBe("false")
    row.click()
    expect(row.getAttribute("aria-checked")).toBe("true")
    expect(stored().autoOpen).toBe(true)
    row.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as never)
    expect(stored().autoOpen).toBe(false)
  })

  it("keeps the host page clean: one host element, styles only inside the shadow root", () => {
    const { win, root } = mount()
    expect(win.document.querySelectorAll("[data-sql-inspector]")).toHaveLength(1)
    expect(win.document.head.querySelector("style")).toBeNull()
    expect(win.document.body.children).toHaveLength(1)
    expect(root.querySelector("style")!.textContent).toContain(":host { all: initial")
  })

  it("removes itself on destroy", () => {
    const { win } = mount()
    handle!.destroy()
    expect(win.document.querySelector("[data-sql-inspector]")).toBeNull()
  })
})
