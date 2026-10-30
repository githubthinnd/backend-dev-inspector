---
name: dev-inspector
description: Find and fix slow or wasteful backend requests (N+1 queries, repeated calls, slow SQL, failing calls) by reading what the running app actually did, through the dev-inspector MCP server. Use when asked why an endpoint is slow, how many queries a request makes, where an N+1 comes from, or after changing data-access code.
---

# dev-inspector

`backend-dev-inspector` (or `sql-dev-inspector`) records, in development only, every SQL query, MongoDB command, Redis call and outgoing HTTP request that each request of the running application makes. This skill uses what it recorded instead of guessing from the code.

## Connect

The inspector serves a read-only MCP endpoint next to its page. With the app running in development (`NODE_ENV=development`):

```bash
claude mcp add --transport http dev-inspector http://localhost:3000/__sql-inspector/mcp
```

For Cursor or another client that reads `mcp.json`:

```json
{ "mcpServers": { "dev-inspector": { "url": "http://localhost:3000/__sql-inspector/mcp" } } }
```

Use the app's own port and base path. If the page was moved with `SQL_INSPECTOR_PATH`, use that path instead of `__sql-inspector`. If the inspector runs with `SQL_INSPECTOR_TOKEN`, send it as a header: `claude mcp add --transport http dev-inspector <url> --header "Authorization: Bearer <token>"`. Nothing is recorded in production, so there is nothing to connect to there.

## Tools

| Tool | Use it to |
|---|---|
| `find_problems` | Start here: every warning and error across recent requests, grouped by route, worst first |
| `get_overview` | See what to optimise first: the routes that cost the most in all, the calls that cost the most across routes, the findings that keep coming back |
| `list_requests` | See recent requests with their call counts and timings (`onlyIssues` narrows it) |
| `get_request` | Read one request: its calls in order, with timing, rows, errors, the line of code that made each (`calledFrom`), the SQL an ORM sent for a call (`sentToDatabase`), where the time went (`totals.breakdown`), and insights with advice (`hint`) |
| `compare_requests` | See what changed between two requests (before and after a fix): calls that are new, gone, repeated more or fewer times or slower, the time split, and the warnings that went away |
| `get_settings` | Learn how the inspector is set up (threshold, whether values are hidden, followed routes) |
| `diagnose` | Check the inspector itself when the other tools return nothing |

## Workflow

1. If the user names an endpoint, make sure it has been called (ask them to, or call it yourself in development), then `list_requests` to find its id. Otherwise run `find_problems`.
2. `get_request` for the worst one. Read the `insights` first: each has a `type` (`n-plus-one`, `duplicate`, `slow`, `error`, `many-queries`, or a `budget-*` type when the route has a budget that was passed), a `hint`, and `calledFrom` (`file:line`).
3. Open `calledFrom` in the repository and change the code the way the hint says (a join, an `IN` list, an eager-loading option, `MGET`, a batch endpoint, a cache for the request).
4. Ask for the endpoint to be called again, then `compare_requests` with the old and the new request id (or `get_request` on the new one) and report the change in calls and timing. State the numbers.

## Rules

- **Report what the inspector shows, with its numbers**, not what the code suggests it should do. A request that looks fine in the code can still make 40 calls.
- Bind parameters are hidden by default (`<number>`, `<string:12>`). Do not ask the user to switch that off just to debug; the shape of the statement is enough.
- It is read-only: you cannot change settings or clear history through MCP, and should not suggest running SQL against the user's database.
- A request with no `calledFrom` was made inside a library; look at the nearest caller in the code instead.
- If `find_problems` is empty, say that the recorded requests are clean, and name how many requests it looked at.
