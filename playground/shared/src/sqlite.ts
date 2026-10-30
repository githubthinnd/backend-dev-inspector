import type Database from "better-sqlite3"
import type { CustomerRow, OrderRow, Repository } from "./scenarios.ts"

/** Plain better-sqlite3: the SQL is written by hand. */
export function createSqliteRepository(db: Database.Database): Repository {
  return {
    latestOrders: async limit => (db.prepare(
      `select o.id, o.customer_id as customerId, o.status, o.total_cents as totalCents, c.name as customerName
       from orders o join customers c on c.id = o.customer_id
       order by o.id desc limit ?`
    ).all(limit) as Array<OrderRow & { customerName: string }>),
    orderHeaders: async limit => db.prepare(
      "select id, customer_id as customerId, status, total_cents as totalCents from orders order by id desc limit ?"
    ).all(limit) as OrderRow[],
    customerById: async id => db.prepare("select id, name, country from customers where id = ?").get(id) as CustomerRow | undefined,
    heavyReport: async () => {
      const row = db.prepare(
        "with recursive n(x) as (select 1 union all select x + 1 from n where x < 6000000) select count(*) as rows from n"
      ).get() as { rows: number }
      return row.rows
    },
    failingQuery: async () => db.prepare(
      "insert into order_items (order_id, product_id, quantity, unit_price_cents) values (?, ?, ?, ?)"
    ).run(999_999, 1, 1, 500),
    placeOrder: async () => {
      const place = db.transaction(() => {
        const order = db.prepare("insert into orders (customer_id, status, total_cents, created_at) values (?, ?, ?, ?)")
          .run(1, "pending", 5600, new Date().toISOString())
        const orderId = Number(order.lastInsertRowid)
        db.prepare("insert into order_items (order_id, product_id, quantity, unit_price_cents) values (?, ?, ?, ?)").run(orderId, 1, 2, 2800)
        // A nested transaction is a savepoint in better-sqlite3; the error rolls only that part back.
        const optionalGift = db.transaction(() => {
          db.prepare("insert into order_items (order_id, product_id, quantity, unit_price_cents) values (?, ?, ?, ?)").run(orderId, 2, 1, 0)
          throw new Error("gift is out of stock")
        })
        try {
          optionalGift()
        } catch {
          // the gift is dropped, the order stays
        }
        return orderId
      })
      return { orderId: place() }
    }
  }
}
