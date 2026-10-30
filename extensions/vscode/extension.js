// Dev Inspector for VS Code: opens the request inspector of the running dev server next to your code.
// No dependencies, and no network calls of its own: it hands an address to VS Code's Simple Browser (or the system browser).
const vscode = require("vscode")

const SECRET = "devInspector.token"
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|[^/]*\.localhost)$/

/** The address to open: the setting, with the token (kept in VS Code's secret storage) as `?token=` when there is one. Null when it is not usable. */
function addressFor(setting, token) {
  let url
  try {
    url = new URL(setting)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null
  }
  // The inspector refuses non-local hosts unless a token is set; do not open a remote address without one.
  if (!LOCAL.test(url.hostname) && !token) {
    return null
  }
  if (token) {
    url.searchParams.set("token", token)
  }
  return url.toString()
}

async function open(context, external) {
  const setting = vscode.workspace.getConfiguration("devInspector").get("url")
  const address = addressFor(setting, await context.secrets.get(SECRET))
  if (!address) {
    vscode.window.showWarningMessage("Dev Inspector: set devInspector.url to the address of the inspector page (a local address, or any address with a token set).")
    return
  }
  if (external) {
    await vscode.env.openExternal(vscode.Uri.parse(address))
  } else {
    await vscode.commands.executeCommand("simpleBrowser.show", address)
  }
}

function activate(context) {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0)
  item.text = "$(pulse) Inspector"
  item.tooltip = "Open the request inspector of the running dev server"
  item.command = "devInspector.open"
  item.show()
  context.subscriptions.push(
    item,
    vscode.commands.registerCommand("devInspector.open", () => open(context, false)),
    vscode.commands.registerCommand("devInspector.openInBrowser", () => open(context, true)),
    vscode.commands.registerCommand("devInspector.setToken", async () => {
      const value = await vscode.window.showInputBox({ prompt: "Token of the inspector (SQL_INSPECTOR_TOKEN). Leave empty to forget it.", password: true })
      if (value === undefined) {
        return
      }
      if (value) {
        await context.secrets.store(SECRET, value)
      } else {
        await context.secrets.delete(SECRET)
      }
    })
  )
}

function deactivate() {}

module.exports = { activate, deactivate, addressFor }
