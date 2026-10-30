<script setup lang="ts">
const { data, search, drawer, load } = useAntimatter()

const entry = computed(() => data.value.orders)
const orders = computed(() => (entry.value?.payload as Order[] | undefined) ?? [])
const shown = computed(() => orders.value.filter(order => !search.value || `${order.customerName} ${order.id}`.toLowerCase().includes(search.value.toLowerCase())))
const kpis = computed(() => {
  const total = orders.value.reduce((sum, order) => sum + order.totalCents, 0)
  return [
    { label: "Orders", value: String(orders.value.length), sub: "latest in the shop", icon: "orders" },
    { label: "Revenue", value: money(total), sub: "across these orders", icon: "wallet" },
    { label: "Average order", value: money(orders.value.length ? total / orders.value.length : 0), sub: "per order", icon: "trend" },
    { label: "Pending", value: String(orders.value.filter(order => order.status === "pending").length), sub: "waiting for payment", icon: "clock" }
  ]
})
</script>

<template>
  <AntimatterSkeleton v-if="!entry || entry.status === 'loading'" :rows="6" />
  <AntimatterError v-else-if="entry.status === 'error'" :message="entry.message" @retry="load('orders', true)" />
  <template v-else>
    <div class="kpis">
      <div v-for="kpi in kpis" :key="kpi.label" class="card kpi">
        <div class="label"><AntimatterIcon :name="kpi.icon" />{{ kpi.label }}</div>
        <div class="value">{{ kpi.value }}</div>
        <div class="sub">{{ kpi.sub }}</div>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Recent orders</h2><span class="muted">{{ shown.length }} shown</span></div>
      <div v-if="shown.length" class="table-wrap">
        <table>
          <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th class="num">Total</th></tr></thead>
          <tbody>
            <tr v-for="order in shown" :key="order.id" tabindex="0" @click="drawer = order" @keydown.enter="drawer = order">
              <td class="mono">#{{ order.id }}</td>
              <td><div class="person"><AntimatterAvatar :name="order.customerName" size="sm" /><div><strong>{{ order.customerName }}</strong></div></div></td>
              <td><span class="badge" :class="order.status">{{ order.status }}</span></td>
              <td class="num">{{ money(order.totalCents) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="empty"><strong>No orders match "{{ search }}"</strong></div>
    </div>
  </template>
</template>
