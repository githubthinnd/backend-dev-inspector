const test = require("node:test")
const assert = require("node:assert")
const Module = require("node:module")

// A stand-in for the `vscode` module that records what the extension does.
const calls = { commands: new Map(), executed: [], external: [], warnings: [], secrets: new Map() }
const fake = {
  StatusBarAlignment: { Left: 1 },
  window: {
    createStatusBarItem: () => ({ show() {}, dispose() {} }),
    showWarningMessage: (message) => calls.warnings.push(message),
    showInputBox: async () => "tok-12345678"
  },
  workspace: { getConfiguration: () => ({ get: () => calls.setting }) },
  commands: { registerCommand: (name, fn) => (calls.commands.set(name, fn), { dispose() {} }), executeCommand: async (...args) => calls.executed.push(args) },
  env: { openExternal: async (uri) => calls.external.push(String(uri)) },
  Uri: { parse: (value) => value }
}
const load = Module._load
Module._load = (request, ...rest) => request === "vscode" ? fake : load(request, ...rest)
const { activate, addressFor } = require("../extension.js")
Module._load = load

const context = () => ({ subscriptions: [], secrets: { get: async (k) => calls.secrets.get(k), store: async (k, v) => calls.secrets.set(k, v), delete: async (k) => calls.secrets.delete(k) } })

test("opens a local address as it is, and a remote one only with a token", () => {
  assert.equal(addressFor("http://localhost:3000/__sql-inspector/", undefined), "http://localhost:3000/__sql-inspector/")
  assert.equal(addressFor("http://app.test.localhost:3000/x/", undefined), "http://app.test.localhost:3000/x/")
  assert.equal(addressFor("https://dev.example.com/__sql-inspector/", undefined), null)
  assert.equal(addressFor("https://dev.example.com/__sql-inspector/", "tok-12345678"), "https://dev.example.com/__sql-inspector/?token=tok-12345678")
  assert.equal(addressFor("javascript:alert(1)", "tok"), null)
  assert.equal(addressFor("not a url", undefined), null)
})

test("the commands open Simple Browser or the system browser, and warn about an unusable address", async () => {
  const ctx = context()
  calls.setting = "http://localhost:3000/__sql-inspector/"
  activate(ctx)
  assert.deepEqual([...calls.commands.keys()].sort(), ["devInspector.open", "devInspector.openInBrowser", "devInspector.setToken"])
  await calls.commands.get("devInspector.open")()
  assert.deepEqual(calls.executed.at(-1), ["simpleBrowser.show", "http://localhost:3000/__sql-inspector/"])
  await calls.commands.get("devInspector.openInBrowser")()
  assert.equal(calls.external.at(-1), "http://localhost:3000/__sql-inspector/")
  calls.setting = "ftp://x"
  await calls.commands.get("devInspector.open")()
  assert.equal(calls.warnings.length, 1)
})

test("a token is kept in secret storage and sent as ?token=", async () => {
  const ctx = context()
  calls.setting = "http://localhost:3000/__sql-inspector/"
  calls.commands.clear()
  activate(ctx)
  await calls.commands.get("devInspector.setToken")()
  assert.equal(calls.secrets.get("devInspector.token"), "tok-12345678")
  await calls.commands.get("devInspector.open")()
  assert.equal(calls.executed.at(-1)[1], "http://localhost:3000/__sql-inspector/?token=tok-12345678")
})
