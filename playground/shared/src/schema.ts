import Database from "better-sqlite3"

export const DDL = `
  create table if not exists customers (
    id integer primary key,
    name text not null,
    email text not null,
    country text not null
  );
  create table if not exists products (
    id integer primary key,
    sku text not null,
    name text not null,
    price_cents integer not null
  );
  create table if not exists orders (
    id integer primary key,
    customer_id integer not null references customers(id),
    status text not null,
    total_cents integer not null,
    created_at text not null
  );
  create table if not exists order_items (
    id integer primary key,
    order_id integer not null references orders(id),
    product_id integer not null references products(id),
    quantity integer not null,
    unit_price_cents integer not null
  );
`

const COUNTRIES = ["VN", "JP", "US", "DE", "FR"]
const STATUSES = ["paid", "shipped", "pending"]

/** Deterministic demo data: 25 customers, 8 products, 40 orders with 1 to 3 items each. */
export function seed(db: Database.Database): void {
  const customer = db.prepare("insert into customers (id, name, email, country) values (?, ?, ?, ?)")
  const product = db.prepare("insert into products (id, sku, name, price_cents) values (?, ?, ?, ?)")
  const order = db.prepare("insert into orders (id, customer_id, status, total_cents, created_at) values (?, ?, ?, ?, ?)")
  const item = db.prepare("insert into order_items (order_id, product_id, quantity, unit_price_cents) values (?, ?, ?, ?)")
  db.transaction(() => {
    for (let id = 1; id <= 25; id++) {
      customer.run(id, `Customer ${id}`, `customer${id}@example.com`, COUNTRIES[id % COUNTRIES.length])
    }
    for (let id = 1; id <= 8; id++) {
      product.run(id, `SKU-${String(id).padStart(3, "0")}`, `Product ${id}`, 500 * id)
    }
    for (let id = 1; id <= 40; id++) {
      const lines = Array.from({ length: 1 + (id % 3) }, (_unused, line) => {
        const productId = 1 + ((id + line) % 8)
        return { productId, quantity: 1 + (line % 2), unitPrice: 500 * productId }
      })
      const total = lines.reduce((sum, { quantity, unitPrice }) => sum + quantity * unitPrice, 0)
      order.run(id, 1 + (id % 25), STATUSES[id % STATUSES.length], total, `2026-01-${String(1 + (id % 28)).padStart(2, "0")}T10:00:00Z`)
      for (const { productId, quantity, unitPrice } of lines) {
        item.run(id, productId, quantity, unitPrice)
      }
    }
  })()
}

/** A seeded SQLite database: in memory by default, or the file named by `PLAYGROUND_DB`. */
export function openDatabase(file: string = process.env.PLAYGROUND_DB ?? ":memory:"): Database.Database {
  const db = new Database(file)
  db.exec(DDL)
  const { count } = db.prepare("select count(*) as count from customers").get() as { count: number }
  if (count === 0) {
    seed(db)
  }
  return db
}
