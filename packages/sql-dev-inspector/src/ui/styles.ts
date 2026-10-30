/**
 * Styles of the inspector page. The page runs on its own document (served by the inspector,
 * shown standalone or inside the floating panel's iframe), so nothing here can reach the host
 * application. Everything is still scoped to our own elements and every native control is
 * restyled, so no browser-default widget shows through.
 */

const DARK = `
  --bg: #0d1117; --surface: #151b23; --surface-2: #1b232d; --surface-3: #242e3a;
  --border: #283241; --border-strong: #3a4757;
  --text: #e6edf3; --text-2: #aab5c3; --text-3: #7d8896;
  --accent: #5aa2ff; --accent-weak: rgba(90, 162, 255, .14); --accent-text: #0d1117;
  --ok: #4ac26b; --ok-weak: rgba(74, 194, 107, .14);
  --warn: #e3a008; --warn-weak: rgba(227, 160, 8, .14);
  --err: #ff6b6b; --err-weak: rgba(255, 107, 107, .15);
  --shadow: 0 8px 24px rgba(0, 0, 0, .45);
  --syn-kw: #c792ea; --syn-str: #8bd49c; --syn-num: #f2a65e; --syn-id: #7cb7ff; --syn-fn: #e6c07b; --syn-com: #7d8896;
`

