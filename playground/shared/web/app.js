/* Antimatter: a small admin that calls the playground API. Plain JavaScript, no build step. */
(function () {
  "use strict"

  var config = window.__PLAYGROUND__ || { framework: "Playground", data: "SQLite" }

  /* ---------- helpers ---------- */
  var ICONS = {
    orders: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
    customers: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    reports: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
    loyalty: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    wallet: '<path d="M20 7H5a2 2 0 0 1 0-4h13v4z"/><path d="M3 5v14a2 2 0 0 0 2 2h15V7"/><path d="M16 14h.01"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    trend: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
    play: '<path d="m6 3 14 9-14 9z"/>',
    logo: '<circle cx="12" cy="12" r="5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3" />'
  }
  function icon(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + "</svg>"
  }
  function esc(text) {
    return String(text).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] })
  }
  function money(cents) {
    return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
  }
  var PALETTE = ["#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#0ea5e9", "#ef4444", "#14b8a6"]
  function hue(name) {
    var h = 0
    for (var i = 0; i < name.length; i++) { h = (h * 31 + name.charCodeAt(i)) >>> 0 }
    return PALETTE[h % PALETTE.length]
  }
  function initials(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0] }).join("").toUpperCase()
  }
  function avatar(name, size) {
    return '<span class="avatar ' + (size || "") + '" style="--avatar:' + hue(name) + '" aria-hidden="true">' + esc(initials(name)) + "</span>"
  }
  var FLAGS = { JP: "🇯🇵", VN: "🇻🇳", US: "🇺🇸", IT: "🇮🇹", FR: "🇫🇷", DE: "🇩🇪" }
  var COUNTRIES = { JP: "Japan", VN: "Vietnam", US: "United States", IT: "Italy", FR: "France", DE: "Germany" }

  /* ---------- API ---------- */
  var last = null
  function api(path) {
    var started = performance.now()
    return fetch(path, { headers: { accept: "application/json" } }).then(function (response) {
      return response.json().catch(function () { return null }).then(function (data) {
        var result = { ok: response.ok, status: response.status, data: data, ms: Math.round(performance.now() - started), path: path }
        last = result
        paintFootnote()
        return result
      })
    }).catch(function (error) {
      var result = { ok: false, status: 0, data: { error: String(error && error.message || error) }, ms: Math.round(performance.now() - started), path: path }
      last = result
      paintFootnote()
      return result
    })
  }

  /* ---------- state ---------- */
  var VIEWS = {}
  Object.keys(config.views || {}).forEach(function (key) {
    var v = config.views[key]
    VIEWS[key] = { title: v.title, sub: v.subtitle, icon: key, pill: [v.pill.tone === "warn" ? "" : v.pill.tone, v.pill.text], path: v.path, explain: v.explain }
  })
  var state = {
    view: "orders",
    search: "",
    data: {},      // view -> { status: "loading" | "ready" | "error", payload, message }
    runs: [],      // report runs: { ms, rows }
    running: false,
    drawer: null,  // an order
    bannerOpen: true,
    busy: ""
  }
  try { state.bannerOpen = sessionStorage.getItem("antimatter.banner") !== "closed" } catch (_) { /* private mode */ }

  /* ---------- views ---------- */
  function badge(status) { return '<span class="badge ' + esc(status) + '">' + esc(status) + "</span>" }

  function skeleton(rows) {
    var out = ""
    for (var i = 0; i < rows; i++) { out += '<div class="sk-row"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>' }
    return out
  }
  function errorState(message, retry) {
    return '<div class="error-state"><strong>Something went wrong</strong><span>' + esc(message || "The request failed.") + '</span><button class="btn" data-action="retry">' + esc(retry || "Try again") + "</button></div>"
  }

  function ordersView(entry) {
    if (entry.status === "loading") { return '<div class="card">' + skeleton(6) + "</div>" }
    if (entry.status === "error") { return '<div class="card">' + errorState(entry.message) + "</div>" }
    var orders = entry.payload
    var total = orders.reduce(function (sum, order) { return sum + order.totalCents }, 0)
    var pending = orders.filter(function (order) { return order.status === "pending" }).length
    var average = orders.length ? total / orders.length : 0
    var shown = orders.filter(function (order) { return !state.search || (order.customerName + " " + order.id).toLowerCase().indexOf(state.search.toLowerCase()) >= 0 })
    var kpis = [
      ["Orders", String(orders.length), "latest in the shop", "orders"],
      ["Revenue", money(total), "across these orders", "wallet"],
      ["Average order", money(average), "per order", "trend"],
      ["Pending", String(pending), "waiting for payment", "clock"]
    ].map(function (k) {
      return '<div class="card kpi"><div class="label">' + icon(k[3]) + k[0] + '</div><div class="value">' + esc(k[1]) + '</div><div class="sub">' + k[2] + "</div></div>"
    }).join("")
    var rows = shown.map(function (order) {
      return '<tr data-order="' + order.id + '" tabindex="0"><td class="mono">#' + order.id + '</td><td><div class="person">' + avatar(order.customerName, "sm") +
        "<div><strong>" + esc(order.customerName) + "</strong></div></div></td><td>" + badge(order.status) + '</td><td class="num">' + money(order.totalCents) + "</td></tr>"
    }).join("")
    return '<div class="kpis">' + kpis + '</div><div class="card"><div class="card-head"><h2>Recent orders</h2><span class="muted">' + shown.length + ' shown</span></div>' +
      (shown.length ? '<div class="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Status</th><th class="num">Total</th></tr></thead><tbody>' + rows + "</tbody></table></div>"
        : '<div class="empty"><strong>No orders match "' + esc(state.search) + '"</strong></div>') + "</div>"
  }

  function customersView(entry) {
    if (entry.status === "loading") { return '<div class="card">' + skeleton(6) + "</div>" }
    if (entry.status === "error") { return '<div class="card">' + errorState(entry.message) + "</div>" }
    var shown = entry.payload.filter(function (row) { return !state.search || row.customer.name.toLowerCase().indexOf(state.search.toLowerCase()) >= 0 })
    if (!shown.length) { return '<div class="card"><div class="empty"><strong>No customers match "' + esc(state.search) + '"</strong></div></div>' }
    return '<div class="grid">' + shown.map(function (row) {
      var c = row.customer
      return '<div class="card tile"><div class="top">' + avatar(c.name, "lg") + "<div><strong>" + esc(c.name) + '</strong><div class="muted">' +
        (FLAGS[c.country] || "") + " " + esc(COUNTRIES[c.country] || c.country) + '</div></div></div><div class="meta"><div><div class="muted">Order #' + row.id + "</div>" +
        badge(row.status) + '</div><div class="amount">' + money(row.totalCents) + "</div></div></div>"
    }).join("") + "</div>"
  }

  function reportsView(entry) {
    var lastRun = state.runs[0]
    var history = state.runs.length ? state.runs.map(function (run, index) {
      return '<div class="list-row"><span class="mono muted">Run ' + (state.runs.length - index) + '</span><span class="grow">' + Number(run.rows).toLocaleString("en-US") + ' rows scanned</span><strong class="mono">' + run.ms + " ms</strong></div>"
    }).join("") : '<div class="empty"><strong>No runs yet</strong><span>Run the report to see how long it takes.</span></div>'
    return '<div class="report"><div class="card"><div class="card-head"><h2>Revenue by period</h2><span class="pill err">Heavy query</span></div><div class="report-body">' +
      "<p class=\"muted\" style=\"margin:0\">Scans the whole order history and aggregates it. It is slow on purpose: the inspector flags any statement over 100 ms.</p>" +
      '<div class="meter ' + (state.running ? "busy" : "") + '"><i style="' + (!state.running && lastRun ? "width:100%" : "") + '"></i></div>' +
      '<div class="stat-line"><span class="muted">' + (lastRun ? "Last run" : "Ready") + "</span><strong>" +
      (state.running ? "Running…" : lastRun ? Number(lastRun.rows).toLocaleString("en-US") + " rows in " + lastRun.ms + " ms" : "—") + "</strong></div>" +
      '<div><button class="btn primary" data-action="run-report" ' + (state.running ? "disabled" : "") + ">" + (state.running ? '<span class="spinner"></span>Running' : icon("play") + "Run report") + "</button></div>" +
      '</div></div><div class="card"><div class="card-head"><h2>Recent runs</h2></div><div class="list">' + history + "</div></div></div>"
  }

  function loyaltyView(entry) {
    if (entry.status === "loading") { return '<div class="card">' + skeleton(4) + "</div>" }
    if (entry.status === "error") {
      return '<div class="card">' + errorState("The customer service did not answer: " + (entry.message || "unreachable") + ". Is it running on port 4010?", "Try again") + "</div>"
    }
    var rows = entry.payload.map(function (row) {
      var c = row.customer
      return '<div class="list-row">' + avatar(c.name) + '<div class="grow"><strong>' + esc(c.name) + '</strong><div class="muted">Order #' + row.orderId +
        '</div></div><span class="muted">' + Number(c.points || 0).toLocaleString("en-US") + ' pts</span><span class="badge ' + esc(c.tier) + '">' + esc(c.tier) + "</span></div>"
    }).join("")
    return '<div class="card"><div class="card-head"><h2>Loyalty members</h2><span class="muted">from the customer service</span></div><div class="list">' + rows + "</div></div>"
  }

  function explainCard(v) {
    var steps = [
      ["1", "What you are doing", v.explain.doing],
      ["2", "What the server runs", v.explain.server],
      ["3", "What to look for in the inspector", v.explain.look]
    ].map(function (s) {
      return '<div class="step"><span class="step-n">' + s[0] + "</span><div><strong>" + esc(s[1]) + "</strong><p>" + esc(s[2]) + "</p></div></div>"
    }).join("")
    return '<div class="card explain"><div class="card-head"><h2>Behind this screen</h2><a class="btn" href="/__sql-inspector/" target="_blank" rel="noopener">' + icon("external") + "Open the inspector</a></div><div class=\"steps\">" + steps + "</div></div>"
  }

  var RENDERERS = { orders: ordersView, customers: customersView, reports: reportsView, loyalty: loyaltyView }

  /* ---------- shell ---------- */
  function drawerHtml() {
    var o = state.drawer
    return '<div class="scrim ' + (o ? "open" : "") + '" data-action="close"></div><aside class="drawer ' + (o ? "open" : "") + '" aria-hidden="' + (o ? "false" : "true") + '">' +
      (o ? '<div class="drawer-head">' + avatar(o.customerName) + "<div><h2>Order #" + o.id + '</h2><span class="muted">' + esc(o.customerName) + '</span></div><button class="x" data-action="close" aria-label="Close">×</button></div>' +
        '<div class="drawer-body"><dl class="kv"><dt>Status</dt><dd>' + badge(o.status) + "</dd><dt>Total</dt><dd>" + money(o.totalCents) + "</dd><dt>Customer #</dt><dd class=\"mono\">" + o.customerId +
        '</dd></dl><div class="banner">' + icon("info") + "<p>Adding an item for an order that does not exist fails in the database. Try it and look at the error in the inspector.</p></div></div>" +
        '<div class="drawer-foot"><button class="btn danger" data-action="add-item" ' + (state.busy === "add-item" ? "disabled" : "") + ">" + (state.busy === "add-item" ? '<span class="spinner"></span>' : "") + 'Add gift item</button><button class="btn" data-action="close">Close</button></div>' : "") + "</aside>"
  }

  function navHtml() {
    var orders = state.data.orders && state.data.orders.status === "ready" ? state.data.orders.payload.length : ""
    return Object.keys(VIEWS).map(function (key) {
      var v = VIEWS[key]
      return '<button class="nav-item ' + (state.view === key ? "active" : "") + '" data-view="' + key + '">' + icon(v.icon) + v.title +
        (key === "orders" && orders !== "" ? '<span class="count">' + orders + "</span>" : "") + "</button>"
    }).join("")
  }

  function shell() {
    var v = VIEWS[state.view]
    var entry = state.data[state.view] || { status: "loading" }
    return '<div class="shell"><aside class="sidebar"><div class="brand"><span class="brand-mark">' + icon("logo") + '</span><div><strong>Antimatter</strong><small>Commerce admin</small></div></div>' +
      '<nav class="nav"><div class="nav-label">Workspace</div>' + navHtml() + '</nav><div class="sidebar-foot"><div class="env-card"><div class="row"><span class="dot"></span>' + esc(config.framework) +
      "</div><p>" + esc(config.data) + ' · local playground</p><a class="btn" style="width:100%;justify-content:center" href="/__sql-inspector/" target="_blank" rel="noopener">' + icon("external") + 'Open inspector</a></div></div></aside>' +
      '<div class="content"><header class="topbar"><div class="grow"><div class="crumbs">Antimatter / ' + esc(v.title) + '</div><h1 class="page-title">' + esc(v.title) + '</h1></div>' +
      '<label class="search">' + icon("search") + '<input type="search" placeholder="Search" aria-label="Search" value="' + esc(state.search) + '" data-input="search"></label>' +
      '<button class="btn primary" data-action="new-order" ' + (state.busy === "new-order" ? "disabled" : "") + ">" + (state.busy === "new-order" ? '<span class="spinner"></span>' : icon("plus")) + "New order</button>" +
      avatar("Nhu Thin") + '</header><main class="page">' +
      (state.bannerOpen ? '<div class="banner">' + icon("info") + "<p><strong>Playground.</strong> Everything here calls the real API behind it, so each click is a request you can open in the <a href=\"/__sql-inspector/\" target=\"_blank\" rel=\"noopener\">inspector</a>.</p><button data-action=\"dismiss\" aria-label=\"Dismiss\">✕</button></div>" : "") +
      '<div class="view-head"><span class="pill ' + v.pill[0] + '">Inspector: ' + esc(v.pill[1]) + "</span><p>" + esc(v.sub) + "</p></div>" + RENDERERS[state.view](entry) + explainCard(v) +
      '<div class="footnote"><span id="last-request">' + footnote() + "</span><span>" + esc(config.framework) + " · " + esc(config.data) + "</span></div></main></div></div>" + drawerHtml()
  }

  function footnote() {
    return last ? esc("GET " + last.path + " · " + (last.status || "failed") + " · " + last.ms + " ms") : "No request yet"
  }
  function paintFootnote() {
    var node = document.getElementById("last-request")
    if (node) { node.textContent = last ? "GET " + last.path + " · " + (last.status || "failed") + " · " + last.ms + " ms" : "No request yet" }
  }

  var root = document.getElementById("app")
  var toasts = document.createElement("div")
  toasts.className = "toasts"
  document.body.appendChild(toasts)

  function render() {
    var focus = document.activeElement
    var keepSearch = focus && focus.getAttribute && focus.getAttribute("data-input") === "search"
    var caret = keepSearch ? focus.selectionStart : 0
    root.innerHTML = shell()
    if (keepSearch) {
      var input = root.querySelector('[data-input="search"]')
      input.focus()
      input.setSelectionRange(caret, caret)
    }
  }

  function toast(kind, title, message) {
    var el = document.createElement("div")
    el.className = "toast " + (kind === "err" ? "err" : "")
    el.setAttribute("role", kind === "err" ? "alert" : "status")
    el.innerHTML = "<div><strong>" + esc(title) + "</strong><span>" + esc(message || "") + "</span></div>"
    toasts.appendChild(el)
    setTimeout(function () { el.remove() }, 4200)
  }

  /* ---------- actions ---------- */
  function load(view, force) {
    if (view === "reports") { return Promise.resolve() }
    if (state.data[view] && state.data[view].status === "ready" && !force) { return Promise.resolve() }
    state.data[view] = { status: "loading" }
    render()
    return api(VIEWS[view].path).then(function (result) {
      state.data[view] = result.ok && Array.isArray(result.data)
        ? { status: "ready", payload: result.data }
        : { status: "error", message: (result.data && result.data.error) || ("HTTP " + result.status) }
      render()
    })
  }

  function go(view) {
    state.view = view
    state.search = ""
    try { history.replaceState(null, "", "#/" + view) } catch (_) { /* file URLs */ }
    render()
    return load(view)
  }

  function act(action, target) {
    if (action === "retry") { return load(state.view, true) }
    if (action === "dismiss") {
      state.bannerOpen = false
      try { sessionStorage.setItem("antimatter.banner", "closed") } catch (_) { /* private mode */ }
      render(); return
    }
    if (action === "close") { state.drawer = null; render(); return }
    if (action === "new-order") {
      state.busy = "new-order"; render()
      return api("/api/orders/transaction").then(function (result) {
        state.busy = ""
        if (result.ok) {
          toast("ok", "Order #" + result.data.orderId + " placed", "Saved in one transaction · " + result.ms + " ms")
          state.data.customers = undefined
          return load("orders", true)
        }
        toast("err", "Could not place the order", result.data && result.data.error)
        render()
      })
    }
    if (action === "add-item") {
      state.busy = "add-item"; render()
      return api("/api/orders/error").then(function (result) {
        state.busy = ""
        toast(result.ok ? "ok" : "err", result.ok ? "Item added" : "Could not add the item", result.ok ? "" : (result.data && result.data.error))
        render()
      })
    }
    if (action === "run-report") {
      state.running = true; render()
      return api("/api/orders/slow").then(function (result) {
        state.running = false
        if (result.ok) {
          state.runs.unshift({ ms: result.ms, rows: result.data.rows })
          state.runs = state.runs.slice(0, 5)
        } else {
          toast("err", "The report failed", result.data && result.data.error)
        }
        render()
      })
    }
  }

  root.addEventListener("click", function (event) {
    var el = event.target.closest("[data-view],[data-action],[data-order]")
    if (!el) { return }
    if (el.hasAttribute("data-view")) { go(el.getAttribute("data-view")); return }
    if (el.hasAttribute("data-order")) {
      var id = Number(el.getAttribute("data-order"))
      var rows = state.data.orders && state.data.orders.payload || []
      state.drawer = rows.filter(function (order) { return order.id === id })[0] || null
      render(); return
    }
    act(el.getAttribute("data-action"), el)
  })
  root.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && event.target.hasAttribute && event.target.hasAttribute("data-order")) { event.target.click() }
    if (event.key === "Escape" && state.drawer) { act("close") }
  })
  root.addEventListener("input", function (event) {
    if (event.target.getAttribute && event.target.getAttribute("data-input") === "search") { state.search = event.target.value; render() }
  })

  var start = (location.hash || "").replace("#/", "")
  go(VIEWS[start] ? start : "orders")
})()
