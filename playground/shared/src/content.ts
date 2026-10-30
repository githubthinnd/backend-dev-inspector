/** What each screen of the Antimatter demo says about itself: one source for the plain-HTML apps and the Nuxt layer. */

export type ViewId = "orders" | "customers" | "reports" | "loyalty"

export interface ViewContent {
  title: string
  subtitle: string
  /** The API call this screen makes. */
  path: string
  /** What the inspector should flag: "ok" | "warn" | "err" | "info" styles the pill. */
  pill: { tone: "ok" | "warn" | "err" | "info", text: string }
  /** "Behind this screen": the three things a visitor needs to understand. */
  explain: { doing: string, server: string, look: string }
}

export const views: Record<ViewId, ViewContent> = {
  orders: {
    title: "Orders",
    subtitle: "The latest orders across all channels.",
    path: "/api/orders",
    pill: { tone: "ok", text: "1 query · no warning" },
    explain: {
      doing: "The page asks for the 10 latest orders. Open an order, add an item, or place a new order from the top bar.",
      server: "One joined SQL statement for the list. “New order” runs a transaction with a savepoint; “Add gift item” runs an insert that the database rejects.",
      look: "A single statement and no warning: what a healthy request looks like. After “New order”, a transaction node that commits. After “Add gift item”, an error insight."
    }
  },
  customers: {
    title: "Customers",
    subtitle: "Who ordered recently, with their details.",
    path: "/api/orders/n-plus-one",
    pill: { tone: "warn", text: "N+1 · one query per customer" },
    explain: {
      doing: "The page lists the customers behind the 10 latest orders, with the amount and status of their order.",
      server: "The server loads the orders, then asks for each order's customer separately: 1 + 10 = 11 statements, one request after another.",
      look: "An N+1 warning on “select … from customers where id = ?”. A join, or one query with IN (…), would need only 2 statements."
    }
  },
  reports: {
    title: "Reports",
    subtitle: "Revenue analysis over the full order history.",
    path: "/api/orders/slow",
    pill: { tone: "err", text: "Slow query · over 100 ms" },
    explain: {
      doing: "Press “Run report”. The page waits while the server aggregates the whole history.",
      server: "One heavy SQL aggregate over 6,000,000 rows, much longer than a normal lookup.",
      look: "A slow-query warning with the duration, and the longest bar in the timeline. Run it twice: each run is its own request."
    }
  },
  loyalty: {
    title: "Loyalty",
    subtitle: "Tiers and points, read from the customer service.",
    path: "/api/orders/external",
    pill: { tone: "info", text: "N+1 over HTTP" },
    explain: {
      doing: "The page shows each member's tier and points, which live in another service, not in the database.",
      server: "One query for the orders, then three outbound HTTP calls to the same endpoint with different customer ids.",
      look: "The calls to the other service sit in the same tree as the SQL, as HTTP entries. Repeated calls to one endpoint are flagged as an N+1, like repeated queries."
    }
  }
}
