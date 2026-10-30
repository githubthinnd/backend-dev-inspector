import { type ViewId, views } from "@playground/shared/content"

export interface Order {
  id: number
  customerId: number
  customerName: string
  status: string
  totalCents: number
}

export interface Entry<T = unknown> {
  status: "loading" | "ready" | "error"
  payload?: T
  message?: string
}

export interface ApiResult {
  ok: boolean
  status: number
  data: any
  ms: number
}

export const viewIds = Object.keys(views) as ViewId[]

/** The state and the actions of the Antimatter front end, shared by its components. */
export function useAntimatter() {
  const view = useState<ViewId>("antimatter.view", () => "orders")
  const search = useState("antimatter.search", () => "")
  const data = useState<Record<string, Entry>>("antimatter.data", () => ({}))
  const runs = useState<Array<{ ms: number, rows: number }>>("antimatter.runs", () => [])
  const running = useState("antimatter.running", () => false)
  const drawer = useState<Order | null>("antimatter.drawer", () => null)
  const busy = useState("antimatter.busy", () => "")
  const toasts = useState<Array<{ id: number, kind: "ok" | "err", title: string, message: string }>>("antimatter.toasts", () => [])
  const last = useState("antimatter.last", () => "")
  const bannerOpen = useState("antimatter.banner", () => true)

  async function api(path: string): Promise<ApiResult> {
    const started = performance.now()
    try {
      const response = await $fetch.raw(path, { ignoreResponseError: true, headers: { accept: "application/json" } })
      const result = { ok: response.ok, status: response.status, data: response._data, ms: Math.round(performance.now() - started) }
      last.value = `GET ${path} · ${result.status} · ${result.ms} ms`
      return result
    } catch (error) {
      const result = { ok: false, status: 0, data: { error: String((error as Error)?.message ?? error) }, ms: Math.round(performance.now() - started) }
      last.value = `GET ${path} · failed · ${result.ms} ms`
      return result
    }
  }

  function toast(kind: "ok" | "err", title: string, message = "") {
    const id = Date.now() + Math.random()
    toasts.value = [...toasts.value, { id, kind, title, message }]
    setTimeout(() => { toasts.value = toasts.value.filter(item => item.id !== id) }, 4200)
  }

  async function load(id: ViewId, force = false) {
    if (id === "reports" || (data.value[id]?.status === "ready" && !force)) {
      return
    }
    data.value = { ...data.value, [id]: { status: "loading" } }
    const result = await api(views[id].path)
    data.value = {
      ...data.value,
      [id]: result.ok && Array.isArray(result.data)
        ? { status: "ready", payload: result.data }
        : { status: "error", message: result.data?.error ?? `HTTP ${result.status}` }
    }
  }

  async function go(id: ViewId) {
    view.value = id
    search.value = ""
    if (import.meta.client) {
      history.replaceState(null, "", `#/${id}`)
    }
    await load(id)
  }

  async function newOrder() {
    busy.value = "new-order"
    const result = await api("/api/orders/transaction")
    busy.value = ""
    if (result.ok) {
      toast("ok", `Order #${result.data.orderId} placed`, `Saved in one transaction · ${result.ms} ms`)
      data.value = { ...data.value, customers: undefined as never }
      await load("orders", true)
    } else {
      toast("err", "Could not place the order", result.data?.error)
    }
  }

  async function addItem() {
    busy.value = "add-item"
    const result = await api("/api/orders/error")
    busy.value = ""
    toast(result.ok ? "ok" : "err", result.ok ? "Item added" : "Could not add the item", result.ok ? "" : result.data?.error)
  }

  async function runReport() {
    running.value = true
    const result = await api("/api/orders/slow")
    running.value = false
    if (result.ok) {
      runs.value = [{ ms: result.ms, rows: result.data.rows }, ...runs.value].slice(0, 5)
    } else {
      toast("err", "The report failed", result.data?.error)
    }
  }

  function dismissBanner() {
    bannerOpen.value = false
    try { sessionStorage.setItem("antimatter.banner", "closed") } catch { /* private mode */ }
  }

  return { view, search, data, runs, running, drawer, busy, toasts, last, bannerOpen, load, go, newOrder, addItem, runReport, dismissBanner }
}