export const STYLES = `
:root {
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Hiragino Sans", "Yu Gothic UI", "Apple SD Gothic Neo", sans-serif;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  --radius: 8px; --radius-sm: 6px;
  --bg: #f5f7fa; --surface: #ffffff; --surface-2: #f1f4f8; --surface-3: #e6ebf1;
  --border: #e2e7ee; --border-strong: #cdd5df;
  --text: #121821; --text-2: #4a5666; --text-3: #6e7a8a;
  --accent: #1f6feb; --accent-weak: #e7f0ff; --accent-text: #ffffff;
  --ok: #1a7f37; --ok-weak: #e6f5ea;
  --warn: #9a6700; --warn-weak: #fff4d6;
  --err: #cf222e; --err-weak: #ffebe9;
  --shadow: 0 8px 24px rgba(20, 30, 50, .14);
  --syn-kw: #8250df; --syn-str: #0a7a3d; --syn-num: #b35900; --syn-id: #0550ae; --syn-fn: #8a5a00; --syn-com: #6e7a8a;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${DARK} color-scheme: dark; } }
:root[data-theme="dark"] { ${DARK} color-scheme: dark; }

*, *::before, *::after { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; background: var(--bg); color: var(--text); font: 13px/1.5 var(--font); -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; overflow: hidden; }
[hidden] { display: none !important; }
button, input, select { font: inherit; color: inherit; }
button { appearance: none; background: none; border: 0; padding: 0; cursor: pointer; }
svg { width: 16px; height: 16px; flex: none; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
:focus { outline: none; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; border-radius: 4px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
* { scrollbar-width: thin; scrollbar-color: var(--border-strong) transparent; }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 8px; border: 2px solid transparent; background-clip: content-box; }
::-webkit-scrollbar-track { background: transparent; }

/* ── Shell ─────────────────────────────────────────────────────────── */
.app { display: flex; flex-direction: column; height: 100%; }
.topbar { display: flex; align-items: center; gap: 12px; height: 52px; padding: 0 16px; background: var(--surface); border-bottom: 1px solid var(--border); flex: none; }
.brand { display: flex; align-items: center; gap: 10px; font-weight: 650; font-size: 14px; letter-spacing: -.01em; white-space: nowrap; }
.brand-mark { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; background: linear-gradient(135deg, #1f6feb, #7a5af8); color: #fff; }
.brand-mark svg { width: 16px; height: 16px; stroke: #fff; }
.live { display: inline-flex; align-items: center; gap: 6px; padding: 2px 9px 2px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 600; color: var(--text-2); background: var(--surface-2); border: 1px solid var(--border); white-space: nowrap; }
.live i { width: 7px; height: 7px; border-radius: 50%; background: var(--err); }
.live.on i { background: var(--ok); box-shadow: 0 0 0 3px var(--ok-weak); }
.spacer { flex: 1; }
.field { position: relative; display: flex; align-items: center; }
.field > svg { position: absolute; left: 10px; color: var(--text-3); pointer-events: none; }
.input { height: 32px; width: 260px; padding: 0 34px 0 32px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--text); transition: border-color .15s, background .15s, box-shadow .15s; }
.input::placeholder { color: var(--text-3); }
.input:hover { border-color: var(--border-strong); }
.input:focus { border-color: var(--accent); background: var(--surface); box-shadow: 0 0 0 3px var(--accent-weak); outline: none; }
.kbd { font: 600 11px/1 var(--mono); min-width: 18px; padding: 3px 5px; text-align: center; border: 1px solid var(--border-strong); border-bottom-width: 2px; border-radius: 4px; background: var(--surface); color: var(--text-2); }
.field .kbd { position: absolute; right: 8px; }
.btn { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); font-weight: 550; white-space: nowrap; transition: background .15s, border-color .15s; }
.btn:hover { background: var(--surface-2); border-color: var(--border-strong); }
.btn:active { background: var(--surface-3); }
.btn.icon { width: 32px; padding: 0; justify-content: center; }
.btn.ghost { border-color: transparent; background: transparent; }
.btn.ghost:hover { background: var(--surface-2); }
.btn.sm { height: 26px; padding: 0 9px; font-size: 12px; }
.dd { position: relative; display: inline-flex; }
.dd-btn { display: inline-flex; align-items: center; gap: 8px; height: 32px; padding: 0 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); font-weight: 550; white-space: nowrap; transition: background .15s, border-color .15s; }
.dd-btn:hover { background: var(--surface-2); border-color: var(--border-strong); }
.dd-btn[aria-expanded="true"] { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-weak); }
.dd-btn svg { color: var(--text-3); } .dd-btn svg:last-child { width: 12px; height: 12px; }
.dd-menu { position: absolute; z-index: 40; right: 0; top: calc(100% + 6px); min-width: 188px; margin: 0; padding: 4px; list-style: none; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); box-shadow: var(--shadow); }
.dd-item { display: flex; align-items: center; gap: 10px; height: 34px; padding: 0 10px; border-radius: 6px; color: var(--text); cursor: pointer; user-select: none; }
.dd-item:hover, .dd-item:focus-visible { background: var(--surface-2); outline: none; }
.dd-item .check { width: 14px; height: 14px; color: var(--accent); visibility: hidden; }
.dd-item[aria-selected="true"] { font-weight: 650; }
.dd-item[aria-selected="true"] .check { visibility: visible; }
.dd-item .code { margin-left: auto; color: var(--text-3); font: 600 11px var(--mono); text-transform: uppercase; }
.seg { display: inline-flex; padding: 2px; gap: 2px; border-radius: var(--radius-sm); background: var(--surface-2); border: 1px solid var(--border); }
.seg button { height: 26px; padding: 0 10px; border-radius: 4px; color: var(--text-2); font-weight: 550; font-size: 12px; }
.seg button:hover { color: var(--text); }
.seg button { white-space: nowrap; }
.seg.wide { display: flex; } .seg.wide button { flex: 1; }
.pill { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px 0 8px; border: 1px solid var(--border); border-radius: 999px; background: var(--ok-weak); color: var(--ok); font-size: 11.5px; font-weight: 650; white-space: nowrap; }
.pill svg { width: 13px; height: 13px; }
.pill:hover { border-color: var(--border-strong); }
.pill[data-mode="off"] { background: var(--warn-weak); color: var(--warn); }
.pop { position: absolute; z-index: 40; right: 0; top: calc(100% + 6px); width: 340px; max-width: calc(100vw - 24px); max-height: calc(100vh - 80px); overflow: auto; padding: 14px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); box-shadow: var(--shadow); text-align: left; }
.pop-title { margin: 0 0 8px; font-size: 14px; font-weight: 700; }
.pop-sec { padding: 10px 0; border-top: 1px solid var(--border); }
.pop-sec h3 { margin: 0 0 8px; color: var(--text-3); font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: .06em; }
.pop-hint { margin: 8px 0 0; color: var(--text-2); font-size: 12px; line-height: 1.45; } .pop-hint.dim { color: var(--text-3); margin-top: 2px; }
.pop-row { display: grid; gap: 4px; margin-bottom: 8px; color: var(--text-2); font-size: 12px; font-weight: 550; }
.pop-input { height: 30px; padding: 0 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--text); font: 12.5px var(--mono); }
.pop-input::placeholder { color: var(--text-3); }
.pop-input:focus { border-color: var(--accent); background: var(--surface); box-shadow: 0 0 0 3px var(--accent-weak); outline: none; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 2px 0 10px; }
.chip.driver { padding: 2px 8px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface-2); color: var(--text); font: 600 11.5px var(--mono); }
.chip.driver.none { color: var(--warn); border-color: var(--warn); font-family: inherit; }
.checks { margin: 10px 0 0; padding: 0; list-style: none; display: grid; gap: 6px; }
.checks li { display: flex; gap: 8px; align-items: flex-start; color: var(--text-2); font-size: 12px; line-height: 1.4; }
.checks .dot { flex: none; width: 8px; height: 8px; margin-top: 5px; border-radius: 50%; background: var(--ok); }
.checks .warn .dot { background: var(--warn); } .checks .error .dot { background: var(--err); }
.pop-code { display: inline-block; padding: 3px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface-2); font: 12.5px var(--mono); }
.seg button[aria-pressed="true"] { background: var(--surface); color: var(--text); box-shadow: 0 1px 2px rgba(0, 0, 0, .12); }
.switch { display: inline-flex; align-items: center; gap: 8px; color: var(--text-2); font-weight: 550; font-size: 12px; cursor: pointer; }
.switch .track { position: relative; width: 28px; height: 16px; border-radius: 999px; background: var(--border-strong); transition: background .15s; }
.switch .track::after { content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0, 0, 0, .3); transition: transform .15s; }
.switch[aria-checked="true"] .track { background: var(--accent); }
.switch[aria-checked="true"] .track::after { transform: translateX(12px); }

.layout { flex: 1; display: grid; grid-template-columns: minmax(280px, 360px) 1fr; min-height: 0; }
.list { display: flex; flex-direction: column; min-height: 0; background: var(--surface); border-right: 1px solid var(--border); }
.list-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
.list-head h2 { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--text-3); font-weight: 650; }
.count { padding: 0 7px; border-radius: 999px; background: var(--surface-3); color: var(--text-2); font-size: 11px; font-weight: 650; line-height: 18px; }
.list-body { flex: 1; overflow: auto; }
.req { position: relative; display: block; width: 100%; text-align: left; padding: 10px 12px 10px 15px; border-bottom: 1px solid var(--border); }
.req::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: transparent; }
.req.has-warn::before { background: var(--warn); } .req.has-err::before { background: var(--err); }
.req:hover { background: var(--surface-2); }
.req[aria-selected="true"] { background: var(--accent-weak); }
.req-top { display: flex; align-items: center; gap: 8px; min-width: 0; }
.req-url { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--mono); font-size: 12px; }
.req-meta { display: flex; align-items: center; gap: 10px; margin-top: 3px; color: var(--text-3); font-size: 11.5px; }
.req-meta .dot { width: 3px; height: 3px; border-radius: 50%; background: var(--border-strong); }

.method { font: 700 10.5px/1 var(--mono); letter-spacing: .02em; padding: 3px 6px; border-radius: 4px; background: var(--surface-3); color: var(--text-2); }
.method.GET { background: var(--ok-weak); color: var(--ok); } .method.POST { background: var(--accent-weak); color: var(--accent); }
.method.PUT, .method.PATCH { background: var(--warn-weak); color: var(--warn); } .method.DELETE { background: var(--err-weak); color: var(--err); }
.status { font: 650 11.5px/1 var(--mono); color: var(--text-2); }
.status.s2 { color: var(--ok); } .status.s3 { color: var(--accent); } .status.s4 { color: var(--warn); } .status.s5 { color: var(--err); }
.chip { display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 8px; border-radius: 999px; font-size: 11px; font-weight: 650; background: var(--surface-3); color: var(--text-2); white-space: nowrap; }
.chip.ok { background: var(--ok-weak); color: var(--ok); } .chip.warn { background: var(--warn-weak); color: var(--warn); } .chip.err { background: var(--err-weak); color: var(--err); } .chip.accent { background: var(--accent-weak); color: var(--accent); }
.chip svg { width: 12px; height: 12px; }

.detail { overflow: auto; min-width: 0; }
.detail-inner { max-width: 1180px; margin: 0 auto; padding: 20px 24px 40px; }
.detail-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
.detail-head h1 { margin: 0; font: 600 15px/1.4 var(--mono); word-break: break-all; flex: 1; min-width: 200px; }
.back { display: none; }
.split { display: flex; height: 10px; border-radius: 5px; overflow: hidden; background: var(--surface-2, var(--border)); margin: 10px 0 8px; }
.split > i { display: block; height: 100%; min-width: 2px; }
.split .database { background: var(--accent); } .split .cache { background: var(--warn); } .split .http { background: var(--ok); } .split .app { background: var(--text-3, #8b949e); opacity: .55; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 12px; color: var(--text-2); }
.legend b { font-family: var(--mono); font-weight: 650; color: var(--text); }
.legend .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
.legend .dot.database { background: var(--accent); } .legend .dot.cache { background: var(--warn); } .legend .dot.http { background: var(--ok); } .legend .dot.app { background: var(--text-3, #8b949e); opacity: .55; }
.compare-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.compare-select { max-width: 100%; min-width: 0; flex: 1; height: 32px; padding: 0 10px; }
.compare-verdict { margin: 12px 0 6px; font-weight: 650; }
.compare-verdict.slower { color: var(--warn); } .compare-verdict.faster { color: var(--ok); } .compare-verdict.same { color: var(--text-2); }
.compare-table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-top: 4px; }
.compare-table th { text-align: left; font-weight: 500; color: var(--text-2); padding: 4px 0; width: 38%; }
.compare-table td { padding: 5px 6px; border-top: 1px solid var(--border); vertical-align: top; }
.compare-table td.num { text-align: right; font-family: var(--mono); white-space: nowrap; }
.compare-table td.up { color: var(--warn); } .compare-table td.down { color: var(--ok); }
.compare-table td.code { font-family: var(--mono); word-break: break-word; }
.compare-table small { opacity: .8; }
.compare-sub { margin: 14px 0 2px; font-size: 12px; color: var(--text-2); text-transform: uppercase; letter-spacing: .04em; }
.sent-title { margin: 12px 0 4px; font-size: 12px; font-weight: 650; color: var(--text-2); text-transform: uppercase; letter-spacing: .04em; }
.sent { margin-top: 6px; padding-left: 10px; border-left: 2px solid var(--accent); }
.ov-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.ov-table th { text-align: left; font-weight: 600; color: var(--text-2); padding: 8px 12px; border-bottom: 1px solid var(--border); white-space: nowrap; }
.ov-table td { padding: 8px 12px; border-top: 1px solid var(--border); vertical-align: top; }
.ov-table td.num { text-align: right; font-family: var(--mono); white-space: nowrap; }
.ov-table td.code { font-family: var(--mono); word-break: break-word; }
.ov-table tr.clickable { cursor: pointer; } .ov-table tr.clickable:hover { background: var(--accent-weak); }
.ov-issue { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; }
#overview[aria-pressed="true"] { background: var(--accent-weak); color: var(--accent); }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 20px; }
.kpi { padding: 12px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
.kpi-label { color: var(--text-3); font-size: 11.5px; font-weight: 600; }
.kpi-value { margin-top: 2px; font-size: 22px; font-weight: 650; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.kpi-sub { color: var(--text-3); font-size: 11.5px; }
.section { margin-bottom: 22px; }
.section-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.section-head h2 { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--text-3); font-weight: 650; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.insight { display: flex; gap: 10px; width: 100%; text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--border); }
.insight:last-child { border-bottom: 0; }
.insight:hover { background: var(--surface-2); }
.insight .ico { margin-top: 1px; }
.insight.warn .ico { color: var(--warn); } .insight.error .ico { color: var(--err); } .insight.info .ico { color: var(--text-3); }
.insight-title { font-weight: 650; }
.insight-msg { color: var(--text-2); font-size: 12.5px; word-break: break-word; }
.logs { padding: 4px 0; }
.log { display: grid; grid-template-columns: 52px 68px minmax(0, 1fr) auto; gap: 8px; align-items: baseline; padding: 5px 12px; font: 12px var(--mono); border-top: 1px solid var(--border); }
.log:first-child { border-top: 0; }
.log .lvl { color: var(--text-3); text-transform: uppercase; font-size: 10.5px; font-weight: 700; }
.log.warn .lvl { color: var(--warn); } .log.error .lvl { color: var(--err); }
.log .t { color: var(--text-3); } .log .msg { white-space: pre-wrap; word-break: break-word; color: var(--text); }
.insight-hint { margin-top: 6px; padding: 6px 8px; border-radius: 6px; background: var(--surface-2); color: var(--text-2); font-size: 12px; line-height: 1.45; }
.insight-hint strong { color: var(--text); }
.insight-where { margin-top: 3px; color: var(--text-3); font: 12px var(--mono); }
.from { color: var(--text-3); }
.caller { color: var(--accent); font: 12px var(--mono); text-decoration: none; }
a.caller:hover { text-decoration: underline; }
.insight-msg code { font: 12px var(--mono); }
.empty-ok { padding: 14px; color: var(--text-2); display: flex; gap: 8px; align-items: center; }
.empty-ok svg { color: var(--ok); }
.empty { display: grid; place-items: center; align-content: center; gap: 6px; height: 100%; min-height: 240px; padding: 32px; text-align: center; color: var(--text-2); }
.empty svg.big { width: 44px; height: 44px; stroke-width: 1.3; color: var(--text-3); }
.empty h3 { margin: 6px 0 0; font-size: 14px; color: var(--text); }
.empty p { margin: 0; max-width: 340px; color: var(--text-3); }

/* ── Query tree ───────────────────────────────────────────────────── */
.tree-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.axis { display: flex; justify-content: space-between; margin: 0 12px 4px auto; width: var(--wf, 220px); color: var(--text-3); font: 11px var(--mono); }
.tx { margin: 6px 0; border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: var(--radius); background: color-mix(in srgb, var(--accent-weak) 35%, var(--surface)); }
.tx.rolled-back { border-left-color: var(--err); } .tx.committed { border-left-color: var(--ok); } .tx.open { border-left-color: var(--warn); }
.tx > .tx-head { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 10px; text-align: left; font-weight: 650; }
.tx-head .dim { font-weight: 500; }
.tx-children { padding: 0 8px 8px; }
.q { margin: 4px 0; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
.q.hl { box-shadow: 0 0 0 2px var(--accent); border-color: var(--accent); }
.q.err { border-color: var(--err); }
.q-head { display: grid; grid-template-columns: 1fr var(--wf, 220px); align-items: center; gap: 12px; width: 100%; padding: 7px 12px; text-align: left; }
.q-main { min-width: 0; }
.q-line { display: flex; align-items: center; gap: 8px; min-width: 0; }
.chev { transition: transform .15s; color: var(--text-3); }
.q.open .chev, .tx.expanded > .tx-head .chev { transform: rotate(90deg); }
.kind { font: 700 10.5px/1 var(--mono); padding: 3px 6px; border-radius: 4px; background: var(--surface-3); color: var(--text-2); min-width: 54px; text-align: center; }
.kind.select { background: var(--accent-weak); color: var(--accent); } .kind.insert { background: var(--ok-weak); color: var(--ok); }
.kind.update { background: var(--warn-weak); color: var(--warn); } .kind.delete { background: var(--err-weak); color: var(--err); }
.tables { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.dim { color: var(--text-3); }
.num { font: 12px var(--mono); font-variant-numeric: tabular-nums; color: var(--text-2); white-space: nowrap; }
.preview { margin-top: 3px; font: 11.5px/1.4 var(--mono); color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wf { position: relative; height: 8px; border-radius: 4px; background: var(--surface-3); }
.wf i { position: absolute; top: 0; bottom: 0; min-width: 2px; border-radius: 4px; background: var(--accent); }
.wf i.slow { background: var(--warn); } .wf i.err { background: var(--err); }
.q-body { display: none; padding: 10px 12px 12px; border-top: 1px solid var(--border); background: var(--surface-2); border-radius: 0 0 var(--radius) var(--radius); }
.q.open .q-body { display: block; }
.q-tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; color: var(--text-3); font-size: 12px; }
.q-tools .spacer { flex: 1; }
.sql { margin: 0; padding: 12px 14px; max-height: 380px; overflow: auto; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); font: 12px/1.6 var(--mono); white-space: pre-wrap; word-break: break-word; tab-size: 2; }
.sql .kw { color: var(--syn-kw); font-weight: 600; } .sql .str { color: var(--syn-str); } .sql .num { color: var(--syn-num); font: inherit; }
.sql .id { color: var(--syn-id); } .sql .fn { color: var(--syn-fn); } .sql .com { color: var(--syn-com); font-style: italic; }
.params { margin-top: 8px; font: 12px var(--mono); color: var(--text-2); word-break: break-all; }
.error-box { margin-top: 8px; padding: 8px 10px; border-radius: var(--radius-sm); background: var(--err-weak); color: var(--err); font: 12px var(--mono); }

.toast { position: fixed; left: 50%; bottom: 20px; transform: translate(-50%, 12px); padding: 8px 14px; border-radius: 999px; background: var(--text); color: var(--bg); font-weight: 600; font-size: 12.5px; box-shadow: var(--shadow); opacity: 0; pointer-events: none; transition: opacity .18s, transform .18s; }
.toast.show { opacity: 1; transform: translate(-50%, 0); }
.footer { display: flex; align-items: center; gap: 14px; height: 28px; padding: 0 16px; border-top: 1px solid var(--border); background: var(--surface); color: var(--text-3); font-size: 11.5px; flex: none; overflow: hidden; white-space: nowrap; }
.footer span { display: inline-flex; align-items: center; gap: 5px; }

/* Narrow (the docked panel can be ~400px wide): one pane at a time */
.slow .input { width: 104px; padding: 0 30px 0 32px; text-align: right; font: 600 12.5px var(--mono); -moz-appearance: textfield; }
.slow .input::-webkit-inner-spin-button, .slow .input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.slow .input::placeholder { font-weight: 500; }
.slow .unit { position: absolute; right: 9px; color: var(--text-3); font-size: 11px; pointer-events: none; }
.narrow .topbar { gap: 8px; padding: 0 10px; }
.narrow .slow .input { width: 88px; }
.narrow .brand span.name, .narrow .footer, .narrow .live span, .narrow .btn .label { display: none; }
.narrow .input { width: 150px; }
.narrow .layout { display: block; }
.narrow .list, .narrow .detail { height: 100%; border: 0; }
.narrow[data-view="detail"] .list { display: none; } .narrow[data-view="list"] .detail { display: none; }
.narrow .back { display: inline-flex; }
.narrow .detail-inner { padding: 14px 12px 28px; }
.narrow .kpis { grid-template-columns: repeat(2, 1fr); }
.narrow .q-head { grid-template-columns: 1fr; } .narrow .wf, .narrow .axis { display: none; }

@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`
