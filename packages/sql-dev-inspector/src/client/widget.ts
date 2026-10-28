/**
 * Floating launcher for the SQL Inspector page, mounted in the host application during dev.
 *
 * It lives inside a shadow root and resets everything it uses, so it neither looks like nor
 * is affected by the host's CSS (no inherited fonts, no styled `button` / `select` / `a`
 * leaking in or out). No framework and no Nuxt imports: it must work in any frontend.
 */
import { type Locale, LOCALES, type MessageKey, pickLocale, translate } from "../i18n/index.js"

export interface WidgetOptions {
  /** Path prefix under which the server serves the inspector, e.g. `/` or `/app` (Nuxt `app.baseURL`). */
  baseURL: string
  win?: Window & typeof globalThis
}

export interface WidgetSettings {
  enabled: boolean
  buttonVisible: boolean
  open: boolean
  dock: "bottom" | "right"
  /** Panel height (dock bottom) or width (dock right), px. */
  size: number
  /** Open the panel by itself when a request has a warning or an error. */
  autoOpen: boolean
  /** Distance of the button from the bottom-right corner, px. */
  offset: { right: number, bottom: number }
  /** `auto` follows the browser language. */
  lang: "auto" | Locale
}

interface ServerSettings {
  slowMs: number
  defaultSlowMs: number
  /** What the server's package calls the UI; null for the default "SQL Inspector". */
  brand?: { title: string, short: string } | null
}

interface RequestSummary {
  id: string
  queryCount: number
  warnings: number
  errors: number
}

export const STORAGE_KEY = "sqlDevInspector.widget"
/** The slow-query threshold the user chose, shared with the inspector page (same origin). Absent means "server default". */
export const SLOW_STORAGE_KEY = "sqlDevInspector.slowMs"
export const HOTKEYS = { togglePanel: "Alt+Shift+S", toggleButton: "Alt+Shift+D" } as const

const DEFAULTS: WidgetSettings = {
  enabled: true,
  buttonVisible: true,
  open: false,
  dock: "bottom",
  size: 420,
  autoOpen: false,
  offset: { right: 20, bottom: 20 },
  lang: "auto"
}

const SLOW_MS_MIN = 1
const SLOW_MS_MAX = 600_000

