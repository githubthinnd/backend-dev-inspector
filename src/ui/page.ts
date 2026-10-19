import { type Locale, LOCALES, MESSAGES } from "../i18n/index.js"
import { CLIENT_SCRIPT } from "./client.js"
import { STYLES } from "./styles.js"

/** Keeps a JSON blob inert inside an inline <script>: no `</script>`, no `<!--`. */
// Built from a string: a literal U+2028 / U+2029 inside a regex literal is itself a line terminator in older engines.
// eslint-disable-next-line prefer-regex-literals
const LINE_SEPARATORS = new RegExp("[\\u2028\\u2029]", "g")
const LESS_THAN = /</g
const toInlineJson = (value: unknown) => JSON.stringify(value).replace(LESS_THAN, "\\u003c").replace(LINE_SEPARATORS, " ")

/**
 * The whole inspector page as one document: no build step, no external requests (no CDN, no web
 * fonts). `localeHint` is the language the server was explicitly configured with, if any.
 */
export function renderPage(localeHint: Locale | null = null): string {
  const config = toInlineJson({ messages: MESSAGES, locales: LOCALES, hint: localeHint })
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="referrer" content="no-referrer">
<title>SQL Inspector</title>
<style>${STYLES}</style>
</head>
<body>
<div class="app" id="app" data-view="list">
  <header class="topbar">
    <div class="brand"><span class="brand-mark"><span data-icon="db"></span></span><span class="name" data-i18n="app.title"></span></div>
    <span class="live" id="live"><i></i><span id="live-text"></span></span>
    <span class="spacer"></span>
    <label class="field">
      <span data-icon="search"></span>
      <input id="search" class="input" type="text" autocomplete="off" spellcheck="false" data-i18n-placeholder="search.placeholder" data-i18n-aria="search.aria">
      <span class="kbd" aria-hidden="true">/</span>
    </label>
    <span class="seg" role="group">
      <button type="button" data-mode="all" aria-pressed="true" data-i18n="filter.all"></button>
      <button type="button" data-mode="issues" aria-pressed="false" data-i18n="filter.issues"></button>
      <button type="button" data-mode="errors" aria-pressed="false" data-i18n="filter.errors"></button>
    </span>
    <span class="dd" id="lang-dd">
      <button type="button" class="dd-btn" id="lang" aria-haspopup="listbox" aria-expanded="false" data-i18n-aria="lang.label" data-i18n-title="lang.label"><span data-icon="globe"></span><span id="lang-label"></span><span data-icon="down"></span></button>
      <ul class="dd-menu" id="lang-menu" role="listbox" tabindex="-1" hidden></ul>
    </span>
    <button type="button" class="btn icon ghost" id="theme"></button>
    <button type="button" class="btn" id="clear" data-i18n-title="action.clear.title"><span data-icon="trash"></span><span class="label" data-i18n="action.clear"></span></button>
  </header>
  <div class="layout">
    <aside class="list">
      <div class="list-head">
        <h2 data-i18n="requests.title"></h2><span class="count" id="count">0</span><span class="spacer"></span>
        <button type="button" class="switch" id="follow" role="switch" aria-checked="false"><span class="track"></span><span data-i18n="follow.label"></span></button>
      </div>
      <div class="list-body" id="list-body" role="listbox"></div>
    </aside>
    <main class="detail" id="detail"></main>
  </div>
  <footer class="footer">
    <span class="kbd">/</span><span data-i18n="shortcuts.search"></span>
    <span class="kbd">↑</span><span class="kbd">↓</span><span data-i18n="shortcuts.navigate"></span>
    <span class="kbd">e</span><span data-i18n="shortcuts.expand"></span>
  </footer>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
</div>
<script>
var __SQLI__ = ${config};
${CLIENT_SCRIPT}
</script>
</body>
</html>
`
}
