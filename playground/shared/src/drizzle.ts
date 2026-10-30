import type Database from "better-sqlite3"
import { desc, eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { Repository } from "./scenarios.ts"

export const customers = sqliteTable("customers", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  country: text("country").notNull()
})

export const orders = sqliteTable("orders", {
  id: integer("id").primaryKey(),
  customerId: integer("customer_id").notNull(),
  status: text("status").notNull(),
  totalCents: integer("total_cents").notNull(),
  createdAt: text("created_at").notNull()
})

export const orderItems = sqliteTable("order_items", {
  id: integer("id").primaryKey(),
  orderId: integer("order_id").notNull(),
  productId: integer("product_id").notNull(),
  quantity: integer("quantity").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull()
})

const headerColumns = { id: orders.id, customerId: orders.customerId, status: orders.status, totalCents: orders.totalCents }

/** Drizzle ORM on better-sqlite3. */
export function createDrizzleRepository(client: Database.Database): Repository {
  const db = drizzle(client)
  return {
    latestOrders: async limit => db.select({ ...headerColumns, customerName: customers.name })
      .from(orders).innerJoin(customers, eq(customers.id, orders.customerId)).orderBy(desc(orders.id)).limit(limit).all(),
    orderHeaders: async limit => db.select(headerColumns).from(orders).orderBy(desc(orders.id)).limit(limit).all(),
    customerById: async id => db.select({ id: customers.id, name: customers.name, country: customers.country })
      .from(customers).where(eq(customers.id, id)).get(),
    heavyReport: async () => {
      const row = db.get<{ rows: number }>(
        sql`with recursive n(x) as (select 1 union all select x + 1 from n where x < 6000000) select count(*) as rows from n`
      )
      return row.rows
    },
    failingQuery: async () => db.insert(orderItems).values({ orderId: 999_999, productId: 1, quantity: 1, unitPriceCents: 500 }).run(),
    placeOrder: async () => {
      const orderId = db.transaction((tx) => {
        const created = tx.insert(orders)
          .values({ customerId: 1, status: "pending", totalCents: 5600, createdAt: new Date().toISOString() }).returning({ id: orders.id }).get()
        tx.insert(orderItems).values({ orderId: created.id, productId: 1, quantity: 2, unitPriceCents: 2800 }).run()
        try {
          // A nested transaction is a savepoint in Drizzle; the error rolls only that part back.
          tx.transaction((gift) => {
            gift.insert(orderItems).values({ orderId: created.id, productId: 2, quantity: 1, unitPriceCents: 0 }).run()
            throw new Error("gift is out of stock")
          })
        } catch {
          // the gift is dropped, the order stays
        }
        return created.id
      })
      return { orderId }
    }
  }
}