const TRAILING_SLASHES = /\/+$/
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function loadSettings(win: Window): WidgetSettings {
  try {
    const raw = JSON.parse(win.localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<WidgetSettings>
    return {
      enabled: raw.enabled !== false,
      buttonVisible: raw.buttonVisible !== false,
      open: raw.open === true,
      dock: raw.dock === "right" ? "right" : "bottom",
      size: Number.isFinite(raw.size) ? clamp(raw.size!, 160, 4000) : DEFAULTS.size,
      autoOpen: raw.autoOpen === true,
      offset: {
        right: Number.isFinite(raw.offset?.right) ? raw.offset!.right : DEFAULTS.offset.right,
        bottom: Number.isFinite(raw.offset?.bottom) ? raw.offset!.bottom : DEFAULTS.offset.bottom
      },
      lang: LOCALES.some(locale => locale.code === raw.lang) ? raw.lang as Locale : "auto"
    }
  } catch {
    return { ...DEFAULTS, offset: { ...DEFAULTS.offset } }
  }
}

const TOKENS_LIGHT = `--surface:#fff;--surface-2:#f1f4f8;--border:#dfe5ec;--text:#121821;--text-2:#4a5666;--text-3:#6e7a8a;--accent:#1f6feb;--err:#cf222e;--bar:#101820;--bar-text:#e9eef4;--shadow:0 10px 30px rgba(15,23,42,.28);`
const TOKENS_DARK = `--surface:#151b23;--surface-2:#1d2631;--border:#2b3544;--text:#e6edf3;--text-2:#aab5c3;--text-3:#7d8896;--accent:#5aa2ff;--err:#ff6b6b;--bar:#0b1016;--bar-text:#e6edf3;--shadow:0 10px 30px rgba(0,0,0,.6);`

const STYLE = `
:host { all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; display: block; z-index: 2147483000; }
.root { all: initial; display: block; ${TOKENS_LIGHT} font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Hiragino Sans", "Yu Gothic UI", sans-serif; color: var(--text); -webkit-font-smoothing: antialiased; pointer-events: none; }
@media (prefers-color-scheme: dark) { .root { ${TOKENS_DARK} } }
:where(.root) *, :where(.root) *::before, :where(.root) *::after { box-sizing: border-box; margin: 0; letter-spacing: normal; text-transform: none; }
/* :where() keeps the reset at zero specificity, so the component rules below can restyle these controls. */
:where(.root) :where(button, select) { all: unset; box-sizing: border-box; cursor: pointer; font: inherit; color: inherit; }
.root button:focus-visible, .root select:focus-visible, .root [role="switch"]:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.root svg { width: 16px; height: 16px; flex: none; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.root [hidden] { display: none !important; }

.fab { position: fixed; display: inline-flex; align-items: center; gap: 8px; height: 38px; padding: 0 14px 0 12px; border-radius: 999px; background: var(--bar); color: var(--bar-text); border: 1px solid rgba(255,255,255,.12); box-shadow: var(--shadow); font-weight: 650; font-size: 12.5px; user-select: none; touch-action: none; pointer-events: auto; transition: transform .12s ease, box-shadow .12s ease; }
.fab:hover { transform: translateY(-1px); }
.fab:active { transform: translateY(0); }
.fab svg { color: #7fb3ff; }
.badge { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; background: rgba(255,255,255,.16); font-size: 11px; font-weight: 700; text-align: center; line-height: 20px; font-variant-numeric: tabular-nums; }
.badge:empty { display: none; }
.badge.warn { background: #d99a06; color: #fff; } .badge.err { background: #e5484d; color: #fff; }

.panel { position: fixed; display: none; flex-direction: column; background: var(--surface); box-shadow: var(--shadow); pointer-events: auto; overflow: hidden; }
.panel.open { display: flex; }
.panel.bottom { left: 0; right: 0; bottom: 0; border-top: 1px solid var(--border); border-radius: 12px 12px 0 0; }
.panel.right { top: 0; bottom: 0; right: 0; border-left: 1px solid var(--border); border-radius: 12px 0 0 12px; }
.grip { position: absolute; z-index: 2; }
.bottom .grip { left: 0; right: 0; top: 0; height: 8px; cursor: ns-resize; }
.right .grip { top: 0; bottom: 0; left: 0; width: 8px; cursor: ew-resize; }
.grip:hover { background: color-mix(in srgb, var(--accent) 40%, transparent); }
.bar { display: flex; align-items: center; gap: 4px; height: 40px; padding: 0 8px 0 12px; background: var(--bar); color: var(--bar-text); flex: none; }
.bar .title { font-weight: 650; font-size: 13px; margin-left: 2px; }
.bar .logo { color: #7fb3ff; display: inline-flex; }
.bar .spacer { flex: 1; }
.tool { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 6px; color: #b9c4d0; }
.tool:hover { background: rgba(255,255,255,.12); color: #fff; }
.tool[aria-pressed="true"] { background: rgba(255,255,255,.18); color: #fff; }
.divider { width: 1px; height: 18px; margin: 0 4px; background: rgba(255,255,255,.18); }
iframe { flex: 1; width: 100%; border: 0; background: var(--surface); color-scheme: normal; }
.resizing iframe { pointer-events: none; }

.menu { position: absolute; z-index: 3; top: 46px; right: 8px; width: 320px; max-width: calc(100% - 16px); max-height: calc(100% - 56px); overflow: auto; padding: 6px; border-radius: 10px; background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow); }
.menu .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 36px; padding: 4px 8px; border-radius: 6px; color: var(--text); }
.menu .row.clickable { cursor: pointer; }
.menu .row.clickable:hover { background: var(--surface-2); }
.menu .label { font-size: 12.5px; }
.menu .section { padding: 8px 8px 4px; color: var(--text-3); font-size: 11px; font-weight: 650; text-transform: uppercase !important; letter-spacing: .06em !important; }
.switch { position: relative; width: 30px; height: 18px; border-radius: 999px; background: var(--border); flex: none; transition: background .15s; }
.switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.35); transition: transform .15s; }
.row[aria-checked="true"] .switch { background: var(--accent); }
.row[aria-checked="true"] .switch::after { transform: translateX(12px); }
.value { display: inline-flex; align-items: center; gap: 6px; color: var(--text-2); font-size: 12.5px; font-weight: 600; }
.value svg { width: 12px; height: 12px; color: var(--text-3); transition: transform .15s; }
.row[aria-expanded="true"] .value svg { transform: rotate(180deg); }
.options { padding: 2px 0 4px; }
.opt { display: flex; align-items: center; gap: 8px; min-height: 32px; margin: 0 4px; padding: 0 8px 0 10px; border-radius: 6px; font-size: 12.5px; cursor: pointer; }
.opt:hover, .opt:focus-visible { background: var(--surface-2); outline: none; }
.opt .check { width: 14px; height: 14px; color: var(--accent); visibility: hidden; }
.opt[aria-selected="true"] { font-weight: 650; }
.opt[aria-selected="true"] .check { visibility: visible; }
.opt .code { margin-left: auto; color: var(--text-3); font: 600 10.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; text-transform: uppercase !important; }
.keys { display: flex; align-items: center; gap: 3px; }
kbd { font: 600 10.5px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; padding: 3px 5px; border: 1px solid var(--border); border-bottom-width: 2px; border-radius: 4px; background: var(--surface-2); color: var(--text-2); }
.num { display: inline-flex; align-items: center; gap: 6px; color: var(--text-3); font-size: 12px; }
.num input { width: 78px; height: 26px; padding: 0 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface-2); color: var(--text); font: 600 12.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; text-align: right; -moz-appearance: textfield; }
.num input::placeholder { color: var(--text-3); font-weight: 500; }
.num input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.menu .sep { height: 1px; margin: 6px 0; background: var(--border); }
.menu .action { display: flex; align-items: center; gap: 8px; width: 100%; height: 34px; padding: 0 8px; border-radius: 6px; font-size: 12.5px; }
.menu .action:hover { background: var(--surface-2); }
.menu .action.danger { color: var(--err); }
.menu .hint { padding: 0 8px 6px; color: var(--text-3); font-size: 11.5px; }
@media (prefers-reduced-motion: reduce) { .root * { transition: none !important; } }
`

const ICON = (paths: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`
const ICONS = {
  db: ICON(`<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>`),
  gear: ICON(`<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>`),
  external: ICON(`<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>`),
  close: ICON(`<path d="m6 6 12 12M18 6 6 18"/>`),
  dockBottom: ICON(`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 14h18"/>`),
  dockRight: ICON(`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16"/>`),
  trash: ICON(`<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>`),
  power: ICON(`<path d="M12 3v9M6.3 6.8a8 8 0 1 0 11.4 0"/>`),
  down: ICON(`<path d="m6 9 6 6 6-6"/>`),
  check: ICON(`<path d="m5 12.5 4.5 4.5L19 7.5"/>`)
}

export interface WidgetHandle {
  settings: () => WidgetSettings
  destroy: () => void
}

const keyChips = (combo: string) => combo.split("+").map(key => `<kbd>${key}</kbd>`).join("")

export function mountSqlInspectorWidget(options: WidgetOptions): WidgetHandle {
  const win = options.win ?? (globalThis as unknown as Window & typeof globalThis)
  const doc = win.document
  const inspectorUrl = `${options.baseURL.replace(TRAILING_SLASHES, "")}/__sql-inspector/`
  const settings = loadSettings(win)

  const save = () => {
    try {
      win.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // storage can be blocked; settings then last for this page only
    }
  }
  const locale = (): Locale => settings.lang === "auto"
    ? pickLocale(win.navigator?.languages?.length ? win.navigator.languages : [win.navigator?.language])
    : settings.lang
  const t = (key: MessageKey, params?: Record<string, string | number>) => translate(locale(), key, params)

  // A custom-element name, not a <div>: host stylesheets that style `div` / `body > *` cannot match it by tag.
  const host = doc.createElement("sql-dev-inspector")
  host.setAttribute("data-sql-inspector", "")
  const root = host.attachShadow({ mode: "open" })
  root.innerHTML = `
    <style>${STYLE}</style>
    <div class="root">
      <button class="fab" type="button" data-act="toggle">${ICONS.db}<span data-fab>SQL</span><span class="badge"></span></button>
      <section class="panel" role="dialog">
        <div class="grip" role="separator"></div>
        <header class="bar">
          <span class="logo">${ICONS.db}</span><b class="title"></b><span class="spacer"></span>
          <button class="tool" type="button" data-act="dock-bottom">${ICONS.dockBottom}</button>
          <button class="tool" type="button" data-act="dock-right">${ICONS.dockRight}</button>
          <span class="divider"></span>
          <button class="tool" type="button" data-act="menu" aria-haspopup="true" aria-expanded="false">${ICONS.gear}</button>
          <button class="tool" type="button" data-act="tab">${ICONS.external}</button>
          <button class="tool" type="button" data-act="close">${ICONS.close}</button>
        </header>
        <div class="menu" hidden>
          <div class="row clickable" role="switch" tabindex="0" data-opt="autoOpen"><span class="label" data-t="widget.autoOpen"></span><span class="switch"></span></div>
          <div class="row clickable" role="switch" tabindex="0" data-opt="buttonVisible"><span class="label" data-t="widget.showButton"></span><span class="switch"></span></div>
          <div class="row clickable" role="button" tabindex="0" aria-haspopup="listbox" aria-expanded="false" data-lang-toggle><span class="label" data-t="widget.language"></span><span class="value"><span data-lang-current></span>${ICONS.down}</span></div>
          <div class="options" role="listbox" data-lang-options hidden></div>
          <label class="row"><span class="label" data-t="widget.slowMs"></span><span class="num"><input type="number" inputmode="numeric" min="${SLOW_MS_MIN}" max="${SLOW_MS_MAX}" step="1" data-slow-input>ms</span></label>
          <div class="hint" data-slow-hint></div>
          <div class="sep"></div>
          <div class="section" data-t="widget.shortcuts"></div>
          <div class="row"><span class="label" data-t="widget.shortcut.toggle"></span><span class="keys">${keyChips(HOTKEYS.togglePanel)}</span></div>
          <div class="row"><span class="label" data-t="widget.shortcut.button"></span><span class="keys">${keyChips(HOTKEYS.toggleButton)}</span></div>
          <div class="row"><span class="label" data-t="widget.shortcut.close"></span><span class="keys"><kbd>Esc</kbd></span></div>
          <div class="sep"></div>
          <button class="action" type="button" data-act="clear">${ICONS.trash}<span data-t="widget.clear"></span></button>
          <button class="action danger" type="button" data-act="disable">${ICONS.power}<span data-t="widget.disable"></span></button>
          <div class="hint" data-disable-hint></div>
        </div>
        <iframe></iframe>
      </section>
    </div>`

  const $ = <T extends Element>(selector: string) => root.querySelector<T>(selector)!
  const button = $<HTMLElement>(".fab")
  const badge = $<HTMLElement>(".badge")
  const panel = $<HTMLElement>(".panel")
  const menu = $<HTMLElement>(".menu")
  const grip = $<HTMLElement>(".grip")
  const frame = $<HTMLIFrameElement>("iframe")
  const langToggle = $<HTMLElement>("[data-lang-toggle]")
  const langOptions = $<HTMLElement>("[data-lang-options]")
  const slowInput = $<HTMLInputElement>("[data-slow-input]")
  const slowHint = $<HTMLElement>("[data-slow-hint]")

  // A custom listbox, not a <select>: the browser/OS draws a native select's popup, which no CSS can restyle.
  const langChoices: { value: WidgetSettings["lang"], code: string }[] = [{ value: "auto", code: "" }, ...LOCALES.map(l => ({ value: l.code, code: l.code }))]
  langOptions.innerHTML = langChoices.map(choice =>
    `<div class="opt" role="option" tabindex="-1" data-lang-opt="${choice.value}">${ICONS.check}<span data-lang-name></span><span class="code">${choice.code}</span></div>`).join("")
  const langName = (value: WidgetSettings["lang"]) => value === "auto" ? t("widget.lang.auto") : LOCALES.find(l => l.code === value)!.name

  const query = () => settings.lang === "auto" ? "" : `?lang=${settings.lang}`
  const frameUrl = () => `${inspectorUrl}${query()}#latest`

  // What the server reports for the threshold; null until the first answer.
  let serverSlow: ServerSettings | null = null
  let serverBrand: ServerSettings["brand"] = null
  const isServerSettings = (value: unknown): value is ServerSettings =>
    typeof value === "object" && value !== null
    && typeof (value as ServerSettings).slowMs === "number" && typeof (value as ServerSettings).defaultSlowMs === "number"

  const savedSlow = (): number | null => {
    try {
      const raw = win.localStorage.getItem(SLOW_STORAGE_KEY)
      const value = raw === null ? Number.NaN : Number(raw)
      return Number.isFinite(value) && value >= SLOW_MS_MIN ? clamp(Math.round(value), SLOW_MS_MIN, SLOW_MS_MAX) : null
    } catch {
      return null
    }
  }
  const saveSlow = (value: number | null) => {
    try {
      if (value === null) {
        win.localStorage.removeItem(SLOW_STORAGE_KEY)
      } else {
        win.localStorage.setItem(SLOW_STORAGE_KEY, String(value))
      }
    } catch {
      // storage can be blocked; the server then keeps the value until it restarts
    }
  }

  const showSlow = (server: ServerSettings | null = null) => {
    serverSlow = server ?? serverSlow
    // The server holds the value. An empty box means "server default"; a value set elsewhere shows up here too.
    const custom = serverSlow !== null && serverSlow.slowMs !== serverSlow.defaultSlowMs
    slowInput.value = custom ? String(serverSlow!.slowMs) : ""
    slowInput.placeholder = serverSlow ? String(serverSlow.defaultSlowMs) : ""
    slowHint.textContent = t("widget.slowMs.hint", { ms: serverSlow?.defaultSlowMs ?? "…" })
  }
  const requestSlow = async (init?: RequestInit) => {
    try {
      const data: unknown = await (await win.fetch(`${inspectorUrl}api/settings`, init)).json()
      if (isServerSettings(data)) {
        showSlow(data)
        const brand = data.brand ?? null
        if (brand?.title !== serverBrand?.title || brand?.short !== serverBrand?.short) {
          serverBrand = brand
          applyTexts()
        }
      }
    } catch {
      // inspector not reachable (server restarting): the next connection tries again
    }
  }
  const pushSlow = (value: number | null) => requestSlow({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slowMs: value }) })
  // After a (re)connect: push the threshold saved in this browser, or pick up the server's.
  const syncSlow = () => {
    const saved = savedSlow()
    return saved === null ? requestSlow() : pushSlow(saved)
  }
  const commitSlow = () => {
    const raw = slowInput.value.trim()
    const rounded = Math.round(Number(raw))
    if (raw !== "" && (!Number.isFinite(rounded) || rounded < SLOW_MS_MIN)) {
      showSlow()
      return
    }
    const value = raw === "" ? null : clamp(rounded, SLOW_MS_MIN, SLOW_MS_MAX)
    saveSlow(value)
    void pushSlow(value)
  }
  slowInput.addEventListener("change", commitSlow)

  const applyTexts = () => {
    for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-t]"))) {
      el.textContent = t(el.dataset.t as MessageKey)
    }
    const openLabel = t("widget.open", { keys: HOTKEYS.togglePanel })
    button.setAttribute("title", openLabel)
    button.setAttribute("aria-label", openLabel)
    const title = serverBrand?.title ?? t("widget.title")
    $<HTMLElement>(".title").textContent = title
    $<HTMLElement>("[data-fab]").textContent = serverBrand?.short ?? "SQL"
    panel.setAttribute("aria-label", title)
    const titles: Record<string, string> = {
      "dock-bottom": t("widget.dock.bottom"),
      "dock-right": t("widget.dock.right"),
      "menu": t("widget.settings"),
      "tab": t("widget.newTab"),
      "close": t("widget.close", { key: "Esc" })
    }
    for (const [act, title] of Object.entries(titles)) {
      const el = $<HTMLElement>(`[data-act="${act}"]`)
      el.setAttribute("title", title)
      el.setAttribute("aria-label", title)
    }
    grip.setAttribute("aria-label", t("widget.resize"))
    $<HTMLElement>("[data-disable-hint]").textContent = t("widget.disable.hint", { keys: HOTKEYS.togglePanel })
    for (const opt of Array.from(langOptions.querySelectorAll<HTMLElement>("[data-lang-opt]"))) {
      const value = opt.dataset.langOpt as WidgetSettings["lang"]
      opt.querySelector("[data-lang-name]")!.textContent = langName(value)
      opt.setAttribute("aria-selected", String(value === settings.lang))
      opt.querySelector("svg")!.setAttribute("class", "check")
    }
    $<HTMLElement>("[data-lang-current]").textContent = langName(settings.lang)
    showSlow()
  }

  const setLangList = (open: boolean) => {
    langOptions.hidden = !open
    langToggle.setAttribute("aria-expanded", String(open))
  }
  const chooseLang = (value: WidgetSettings["lang"]) => {
    settings.lang = value
    applyTexts()
    setLangList(false)
    if (frame.getAttribute("src")) {
      frame.setAttribute("src", frameUrl())
    }
    render()
    langToggle.focus()
  }

  let stream: EventSource | null = null
  let lastAnnounced = ""
  let timer: ReturnType<typeof setTimeout> | null = null

  const render = () => {
    host.style.display = settings.enabled ? "" : "none"
    button.style.display = settings.buttonVisible ? "" : "none"
    button.style.right = `${settings.offset.right}px`
    button.style.bottom = `${settings.offset.bottom}px`
    panel.classList.toggle("open", settings.open)
    panel.classList.toggle("bottom", settings.dock === "bottom")
    panel.classList.toggle("right", settings.dock === "right")
    $<HTMLElement>(`[data-act="dock-bottom"]`).setAttribute("aria-pressed", String(settings.dock === "bottom"))
    $<HTMLElement>(`[data-act="dock-right"]`).setAttribute("aria-pressed", String(settings.dock === "right"))
    const max = (settings.dock === "bottom" ? win.innerHeight : win.innerWidth) * 0.9
    const size = `${clamp(settings.size, 160, Math.max(160, max))}px`
    panel.style.height = settings.dock === "bottom" ? size : ""
    panel.style.width = settings.dock === "right" ? size : ""
    for (const row of Array.from(root.querySelectorAll<HTMLElement>("[data-opt]"))) {
      row.setAttribute("aria-checked", String(Boolean(settings[row.dataset.opt as "autoOpen" | "buttonVisible"])))
    }
    // Loaded on first open only: a closed panel costs the app nothing.
    if (settings.open && !frame.getAttribute("src")) {
      frame.setAttribute("src", frameUrl())
    }
    save()
    if (settings.enabled) {
      ensureConnected()
    }
  }

  const setMenu = (open: boolean) => {
    menu.hidden = !open
    setLangList(false)
    const gear = $<HTMLElement>(`[data-act="menu"]`)
    gear.setAttribute("aria-expanded", String(open))
    gear.setAttribute("aria-pressed", String(open))
  }

  const setOpen = (open: boolean) => {
    settings.open = open
    if (open) {
      settings.enabled = true
    } else {
      setMenu(false)
    }
    render()
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.altKey && event.shiftKey && event.code === "KeyS") {
      event.preventDefault()
      setOpen(!settings.open || !settings.enabled)
    } else if (event.altKey && event.shiftKey && event.code === "KeyD") {
      event.preventDefault()
      settings.buttonVisible = !settings.buttonVisible
      render()
    } else if (event.key === "Escape" && settings.open && event.composedPath().some(node => node === host || node === frame.contentWindow)) {
      if (menu.hidden) {
        setOpen(false)
      } else {
        setMenu(false)
      }
    }
  }
  win.addEventListener("keydown", onKeydown)
  // Every load is a new window inside the frame (first open, language change), and it needs the hotkeys again.
  frame.addEventListener("load", () => frame.contentWindow?.addEventListener("keydown", onKeydown))
  // Key events from inside the shadow root are composed, so the window listener already sees them.

  // Drag the button; a move under 4px is a plain click. A real `click` event does the toggling (so
  // keyboard activation, assistive tech and programmatic clicks all work); a drag swallows its own click.
  let suppressClick = false
  button.addEventListener("pointerdown", (down) => {
    const start = { x: down.clientX, y: down.clientY, ...settings.offset }
    let moved = false
    const move = (event: PointerEvent) => {
      const dx = event.clientX - start.x
      const dy = event.clientY - start.y
      moved ||= Math.hypot(dx, dy) > 4
      if (moved) {
        settings.offset = {
          right: clamp(start.right - dx, 4, win.innerWidth - 60),
          bottom: clamp(start.bottom - dy, 4, win.innerHeight - 40)
        }
        button.style.right = `${settings.offset.right}px`
        button.style.bottom = `${settings.offset.bottom}px`
      }
    }
    const up = () => {
      win.removeEventListener("pointermove", move)
      win.removeEventListener("pointerup", up)
      if (moved) {
        suppressClick = true
        setTimeout(() => {
          suppressClick = false
        }, 0)
        save()
      }
    }
    win.addEventListener("pointermove", move)
    win.addEventListener("pointerup", up)
  })
  button.addEventListener("click", () => {
    if (!suppressClick) {
      setOpen(!settings.open)
    }
  })

  grip.addEventListener("pointerdown", (down) => {
    const start = { x: down.clientX, y: down.clientY, size: settings.size }
    panel.classList.add("resizing")
    const move = (event: PointerEvent) => {
      settings.size = settings.dock === "bottom" ? start.size + (start.y - event.clientY) : start.size + (start.x - event.clientX)
      render()
    }
    const up = () => {
      panel.classList.remove("resizing")
      win.removeEventListener("pointermove", move)
      win.removeEventListener("pointerup", up)
    }
    win.addEventListener("pointermove", move)
    win.addEventListener("pointerup", up)
  })

  const toggleOption = (row: HTMLElement) => {
    const name = row.dataset.opt as "autoOpen" | "buttonVisible"
    settings[name] = !settings[name]
    render()
  }

  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement
    if (target.closest("[data-lang-toggle]")) {
      setLangList(Boolean(langOptions.hidden))
      if (!langOptions.hidden) {
        langOptions.querySelector<HTMLElement>(`[aria-selected="true"]`)?.focus()
      }
      return
    }
    const row = target.closest<HTMLElement>("[data-opt]")
    if (row) {
      toggleOption(row)
      return
    }
    const action = target.closest<HTMLElement>("[data-act]")?.dataset.act
    if (action === "close") {
      setOpen(false)
    } else if (action === "menu") {
      setMenu(Boolean(menu.hidden))
    } else if (action === "dock-bottom" || action === "dock-right") {
      settings.dock = action === "dock-bottom" ? "bottom" : "right"
      render()
    } else if (action === "tab") {
      win.open(frameUrl(), "_blank", "noopener")
    } else if (action === "clear") {
      void win.fetch(`${inspectorUrl}api/clear`, { method: "POST" })
    } else if (action === "disable") {
      settings.enabled = false
      settings.open = false
      stream?.close()
      stream = null
      render()
    }
  })
  root.addEventListener("keydown", (event) => {
    const e = event as KeyboardEvent
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-opt]")
    if (row && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault()
      toggleOption(row)
    } else if ((e.target as HTMLElement).closest("[data-lang-toggle]") && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault()
      ;(e.target as HTMLElement).click()
    }
  })
  langOptions.addEventListener("click", (event) => {
    const opt = (event.target as HTMLElement).closest<HTMLElement>("[data-lang-opt]")
    if (opt) {
      chooseLang(opt.dataset.langOpt as WidgetSettings["lang"])
    }
  })
  langOptions.addEventListener("keydown", (event) => {
    const options = Array.from(langOptions.querySelectorAll<HTMLElement>("[data-lang-opt]"))
    const index = options.indexOf(event.target as HTMLElement)
    if (event.key === "ArrowDown") {
      event.preventDefault()
      options[Math.min(options.length - 1, index + 1)]?.focus()
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      options[Math.max(0, index - 1)]?.focus()
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      chooseLang((event.target as HTMLElement).dataset.langOpt as WidgetSettings["lang"])
    } else if (event.key === "Escape") {
      event.stopPropagation()
      setLangList(false)
      langToggle.focus()
    }
  })

  // Badge: query count of the newest request, amber / red when it has warnings / errors.
  const refreshBadge = async () => {
    try {
      const list = await (await win.fetch(`${inspectorUrl}api/requests`)).json() as RequestSummary[]
      const latest = list[0]
      badge.textContent = latest ? String(latest.queryCount) : ""
      badge.className = `badge${latest?.errors ? " err" : latest?.warnings ? " warn" : ""}`
      if (latest && (latest.errors || latest.warnings) && latest.id !== lastAnnounced && settings.autoOpen && !settings.open) {
        setOpen(true)
      }
      lastAnnounced = latest && (latest.errors || latest.warnings) ? latest.id : lastAnnounced
    } catch {
      // inspector not reachable (server restarting): keep the last badge
    }
  }
  function ensureConnected() {
    if (stream || !settings.enabled || !win.EventSource) {
      return
    }
    void refreshBadge()
    stream = new win.EventSource(`${inspectorUrl}api/stream`)
    stream.onopen = () => void syncSlow()
    stream.onmessage = (event) => {
      // Someone (this widget, the page, another tab) changed the threshold: show the server's value.
      if (typeof event?.data === "string" && event.data.includes("settings")) {
        void requestSlow()
      }
      timer ??= setTimeout(() => {
        timer = null
        void refreshBadge()
      }, 150)
    }
  }

  doc.body.append(host)
  applyTexts()
  render()

  return {
    settings: () => ({ ...settings }),
    destroy: () => {
      win.removeEventListener("keydown", onKeydown)
      stream?.close()
      host.remove()
    }
  }
}
