// The inspector page's script, as a string: it runs in the browser, not in Node, and must stay
// dependency-free. `String.raw` keeps regex backslashes intact; keep backticks and dollar-braces out of it.
export const CLIENT_SCRIPT = String.raw`
(function () {
  "use strict";
  var CFG = __SQLI__;
  var MESSAGES = CFG.messages, LOCALES = CFG.locales;
  var KEY_LANG = "sqlDevInspector.lang", KEY_THEME = "sqlDevInspector.theme", KEY_FOLLOW = "sqlDevInspector.follow";
  var KEY_SLOW = "sqlDevInspector.slowMs", SLOW_MIN = 1, SLOW_MAX = 600000;

  // ── tiny helpers ───────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  var storage = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage may be blocked */ } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* storage may be blocked */ } }
  };
  function h(tag, props, kids) {
    var el = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === null || v === undefined || v === false) { return; }
        if (k === "class") { el.className = v; }
        else if (k === "text") { el.textContent = v; }
        else if (k.slice(0, 2) === "on") { el.addEventListener(k.slice(2), v); }
        else { el.setAttribute(k, v === true ? "" : String(v)); }
      });
    }
    (kids || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) { return; }
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return el;
  }
  var ICONS = {
    db: "<svg viewBox='0 0 24 24'><ellipse cx='12' cy='5' rx='8' ry='3'/><path d='M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6'/></svg>",
    search: "<svg viewBox='0 0 24 24'><circle cx='11' cy='11' r='7'/><path d='m20 20-3.5-3.5'/></svg>",
    chev: "<svg viewBox='0 0 24 24'><path d='m9 6 6 6-6 6'/></svg>",
    down: "<svg viewBox='0 0 24 24'><path d='m6 9 6 6 6-6'/></svg>",
    back: "<svg viewBox='0 0 24 24'><path d='m15 6-6 6 6 6'/></svg>",
    trash: "<svg viewBox='0 0 24 24'><path d='M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3'/></svg>",
    copy: "<svg viewBox='0 0 24 24'><rect x='9' y='9' width='11' height='11' rx='2'/><path d='M5 15V6a2 2 0 0 1 2-2h9'/></svg>",
    ok: "<svg viewBox='0 0 24 24'><circle cx='12' cy='12' r='9'/><path d='m8 12.5 2.8 2.8L16 9.5'/></svg>",
    warn: "<svg viewBox='0 0 24 24'><path d='M12 3 2.5 20h19L12 3Z'/><path d='M12 10v4M12 17.2v.1'/></svg>",
    error: "<svg viewBox='0 0 24 24'><circle cx='12' cy='12' r='9'/><path d='m9 9 6 6M15 9l-6 6'/></svg>",
    info: "<svg viewBox='0 0 24 24'><circle cx='12' cy='12' r='9'/><path d='M12 11v5M12 7.8v.1'/></svg>",
    layers: "<svg viewBox='0 0 24 24'><path d='m12 3 9 5-9 5-9-5 9-5Z'/><path d='m3 13 9 5 9-5'/></svg>",
    flag: "<svg viewBox='0 0 24 24'><path d='M5 21V4M5 4h11l-2 4 2 4H5'/></svg>",
    sun: "<svg viewBox='0 0 24 24'><circle cx='12' cy='12' r='4'/><path d='M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'/></svg>",
    moon: "<svg viewBox='0 0 24 24'><path d='M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z'/></svg>",
    monitor: "<svg viewBox='0 0 24 24'><rect x='3' y='4' width='18' height='12' rx='2'/><path d='M8 20h8M12 16v4'/></svg>",
    globe: "<svg viewBox='0 0 24 24'><circle cx='12' cy='12' r='9'/><path d='M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z'/></svg>",
    check: "<svg viewBox='0 0 24 24'><path d='m5 12.5 4.5 4.5L19 7.5'/></svg>",
    inbox: "<svg viewBox='0 0 24 24'><path d='M3 13h5l1.5 3h5L16 13h5'/><path d='M5 5h14l2 8v6H3v-6l2-8Z'/></svg>",
    timer: "<svg viewBox='0 0 24 24'><circle cx='12' cy='13' r='8'/><path d='M12 9v4l2.5 2M9 2h6'/></svg>",
    shield: "<svg viewBox='0 0 24 24'><path d='M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6L12 3Z'/><path d='m9 12 2.2 2.2L15.2 10'/></svg>",
    gear: "<svg viewBox='0 0 24 24'><circle cx='12' cy='12' r='3'/><path d='M12 2.5v2.2M12 19.3v2.2M4.2 6.5l1.9 1.1M17.9 16.4l1.9 1.1M2.5 12h2.2M19.3 12h2.2M4.2 17.5l1.9-1.1M17.9 7.6l1.9-1.1'/></svg>"
  };
  function icon(name) { var s = document.createElement("span"); s.innerHTML = ICONS[name] || ""; return s.firstChild; }

  // ── i18n ──────────────────────────────────────────────────────────
  function matchLocale(tag) {
    var m = /^([a-z]{2,3})/i.exec(tag || "");
    var code = m && m[1].toLowerCase();
    for (var i = 0; i < LOCALES.length; i++) { if (LOCALES[i].code === code) { return code; } }
    return null;
  }
  function initialLocale() {
    var fromQuery = matchLocale(new URLSearchParams(location.search).get("lang"));
    var langs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language];
    var fromBrowser = null;
    for (var i = 0; i < langs.length && !fromBrowser; i++) { fromBrowser = matchLocale(langs[i]); }
    return fromQuery || matchLocale(storage.get(KEY_LANG)) || CFG.hint || fromBrowser || "en";
  }
  var locale = initialLocale();
  function t(key, params) {
    var dict = MESSAGES[locale] || {};
    var one = params && String(params.count) === "1" ? (dict[key + ".one"] || MESSAGES.en[key + ".one"]) : null;
    var s = one || dict[key] || MESSAGES.en[key] || key;
    return s.replace(/\{(\w+)\}/g, function (whole, name) { return params && name in params ? String(params[name]) : whole; });
  }
  function num(n, digits) { try { return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(n); } catch (e) { return String(n); } }
  function fmtMs(v) {
    if (v === null || v === undefined) { return "…"; }
    if (v < 1) { return num(v, 2) + " ms"; }
    if (v < 10) { return num(v, 2) + " ms"; }
    if (v < 1000) { return num(v, 1) + " ms"; }
    return num(v / 1000, 2) + " s";
  }
  function fmtTime(ts) { try { return new Date(ts).toLocaleTimeString(locale); } catch (e) { return ""; } }

  // ── state ─────────────────────────────────────────────────────────
  var state = {
    requests: [], selectedId: null, report: null, term: "", mode: "all",
    follow: location.hash === "#latest" || storage.get(KEY_FOLLOW) === "1",
    open: {}, collapsed: {}, highlight: [], expandAll: false, rawSql: {}, compare: null,
    theme: storage.get(KEY_THEME) || "auto", live: false, loadToken: 0
  };
  var appEl = $("app"), listBody = $("list-body"), detailEl = $("detail");

  // ── theme / language ──────────────────────────────────────────────
  function applyTheme() {
    if (state.theme === "light" || state.theme === "dark") { document.documentElement.setAttribute("data-theme", state.theme); }
    else { document.documentElement.removeAttribute("data-theme"); }
    var btn = $("theme"); btn.textContent = "";
    btn.appendChild(icon(state.theme === "dark" ? "moon" : state.theme === "light" ? "sun" : "monitor"));
    var label = t("theme.label") + ": " + t("theme." + state.theme);
    btn.setAttribute("title", label); btn.setAttribute("aria-label", label);
  }
  function applyI18n() {
    document.documentElement.lang = locale;
    document.title = CFG.title || t("app.title");
    Array.prototype.forEach.call(document.querySelectorAll("[data-i18n]"), function (el) { el.textContent = t(el.getAttribute("data-i18n")); });
    if (CFG.title) { Array.prototype.forEach.call(document.querySelectorAll("[data-i18n='app.title']"), function (el) { el.textContent = CFG.title; }); }
    Array.prototype.forEach.call(document.querySelectorAll("[data-i18n-title]"), function (el) { el.setAttribute("title", t(el.getAttribute("data-i18n-title"))); });
    Array.prototype.forEach.call(document.querySelectorAll("[data-i18n-placeholder]"), function (el) { el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder"))); });
    Array.prototype.forEach.call(document.querySelectorAll("[data-i18n-aria]"), function (el) { el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria"))); });
    updateLangMenu();
    applyTheme(); renderLive(); showSlow(null);
  }

  // ── SQL highlighting (DOM nodes only: SQL text is never parsed as HTML) ──
  var KEYWORDS = {};
  ("select from where and or not in is null like between join left right inner outer cross on group by order having limit offset union all distinct as insert into values update set delete exists case when then else end asc desc with begin commit rollback savepoint release start transaction for true false default duplicate key lateral using interval to").split(" ").forEach(function (w) { KEYWORDS[w] = true; });
  var TOKEN = /('(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.|"")*")|(` + "`" + String.raw`[^` + "`" + String.raw`]*` + "`" + String.raw`)|(\/\*[\s\S]*?\*\/|--[^\n]*)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|(\s+|[\s\S])/g;
  function highlight(sql) {
    var frag = document.createDocumentFragment(), m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(sql)) !== null) {
      var text = m[0], cls = null;
      if (m[1]) { cls = "str"; } else if (m[2]) { cls = "id"; } else if (m[3]) { cls = "com"; } else if (m[4]) { cls = "num"; }
      else if (m[5]) {
        if (KEYWORDS[text.toLowerCase()]) { cls = "kw"; }
        else if (sql.charAt(m.index + text.length) === "(") { cls = "fn"; }
      }
      frag.appendChild(cls ? h("span", { class: cls, text: text }) : document.createTextNode(text));
    }
    return frag;
  }

  // ── derived data ──────────────────────────────────────────────────
  function isControl(kind) { return /^(tx-|savepoint)/.test(kind); }
  function countNodes(nodes, type) {
    var n = 0;
    nodes.forEach(function (node) { if (node.type === type) { n++; } if (node.children) { n += countNodes(node.children, type); } });
    return n;
  }
  function visibleRequests() {
    var term = state.term.trim().toLowerCase();
    return state.requests.filter(function (r) {
      if (state.mode === "issues" && !(r.warnings || r.errors)) { return false; }
      if (state.mode === "errors" && !r.errors) { return false; }
      return !term || (r.method + " " + r.url + " " + (r.status === null ? "" : r.status)).toLowerCase().indexOf(term) >= 0;
    });
  }
  function urlLabel(r) { return r.id === "background" ? t("requests.background") : r.url; }

  // ── request list ──────────────────────────────────────────────────
  function statusEl(status) {
    return h("span", { class: "status" + (status ? " s" + String(status).charAt(0) : ""), text: status === null ? "…" : String(status) });
  }
  function renderList() {
    var rows = visibleRequests();
    $("count").textContent = String(state.requests.length);
    listBody.textContent = "";
    if (!state.requests.length) {
      listBody.appendChild(h("div", { class: "empty" }, [icon("inbox"), h("h3", { text: t("requests.empty.title") }), h("p", { text: t("requests.empty.body") })]));
      listBody.firstChild.querySelector("svg").setAttribute("class", "big");
      return;
    }
    if (!rows.length) { listBody.appendChild(h("div", { class: "empty" }, [h("p", { text: t("requests.noMatch") })])); return; }
    rows.forEach(function (r) {
      var meta = [
        h("span", { text: t("term.queries", { count: r.queryCount }) }),
        h("i", { class: "dot" }),
        h("span", { text: fmtMs(r.sqlTimeMs) }),
        h("i", { class: "dot" }),
        h("span", { text: fmtTime(r.startedAt) })
      ];
      if (r.errors) { meta.push(h("span", { class: "chip err", text: String(r.errors) }, [])); }
      if (r.warnings) { meta.push(h("span", { class: "chip warn", text: String(r.warnings) }, [])); }
      var row = h("button", {
        class: "req" + (r.warnings ? " has-warn" : "") + (r.errors ? " has-err" : ""),
        role: "option", "aria-selected": r.id === state.selectedId ? "true" : "false", "data-id": r.id,
        onclick: function () { select(r.id); }
      }, [
        h("div", { class: "req-top" }, [h("span", { class: "method " + r.method, text: r.method }), statusEl(r.status), h("span", { class: "req-url", title: urlLabel(r), text: urlLabel(r) })]),
        h("div", { class: "req-meta" }, meta)
      ]);
      listBody.appendChild(row);
    });
  }

  // ── detail ────────────────────────────────────────────────────────
  function kpi(label, value, sub) {
    return h("div", { class: "kpi" }, [h("div", { class: "kpi-label", text: label }), h("div", { class: "kpi-value", text: value }), sub ? h("div", { class: "kpi-sub", text: sub }) : null]);
  }
  function signed(v, unit) { return (v > 0 ? "+" : v < 0 ? "−" : "") + (unit === "ms" ? fmtMs(Math.abs(v)) : String(Math.abs(v))); }
  function pairCell(p, unit) {
    var cls = p.delta > 0 ? "up" : p.delta < 0 ? "down" : "";
    return h("td", { class: "num " + cls }, [document.createTextNode((unit === "ms" ? fmtMs(p.a) : p.a) + " → " + (unit === "ms" ? fmtMs(p.b) : p.b)), h("small", { text: p.delta ? " (" + signed(p.delta, unit) + ")" : "" })]);
  }
  function compareSection(tr) {
    var others = state.requests.filter(function (r) { return r.id !== tr.id; });
    var route = function (u) { return String(u).split("?")[0]; };
    others.sort(function (x, y) {
      var sx = x.method === tr.method && route(x.url) === route(tr.url) ? 0 : 1, sy = y.method === tr.method && route(y.url) === route(tr.url) ? 0 : 1;
      return sx - sy;
    });
    var box = h("div", { class: "card", style: "padding: 12px 16px" });
    if (!others.length) { return h("div", {}); }
    var select = h("select", { class: "pop-input compare-select", "aria-label": t("compare.title") }, [h("option", { value: "", text: t("compare.pick") })].concat(others.map(function (r) {
      return h("option", { value: r.id, text: r.method + " " + urlLabel(r) + " · " + fmtTime(r.startedAt) + " · " + t("term.queries", { count: r.queryCount }) });
    })));
    var result = h("div", { class: "compare-result" });
    function show(data) {
      result.textContent = "";
      var verdict = data.verdict === "same" ? t("compare.same") : t("compare." + data.verdict, { ms: fmtMs(Math.abs(data.totals.totalMs.delta)) });
      result.appendChild(h("div", { class: "compare-verdict " + data.verdict, text: verdict }));
      var rows = [["compare.calls", data.totals.calls, "n"], ["compare.callTime", data.totals.callMs, "ms"], ["compare.total", data.totals.totalMs, "ms"], ["compare.database", data.totals.database, "ms"], ["compare.cache", data.totals.cache, "ms"], ["compare.http", data.totals.http, "ms"], ["compare.app", data.totals.app, "ms"]]
        .filter(function (r) { return r[1].a || r[1].b; })
        .map(function (r) { return h("tr", {}, [h("th", { text: t(r[0]) }), pairCell(r[1], r[2])]); });
      result.appendChild(h("table", { class: "compare-table" }, rows));
      if (data.groups.length) {
        result.appendChild(h("h3", { class: "compare-sub", text: t("compare.calls.changed") }));
        result.appendChild(h("table", { class: "compare-table groups" }, data.groups.map(function (g) {
          return h("tr", {}, [
            h("td", {}, [h("span", { class: "chip " + (g.change === "added" || g.change === "more" || g.change === "slower" ? "warn" : "ok"), text: t("compare.change." + g.change) })]),
            h("td", { class: "code", text: (g.driver ? g.driver + " · " : "") + g.text }),
            pairCell(g.count, "n"), pairCell(g.ms, "ms")
          ]);
        })));
      } else { result.appendChild(h("div", { class: "dim", text: t("compare.noCalls") })); }
      if (data.findings.length) {
        result.appendChild(h("h3", { class: "compare-sub", text: t("compare.findings") }));
        result.appendChild(h("table", { class: "compare-table" }, data.findings.map(function (f) { return h("tr", {}, [h("th", { text: t("insight.title." + f.type) }), pairCell({ a: f.a, b: f.b, delta: f.b - f.a }, "n")]); })));
      }
    }
    select.addEventListener("change", function () {
      var other = select.value;
      state.compare = other ? { for: tr.id, against: other } : null;
      result.textContent = "";
      if (!other) { return; }
      fetch("./api/compare/" + encodeURIComponent(other) + "/" + encodeURIComponent(tr.id)).then(function (r) { return r.json(); }).then(show).catch(function () { toast(t("toast.copyFailed")); });
    });
    box.appendChild(h("div", { class: "compare-bar" }, [h("strong", { text: t("compare.title") }), select]));
    box.appendChild(result);
    if (state.compare && state.compare.for === tr.id) {
      select.value = state.compare.against;
      if (select.value) { select.dispatchEvent(new Event("change")); }
    }
    return h("section", { class: "section" }, [h("div", { class: "section-head" }, [h("h2", { text: t("compare.heading") })]), box]);
  }
  function renderDetail() {
    var keep = detailEl.scrollTop;
    detailEl.textContent = "";
    var rep = state.report;
    if (!rep) {
      detailEl.appendChild(h("div", { class: "empty" }, [icon("layers"), h("h3", { text: t("detail.empty.title") }), h("p", { text: t("detail.empty.body") })]));
      detailEl.firstChild.querySelector("svg").setAttribute("class", "big");
      return;
    }
    var tr = rep.trace, tot = rep.totals;
    var share = tr.durationMs ? Math.min(100, Math.round(tot.sqlTimeMs / tr.durationMs * 100)) : null;
    var inner = h("div", { class: "detail-inner" });
    inner.appendChild(h("div", { class: "detail-head" }, [
      h("button", { class: "btn sm back", onclick: function () { appEl.setAttribute("data-view", "list"); } }, [icon("back"), h("span", { text: t("detail.back") })]),
      h("span", { class: "method " + tr.method, text: tr.method }),
      h("h1", { text: tr.id === "background" ? t("requests.background") : tr.url }),
      statusEl(tr.status),
      h("button", { class: "btn sm export", title: t("detail.copyMarkdown.title"), onclick: function () {
        fetch("./api/requests/" + encodeURIComponent(tr.id) + "/markdown").then(function (r) { return r.text(); }).then(copy).catch(function () { toast(t("toast.copyFailed")); });
      } }, [icon("copy"), h("span", { text: t("detail.copyMarkdown") })]),
      h("button", { class: "btn sm export-json", title: t("detail.downloadJson.title"), onclick: function () {
        fetch("./api/requests/" + encodeURIComponent(tr.id) + "/export").then(function (r) { return r.text(); }).then(function (body) {
          var link = document.createElement("a");
          link.href = URL.createObjectURL(new Blob([body], { type: "application/json" }));
          link.download = "request-" + tr.id.slice(0, 8) + ".json";
          document.body.appendChild(link); link.click(); link.remove();
        }).catch(function () { toast(t("toast.copyFailed")); });
      } }, [icon("copy"), h("span", { text: t("detail.downloadJson") })])
    ]));
    inner.appendChild(h("div", { class: "kpis" }, [
      kpi(t("kpi.total"), fmtMs(tr.durationMs)),
      kpi(t("kpi.queries"), String(tot.queryCount)),
      kpi(t("kpi.sqlTime"), fmtMs(tot.sqlTimeMs), share === null ? "" : t("kpi.share", { percent: share })),
      kpi(t("kpi.transactions"), String(countNodes(rep.tree, "transaction"))),
      kpi(t("kpi.depth"), String(tot.maxSubqueryDepth))
    ]));

    var bd = tot.breakdown;
    if (bd && bd.total > 0) {
      var parts = ["database", "cache", "http", "app"].filter(function (k) { return bd[k] > 0; });
      inner.appendChild(h("section", { class: "section" }, [
        h("div", { class: "section-head" }, [h("h2", { text: t("breakdown.title") })]),
        h("div", { class: "card", style: "padding: 4px 16px 14px", title: t("breakdown.note") }, [
          h("div", { class: "split" }, parts.map(function (k) { return h("i", { class: k, style: "width:" + (bd[k] / bd.total * 100) + "%", title: t("breakdown." + k) + " " + fmtMs(bd[k]) }); })),
          h("div", { class: "legend" }, parts.map(function (k) { return h("span", {}, [h("span", { class: "dot " + k }), document.createTextNode(t("breakdown." + k) + " "), h("b", { text: fmtMs(bd[k]) + " · " + Math.round(bd[k] / bd.total * 100) + "%" })]); }))
        ])
      ]));
    }

    inner.appendChild(compareSection(tr));

    // insights
    var slowSeqs = {};
    rep.insights.forEach(function (i) { if (i.type === "slow") { i.seqs.forEach(function (s) { slowSeqs[s] = true; }); } });
    var insightsCard = h("div", { class: "card" });
    if (!rep.insights.length) { insightsCard.appendChild(h("div", { class: "empty-ok" }, [icon("ok"), h("span", { text: t("insights.none") })])); }
    rep.insights.forEach(function (i) {
      var ico = i.severity === "error" ? "error" : i.severity === "warn" ? "warn" : "info";
      insightsCard.appendChild(h("button", { class: "insight " + i.severity, onclick: function () { focusSeqs(i.seqs); } }, [
        h("span", { class: "ico" }, [icon(ico)]),
        h("div", {}, [h("div", { class: "insight-title", text: t("insight.title." + i.type) }), h("div", { class: "insight-msg", text: t("insight.msg." + i.type, i.params) }),
          i.params && i.params.caller ? h("div", { class: "insight-where", text: t("sql.caller") + " " + relPath(String(i.params.caller)) }) : null,
          hintOf(i) ? h("div", { class: "insight-hint" }, [h("strong", { text: t("hint.title") + ": " }), h("span", { text: hintOf(i) })]) : null])
      ]));
    });
    inner.appendChild(h("section", { class: "section" }, [
      h("div", { class: "section-head" }, [h("h2", { text: t("insights.title") }), h("span", { class: "count", text: String(rep.insights.length) })]),
      insightsCard
    ]));
    if (tr.logs && tr.logs.length) {
      var logCard = h("div", { class: "card logs" });
      tr.logs.forEach(function (l) {
        logCard.appendChild(h("div", { class: "log " + l.level }, [
          h("span", { class: "lvl", text: l.level }),
          h("span", { class: "t", text: "+" + fmtMs(Math.max(0, l.at - tr.startedAt)) }),
          h("span", { class: "msg", text: l.message }),
          l.caller ? callerEl(l.caller) : null
        ]));
      });
      inner.appendChild(h("section", { class: "section" }, [
        h("div", { class: "section-head" }, [h("h2", { text: t("logs.title") }), h("span", { class: "count", text: String(tr.logs.length) })]),
        logCard
      ]));
    }

    // tree
    var span = Math.max(tr.durationMs || 0, 1);
    tr.queries.forEach(function (q) { span = Math.max(span, q.startedAt - tr.startedAt + (q.durationMs || 0)); });
    var ctx = { t0: tr.startedAt, span: span, slow: slowSeqs, rep: rep };
    inner.appendChild(h("section", { class: "section" }, [
      h("div", { class: "section-head" }, [
        h("h2", { text: t("tree.title") }), h("span", { class: "spacer" }),
        h("button", { class: "btn sm", onclick: function () { setExpandAll(true); }, text: t("tree.expandAll") }),
        h("button", { class: "btn sm", onclick: function () { setExpandAll(false); }, text: t("tree.collapseAll") })
      ]),
      tr.droppedQueries ? h("div", { class: "dim", style: "margin-bottom:8px", text: t("tree.dropped", { count: tr.droppedQueries }) }) : null,
      h("div", { class: "axis" }, [h("span", { text: "0" }), h("span", { text: fmtMs(span) })]),
      treeNodes(rep.tree, ctx)
    ]));
    detailEl.appendChild(inner);
    detailEl.scrollTop = keep;
  }

  function treeNodes(nodes, ctx) {
    var frag = document.createDocumentFragment();
    nodes.forEach(function (n) { frag.appendChild(n.type === "query" ? queryNode(n.query, ctx) : txNode(n, ctx)); });
    return frag;
  }
  function txNode(n, ctx) {
    var key = "tx:" + n.connectionId + ":" + n.startedAt + ":" + (n.name || "");
    var collapsed = !!state.collapsed[key];
    var statements = countNodes(n.children, "query");
    var box = h("div", { class: "tx " + n.status + (collapsed ? "" : " expanded") });
    var statusCls = n.status === "committed" ? "ok" : n.status === "rolled-back" ? "err" : "warn";
    box.appendChild(h("button", { class: "tx-head", "aria-expanded": collapsed ? "false" : "true", onclick: function () { state.collapsed[key] = !collapsed; renderDetail(); } }, [
      h("span", { class: "chev" }, [icon("chev")]),
      icon(n.type === "transaction" ? "layers" : "flag"),
      h("span", { text: n.type === "transaction" ? t("tx.transaction") : t("tx.savepoint", { name: n.name || "" }) }),
      h("span", { class: "chip " + statusCls, text: t("status." + n.status) }),
      h("span", { class: "dim", text: t("sql.connection", { id: n.connectionId }) + " · " + t("tx.statements", { count: statements }) }),
      h("span", { class: "spacer" }),
      h("span", { class: "num", text: fmtMs(n.durationMs) })
    ]));
    if (!collapsed) { box.appendChild(h("div", { class: "tx-children" }, [treeNodes(n.children, ctx)])); }
    return box;
  }
  function queryNode(q, ctx) {
    var a = q.analysis;
    var isOpen = state.expandAll ? state.open[q.seq] !== false : !!state.open[q.seq];
    var box = h("div", { class: "q" + (isOpen ? " open" : "") + (q.error ? " err" : "") + (state.highlight.indexOf(q.seq) >= 0 ? " hl" : ""), "data-seq": q.seq });
    var rows = q.rowCount !== null ? t("sql.rows", { count: num(q.rowCount) }) : q.affectedRows !== null ? t("sql.affected", { count: num(q.affectedRows) }) : "";
    var wf = h("span", { class: "wf" }, [h("i", {
      class: q.error ? "err" : ctx.slow[q.seq] ? "slow" : "",
      style: "left:" + Math.min(99.5, Math.max(0, (q.startedAt - ctx.t0) / ctx.span * 100)) + "%;width:" + Math.max(0.6, (q.durationMs || 0) / ctx.span * 100) + "%"
    })]);
    var line = [
      h("span", { class: "chev" }, [icon("chev")]),
      h("span", { class: "kind " + a.kind, text: (a.label || a.kind).toUpperCase() }),
      q.driver && q.driver !== "mysql2" ? h("span", { class: "chip", text: q.driver }) : null,
      h("span", { class: "tables", text: a.tables.join(", ") || "—" })
    ];
    if (a.subqueryCount) { line.push(h("span", { class: "chip warn", text: t("sql.subquery", { count: a.subqueryCount, depth: a.subqueryDepth }) })); }
    if (q.error) { line.push(h("span", { class: "chip err", text: t("insight.title.error") })); }
    line.push(h("span", { class: "spacer" }), rows ? h("span", { class: "num", text: rows }) : null, h("span", { class: "num", text: fmtMs(q.durationMs) }));
    box.appendChild(h("button", { class: "q-head", "aria-expanded": isOpen ? "true" : "false", onclick: function () {
      var next = !isOpen; state.open[q.seq] = next; isOpen = next;
      box.classList.toggle("open", next); box.firstChild.setAttribute("aria-expanded", next ? "true" : "false");
      if (next && !body.firstChild) { fillBody(); }
    } }, [
      h("div", { class: "q-main" }, [h("div", { class: "q-line" }, line), h("div", { class: "preview", text: q.sql.replace(/\s+/g, " ").slice(0, 220) })]),
      wf
    ]));
    var body = h("div", { class: "q-body" });
    function fillBody() {
      body.textContent = "";
      var raw = !!state.rawSql[q.seq];
      var pre = h("pre", { class: "sql" });
      pre.appendChild(highlight(raw ? q.sql : (ctx.rep.formattedSql[q.seq] || q.sql)));
      var fmtBtn = h("button", { class: "seg-btn", "aria-pressed": raw ? "false" : "true", text: t("sql.formatted") });
      var rawBtn = h("button", { class: "seg-btn", "aria-pressed": raw ? "true" : "false", text: t("sql.raw") });
      function setRaw(v) { state.rawSql[q.seq] = v; fillBody(); }
      fmtBtn.addEventListener("click", function () { setRaw(false); });
      rawBtn.addEventListener("click", function () { setRaw(true); });
      body.appendChild(h("div", { class: "q-tools" }, [
        h("span", { class: "seg" }, [fmtBtn, rawBtn]),
        h("span", { text: t("sql.connection", { id: q.connectionId }) + " · " + q.api + " · " + t("sql.startedAt", { ms: fmtMs(Math.max(0, q.startedAt - ctx.t0)) }) }),
        q.caller ? h("span", { class: "from" }, [h("span", { text: t("sql.caller") + " " }), callerEl(q.caller)]) : null,
        h("span", { class: "spacer" }),
        h("button", { class: "btn sm", onclick: function () { copy(q.sql); } }, [icon("copy"), h("span", { text: t("sql.copy") })])
      ]));
      body.appendChild(pre);
      if (q.details) { body.appendChild(detailsEl(q.details)); }
      if (q.params && q.params.length) { body.appendChild(h("div", { class: "params", text: t("sql.params") + ": " + JSON.stringify(q.params) })); }
      if (q.statements && q.statements.length) {
        body.appendChild(h("div", { class: "sent-title", text: t("sql.sent", { count: q.statements.length }) }));
        q.statements.forEach(function (s) {
          var sentPre = h("pre", { class: "sql sent" });
          sentPre.appendChild(highlight(raw ? s.sql : (ctx.rep.formattedSql[s.seq] || s.sql)));
          body.appendChild(h("div", { class: "sent" }, [
            h("div", { class: "q-tools" }, [h("span", { text: (s.driver || "") + " · " + fmtMs(s.durationMs) + (s.rowCount !== null && s.rowCount !== undefined ? " · " + t("term.rows", { count: s.rowCount }) : "") }), h("span", { class: "spacer" }),
              h("button", { class: "btn sm", onclick: function () { copy(s.sql); } }, [icon("copy"), h("span", { text: t("sql.copy") })])]),
            sentPre,
            s.params && s.params.length ? h("div", { class: "params", text: t("sql.params") + ": " + JSON.stringify(s.params) }) : null,
            s.error ? h("div", { class: "error-box", text: s.error }) : null
          ]));
        });
      }
      if (q.error) { body.appendChild(h("div", { class: "error-box", text: q.error })); }
    }
    if (isOpen) { fillBody(); }
    box.appendChild(body);
    return box;
  }
  function fmtBytes(n) { return n < 1024 ? n + " B" : n < 1048576 ? num(n / 1024, 1) + " KB" : num(n / 1048576, 1) + " MB"; }
  function detailsEl(d) {
    var parts = [];
    if (d.status !== undefined) { parts.push(t("http.status") + " " + d.status); }
    if (d.requestBytes !== undefined) { parts.push(t("http.sent") + " " + fmtBytes(d.requestBytes)); }
    if (d.responseBytes !== undefined) { parts.push(t("http.received") + " " + fmtBytes(d.responseBytes)); }
    if (d.contentType) { parts.push(d.contentType); }
    if (d.retryAfter) { parts.push(t("http.retryAfter") + " " + d.retryAfter); }
    if (d.requestId) { parts.push("x-request-id " + d.requestId); }
    return h("div", { class: "params http-details", text: parts.join(" · ") });
  }
  function setExpandAll(open) {
    state.expandAll = open; state.open = {};
    if (!open) { state.expandAll = false; }
    renderDetail();
  }
  function focusSeqs(seqs) {
    state.highlight = seqs; renderDetail();
    var first = detailEl.querySelector(".q.hl");
    if (first && first.scrollIntoView) { first.scrollIntoView({ block: "center" }); }
  }

  // ── language menu: a custom listbox, because the OS draws a native <select>'s popup ──
  function langItems() { return Array.prototype.slice.call($("lang-menu").children); }
  function updateLangMenu() {
    var current = LOCALES.filter(function (l) { return l.code === locale; })[0];
    $("lang-label").textContent = current ? current.name : locale;
    langItems().forEach(function (li) { li.setAttribute("aria-selected", li.getAttribute("data-code") === locale ? "true" : "false"); });
  }
  function setLangMenu(open, restoreFocus) {
    var menu = $("lang-menu"), btn = $("lang");
    menu.hidden = !open; btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) { var items = langItems(); var sel = items.filter(function (li) { return li.getAttribute("aria-selected") === "true"; })[0] || items[0]; sel.focus(); }
    else if (restoreFocus) { btn.focus(); }
  }
  function chooseLocale(code) {
    locale = code; storage.set(KEY_LANG, locale); applyI18n(); renderList(); renderDetail(); setLangMenu(false, true);
  }
  function setupLangMenu() {
    var menu = $("lang-menu"), btn = $("lang");
    LOCALES.forEach(function (l) {
      var li = h("li", { class: "dd-item", role: "option", tabindex: "-1", "data-code": l.code }, [icon("check"), h("span", { text: l.name }), h("span", { class: "code", text: l.code })]);
      li.firstChild.setAttribute("class", "check");
      li.addEventListener("click", function () { chooseLocale(l.code); });
      menu.appendChild(li);
    });
    btn.addEventListener("click", function () { setLangMenu(menu.hidden, false); });
    btn.addEventListener("keydown", function (e) { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setLangMenu(true, false); } });
    menu.addEventListener("keydown", function (e) {
      var items = langItems(), i = items.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); items[Math.min(items.length - 1, i + 1)].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); items[Math.max(0, i - 1)].focus(); }
      else if (e.key === "Home") { e.preventDefault(); items[0].focus(); }
      else if (e.key === "End") { e.preventDefault(); items[items.length - 1].focus(); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (i >= 0) { chooseLocale(items[i].getAttribute("data-code")); } }
      else if (e.key === "Escape") { e.preventDefault(); setLangMenu(false, true); }
      else if (e.key === "Tab") { setLangMenu(false, false); }
    });
    document.addEventListener("click", function (e) { if (!menu.hidden && !$("lang-dd").contains(e.target)) { setLangMenu(false, false); } });
  }

  // ── slow-query threshold ──────────────────────────────────────────
  // The server holds the value; this box only shows it. The choice is also kept in localStorage
  // (shared with the floating panel, same origin) so it can be re-applied after a server restart.
  var serverSlow = null;
  function showSlow(server) {
    serverSlow = server || serverSlow;
    var input = $("slow");
    var custom = serverSlow && serverSlow.slowMs !== serverSlow.defaultSlowMs;
    input.value = custom ? String(serverSlow.slowMs) : "";
    input.placeholder = serverSlow ? String(serverSlow.defaultSlowMs) : "";
    $("slow-field").setAttribute("title", t("widget.slowMs") + " — " + t("widget.slowMs.hint", { ms: serverSlow ? serverSlow.defaultSlowMs : "…" }));
    showPrivacy(serverSlow);
  }
  // ── what to do about an insight: the most specific advice that exists for its kind of call ──
  function hintOf(i) {
    var family = i.params && i.params.family ? i.params.family : "sql", keys = ["insight.hint." + i.type + "." + family, "insight.hint." + i.type];
    for (var n = 0; n < keys.length; n++) { if (MESSAGES.en[keys[n]]) { return t(keys[n]); } }
    return "";
  }
  // ── where a call was made: a location, and a link that opens it in the editor ──
  var EDITOR_SCHEME = /^(?:vscode|vscode-insiders|cursor|windsurf|zed|idea|webstorm|phpstorm|pycharm|sublime|subl|txmt|atom):\/\//;
  function relPath(file) {
    var root = serverSlow && serverSlow.root ? serverSlow.root : "";
    return root && file.indexOf(root + "/") === 0 ? file.slice(root.length + 1) : file;
  }
  function editorHref(c) {
    var tpl = serverSlow && serverSlow.editor ? serverSlow.editor.template : "";
    if (!tpl || !EDITOR_SCHEME.test(tpl)) { return null; }
    var file = c.file.replace(/\\/g, "/");
    return tpl.replace("{file}", encodeURI(file)).replace("{path}", encodeURI(file.replace(/^\//, ""))).replace("{line}", String(c.line)).replace("{column}", String(c.column));
  }
  function callerEl(c) {
    var label = relPath(c.file) + ":" + c.line, href = editorHref(c);
    return href ? h("a", { class: "caller", href: href, title: t("sql.openInEditor"), text: label }) : h("span", { class: "caller", text: label });
  }
  // ── privacy and the requests to follow: server settings, shown in a popover ──
  function listOf(text) { return text.split(",").map(function (x) { return x.trim(); }).filter(Boolean); }
  function showPrivacy(server) {
    if (!server || !server.redact) { return; }
    var mode = server.redact;
    Array.prototype.forEach.call(document.querySelectorAll("[data-redact]"), function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-redact") === mode ? "true" : "false"); });
    $("redact-hint").textContent = t("settings.redact.hint." + mode);
    $("privacy").setAttribute("data-mode", mode);
    $("privacy-text").textContent = t(mode === "params" ? "status.hidden" : mode === "all" ? "status.masked" : "status.visible");
    if (document.activeElement !== $("include-input")) { $("include-input").value = (server.include || []).join(", "); }
    if (document.activeElement !== $("exclude-input")) { $("exclude-input").value = (server.exclude || []).join(", "); }
    if (document.activeElement !== $("budgets-input")) { $("budgets-input").value = (server.budgets || []).join("; "); }
    $("path-value").textContent = "/" + (server.mount || "__sql-inspector") + "/";
    $("stack-switch").setAttribute("aria-checked", server.stack === false ? "false" : "true");
    $("logs-switch").setAttribute("aria-checked", server.logs === true ? "true" : "false");
    var box = $("drivers"); box.textContent = "";
    (server.drivers || []).forEach(function (name) { box.appendChild(h("span", { class: "chip driver", text: name })); });
    if (!(server.drivers || []).length) { box.appendChild(h("span", { class: "chip driver none", text: t("settings.drivers.none") })); }
    var editor = server.editor ? server.editor.name : "vscode";
    Array.prototype.forEach.call(document.querySelectorAll("[data-editor]"), function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-editor") === editor ? "true" : "false"); });
  }
  function pushSetting(body) {
    return requestSlow({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }
  function setSettingsOpen(open, restoreFocus) {
    var pop = $("settings-pop"), btn = $("settings");
    pop.hidden = !open; btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (!open && restoreFocus) { btn.focus(); }
  }
  function setupSettings() {
    var pop = $("settings-pop");
    $("settings").addEventListener("click", function () { setSettingsOpen(pop.hidden, false); });
    $("privacy").addEventListener("click", function () { setSettingsOpen(pop.hidden, false); });
    Array.prototype.forEach.call(document.querySelectorAll("[data-redact]"), function (b) {
      b.addEventListener("click", function () { pushSetting({ redact: b.getAttribute("data-redact") }); });
    });
    $("include-input").addEventListener("change", function () { pushSetting({ include: listOf($("include-input").value) }); });
    $("exclude-input").addEventListener("change", function () { pushSetting({ exclude: listOf($("exclude-input").value) }); });
    $("budgets-input").addEventListener("change", function () {
      var items = $("budgets-input").value.split(";").map(function (s) { return s.trim(); }).filter(Boolean);
      pushSetting({ budgets: items });
    });
    $("check").addEventListener("click", function () {
      var list = $("checks"), btn = $("check");
      btn.textContent = t("settings.check.running"); list.hidden = false; list.textContent = "";
      fetch("./api/doctor").then(function (r) { return r.json(); }).then(function (d) {
        (d.checks || []).forEach(function (c) { list.appendChild(h("li", { class: c.status }, [h("span", { class: "dot" }), h("span", { text: c.message })])); });
      }).catch(function () { list.appendChild(h("li", { class: "error" }, [h("span", { class: "dot" }), h("span", { text: t("settings.check.failed") })])); })
        .then(function () { btn.textContent = t("settings.check"); });
    });
    $("logs-switch").addEventListener("click", function () { pushSetting({ logs: $("logs-switch").getAttribute("aria-checked") !== "true" }); });
    $("stack-switch").addEventListener("click", function () { pushSetting({ stack: $("stack-switch").getAttribute("aria-checked") !== "true" }); });
    Array.prototype.forEach.call(document.querySelectorAll("[data-editor]"), function (b) {
      b.addEventListener("click", function () { pushSetting({ editor: b.getAttribute("data-editor") }); });
    });
    $("settings-reset").addEventListener("click", function () { pushSetting({ redact: null, include: null, exclude: null, budgets: null, stack: null, logs: null, editor: null }); });
    pop.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); setSettingsOpen(false, true); } });
    document.addEventListener("click", function (e) {
      if (!pop.hidden && !$("settings-dd").contains(e.target) && !$("privacy").contains(e.target)) { setSettingsOpen(false, false); }
    });
  }
  function requestSlow(init) {
    return fetch("./api/settings", init).then(function (r) { return r.json(); }).then(function (d) {
      if (d && typeof d.slowMs === "number" && typeof d.defaultSlowMs === "number") { showSlow(d); }
    }).catch(function () { /* server restarting; the next connection retries */ });
  }
  function pushSlow(value) {
    return requestSlow({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slowMs: value }) });
  }
  function syncSlow() {
    var saved = storage.get(KEY_SLOW) === null ? NaN : Number(storage.get(KEY_SLOW));
    return Number.isFinite(saved) && saved >= SLOW_MIN ? pushSlow(saved) : requestSlow();
  }
  function commitSlow() {
    var raw = $("slow").value.trim(), rounded = Math.round(Number(raw));
    if (raw === "") { storage.del(KEY_SLOW); pushSlow(null); return; }
    if (!Number.isFinite(rounded) || rounded < SLOW_MIN) { showSlow(null); return; }
    rounded = Math.min(SLOW_MAX, rounded);
    storage.set(KEY_SLOW, String(rounded)); pushSlow(rounded);
  }

  // ── actions ───────────────────────────────────────────────────────
  var toastTimer = null;
  function toast(text) {
    var el = $("toast"); el.textContent = text; el.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.classList.remove("show"); }, 1600);
  }
  function copy(text) {
    function fallback() {
      var ta = h("textarea", { style: "position:fixed;opacity:0" }); ta.value = text; document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta); toast(t(ok ? "toast.copied" : "toast.copyFailed"));
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(t("toast.copied")); }, fallback);
    } else { fallback(); }
  }
  function api(path, init) { return fetch("./api/" + path, init).then(function (r) { return r.json(); }); }
  function loadDetail(id) {
    var token = ++state.loadToken;
    return api("requests/" + id).then(function (d) {
      if (token !== state.loadToken || id !== state.selectedId) { return; }
      state.report = d && d.trace ? d : null; renderDetail();
    }).catch(function () { /* server restarting; the next change event retries */ });
  }
  function select(id) {
    state.selectedId = id; state.highlight = []; state.open = {}; state.expandAll = false;
    appEl.setAttribute("data-view", "detail");
    renderList(); return loadDetail(id);
  }
  function refresh() {
    return api("requests").then(function (list) {
      state.requests = list; renderList();
      if (state.follow && list.length && list[0].id !== state.selectedId) { return select(list[0].id); }
      if (state.selectedId && list.some(function (r) { return r.id === state.selectedId; })) { return loadDetail(state.selectedId); }
      if (state.selectedId) { state.selectedId = null; state.report = null; renderDetail(); }
    }).catch(function () { /* server restarting */ });
  }
  function renderLive() {
    var el = $("live"); el.classList.toggle("on", state.live);
    $("live-text").textContent = t(state.live ? "live.on" : "live.off");
  }
  function connect() {
    if (typeof EventSource === "undefined") { return; }
    var es = new EventSource("./api/stream");
    es.onopen = function () { state.live = true; renderLive(); syncSlow(); refresh(); };
    es.onmessage = function (e) {
      if (e && typeof e.data === "string" && e.data.indexOf("settings") >= 0) { requestSlow(); }
      refresh();
    };
    es.onerror = function () { state.live = false; renderLive(); };
  }
  function move(delta) {
    var rows = visibleRequests(); if (!rows.length) { return; }
    var i = rows.findIndex(function (r) { return r.id === state.selectedId; });
    var next = rows[Math.min(rows.length - 1, Math.max(0, i < 0 ? 0 : i + delta))];
    select(next.id);
    var el = listBody.querySelector("[data-id='" + next.id + "']"); if (el && el.scrollIntoView) { el.scrollIntoView({ block: "nearest" }); }
  }
  function setFollow(v) {
    state.follow = v; storage.set(KEY_FOLLOW, v ? "1" : "0");
    $("follow").setAttribute("aria-checked", v ? "true" : "false");
    if (v) { refresh(); }
  }
  function setMode(mode) {
    state.mode = mode;
    Array.prototype.forEach.call(document.querySelectorAll("[data-mode]"), function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-mode") === mode ? "true" : "false"); });
    renderList();
  }
  function fitLayout() { appEl.classList.toggle("narrow", window.innerWidth < 760); document.documentElement.style.setProperty("--wf", window.innerWidth < 1100 ? "140px" : "220px"); }

  // ── wiring ────────────────────────────────────────────────────────
  Array.prototype.forEach.call(document.querySelectorAll("[data-icon]"), function (el) { el.replaceWith(icon(el.getAttribute("data-icon"))); });
  setupLangMenu();
  setupSettings();
  $("theme").addEventListener("click", function () {
    state.theme = state.theme === "auto" ? "light" : state.theme === "light" ? "dark" : "auto";
    storage.set(KEY_THEME, state.theme); applyTheme();
  });
  $("clear").addEventListener("click", function () {
    api("clear", { method: "POST" }).then(function () { state.selectedId = null; state.report = null; renderDetail(); refresh(); });
  });
  $("follow").addEventListener("click", function () { setFollow(!state.follow); });
  $("slow").addEventListener("change", commitSlow);
  var search = $("search");
  search.addEventListener("input", function () { state.term = search.value; renderList(); });
  Array.prototype.forEach.call(document.querySelectorAll("[data-mode]"), function (b) { b.addEventListener("click", function () { setMode(b.getAttribute("data-mode")); }); });
  document.addEventListener("keydown", function (e) {
    var tag = (e.target && e.target.tagName) || "";
    if (e.target && e.target.closest && e.target.closest(".dd")) { return; }
    if (e.key === "Escape" && e.target === search) { search.value = ""; state.term = ""; renderList(); search.blur(); return; }
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || e.metaKey || e.ctrlKey || e.altKey) { return; }
    if (e.key === "/") { e.preventDefault(); search.focus(); }
    else if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); move(-1); }
    else if (e.key === "e") { setExpandAll(!state.expandAll); }
  });
  window.addEventListener("resize", fitLayout);

  fitLayout(); applyI18n(); setFollow(state.follow); setMode("all"); renderList(); renderDetail(); refresh(); connect();
})();
`
