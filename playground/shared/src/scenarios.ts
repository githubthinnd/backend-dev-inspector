/** What every playground app can do, whatever its framework or data layer. */

export interface OrderRow {
  id: number
  customerId: number
  status: string
  totalCents: number
}

export interface CustomerRow {
  id: number
  name: string
  country: string
}

/** The few queries the scenarios need. Each data layer (raw SQL, Drizzle, Prisma) implements them its own way. */
export interface Repository {
  /** One query: the latest orders with their customer. */
  latestOrders: (limit: number) => Promise<Array<OrderRow & { customerName: string }>>
  /** Plain read of the latest orders, without their customers. */
  orderHeaders: (limit: number) => Promise<OrderRow[]>
  customerById: (id: number) => Promise<CustomerRow | undefined>
  /** A statement that takes well over the slow-query thresholds the inspector offers (100 and 200 ms). */
  heavyReport: () => Promise<number>
  /** A statement that fails when it runs: it adds an item to an order that does not exist (a foreign key violation). */
  failingQuery: () => Promise<unknown>
  /** An order and its items in a transaction, with a savepoint that is rolled back. */
  placeOrder: () => Promise<{ orderId: number }>
}

export interface ScenarioContext {
  /** Base URL of the fake service the "external" scenario calls. */
  mockApiUrl: string
}

export interface Scenario {
  id: "orders" | "n-plus-one" | "slow" | "error" | "transaction" | "external"
  path: string
  title: string
  /** What the inspector should show for this request. */
  expect: string
  /** HTTP status the scenario answers with. */
  status: number
  run: (repo: Repository, context: ScenarioContext) => Promise<unknown>
}

export const DEFAULT_MOCK_API_URL = "http://127.0.0.1:4010"

export const scenarios: Scenario[] = [
  {
    id: "orders",
    path: "/api/orders",
    title: "Healthy request",
    expect: "One query, no warning.",
    status: 200,
    run: repo => repo.latestOrders(10)
  },
  {
    id: "n-plus-one",
    path: "/api/orders/n-plus-one",
    title: "N+1 queries",
    expect: "N+1 warning: one query for the orders, then one per order for its customer.",
    status: 200,
    run: async (repo) => {
      const orders = await repo.orderHeaders(10)
      const result = []
      for (const order of orders) {
        result.push({ ...order, customer: await repo.customerById(order.customerId) })
      }
      return result
    }
  },
  {
    id: "slow",
    path: "/api/orders/slow",
    title: "Slow query",
    expect: "Slow-query warning: a statement that takes more than 100 ms.",
    status: 200,
    run: async repo => ({ rows: await repo.heavyReport() })
  },
  {
    id: "error",
    path: "/api/orders/error",
    title: "SQL error",
    expect: "Error insight: an item is added to an order that does not exist (foreign key violation).",
    status: 500,
    run: async (repo) => {
      try {
        return await repo.failingQuery()
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    }
  },
  {
    id: "transaction",
    path: "/api/orders/transaction",
    title: "Transaction with a savepoint",
    expect: "A transaction node that commits, containing a savepoint that rolls back.",
    status: 200,
    run: repo => repo.placeOrder()
  },
  {
    id: "external",
    path: "/api/orders/external",
    title: "Outbound HTTP",
    expect: "Three calls to the same endpoint with different ids: an N+1 over HTTP.",
    status: 200,
    run: async (repo, context) => {
      const orders = await repo.orderHeaders(3)
      const result = []
      for (const order of orders) {
        const response = await fetch(`${context.mockApiUrl}/customers/${order.customerId}`)
        result.push({ orderId: order.id, customer: await response.json() })
      }
      return result
    }
  }
]

export function findScenario(path: string): Scenario | undefined {
  return scenarios.find(scenario => scenario.path === path)
}

/** What a scenario answers: the status and the JSON body. */
export async function runScenario(scenario: Scenario, repo: Repository, context: ScenarioContext): Promise<{ status: number, body: unknown }> {
  try {
    const body = await scenario.run(repo, context)
    return { status: scenario.status === 500 ? 500 : 200, body }
  } catch (error) {
    return { status: 500, body: { error: error instanceof Error ? error.message : String(error) } }
  }
}
