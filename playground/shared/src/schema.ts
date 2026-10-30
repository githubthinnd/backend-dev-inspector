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

export interface CustomerSeed {
  name: string
  country: string
}

/** The 25 demo customers; the fake customer service answers with the same names. */
export const CUSTOMERS: CustomerSeed[] = [
  { name: "Aiko Tanaka", country: "JP" }, { name: "Minh Anh Nguyen", country: "VN" }, { name: "Liam Carter", country: "US" },
  { name: "Sofia Rossi", country: "IT" }, { name: "Hiroshi Sato", country: "JP" }, { name: "Linh Tran", country: "VN" },
  { name: "Emma Dubois", country: "FR" }, { name: "Noah Müller", country: "DE" }, { name: "Yuki Nakamura", country: "JP" },
  { name: "Olivia Brown", country: "US" }, { name: "Kenji Watanabe", country: "JP" }, { name: "Thu Hà Pham", country: "VN" },
  { name: "Lucas Martin", country: "FR" }, { name: "Mia Schneider", country: "DE" }, { name: "Daniel Kim", country: "US" },
  { name: "Chloé Bernard", country: "FR" }, { name: "Anh Tuan Le", country: "VN" }, { name: "Grace Miller", country: "US" },
  { name: "Takumi Ito", country: "JP" }, { name: "Isabella Conti", country: "IT" }, { name: "Ethan Walker", country: "US" },
  { name: "Hana Suzuki", country: "JP" }, { name: "Quang Huy Vo", country: "VN" }, { name: "Amélie Laurent", country: "FR" },
  { name: "Oliver Hoffmann", country: "DE" }
]

const PRODUCTS = [
  "Mechanical Keyboard", "Wireless Mouse", "USB-C Dock", "27-inch Monitor",
  "Noise-cancelling Headphones", "4K Webcam", "Laptop Stand", "Desk Lamp"
]
const STATUSES = ["paid", "shipped", "pending"]

const emailOf = (name: string) => `${name.normalize("NFD").replace(/[\u0300-\u036F]/g, "").toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`

/** Deterministic demo data: 25 customers, 8 products, 40 orders with 1 to 3 items each. */
export function seed(db: Database.Database): void {
  const customer = db.prepare("insert into customers (id, name, email, country) values (?, ?, ?, ?)")
  const product = db.prepare("insert into products (id, sku, name, price_cents) values (?, ?, ?, ?)")
  const order = db.prepare("insert into orders (id, customer_id, status, total_cents, created_at) values (?, ?, ?, ?, ?)")
  const item = db.prepare("insert into order_items (order_id, product_id, quantity, unit_price_cents) values (?, ?, ?, ?)")
  db.transaction(() => {
    CUSTOMERS.forEach(({ name, country }, index) => customer.run(index + 1, name, emailOf(name), country))
    PRODUCTS.forEach((name, index) => product.run(index + 1, `SKU-${String(index + 1).padStart(3, "0")}`, name, 1900 * (index + 1) + 900))
    for (let id = 1; id <= 40; id++) {
      const lines = Array.from({ length: 1 + (id % 3) }, (_unused, line) => {
        const productId = 1 + ((id + line) % PRODUCTS.length)
        return { productId, quantity: 1 + (line % 2), unitPrice: 1900 * productId + 900 }
      })
      const total = lines.reduce((sum, { quantity, unitPrice }) => sum + quantity * unitPrice, 0)
      order.run(id, 1 + (id % CUSTOMERS.length), STATUSES[id % STATUSES.length], total, `2026-01-${String(1 + (id % 28)).padStart(2, "0")}T10:00:00Z`)
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
