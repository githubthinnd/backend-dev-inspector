import { PrismaLibSql } from "@prisma/adapter-libsql"
import { prismaExtension } from "backend-dev-inspector/prisma"
import { openDatabase, type Repository } from "@playground/shared"
import { PrismaClient } from "../generated/prisma/client.ts"

/** Prisma on SQLite. The extension is what shows Prisma's calls in the inspector. */
export function createPrismaRepository(file = process.env.PLAYGROUND_DB ?? "playground.sqlite"): Repository {
  openDatabase(file).close() // creates and seeds the file; Prisma opens its own connection
  const prisma = new PrismaClient({ adapter: new PrismaLibSql({ url: `file:${file}` }) }).$extends(prismaExtension())
  const headers = { id: true, customerId: true, status: true, totalCents: true } as const

  return {
    latestOrders: async limit => (await prisma.order.findMany({
      take: limit, orderBy: { id: "desc" }, select: { ...headers, customer: { select: { name: true } } }
    })).map(({ customer, ...order }) => ({ ...order, customerName: customer.name })),
    orderHeaders: limit => prisma.order.findMany({ take: limit, orderBy: { id: "desc" }, select: headers }),
    customerById: async id => (await prisma.customer.findUnique({ where: { id }, select: { id: true, name: true, country: true } })) ?? undefined,
    heavyReport: async () => {
      const rows = await prisma.$queryRawUnsafe<Array<{ rows: bigint | number }>>(
        "with recursive n(x) as (select 1 union all select x + 1 from n where x < 6000000) select count(*) as rows from n"
      )
      return Number(rows[0]?.rows ?? 0)
    },
    failingQuery: () => prisma.orderItem.create({ data: { orderId: 999_999, productId: 1, quantity: 1, unitPriceCents: 500 } }),
    placeOrder: () => prisma.$transaction(async (tx) => {
      const order = await tx.order.create({ data: { customerId: 1, status: "pending", totalCents: 5600, createdAt: new Date().toISOString() } })
      await tx.orderItem.create({ data: { orderId: order.id, productId: 1, quantity: 2, unitPriceCents: 2800 } })
      try {
        // Prisma has no savepoints: a failing statement inside the transaction is caught and the order stays.
        await tx.orderItem.create({ data: { orderId: order.id, productId: 999, quantity: 1, unitPriceCents: 0 } })
      } catch {
        // the gift is dropped, the order stays
      }
      return { orderId: order.id }
    })
  }
}
