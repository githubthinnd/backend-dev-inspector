import "@playground/shared/dev-env"
// Calls to the other service carry a traceparent, so both inspectors can follow one operation.
process.env.SQL_INSPECTOR_PROPAGATE ??= "1"
const { createApp } = await import("./app.ts")

const port = Number(process.env.PORT ?? 3020)
const ordersUrl = process.env.ORDERS_URL ?? "http://localhost:3000"
createApp({ ordersUrl }).listen(port, () => {
  console.log(`express-gateway: http://localhost:${port}  inspector: http://localhost:${port}/__sql-inspector/`)
  console.log(`  calls ${ordersUrl}: start it with  npm run dev:express-sqlite  (its inspector: ${ordersUrl}/__sql-inspector/)`)
})
