# Dev Inspector for VS Code

Opens the request inspector of your running dev server (`sql-dev-inspector`, `backend-dev-inspector`) inside VS Code, next to your code. The inspector's own links (`vscode://file/…`) already jump from a call to its line without this extension; this adds a button and a command to open the page itself.

- **Dev Inspector: Open** (also the status bar item `Inspector`): opens the page in VS Code's Simple Browser.
- **Dev Inspector: Open in Browser**: the same address in your browser.
- **Dev Inspector: Set Token**: if you run the inspector with `SQL_INSPECTOR_TOKEN`, keep the token in VS Code's secret storage; it is sent once as `?token=`.
- Setting `devInspector.url` (default `http://localhost:3000/__sql-inspector/`): where the page is. A remote address is opened only when a token is set.

No dependencies and no network calls of its own. **Status: not published and not run inside VS Code**: its logic is tested against a stand-in `vscode` module (`npm test`). To try it: open this folder in VS Code and press F5.
